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

test("maps a released timestamp to one deterministic Sentence", () => {
  const sentences = [
    { timestamp: [1, 2] },
    { timestamp: [2, 3] },
    { timestamp: [4, 5] },
  ];

  for (const [time, sentenceNumber] of [
    [0, 1],
    [1, 1],
    [1.99, 1],
    [2, 2],
    [3, 3],
    [5, 3],
    [6, 3],
  ]) {
    assert.equal(core.sentenceAtTime(sentences, time), sentenceNumber);
  }

  assert.equal(core.sentenceAtTime(sentences, Number.NaN), null);
  assert.equal(core.sentenceAtTime([{ timestamp: [-1, 1] }], 0), null);
  assert.equal(core.sentenceAtTime([{ timestamp: [2, 1] }], 1), null);
  assert.equal(
    core.sentenceAtTime([{ timestamp: [2, 3] }, { timestamp: [1, 2] }], 1),
    null,
  );
});

test("synchronizes only a settled seek to a different Sentence", () => {
  const sentences = [
    { timestamp: [1, 2] },
    { timestamp: [2, 3] },
  ];

  assert.equal(core.seekTarget(sentences, 1, 2.5, true, false), 2);
  assert.equal(core.seekTarget(sentences, 1, 2.5, false, false), null);
  assert.equal(core.seekTarget(sentences, 1, 1.5, true, false), null);
  assert.equal(core.seekTarget(sentences, 1, 2.5, true, true), null);
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

test("plays the activation cue only for a live play request in the same lesson", () => {
  const request = { lessonKey: "es:1", until: 5000 };
  const activation = { play: false, activation: true, lessonKey: "es:1" };

  assert.equal(core.cueCommand(activation, request, 5000), "seek-play");
  assert.equal(core.cueCommand(activation, null, 5000), "seek");
  assert.equal(core.cueCommand(activation, request, 5001), "seek");
  assert.equal(
    core.cueCommand({ ...activation, lessonKey: "es:2" }, request, 5000),
    "seek",
  );
  assert.equal(
    core.cueCommand({ ...activation, activation: false }, request, 5000),
    "seek",
  );
  assert.equal(
    core.cueCommand({ ...activation, activation: false, play: true }, null, 5000),
    "seek-play",
  );
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

test("resumes a near-adjacent Sentence without seeking", () => {
  const segment = { start: 248.91, end: 253.12 };

  assert.equal(core.segmentTransition(true, 248.81, segment), "resume");
  assert.equal(core.segmentTransition(true, 248.65, segment), "seek");
  assert.equal(core.segmentTransition(true, 249.17, segment), "seek");
  assert.equal(core.segmentTransition(false, 248.81, segment), "seek");
  assert.equal(core.segmentTransition(true, segment.end, segment), "seek");
});

test("normalizes persisted Playback Modes to Pause", () => {
  assert.equal(core.playbackMode("pause"), "pause");
  assert.equal(core.playbackMode("continue"), "continue");
  assert.equal(core.playbackMode("repeat"), "repeat");
  assert.equal(core.playbackMode("autoplay"), "pause");
  assert.equal(core.playbackMode(), "pause");
});

test("shows a companion status only when it needs the reader", () => {
  assert.deepEqual(core.companionStatus("loading"), {
    message: "Preparing video…",
    visible: true,
  });
  assert.deepEqual(core.companionStatus("ready"), {
    message: "Video ready.",
    visible: false,
  });
  assert.deepEqual(core.companionStatus("paused"), {
    message: "Playback paused. Press Play in the video to continue.",
    visible: true,
  });
  assert.deepEqual(core.companionStatus("failed"), {
    message: "Video unavailable. Reload this page to retry.",
    visible: true,
  });
  assert.deepEqual(core.companionStatus("unsupported"), {
    message: "This video isn’t supported in Sentence View.",
    visible: true,
  });
  assert.equal(core.companionStatus(), null);
  assert.equal(core.companionStatus("toString"), null);
});

test("chooses each Sentence Boundary reaction without wrapping", () => {
  assert.equal(core.boundaryAction("pause", true), "stay");
  assert.equal(core.boundaryAction("continue", true), "next");
  assert.equal(core.boundaryAction("continue", false), "stay");
  assert.equal(core.boundaryAction("repeat", false), "repeat");
});

test("reacts once only after expected bounded playback", () => {
  const armed = core.boundaryEvent(false, core.PLAYER_STATES.PLAYING, true);
  const reached = core.boundaryEvent(armed.armed, core.PLAYER_STATES.ENDED);

  assert.deepEqual(armed, { armed: true, reached: false });
  assert.deepEqual(reached, { armed: false, reached: true });
  assert.deepEqual(core.boundaryEvent(reached.armed, core.PLAYER_STATES.ENDED), {
    armed: false,
    reached: false,
  });
});

test("resolves shortcuts only for an unmodified page-owned key press", () => {
  assert.equal(core.shortcutAction({ key: "Space" }), "toggle");
  assert.equal(core.shortcutAction({ key: "N" }), "next");
  assert.equal(core.shortcutAction({ key: "P" }), "previous");
  assert.equal(core.shortcutAction({ key: "R" }), "replay");
  assert.equal(core.shortcutAction({ key: "Space", type: "keyup" }), "consume");
  assert.equal(core.shortcutAction({ key: "N", type: "keyup" }), "consume");
  assert.equal(core.shortcutAction({ key: "P", type: "keyup" }), "consume");
  assert.equal(core.shortcutAction({ key: "R", type: "keyup" }), "consume");
  assert.equal(core.shortcutAction({ key: "Space", repeat: true }), "consume");
  assert.equal(core.shortcutAction({ key: "N", repeat: true }), null);
  assert.equal(core.shortcutAction({ key: "P", repeat: true }), null);
  assert.equal(core.shortcutAction({ key: "R", repeat: true }), null);

  for (const blocked of ["modified", "editable", "interactive"]) {
    for (const key of ["N", "P", "R"]) {
      assert.equal(core.shortcutAction({ key, [blocked]: true }), null);
    }
  }
  assert.equal(core.shortcutAction({ key: "X" }), null);
});

test("resolves Space from a focused control but leaves letters to the control", () => {
  const control = { interactive: true };
  assert.equal(core.shortcutAction({ key: "Space", ...control }), "toggle");
  assert.equal(core.shortcutAction({ key: "Space", type: "keyup", ...control }), "consume");
  assert.equal(core.shortcutAction({ key: "Space", repeat: true, ...control }), "consume");
  assert.equal(core.shortcutAction({ key: "Space", modified: true, ...control }), null);

  for (const key of ["N", "P", "R"]) {
    assert.equal(core.shortcutAction({ key, ...control }), null);
    assert.equal(core.shortcutAction({ key, type: "keyup", ...control }), null);
  }

  for (const field of [{ editable: true }, { editable: true, interactive: true }]) {
    assert.equal(core.shortcutAction({ key: "Space", ...field }), null);
    assert.equal(core.shortcutAction({ key: "Space", type: "keyup", ...field }), null);
    assert.equal(core.shortcutAction({ key: "Space", repeat: true, ...field }), null);
  }
});

function holdSpace(target) {
  const page = new EventTarget();
  const actions = [];
  const claimed = [];
  let lingqAudioToggles = 0;

  const companion = (event) => {
    const action = core.claimShortcut(event, true, target);
    if (action && action !== "consume") actions.push(action);
  };
  page.addEventListener("keydown", companion);
  page.addEventListener("keyup", companion);
  page.addEventListener("keydown", () => { lingqAudioToggles += 1; });
  page.addEventListener("keyup", () => { lingqAudioToggles += 1; });

  for (const [type, repeat] of [["keydown", false], ["keydown", true], ["keyup", false]]) {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, {
      code: { value: "Space" },
      key: { value: " " },
      repeat: { value: repeat },
    });
    page.dispatchEvent(event);
    claimed.push(event.defaultPrevented);
  }

  return { actions, claimed, lingqAudioToggles };
}

test("claims a full Space press before LingQ can handle it", () => {
  assert.deepEqual(holdSpace({ editable: false, interactive: false }), {
    actions: ["toggle"],
    claimed: [true, true, true],
    lingqAudioToggles: 0,
  });
});

test("claims a full Space press while a button or link owns focus", () => {
  assert.deepEqual(holdSpace({ editable: false, interactive: true }), {
    actions: ["toggle"],
    claimed: [true, true, true],
    lingqAudioToggles: 0,
  });
});

test("leaves a Space press in a text field to the page", () => {
  assert.deepEqual(holdSpace({ editable: true, interactive: true }), {
    actions: [],
    claimed: [false, false, false],
    lingqAudioToggles: 3,
  });
});

// Holds a key on the selected menu option the way Chrome delivers it: the
// companion's capture listener, then the focused element, then LingQ, then
// the button's native activation. Choosing moves focus to the mode button.
function holdInMenu(key, enabled) {
  const page = new EventTarget();
  const result = { actions: [], choices: 0, reopened: 0, lingq: [] };
  let focus = "item";

  page.addEventListener("keydown", companion);
  page.addEventListener("keyup", companion);
  page.addEventListener("keydown", owner);
  page.addEventListener("keyup", owner);
  page.addEventListener("keydown", lingq);
  page.addEventListener("keyup", lingq);

  function companion(event) {
    const target = { editable: false, interactive: true, menu: focus === "item" };
    const action = core.claimShortcut(event, enabled, target);
    if (action && action !== "consume") result.actions.push(action);
  }
  function owner(event) {
    const action =
      focus === "item" ? core.menuKey(event, 0, 3)?.type : core.menuButtonKey(event);
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (focus === "item" && event.type === "keydown" && action === "choose") {
      result.choices += 1;
      focus = "button";
    }
  }
  function lingq(event) {
    result.lingq.push(`${event.type}:${event.key}`);
  }

  const send = (type, repeat) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, {
      code: { value: key === " " ? "Space" : key },
      key: { value: key },
      repeat: { value: repeat },
    });
    page.dispatchEvent(event);
    const activates = key === " " ? type === "keyup" : type === "keydown";
    if (focus === "button" && activates && !event.defaultPrevented) result.reopened += 1;
  };
  send("keydown", false);
  for (let index = 0; index < 3; index += 1) send("keydown", true);
  send("keyup", false);
  return result;
}

test("chooses with Space in the Playback Mode menu without toggling playback", () => {
  for (const enabled of [true, false]) {
    assert.deepEqual(holdInMenu(" ", enabled), {
      actions: [],
      choices: 1,
      reopened: 0,
      lingq: [],
    });
  }
  for (const key of ["N", "P", "R"]) {
    assert.equal(core.shortcutAction({ key, menu: true, interactive: true }), null);
  }
});

test("chooses once when Enter is held in the Playback Mode menu", () => {
  for (const enabled of [true, false]) {
    assert.deepEqual(holdInMenu("Enter", enabled), {
      actions: [],
      choices: 1,
      reopened: 0,
      lingq: ["keyup:Enter"],
    });
  }
});

test("keeps Escape and Space on the mode button away from LingQ", () => {
  for (const type of ["keydown", "keyup"]) {
    assert.equal(core.menuButtonKey({ type, key: "Escape" }), "consume");
    assert.equal(core.menuButtonKey({ type, key: " " }), "consume");
  }
  assert.equal(core.menuButtonKey({ type: "keydown", key: "Enter", repeat: true }), "consume");
  assert.equal(core.menuButtonKey({ type: "keydown", key: "Enter" }), null);
  assert.equal(core.menuButtonKey({ type: "keydown", key: "ArrowDown" }), "open");
  assert.equal(core.menuButtonKey({ type: "keydown", key: "ArrowUp" }), "open");
  assert.equal(core.menuButtonKey({ type: "keyup", key: "ArrowDown" }), null);
  assert.equal(core.menuButtonKey({ type: "keydown", key: "Escape", ctrlKey: true }), null);
  assert.equal(core.menuButtonKey({ type: "keydown", key: "n" }), null);
});

test("asks for Play only when a play settled paused", () => {
  const { PAUSED, CUED, PLAYING } = core.PLAYER_STATES;

  assert.equal(core.playbackStatus(true, false, PAUSED, true), "paused");
  assert.equal(core.playbackStatus(false, "play", PAUSED, true), "paused");
  assert.equal(core.playbackStatus(false, "play", CUED, true), "paused");
  assert.equal(core.playbackStatus(false, "pause", PAUSED, true), "ready");
  assert.equal(core.playbackStatus(false, false, PAUSED, true), "ready");
  assert.equal(core.playbackStatus(false, "play", PLAYING, true), "ready");
  assert.equal(core.playbackStatus(false, "pause", PAUSED, false), null);
});

test("moves through the Playback Mode menu with wrapping arrows and Home/End", () => {
  const key = (name, index) => core.menuKey({ key: name }, index, 3);

  assert.deepEqual(key("ArrowDown", 0), { type: "focus", index: 1 });
  assert.deepEqual(key("ArrowDown", 2), { type: "focus", index: 0 });
  assert.deepEqual(key("ArrowUp", 0), { type: "focus", index: 2 });
  assert.deepEqual(key("ArrowUp", 2), { type: "focus", index: 1 });
  assert.deepEqual(key("Home", 2), { type: "focus", index: 0 });
  assert.deepEqual(key("End", 0), { type: "focus", index: 2 });
});

test("chooses, closes, or leaves the Playback Mode menu from the keyboard", () => {
  assert.deepEqual(core.menuKey({ key: "Enter" }, 1, 3), { type: "choose", index: 1 });
  assert.deepEqual(core.menuKey({ key: " " }, 2, 3), { type: "choose", index: 2 });
  assert.deepEqual(core.menuKey({ key: " ", repeat: true }, 2, 3), { type: "hold" });
  assert.deepEqual(core.menuKey({ key: "Enter", repeat: true }, 2, 3), { type: "hold" });
  assert.deepEqual(core.menuKey({ key: "Escape" }, 0, 3), { type: "close" });
  assert.deepEqual(core.menuKey({ key: "Tab" }, 0, 3), { type: "leave" });
  assert.deepEqual(core.menuKey({ key: "Tab", shiftKey: true }, 0, 3), { type: "leave" });
  for (const modifier of ["altKey", "ctrlKey", "metaKey"]) {
    assert.equal(core.menuKey({ key: "ArrowDown", [modifier]: true }, 0, 3), null);
  }
  assert.equal(core.menuKey({ key: "n" }, 0, 3), null);
});

test("claims the previous-Sentence key in the same cases as Next", () => {
  const claim = (key, { type = "keydown", enabled = true, target = {}, ...init } = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, {
      code: { value: `Key${key.toUpperCase()}` },
      key: { value: key },
      repeat: { value: Boolean(init.repeat) },
      altKey: { value: Boolean(init.altKey) },
      ctrlKey: { value: Boolean(init.ctrlKey) },
      metaKey: { value: Boolean(init.metaKey) },
      shiftKey: { value: Boolean(init.shiftKey) },
    });
    const action = core.claimShortcut(event, enabled, {
      editable: false,
      interactive: false,
      ...target,
    });
    return { action, claimed: event.defaultPrevented };
  };
  const cases = [
    [{}, "previous"],
    [{ type: "keyup" }, "consume"],
    [{ repeat: true }, null],
    [{ altKey: true }, null],
    [{ ctrlKey: true }, null],
    [{ metaKey: true }, null],
    [{ shiftKey: true }, null],
    [{ target: { editable: true } }, null],
    [{ target: { interactive: true } }, null],
    [{ enabled: false }, null],
  ];

  for (const [init, expected] of cases) {
    const previous = claim("p", init);
    const next = claim("n", init);
    assert.deepEqual(previous, { action: expected, claimed: expected !== null });
    assert.deepEqual(next, {
      action: expected === "previous" ? "next" : expected,
      claimed: previous.claimed,
    });
  }
});

