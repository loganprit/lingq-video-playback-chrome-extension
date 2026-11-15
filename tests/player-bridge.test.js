const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const core = require("../src/core.js");

const ORIGIN = "https://www.lingq.com";
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

function loadBridge({ existing, get = true, frames = { widget2: existing } }) {
  const src = "https://www.youtube.com/embed/VQMZfw9CYaM?enablejsapi=1&origin=" +
    encodeURIComponent(ORIGIN);
  const frameFor = (id) => ({ id, src, closest: () => null });
  const frameObjects = Object.fromEntries(Object.keys(frames).map((id) => [id, frameFor(id)]));
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

test("reports a play the browser blocked", () => {
  const existing = fakePlayer({ ready: true });
  const bridge = loadBridge({ existing });

  existing.fire("onAutoplayBlocked");
  bridge.bind(1);
  existing.fire("onAutoplayBlocked");

  assert.deepEqual(bridge.events, [
    core.bridgeEvent("ready", 1),
    core.bridgeEvent("blocked", 1),
  ]);
});
