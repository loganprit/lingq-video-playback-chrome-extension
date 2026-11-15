const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const core = require("../src/core.js");

const ORIGIN = "https://www.lingq.com";
const YOUTUBE = "https://www.youtube.com";
const SOURCE = fs.readFileSync(
  path.join(__dirname, "../src/player-bridge.js"),
  "utf8",
);

function fakePlayer({ ready }) {
  const listeners = {};
  const player = {
    addEventListener(type, listener) {
      (listeners[type] ||= []).push(listener);
    },
    // Real YT players have no working removeEventListener, and their command
    // proxies throw once the player is destroyed.
    destroy() {
      player.removeEventListener = player.pauseVideo = () => {
        throw new TypeError("Cannot read properties of null (reading 'src')");
      };
    },
    becomeReady() {
      Object.assign(player, {
        getCurrentTime: () => 12.5,
        pauseVideo() {},
        playVideo() {},
        seekTo() {},
      });
    },
    fire(type, data) {
      for (const listener of listeners[type] || []) listener({ target: player, data });
    },
  };
  if (ready) player.becomeReady();
  return player;
}

// The document inside a YouTube iframe. It reports only the player events it
// was asked for, and a repeated request changes nothing. The YT player asks
// once per event type, so the first embed has every event and a reloaded one
// has none.
function fakeEmbed(widgetId, events) {
  const subscriptions = new Set(events);
  const origins = [];
  return {
    subscriptions,
    origins,
    postMessage(data, origin) {
      origins.push(origin);
      const message = JSON.parse(data);
      if (
        origin === YOUTUBE &&
        message.event === "command" &&
        message.func === "addEventListener" &&
        message.channel === "widget" &&
        message.id === widgetId
      ) {
        subscriptions.add(message.args[0]);
      }
    },
  };
}

function loadBridge({ existing, get = true, frames = { widget2: existing } }) {
  const src = `${YOUTUBE}/embed/VQMZfw9CYaM?enablejsapi=1&origin=` +
    encodeURIComponent(ORIGIN);
  const frameFor = (id, index) => ({
    id,
    src,
    closest: () => null,
    contentWindow: fakeEmbed(index + 1, ["onStateChange", "onError", "onAutoplayBlocked"]),
  });
  const frameObjects = Object.fromEntries(
    Object.keys(frames).map((id, index) => [id, frameFor(id, index)]),
  );
  let current = frameObjects[Object.keys(frames)[0]];
  const constructed = [];
  const events = [];
  const handlers = [];
  const window = {
    addEventListener(type, handler) {
      handlers.push(handler);
    },
    postMessage(data, origin) {
      if (data.direction === "from-player") events.push(data);
      for (const handler of handlers) handler({ source: window, origin, data });
    },
  };
  const YT = {
    Player: function Player(id, options) {
      const player = fakePlayer({ ready: false });
      for (const [type, listener] of Object.entries(options?.events || {})) {
        player.addEventListener(type, listener);
      }
      constructed.push({ id, player });
      return player;
    },
    ...(get ? { get: (id) => frames[id] } : {}),
  };

  vm.runInNewContext(SOURCE, {
    LingqPlaybackCore: core,
    YT,
    clearInterval() {},
    document: { querySelectorAll: () => [current] },
    location: { href: `${ORIGIN}/en/learn/es/web/reader/1`, origin: ORIGIN },
    setInterval: () => 0,
    setTimeout: () => 0,
    window,
  });

  return {
    constructed,
    events,
    bind(generation, id) {
      if (id) current = frameObjects[id];
      window.postMessage(core.bridgeCommand("bind", generation), ORIGIN);
    },
    // Moving an iframe in the DOM reloads it into a new window.
    reload(id) {
      frameObjects[id].contentWindow = fakeEmbed(Object.keys(frames).indexOf(id) + 1, []);
    },
    // An embed says this each time it finishes loading.
    announce(id, message = {}) {
      const event = {
        source: frameObjects[id].contentWindow,
        origin: YOUTUBE,
        data: JSON.stringify({
          event: "onReady",
          info: null,
          channel: "widget",
          id: Object.keys(frames).indexOf(id) + 1,
        }),
        ...message,
      };
      for (const handler of handlers) handler(event);
    },
    embed: (id) => frameObjects[id].contentWindow,
    embedEvent(id, type, data) {
      if (frameObjects[id].contentWindow.subscriptions.has(type)) frames[id].fire(type, data);
    },
  };
}

