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
        playerState: 1,
        volume: 80,
        volumes: [],
        getPlayerState: () => player.playerState,
        getVolume: () => player.volume,
        // getVolume reads a copy the embed updates a few ms later.
        setVolume(volume) {
          player.volumes.push(volume);
          player.echo = () => {
            player.volume = volume;
          };
        },
        getCurrentTime: () => 12.5,
        rates: [],
        setPlaybackRate(rate) {
          player.rates.push(rate);
        },
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
    contentWindow: fakeEmbed(index + 1, [
      "onStateChange",
      "onError",
      "onAutoplayBlocked",
      "onPlaybackRateChange",
    ]),
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

  // An Audio element. LingQ never adds the ones it reads words with to the page.
  class HTMLMediaElement {
    constructor(src, started = Promise.resolve()) {
      this.src = src;
      this.started = started;
      this.paused = true;
      this.listeners = {};
    }
    addEventListener(type, listener) {
      (this.listeners[type] ||= []).push(listener);
    }
    // A clip that ends is paused, and pause and emptied events from a source
    // change can arrive after play() has started the next one.
    dispatch(type, paused = ["ended", "pause"].includes(type) || this.paused) {
      this.paused = paused;
      for (const listener of this.listeners[type] || []) listener();
    }
  }
  HTMLMediaElement.prototype.play = function play() {
    this.paused = false;
    return this.started;
  };
  const stalls = new Map();
  let timers = 0;
  let now = 0;

  vm.runInNewContext(SOURCE, {
    HTMLMediaElement,
    LingqPlaybackCore: core,
    YT,
    clearInterval() {},
    document: { querySelectorAll: () => [current] },
    location: { href: `${ORIGIN}/en/learn/es/web/reader/1`, origin: ORIGIN },
    Date: { now: () => now },
    clearTimeout: (id) => stalls.delete(id),
    setInterval: () => 0,
    // Only the bridge's word-audio limit waits 10 s.
    setTimeout(callback, ms) {
      if (ms !== 10000) return 0;
      stalls.set(++timers, callback);
      return timers;
    },
    window,
  });

  return {
    clip: (src, started) => new HTMLMediaElement(src, started),
    advance(ms) {
      now += ms;
    },
    stalls,
    stall() {
      for (const callback of stalls.values()) callback();
    },
    constructed,
    events,
    bind(generation, id) {
      if (id) current = frameObjects[id];
      window.postMessage(core.bridgeCommand("bind", generation), ORIGIN);
    },
    send(data, origin = ORIGIN) {
      window.postMessage(data, origin);
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
    ["onStateChange", "onError", "onAutoplayBlocked", "onPlaybackRateChange"],
  );

  bridge.reload("widget2");
  bridge.announce("widget2", { origin: "https://www.youtube-nocookie.com" });
  assert.deepEqual(
    bridge.embed("widget2").origins,
    Array(4).fill("https://www.youtube-nocookie.com"),
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

test("sets the bound player's playback rate", () => {
  const existing = fakePlayer({ ready: true });
  const bridge = loadBridge({ existing });

  bridge.bind(1);
  bridge.send(core.bridgeCommand("rate", 1, 0.75));
  bridge.send(core.bridgeCommand("rate", 2, 0.5));
  bridge.send({ ...core.bridgeCommand("rate", 1, 0.75), rate: 3 });
  bridge.send(core.bridgeCommand("rate", 1, 0.5), "https://example.com");

  assert.deepEqual(existing.rates, [0.75]);
});

test("reports a rate change from the player, including YouTube's own menu", () => {
  const existing = fakePlayer({ ready: true });
  const bridge = loadBridge({ existing });

  existing.fire("onPlaybackRateChange", 0.5);
  bridge.bind(1);
  existing.fire("onPlaybackRateChange", 1.5);
  existing.fire("onPlaybackRateChange", "fast");

  assert.deepEqual(bridge.events, [
    core.bridgeEvent("ready", 1),
    core.bridgeEvent("rate", 1, { rate: 1.5 }),
  ]);
});

test("reports rate changes again after the bound frame's embed reloads", () => {
  const existing = fakePlayer({ ready: true });
  const bridge = loadBridge({ existing });

  bridge.announce("widget2");
  bridge.bind(1);
  bridge.reload("widget2");
  bridge.announce("widget2");
  bridge.embedEvent("widget2", "onPlaybackRateChange", 0.75);

  assert.deepEqual(bridge.events.at(-1), core.bridgeEvent("rate", 1, { rate: 0.75 }));
});

const WORD = "https://s3.amazonaws.com/media.lingq.com/resources/tts/audio/esLucia_58e5b48a.mp3";

test("plays the video quieter while LingQ reads a word aloud", () => {
  const existing = fakePlayer({ ready: true });
  const bridge = loadBridge({ existing });
  bridge.bind(1);

  const first = bridge.clip(WORD);
  const second = bridge.clip(WORD.replace("58e5b48a", "c5cc8138"));
  first.play();
  second.play();
  assert.deepEqual(existing.volumes, [24]);

  first.dispatch("ended");
  assert.deepEqual(existing.volumes, [24]);
  second.dispatch("pause");
  assert.deepEqual(existing.volumes, [24, 80]);

  first.play();
  first.dispatch("ended");
  assert.deepEqual(existing.volumes, [24, 80, 24, 80]);
});

test("leaves the volume alone for other audio and a paused or unbound video", () => {
  const existing = fakePlayer({ ready: true });
  const bridge = loadBridge({ existing });

  bridge.clip(WORD).play();
  bridge.bind(1);
  bridge.clip("data:audio/mp3;base64,//MkxAAH").play();
  bridge.clip("https://media.lingq.com/media/audionorm/lesson.mp3").play();
  existing.playerState = core.PLAYER_STATES.PAUSED;
  bridge.clip(WORD).play();

  assert.deepEqual(existing.volumes, []);
});

test("restores the volume when a word clip can't play", async () => {
  const existing = fakePlayer({ ready: true });
  const bridge = loadBridge({ existing });
  bridge.bind(1);

  const refused = Promise.reject(new Error("NotAllowedError"));
  bridge.clip(WORD, refused).play().catch(() => {});
  assert.deepEqual(existing.volumes, [24]);
  await refused.catch(() => {});
  await Promise.resolve();
  assert.deepEqual(existing.volumes, [24, 80]);
});

test("keeps the video's own volume when a word starts as another ends", () => {
  const existing = fakePlayer({ ready: true });
  const bridge = loadBridge({ existing });
  bridge.bind(1);

  const first = bridge.clip(WORD);
  first.play();
  existing.echo();
  first.dispatch("ended");
  bridge.clip(WORD).play();
  existing.echo();

  assert.deepEqual(existing.volumes, [24, 80, 24]);
});

test("keeps the video quiet when LingQ reuses a clip for the next word", () => {
  const existing = fakePlayer({ ready: true });
  const bridge = loadBridge({ existing });
  bridge.bind(1);

  const clip = bridge.clip(WORD);
  clip.play();
  clip.src = WORD.replace("58e5b48a", "c5cc8138");
  clip.play();
  clip.dispatch("pause", false);
  clip.dispatch("emptied");
  assert.deepEqual(existing.volumes, [24]);

  clip.dispatch("ended");
  assert.deepEqual(existing.volumes, [24, 80]);
});

test("restores the volume after a stalled clip, a rebind, or an error", () => {
  const existing = fakePlayer({ ready: true });
  const other = fakePlayer({ ready: true });
  const bridge = loadBridge({ existing, frames: { widget2: existing, widget3: other } });
  bridge.bind(1);

  bridge.clip(WORD).play();
  bridge.stall();
  assert.deepEqual(existing.volumes, [24, 80]);

  bridge.clip(WORD).play();
  bridge.bind(2, "widget3");
  assert.deepEqual(existing.volumes, [24, 80, 24, 80]);

  existing.volumes.length = 0;
  bridge.bind(3, "widget2");
  const broken = bridge.clip(WORD);
  broken.play();
  broken.dispatch("error");
  assert.deepEqual(existing.volumes, [24, 80]);
});

test("keeps a volume the user sets to the lowered level", () => {
  const existing = fakePlayer({ ready: true });
  const bridge = loadBridge({ existing });
  bridge.bind(1);

  const first = bridge.clip(WORD);
  first.play();
  existing.echo();
  first.dispatch("ended");
  existing.echo();
  existing.volume = 24;
  bridge.advance(3000);
  bridge.clip(WORD).play();

  assert.deepEqual(existing.volumes, [24, 80, 7]);
});

test("times only the latest word against the duck's limit", () => {
  const existing = fakePlayer({ ready: true });
  const bridge = loadBridge({ existing });
  bridge.bind(1);

  const first = bridge.clip(WORD);
  first.play();
  bridge.clip(WORD).play();
  assert.equal(bridge.stalls.size, 1);

  bridge.stall();
  bridge.clip(WORD).play();
  assert.equal(bridge.stalls.size, 1);
});

test("ducks a word by its new source and while the video buffers", () => {
  const existing = fakePlayer({ ready: true });
  const bridge = loadBridge({ existing });
  bridge.bind(1);
  existing.playerState = core.PLAYER_STATES.BUFFERING;

  const clip = bridge.clip(WORD);
  clip.currentSrc = "data:audio/mp3;base64,//MkxAAH";
  clip.play();
  assert.deepEqual(existing.volumes, [24]);

  clip.dispatch("emptied", true);
  assert.deepEqual(existing.volumes, [24, 80]);
});

test("stays quiet when a new word aborts the clip's previous play", async () => {
  const existing = fakePlayer({ ready: true });
  const bridge = loadBridge({ existing });
  bridge.bind(1);

  const aborted = Promise.reject(new Error("AbortError"));
  const clip = bridge.clip(WORD, aborted);
  clip.play().catch(() => {});
  clip.started = Promise.resolve();
  clip.play();
  await aborted.catch(() => {});
  await Promise.resolve();

  assert.deepEqual(existing.volumes, [24]);
});