test("accepts only fixed validated player commands", () => {
  const bind = core.bridgeCommand("bind", 3);
  const seek = core.bridgeCommand("seek", 3, { start: 0.55, end: 2.37 });
  const seekPlay = core.bridgeCommand("seek-play", 3, { start: 0.55, end: 2.37 });

  assert.deepEqual(core.parseBridgeCommand(bind), bind);
  assert.deepEqual(core.parseBridgeCommand(seek), seek);
  assert.deepEqual(core.parseBridgeCommand(seekPlay), seekPlay);
  assert.deepEqual(
    core.parseBridgeCommand(core.bridgeCommand("play", 3)),
    core.bridgeCommand("play", 3),
  );
  assert.deepEqual(
    core.parseBridgeCommand(core.bridgeCommand("pause", 3)),
    core.bridgeCommand("pause", 3),
  );
  assert.equal(core.bridgeCommand("cue", 3, { start: 0.55, end: 2.37 }), null);
  assert.equal(core.bridgeCommand("load", 3, { start: 0.55, end: 2.37 }), null);
  assert.equal(core.bridgeCommand("bind", 0), null);
  assert.equal(core.bridgeCommand("seek", 3, { start: 2.37, end: 0.55 }), null);
  assert.equal(
    core.parseBridgeCommand({ ...bind, source: "untrusted-page-script" }),
    null,
  );
});

