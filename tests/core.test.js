const test = require("node:test");
const assert = require("node:assert/strict");

const core = require("../src/core.js");

const { MODES, PLAYER_STATES } = core;

test("normalizes persisted modes and defaults invalid values to pause", () => {
  assert.equal(core.normalizeMode(MODES.PAUSE), MODES.PAUSE);
  assert.equal(core.normalizeMode(MODES.CONTINUE), MODES.CONTINUE);
  assert.equal(core.normalizeMode(MODES.REPEAT), MODES.REPEAT);
  assert.equal(core.normalizeMode("unexpected"), MODES.PAUSE);
  assert.equal(core.normalizeMode(undefined), MODES.PAUSE);
});

test("maps each mode to its sentence-ended reaction", () => {
  assert.equal(core.reactionForEnded(MODES.PAUSE), "pause");
  assert.equal(core.reactionForEnded(MODES.CONTINUE), "advance-and-play");
  assert.equal(core.reactionForEnded(MODES.REPEAT), "replay");
});

test("only reacts to a deduplicated ended transition after playback armed", () => {
  assert.equal(
    core.shouldReactToEnded(PLAYER_STATES.PLAYING, PLAYER_STATES.ENDED, true),
    true,
  );
  assert.equal(
    core.shouldReactToEnded(PLAYER_STATES.ENDED, PLAYER_STATES.ENDED, true),
    false,
  );
  assert.equal(
    core.shouldReactToEnded(PLAYER_STATES.PLAYING, PLAYER_STATES.PAUSED, true),
    false,
  );
  assert.equal(
    core.shouldReactToEnded(PLAYER_STATES.UNSTARTED, PLAYER_STATES.ENDED, false),
    false,
  );
});

test("parses YouTube state events from strings and objects", () => {
  assert.deepEqual(
    core.parseYouTubeMessage(
      JSON.stringify({ event: "onStateChange", info: 1, id: 7 }),
    ),
    { kind: "state", state: 1, id: 7 },
  );
  assert.deepEqual(
    core.parseYouTubeMessage({
      event: "infoDelivery",
      info: { playerState: 0, currentTime: 2.75, duration: 100 },
      id: 9,
    }),
    {
      kind: "info",
      state: 0,
      currentTime: 2.75,
      duration: 100,
      id: 9,
    },
  );
});

test("ignores malformed and irrelevant YouTube messages", () => {
  assert.equal(core.parseYouTubeMessage("not json"), null);
  assert.equal(core.parseYouTubeMessage(null), null);
  assert.equal(core.parseYouTubeMessage({ event: "onReady", info: null }), null);
  assert.equal(
    core.parseYouTubeMessage({ event: "infoDelivery", info: { volume: 50 } }),
    null,
  );
});

test("accepts only YouTube iframe origins", () => {
  assert.equal(core.isYouTubeOrigin("https://www.youtube.com"), true);
  assert.equal(core.isYouTubeOrigin("https://music.youtube.com"), true);
  assert.equal(core.isYouTubeOrigin("https://www.youtube-nocookie.com"), true);
  assert.equal(core.isYouTubeOrigin("https://youtube.com.evil.example"), false);
  assert.equal(core.isYouTubeOrigin("https://example.com"), false);
  assert.equal(core.isYouTubeOrigin("not a url"), false);
});

test("resolves supported shortcuts without stealing modified or editable input", () => {
  const event = (key, overrides = {}) => ({
    key,
    target: { tagName: "DIV", isContentEditable: false },
    ...overrides,
  });

  assert.equal(core.shortcutAction(event(" ")), "toggle-play");
  assert.equal(core.shortcutAction(event("N")), "next");
  assert.equal(core.shortcutAction(event("r")), "replay");
  assert.equal(core.shortcutAction(event("C")), "toggle-continue");
  assert.equal(core.shortcutAction(event("a")), "continue");
  assert.equal(core.shortcutAction(event("n", { metaKey: true })), null);
  assert.equal(core.shortcutAction(event("n", { repeat: true })), null);
  assert.equal(
    core.shortcutAction(event("n", { target: { tagName: "INPUT" } })),
    null,
  );
  assert.equal(
    core.shortcutAction(
      event(" ", { target: { tagName: "SPAN", isContentEditable: true } }),
    ),
    null,
  );
});

test("toggles between pause and continue without entering repeat", () => {
  assert.equal(core.toggleContinueMode(MODES.PAUSE), MODES.CONTINUE);
  assert.equal(core.toggleContinueMode(MODES.CONTINUE), MODES.PAUSE);
  assert.equal(core.toggleContinueMode(MODES.REPEAT), MODES.CONTINUE);
});

test("extracts a stable sentence key with sensible fallbacks", () => {
  const rootWithId = {
    querySelector(selector) {
      if (selector === ".sentence") return { id: "s17", textContent: "Hola" };
      if (selector === ".sentence-text") return { className: "sentence-text is-page-17" };
      return null;
    },
  };
  assert.equal(core.sentenceKey(rootWithId), "s17");

  const rootWithPage = {
    querySelector(selector) {
      if (selector === ".sentence") return { id: "", textContent: "  Buenos   días " };
      if (selector === ".sentence-text") return { className: "sentence-text is-page-3" };
      return null;
    },
  };
  assert.equal(core.sentenceKey(rootWithPage), "is-page-3");

  assert.equal(core.sentenceKey({ querySelector: () => null }), null);
});