test("controls the player LingQ already created for the frame", () => {
  const existing = fakePlayer({ ready: true });
  const bridge = loadBridge({ existing });

  bridge.bind(1);

  assert.equal(bridge.constructed.length, 0);
  assert.deepEqual(bridge.events, [core.bridgeEvent("ready", 1)]);

  existing.fire("onStateChange", core.PLAYER_STATES.PAUSED);
  assert.deepEqual(bridge.events.at(-1), core.bridgeEvent("state", 1, {
    state: core.PLAYER_STATES.PAUSED,
    currentTime: 12.5,
  }));
});

test("becomes ready when LingQ's player does", () => {
  const existing = fakePlayer({ ready: false });
  const bridge = loadBridge({ existing });

  bridge.bind(1);
  assert.deepEqual(bridge.events, []);

  existing.becomeReady();
  existing.fire("onReady");

  assert.equal(bridge.constructed.length, 0);
  assert.deepEqual(bridge.events, [core.bridgeEvent("ready", 1)]);
});

test("reports each player state once after rebinding the same frame", () => {
  const existing = fakePlayer({ ready: true });
  const bridge = loadBridge({ existing });

  bridge.bind(1);
  bridge.bind(2);
  existing.fire("onStateChange", core.PLAYER_STATES.PLAYING);

  assert.deepEqual(
    bridge.events.filter((event) => event.type === "state"),
    [
      core.bridgeEvent("state", 2, {
        state: core.PLAYER_STATES.PLAYING,
        currentTime: 12.5,
      }),
    ],
  );
});

test("creates a player only for a frame that has none", () => {
  for (const options of [{ existing: undefined }, { existing: null }, { get: false }]) {
    const bridge = loadBridge(options);

    bridge.bind(1);
    assert.deepEqual(bridge.constructed.map(({ id }) => id), ["widget2"]);
    assert.deepEqual(bridge.events, []);

    bridge.constructed[0].player.becomeReady();
    bridge.constructed[0].player.fire("onReady");
    assert.deepEqual(bridge.events, [core.bridgeEvent("ready", 1)]);
  }
});

test("reports each state once after returning to an earlier frame", () => {
  const first = fakePlayer({ ready: true });
  const second = fakePlayer({ ready: true });
  const bridge = loadBridge({ frames: { widget2: first, widget7: second } });

  bridge.bind(1, "widget2");
  bridge.bind(2, "widget7");
  bridge.bind(3, "widget2");
  first.fire("onStateChange", core.PLAYER_STATES.PLAYING);

  assert.equal(bridge.constructed.length, 0);
  assert.deepEqual(
    bridge.events.filter((event) => event.type === "state"),
    [
      core.bridgeEvent("state", 3, {
        state: core.PLAYER_STATES.PLAYING,
        currentTime: 12.5,
      }),
    ],
  );
});

test("binds a new frame after LingQ destroys the previous player", () => {
  const first = fakePlayer({ ready: true });
  const second = fakePlayer({ ready: true });
  const bridge = loadBridge({ frames: { widget2: first, widget7: second } });

  bridge.bind(1, "widget2");
  first.destroy();
  bridge.bind(2, "widget7");

  assert.equal(bridge.constructed.length, 0);
  assert.deepEqual(bridge.events, [
    core.bridgeEvent("ready", 1),
    core.bridgeEvent("ready", 2),
  ]);
});

test("reports a play the browser blocked on the current ready player", () => {
  const first = fakePlayer({ ready: false });
  const second = fakePlayer({ ready: true });
  const bridge = loadBridge({ frames: { widget2: first, widget7: second } });

  bridge.bind(1, "widget2");
  first.fire("onAutoplayBlocked");
  bridge.bind(2, "widget7");
  first.fire("onAutoplayBlocked");
  second.fire("onAutoplayBlocked");

  assert.deepEqual(bridge.events, [
    core.bridgeEvent("ready", 2),
    core.bridgeEvent("blocked", 2),
  ]);
});

test("waits for a moved frame's embed before reporting ready", () => {
  const existing = fakePlayer({ ready: true });
  const bridge = loadBridge({ existing });

  bridge.announce("widget2");
  bridge.bind(1);
  bridge.reload("widget2");
  bridge.bind(2);
  assert.deepEqual(bridge.events, [core.bridgeEvent("ready", 1)]);

  bridge.announce("widget2");
  assert.deepEqual(bridge.events, [
    core.bridgeEvent("ready", 1),
    core.bridgeEvent("ready", 2),
  ]);
});

