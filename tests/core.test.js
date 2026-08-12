const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("../src/core.js");

test("identifies the current LingQ lesson from its reader URL", () => {
  assert.deepEqual(core.readerLesson("/en/learn/es/web/reader/39351008"), {
    key: "es:39351008",
    endpoint: "/api/v3/es/lessons/39351008/sentences/",
  });
  assert.equal(core.readerLesson("/en/learn/es/web/library"), null);
});

test("resolves only a valid bounded segment for the active Sentence", () => {
  const sentences = [
    { timestamp: [0, 0.45] },
    { timestamp: [0.55, 2.37] },
  ];

  assert.deepEqual(core.activeSegment(sentences, "s2"), {
    sentenceNumber: 2,
    start: 0.55,
    end: 2.37,
  });
  assert.equal(core.activeSegment(sentences, "sentence-2"), null);
  assert.equal(core.activeSegment([{ timestamp: [2, 1] }], "s1"), null);
  assert.equal(core.activeSegment([{ timestamp: [0, "1"] }], "s1"), null);
  assert.equal(core.activeSegment(sentences, "s3"), null);
});

test("accepts only a LingQ sentence response array", () => {
  const sentences = [{ timestamp: [0, 0.45] }];

  assert.equal(core.sentenceResponse(sentences), sentences);
  assert.equal(core.sentenceResponse({ results: sentences }), null);
  assert.equal(core.sentenceResponse(null), null);
});

test("cues initially only when both player and active bounds are valid", () => {
  const sentences = [{ timestamp: [0.55, 2.37] }];

  assert.deepEqual(core.initialCue(sentences, "s1", true), {
    sentenceNumber: 1,
    start: 0.55,
    end: 2.37,
  });
  assert.equal(core.initialCue(sentences, "s1", false), null);
  assert.equal(core.initialCue([{ timestamp: [2, 1] }], "s1", true), null);
});

test("accepts only same-origin JavaScript-enabled YouTube embeds", () => {
  const origin = "https://www.lingq.com";
  const baseUrl = `${origin}/unused`;

  assert.equal(
    core.youtubeEmbedId(
      "https://www.youtube.com/embed/LBo8NDfoCCY?enablejsapi=1&origin=https%3A%2F%2Fwww.lingq.com",
      baseUrl,
      origin,
    ),
    "LBo8NDfoCCY",
  );
  assert.equal(
    core.youtubeEmbedId(
      "https://www.youtube.com/embed/LBo8NDfoCCY?enablejsapi=1&origin=https%3A%2F%2Fevil.example",
      baseUrl,
      origin,
    ),
    null,
  );
});

test("chooses only available adjacent Sentences", () => {
  assert.equal(core.adjacentSentence(1, 208, "previous"), null);
  assert.equal(core.adjacentSentence(1, 208, "next"), 2);
  assert.equal(core.adjacentSentence(208, 208, "previous"), 207);
  assert.equal(core.adjacentSentence(208, 208, "next"), null);
});

test("chooses explicit bounded playback commands", () => {
  const segment = { start: 4.27, end: 7.13 };

  assert.equal(core.explicitPlayback(core.PLAYER_STATES.PLAYING, 5, segment), "pause");
  assert.equal(core.explicitPlayback(core.PLAYER_STATES.PAUSED, 5, segment), "play");
  assert.equal(core.explicitPlayback(core.PLAYER_STATES.ENDED, 7.13, segment), "load");
  assert.equal(core.explicitPlayback(core.PLAYER_STATES.PAUSED, 0, segment), "load");
});

test("resolves shortcuts only for an unmodified page-owned key press", () => {
  assert.equal(core.shortcutAction({ key: "Space" }), "toggle");
  assert.equal(core.shortcutAction({ key: "N" }), "next");
  assert.equal(core.shortcutAction({ key: "R" }), "replay");

  for (const blocked of ["modified", "repeat", "editable", "interactive"]) {
    assert.equal(core.shortcutAction({ key: "R", [blocked]: true }), null);
  }
  assert.equal(core.shortcutAction({ key: "X" }), null);
});

test("accepts only fixed validated player commands", () => {
  const bind = core.bridgeCommand("bind", 3);
  const cue = core.bridgeCommand("cue", 3, { start: 0.55, end: 2.37 });
  const load = core.bridgeCommand("load", 3, { start: 0.55, end: 2.37 });

  assert.deepEqual(core.parseBridgeCommand(bind), bind);
  assert.deepEqual(core.parseBridgeCommand(cue), cue);
  assert.deepEqual(core.parseBridgeCommand(load), load);
  assert.deepEqual(
    core.parseBridgeCommand(core.bridgeCommand("play", 3)),
    core.bridgeCommand("play", 3),
  );
  assert.deepEqual(
    core.parseBridgeCommand(core.bridgeCommand("pause", 3)),
    core.bridgeCommand("pause", 3),
  );
  assert.equal(core.bridgeCommand("seekTo", 3, { start: 0.55, end: 2.37 }), null);
  assert.equal(core.bridgeCommand("bind", 0), null);
  assert.equal(core.bridgeCommand("cue", 3, { start: 2.37, end: 0.55 }), null);
  assert.equal(
    core.parseBridgeCommand({ ...bind, source: "untrusted-page-script" }),
    null,
  );
});

test("accepts only current-generation player events", () => {
  const ready = core.bridgeEvent("ready", 4);
  const state = core.bridgeEvent("state", 4, { state: 1, currentTime: 0.7 });
  const error = core.bridgeEvent("error", 4, { reason: "player-unavailable" });

  assert.deepEqual(core.parseBridgeEvent(ready, 4), ready);
  assert.deepEqual(core.parseBridgeEvent(state, 4), state);
  assert.deepEqual(core.parseBridgeEvent(error, 4), error);
  assert.equal(core.parseBridgeEvent(ready, 5), null);
  assert.equal(core.bridgeEvent("playing", 4), null);
  assert.equal(
    core.parseBridgeEvent({ ...ready, direction: "to-player" }, 4),
    null,
  );
});