test("accepts only current-generation player events", () => {
  const ready = core.bridgeEvent("ready", 4);
  const state = core.bridgeEvent("state", 4, { state: 1, currentTime: 0.7 });
  const error = core.bridgeEvent("error", 4, { reason: "player-unavailable" });
  const blocked = core.bridgeEvent("blocked", 4);

  assert.deepEqual(core.parseBridgeEvent(ready, 4), ready);
  assert.deepEqual(core.parseBridgeEvent(blocked, 4), blocked);
  assert.equal("detail" in blocked, false);
  assert.deepEqual(core.parseBridgeEvent(state, 4), state);
  assert.deepEqual(core.parseBridgeEvent(error, 4), error);
  assert.equal(core.parseBridgeEvent(ready, 5), null);
  assert.equal(core.bridgeEvent("playing", 4), null);
  assert.equal(
    core.parseBridgeEvent({ ...ready, direction: "to-player" }, 4),
    null,
  );
});

test("chooses one lifecycle action for context changes", () => {
  const frame = {};
  const current = { lessonKey: "es:1", frame };

  assert.equal(core.lifecycleAction(null, current), "bind");
  assert.equal(core.lifecycleAction(current, current), "retain");
  assert.equal(
    core.lifecycleAction(current, { lessonKey: "es:2", frame }),
    "bind",
  );
  assert.equal(
    core.lifecycleAction(current, { lessonKey: "es:1", frame: {} }),
    "bind",
  );
});

test("rebinds layout owners when LingQ rerenders around the mounted player", () => {
  const frame = {};
  const modal = {};
  const portal = {};
  const reader = {};
  const footer = {};
  const current = { modal, portal, reader, footer };

  assert.equal(core.layoutAction(current, current), "retain");
  assert.equal(core.layoutAction(current, { ...current, reader: {} }), "rebind");
  assert.equal(core.layoutAction(current, { ...current, footer: {} }), "rebind");
  assert.equal(core.layoutAction(current, { ...current, portal: {} }), "rebind");
  assert.equal(core.layoutAction(current, { ...current, modal: {} }), "replace");
  assert.equal(
    core.lifecycleAction(
      { lessonKey: "es:1", frame, ...current },
      { lessonKey: "es:1", frame, ...current, reader: {} },
    ),
    "bind",
  );
});