test("waits for the embed when the frame moved before the first bind", () => {
  const existing = fakePlayer({ ready: true });
  const bridge = loadBridge({ existing });

  bridge.announce("widget2");
  bridge.reload("widget2");
  bridge.bind(1);
  assert.deepEqual(bridge.events, []);

  bridge.announce("widget2");
  assert.deepEqual(bridge.events, [core.bridgeEvent("ready", 1)]);
});

test("reports player events again after the bound frame's embed reloads", () => {
  const existing = fakePlayer({ ready: true });
  const bridge = loadBridge({ existing });

  bridge.announce("widget2");
  bridge.bind(1);
  bridge.reload("widget2");
  bridge.announce("widget2");
  bridge.embedEvent("widget2", "onStateChange", core.PLAYER_STATES.PLAYING);
  bridge.embedEvent("widget2", "onAutoplayBlocked");
  bridge.embedEvent("widget2", "onError");

  assert.deepEqual(bridge.events, [
    core.bridgeEvent("ready", 1),
    core.bridgeEvent("ready", 1),
    core.bridgeEvent("state", 1, {
      state: core.PLAYER_STATES.PLAYING,
      currentTime: 12.5,
    }),
    core.bridgeEvent("blocked", 1),
    core.bridgeEvent("error", 1, { reason: "player-error" }),
  ]);
});

test("takes a ready announcement only from the bound frame's YouTube embed", () => {
  const first = fakePlayer({ ready: true });
  const second = fakePlayer({ ready: true });
  const bridge = loadBridge({ frames: { widget2: first, widget7: second } });

  bridge.announce("widget2");
  bridge.bind(1, "widget2");
  bridge.reload("widget7");
  bridge.announce("widget7");
  assert.deepEqual(bridge.events, [core.bridgeEvent("ready", 1)]);
  assert.deepEqual([...bridge.embed("widget7").subscriptions], []);

  bridge.reload("widget2");
  bridge.bind(2, "widget2");
  bridge.announce("widget2", { origin: "https://example.com" });
  bridge.announce("widget2", { data: "onReady" });
  bridge.announce("widget2", { data: JSON.stringify({ event: "onReady" }) });
  bridge.announce("widget2", { data: { event: "onReady", channel: "widget" } });
  bridge.announce("widget2", { source: null });
  bridge.announce("widget2", { origin: "https://www.youtube.com.example" });
  bridge.announce("widget2", {
    data: JSON.stringify({ event: "infoDelivery", info: "onReady", channel: "widget", id: 1 }),
  });

  assert.deepEqual(bridge.events, [core.bridgeEvent("ready", 1)]);
  assert.deepEqual([...bridge.embed("widget2").subscriptions], []);
});

test("re-subscribes a reloaded embed under its own widget id and origin", () => {
  const other = fakePlayer({ ready: true });
  const existing = fakePlayer({ ready: true });
  const bridge = loadBridge({ frames: { widget5: other, widget2: existing } });

  bridge.announce("widget2");
  bridge.bind(1, "widget2");
  bridge.reload("widget2");
  bridge.announce("widget2");

  assert.deepEqual(
    [...bridge.embed("widget2").subscriptions],
    ["onStateChange", "onError", "onAutoplayBlocked"],
  );

  bridge.reload("widget2");
  bridge.announce("widget2", { origin: "https://www.youtube-nocookie.com" });
  assert.deepEqual(
    bridge.embed("widget2").origins,
    Array(3).fill("https://www.youtube-nocookie.com"),
  );
  assert.deepEqual(bridge.events, [
    core.bridgeEvent("ready", 1),
    core.bridgeEvent("ready", 1),
    core.bridgeEvent("ready", 1),
  ]);
});

test("waits for the player after an announcement that comes first", () => {
  const existing = fakePlayer({ ready: false });
  const bridge = loadBridge({ existing });

  bridge.bind(1);
  bridge.announce("widget2");
  assert.deepEqual(bridge.events, []);

  existing.becomeReady();
  existing.fire("onReady");
  assert.deepEqual(bridge.events, [core.bridgeEvent("ready", 1)]);
});
