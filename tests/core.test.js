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

test("holds at the Sentence Boundary in every Playback Mode while a selection is open", () => {
  for (const mode of ["pause", "continue", "repeat"]) {
    assert.equal(core.boundaryAction(mode, true, true), "hold");
    assert.equal(core.boundaryAction(mode, false, true), "hold");
  }
  assert.equal(core.boundaryAction("continue", true, false), "next");
});

test("runs the Playback Mode's reaction when a held selection ends", () => {
  const hold = { kind: "hold", at: "es:1:s11" };
  assert.equal(core.waitRelease(hold, "es:1:s11", "pause", true), "stay");
  assert.equal(core.waitRelease(hold, "es:1:s11", "continue", true), "next");
  assert.equal(core.waitRelease(hold, "es:1:s11", "continue", false), "stay");
  assert.equal(core.waitRelease(hold, "es:1:s11", "repeat", true), "repeat");
});

test("recognizes LingQ's spoken words among its audio", () => {
  assert.equal(
    core.wordAudio("https://s3.amazonaws.com/media.lingq.com/resources/tts/audio/esLucia_58e5b48a.mp3"),
    true,
  );
  assert.equal(core.wordAudio("https://media.lingq.com/resources/tts/audio/x.mp3"), true);
  assert.equal(core.wordAudio("data:audio/mp3;base64,//MkxAAH"), false);
  assert.equal(core.wordAudio("https://evil.example/media.lingq.com/resources/tts/x.mp3"), false);
  assert.equal(core.wordAudio(undefined), false);
});

test("lowers the video to 30% of its volume under a spoken word", () => {
  assert.equal(core.duckedVolume(100), 30);
  assert.equal(core.duckedVolume(55), 17);
  assert.equal(core.duckedVolume(undefined), null);
});

test("ignores a selection that ends before the boundary or while paused", () => {
  for (const mode of ["pause", "continue", "repeat"]) {
    assert.equal(core.waitRelease(null, "es:1:s11", mode, true), null);
  }
});

test("drops a hold whose sentence is no longer active without reacting", () => {
  const hold = { kind: "hold", at: "es:1:s11" };
  assert.equal(core.waitRelease(hold, "es:1:s12", "continue", true), null);
  assert.equal(core.waitRelease(hold, "es:2:s11", "continue", true), null);
  assert.equal(core.waitRelease(hold, null, "repeat", true), null);
  assert.equal(core.waitRelease({ kind: "hold", at: null }, null, "repeat", true), null);
});

const SHORT = "Hola, ¿qué tal?";
const LONG =
  "En general, la gente es muy comprensiva, pero si tú quieres encajar mejor en la cultura y saber cómo comportarte correctamente en ciertas circunstancias, este episodio es para ti.";
const DELAYS = {
  off: { kind: "off" },
  seconds: { kind: "seconds", seconds: 3 },
  reading: { kind: "reading" },
};
const settle = (mode, delay, hasNext, selectionOpen, text = LONG) =>
  core.boundaryReaction({ playbackMode: mode, boundaryDelay: delay }, hasNext, selectionOpen, text);

test("normalizes the settings record and falls back to defaults", () => {
  const defaults = {
    playbackMode: "pause",
    boundaryDelay: { kind: "off" },
    sentenceVisibility: "always",
    neighborSentences: true,
  };
  assert.deepEqual(core.companionSettings(), defaults);
  assert.deepEqual(core.companionSettings("continue"), defaults);
  assert.deepEqual(
    core.companionSettings({
      playbackMode: "repeat",
      boundaryDelay: { kind: "seconds", seconds: 10, extra: true },
      sentenceVisibility: "listen-first",
      neighborSentences: false,
      extra: 1,
    }),
    {
      playbackMode: "repeat",
      boundaryDelay: { kind: "seconds", seconds: 10 },
      sentenceVisibility: "listen-first",
      neighborSentences: false,
    },
  );
  assert.deepEqual(core.companionSettings({ boundaryDelay: { kind: "reading", seconds: 4 } }), {
    playbackMode: "pause",
    boundaryDelay: { kind: "reading" },
    sentenceVisibility: "always",
    neighborSentences: true,
  });
  for (const visibility of ["always", "listen-first", "show-on-pause"]) {
    assert.equal(core.companionSettings({ sentenceVisibility: visibility }).sentenceVisibility, visibility);
  }
  for (const visibility of ["Listen First", "hidden", "", null, 1]) {
    assert.equal(core.companionSettings({ sentenceVisibility: visibility }).sentenceVisibility, "always");
  }
  for (const seconds of [0, 11, 2.5, "3", undefined, NaN]) {
    assert.deepEqual(core.boundaryDelay({ kind: "seconds", seconds }), { kind: "off" });
  }
  assert.deepEqual(core.boundaryDelay({ kind: "seconds", seconds: 1 }), { kind: "seconds", seconds: 1 });
  assert.deepEqual(core.boundaryDelay({ kind: "later" }), { kind: "off" });
  assert.deepEqual(core.boundaryDelay(null), { kind: "off" });
});

test("carries the old stored Playback Mode into the settings record", () => {
  assert.deepEqual(core.storedSettings({ playbackMode: "continue" }), {
    playbackMode: "continue",
    boundaryDelay: { kind: "off" },
    sentenceVisibility: "always",
    neighborSentences: true,
  });
  assert.deepEqual(core.storedSettings({ playbackMode: "autoplay" }).playbackMode, "pause");
  assert.deepEqual(core.storedSettings({}), core.companionSettings());
  assert.deepEqual(core.storedSettings(undefined), core.companionSettings());
});

test("prefers a stored settings record over the old Playback Mode key", () => {
  const settings = {
    playbackMode: "pause",
    boundaryDelay: { kind: "reading" },
    sentenceVisibility: "show-on-pause",
    neighborSentences: false,
  };
  assert.deepEqual(core.storedSettings({ settings, playbackMode: "repeat" }), settings);
  assert.deepEqual(
    core.storedSettings({ [core.SETTINGS_KEY]: settings, [core.LEGACY_MODE_KEY]: "repeat" }),
    settings,
  );
});

test("shows the sentence Always in a stored record from before Sentence Visibility", () => {
  const stored = { settings: { playbackMode: "continue", boundaryDelay: { kind: "seconds", seconds: 3 } } };
  assert.deepEqual(core.storedSettings(stored), {
    playbackMode: "continue",
    boundaryDelay: { kind: "seconds", seconds: 3 },
    sentenceVisibility: "always",
    neighborSentences: true,
  });
});

test("shows Neighbor Sentences in a stored record from before the setting", () => {
  const stored = { settings: { playbackMode: "pause", sentenceVisibility: "show-on-pause" } };
  assert.equal(core.storedSettings(stored).neighborSentences, true);
  assert.equal(core.storedSettings({ playbackMode: "repeat" }).neighborSentences, true);
});

test("turns Neighbor Sentences off only for a stored false", () => {
  assert.equal(core.companionSettings({ neighborSentences: false }).neighborSentences, false);
  for (const value of [true, undefined, null, 0, "", "off", "false"]) {
    assert.equal(core.companionSettings({ neighborSentences: value }).neighborSentences, true);
  }
});

test("estimates a reading wait from the sentence text's length", () => {
  assert.equal(core.readingSeconds(SHORT), 1);
  assert.equal(core.readingSeconds(LONG), 12);
  assert.equal(core.readingSeconds("x".repeat(105)), 7);
  assert.equal(core.readingSeconds("x".repeat(600)), 15);
  assert.equal(core.readingSeconds(""), 1);
  assert.equal(core.readingSeconds(undefined), 1);
});

test("waits only before Continue's next sentence and Repeat's replay", () => {
  const expected = {
    pause: { off: 0, seconds: 0, reading: 0 },
    continue: { off: 0, seconds: 3, reading: 12 },
    repeat: { off: 0, seconds: 3, reading: 12 },
  };
  for (const [mode, waits] of Object.entries(expected)) {
    for (const [kind, wait] of Object.entries(waits)) {
      const action = { pause: "stay", continue: "next", repeat: "repeat" }[mode];
      assert.deepEqual(settle(mode, DELAYS[kind], true, false), { action, wait }, `${mode} ${kind}`);
    }
  }
});

test("never waits in Continue at the lesson's last sentence", () => {
  for (const delay of Object.values(DELAYS)) {
    assert.deepEqual(settle("continue", delay, false, false), { action: "stay", wait: 0 });
  }
});

test("waits longer for reading after a long sentence than a short one", () => {
  for (const mode of ["continue", "repeat"]) {
    const short = settle(mode, DELAYS.reading, true, false, SHORT).wait;
    const long = settle(mode, DELAYS.reading, true, false, LONG).wait;
    assert.ok(long > short, `${mode}: ${long} > ${short}`);
  }
});

test("holds before any Boundary Delay while a selection is open", () => {
  for (const mode of ["pause", "continue", "repeat"]) {
    for (const delay of Object.values(DELAYS)) {
      assert.deepEqual(settle(mode, delay, true, true), { action: "hold", wait: 0 });
    }
  }
});

test("runs the reaction with its Boundary Delay once a held selection ends", () => {
  const hold = { kind: "hold", at: "es:1:s11" };
  for (const [mode, action] of [["continue", "next"], ["repeat", "repeat"]]) {
    assert.equal(core.waitRelease(hold, "es:1:s11", mode, true), action);
    assert.deepEqual(settle(mode, DELAYS.seconds, true, false), { action, wait: 3 });
    assert.deepEqual(settle(mode, DELAYS.reading, true, false), { action, wait: 12 });
    assert.deepEqual(settle(mode, DELAYS.off, true, false), { action, wait: 0 });
  }
  assert.deepEqual(settle("pause", DELAYS.seconds, true, false), { action: "stay", wait: 0 });
});

const delayAt = (mode, delay, started = 1000, at = "es:1:s11") =>
  core.boundaryDelayWait(at, settle(mode, delay, true, false), started);

test("times a Boundary Delay from its start", () => {
  assert.deepEqual(delayAt("continue", DELAYS.seconds), {
    kind: "delay",
    at: "es:1:s11",
    action: "next",
    started: 1000,
    until: 4000,
  });
  assert.equal(delayAt("repeat", DELAYS.reading).until, 13000);
});

test("cuts a Boundary Delay short into its own action", () => {
  const next = delayAt("continue", DELAYS.seconds);
  const repeat = delayAt("repeat", DELAYS.seconds);
  assert.equal(core.waitRelease(next, "es:1:s11", "continue", true), "next");
  assert.equal(core.waitRelease(repeat, "es:1:s11", "repeat", true), "repeat");
  assert.equal(core.waitRelease(next, "es:1:s12", "continue", true), null);
});

test("runs a Boundary Delay's action when it runs out at its own sentence", () => {
  assert.equal(core.delayEnd(delayAt("continue", DELAYS.seconds), "es:1:s11", false), "next");
  assert.equal(core.delayEnd(delayAt("repeat", DELAYS.reading), "es:1:s11", false), "repeat");
});

test("holds instead when a selection is open as a Boundary Delay runs out", () => {
  for (const mode of ["continue", "repeat"]) {
    assert.equal(core.delayEnd(delayAt(mode, DELAYS.seconds), "es:1:s11", true), "hold");
  }
});

test("drops a Boundary Delay whose sentence or lesson is no longer active", () => {
  const wait = delayAt("continue", DELAYS.seconds);
  assert.equal(core.delayEnd(wait, "es:1:s12", false), "drop");
  assert.equal(core.delayEnd(wait, "es:2:s11", false), "drop");
  assert.equal(core.delayEnd(wait, null, false), "drop");
  assert.equal(core.delayEnd(wait, "es:1:s12", true), "drop");
  assert.equal(core.delayEnd(delayAt("continue", DELAYS.seconds, 1000, null), null, false), "drop");
});

test("ends a Boundary Delay when the settings change to a reaction that stays", () => {
  const wait = delayAt("continue", DELAYS.seconds);
  assert.equal(core.changedDelay(wait, settle("pause", DELAYS.seconds, true, false)), null);
  assert.equal(core.changedDelay(wait, settle("continue", DELAYS.seconds, false, false)), null);
});

test("acts at once when the Boundary Delay changes to Off mid-wait", () => {
  const changed = core.changedDelay(
    delayAt("repeat", DELAYS.seconds),
    settle("repeat", DELAYS.off, true, false),
  );
  assert.equal(changed.action, "repeat");
  assert.equal(changed.until, changed.started);
  assert.equal(core.delayEnd(changed, "es:1:s11", false), "repeat");
});

test("keeps a Boundary Delay's start with the newly chosen action and length", () => {
  const wait = delayAt("continue", DELAYS.seconds);
  assert.deepEqual(core.changedDelay(wait, settle("repeat", DELAYS.seconds, true, false)), {
    ...wait,
    action: "repeat",
  });
  assert.deepEqual(core.changedDelay(wait, settle("continue", DELAYS.reading, true, false)), {
    ...wait,
    until: 13000,
  });
  assert.deepEqual(
    core.changedDelay(wait, settle("continue", { kind: "seconds", seconds: 1 }, true, false)),
    { ...wait, until: 2000 },
  );
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

const { PLAYER_STATES } = core;
const VISIBILITIES = ["always", "listen-first", "show-on-pause"];
const reveals = (visibility, mode, delay, hasNext, hidden) =>
  core.boundaryReaction(
    { playbackMode: mode, boundaryDelay: delay, sentenceVisibility: visibility },
    hasNext,
    false,
    LONG,
    hidden,
  );

test("shows the sentence by Sentence Visibility, playback, and what revealed it", () => {
  const cases = [
    // [paused, listened, requested] -> [always, listen-first, show-on-pause]
    [[false, false, false], [true, false, false]],
    [[true, false, false], [true, false, true]],
    [[false, true, false], [true, true, false]],
    [[true, true, false], [true, true, true]],
    [[false, false, true], [true, true, true]],
    [[false, true, true], [true, true, true]],
  ];
  for (const [[paused, listened, requested], expected] of cases) {
    VISIBILITIES.forEach((visibility, index) => {
      assert.equal(
        core.sentenceShown(visibility, { paused, listened, requested, selected: false, failed: false }),
        expected[index],
        `${visibility} paused=${paused} listened=${listened} requested=${requested}`,
      );
    });
  }
});

test("shows a sentence that holds a word or phrase selection", () => {
  for (const visibility of VISIBILITIES) {
    assert.equal(
      core.sentenceShown(visibility, { paused: false, listened: false, requested: false, selected: true, failed: false }),
      true,
      visibility,
    );
  }
});

test("shows the sentence whenever the video can't play", () => {
  for (const visibility of VISIBILITIES) {
    assert.equal(
      core.sentenceShown(visibility, { paused: false, listened: false, requested: false, selected: false, failed: true }),
      true,
      visibility,
    );
  }
});

const key = (key, modifiers = {}) => ({ key, code: key === " " ? "Space" : "", ...modifiers });

test("recognizes LingQ's keys that land on a word, with any modifier but Shift", () => {
  for (const name of ["ArrowLeft", "ArrowRight", "Left", "Right", "b"]) {
    for (const modifiers of [{}, { altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      assert.equal(core.wordKey(key(name, modifiers)), true, `${JSON.stringify(modifiers)} ${name}`);
    }
  }
  for (const modifiers of [{ shiftKey: true }, { shiftKey: true, ctrlKey: true }]) {
    assert.equal(core.wordKey(key(" ", modifiers)), true, `${JSON.stringify(modifiers)} Space`);
  }
  for (const [name, modifiers] of [
    [" ", {}],
    ["ArrowRight", { shiftKey: true }],
    ["ArrowLeft", { shiftKey: true, altKey: true }],
    ["ArrowUp", { shiftKey: true }],
    ["B", { shiftKey: true }],
    ["ArrowDown", {}],
    ["n", {}],
    ["1", {}],
  ]) {
    assert.equal(core.wordKey(key(name, modifiers)), false, `${JSON.stringify(modifiers)} ${name}`);
  }
});

const keyEvent = (type, name, modifiers = {}) => ({ type, repeat: false, ...key(name, modifiers) });
const act = (event, target = {}, hidden = true, guarded = false, kept = false) =>
  core.keyAction(event, { editable: false, popover: false, hidden, guarded, kept, ...target });

test("shows the hidden sentence for a plain word key and keeps it from LingQ", () => {
  assert.equal(act(keyEvent("keydown", "ArrowRight")), "reveal");
  assert.equal(act(keyEvent("keydown", "b")), "reveal");
  assert.equal(act(keyEvent("keydown", " ", { shiftKey: true })), "reveal");
  assert.equal(act(keyEvent("keyup", "ArrowRight"), {}, false, false, true), "consume");
  assert.equal(act(keyEvent("keydown", "ArrowRight"), {}, false, true), "consume");
});

test("keeps a modified word key from LingQ but leaves it to the browser", () => {
  assert.equal(act(keyEvent("keydown", "ArrowLeft", { altKey: true })), "keep");
  assert.equal(act(keyEvent("keydown", "ArrowLeft", { metaKey: true })), "keep");
  assert.equal(act(keyEvent("keydown", "b", { ctrlKey: true })), "keep");
  assert.equal(act(keyEvent("keydown", "b", { metaKey: true }), {}, false, true), "keep");
});

test("keeps a held word key's repeats from LingQ once the text shows", () => {
  const repeat = { ...keyEvent("keydown", "ArrowRight"), repeat: true };
  assert.equal(act(repeat, {}, false, false, true), "consume");
  assert.equal(act(repeat, {}, false, false, false), null);
});

test("leaves word keys to fields, the companion's popovers, and a shown sentence", () => {
  const right = keyEvent("keydown", "ArrowRight");
  assert.equal(act(right, { editable: true }), null);
  assert.equal(act(right, { popover: true }), null);
  assert.equal(act(right, {}, false, false), null);
  assert.equal(act(keyEvent("keydown", "n")), null);
  assert.equal(act(keyEvent("keydown", "ArrowRight", { shiftKey: true })), null);
});

const press = (start, atWords, hidden, guarded, kept = false) =>
  core.pressKept(start, { atWords, hidden, guarded, kept });

test("keeps a press on the hidden or just-shown sentence away from LingQ", () => {
  assert.equal(press(true, true, true, false), true);
  assert.equal(press(true, true, false, true), true);
  assert.equal(press(true, true, false, false), false);
  assert.equal(press(true, false, true, true), false);
});

test("lets the press's start decide for its release, click, and double click", () => {
  // The guard ran out between pointerdown and click: the click still stays away.
  assert.equal(press(false, true, false, false, true), true);
  // A press begun on hidden text and released off the sentence stays away.
  assert.equal(press(false, false, false, false, true), true);
  // A press that reached LingQ at its start isn't taken away halfway.
  assert.equal(press(false, true, false, false, false), false);
  // Its end still never reaches a hidden word.
  assert.equal(press(false, true, true, false, false), true);
});

test("counts the video paused only when it has stopped and no play is on its way", () => {
  for (const state of [
    PLAYER_STATES.PAUSED,
    PLAYER_STATES.CUED,
    PLAYER_STATES.UNSTARTED,
    PLAYER_STATES.ENDED,
  ]) {
    assert.equal(core.videoPaused(state, false), true, `state ${state}`);
    assert.equal(core.videoPaused(state, true), false, `state ${state} with a play pending`);
  }
  for (const state of [PLAYER_STATES.PLAYING, PLAYER_STATES.BUFFERING]) {
    assert.equal(core.videoPaused(state, false), false, `state ${state}`);
  }
});

test("shows the sentence on Show on Pause only while the video is paused", () => {
  const shown = (state, playPending) =>
    core.sentenceShown("show-on-pause", {
      paused: core.videoPaused(state, playPending),
      listened: true,
      requested: false,
      selected: false,
      failed: false,
    });
  assert.equal(shown(PLAYER_STATES.PAUSED, false), true);
  assert.equal(shown(PLAYER_STATES.PLAYING, false), false);
  assert.equal(shown(PLAYER_STATES.ENDED, false), true);
  assert.equal(shown(PLAYER_STATES.ENDED, true), false);
  assert.equal(shown(PLAYER_STATES.PAUSED, true), false);
});

test("reveals the hidden sentence under Listen First at a boundary with no Boundary Delay", () => {
  const expected = {
    always: { pause: "stay", continue: "next", repeat: "repeat" },
    "listen-first": { pause: "stay", continue: "reveal", repeat: "reveal" },
    "show-on-pause": { pause: "stay", continue: "next", repeat: "repeat" },
  };
  for (const visibility of VISIBILITIES) {
    for (const mode of ["pause", "continue", "repeat"]) {
      assert.deepEqual(
        reveals(visibility, mode, DELAYS.off, true, true),
        { action: expected[visibility][mode], wait: 0 },
        `${visibility} ${mode}`,
      );
    }
  }
});

test("reveals the Listen First sentence during a Boundary Delay instead of pausing", () => {
  for (const [mode, action] of [["continue", "next"], ["repeat", "repeat"]]) {
    assert.deepEqual(reveals("listen-first", mode, DELAYS.seconds, true, true), { action, wait: 3 });
    assert.deepEqual(reveals("listen-first", mode, DELAYS.reading, true, true), { action, wait: 12 });
  }
  for (const delay of Object.values(DELAYS)) {
    assert.deepEqual(reveals("listen-first", "pause", delay, true, true), { action: "stay", wait: 0 });
  }
});

test("replays and moves on as usual once the Listen First sentence shows", () => {
  for (const visibility of VISIBILITIES) {
    for (const [mode, action] of [["pause", "stay"], ["continue", "next"], ["repeat", "repeat"]]) {
      for (const [kind, delay] of Object.entries(DELAYS)) {
        const wait = mode === "pause" ? 0 : { off: 0, seconds: 3, reading: 12 }[kind];
        assert.deepEqual(
          reveals(visibility, mode, delay, true, false),
          { action, wait },
          `${visibility} ${mode} ${kind}`,
        );
      }
    }
  }
});

test("stays at the lesson's last sentence and holds a selection under Listen First", () => {
  assert.deepEqual(reveals("listen-first", "continue", DELAYS.off, false, true), {
    action: "stay",
    wait: 0,
  });
  for (const mode of ["pause", "continue", "repeat"]) {
    assert.deepEqual(
      core.boundaryReaction(
        { playbackMode: mode, boundaryDelay: DELAYS.off, sentenceVisibility: "listen-first" },
        true,
        true,
        LONG,
        true,
      ),
      { action: "hold", wait: 0 },
    );
  }
});

test("moves on or replays when Play ends Listen First's reveal", () => {
  const reveal = { kind: "reveal", at: "es:1:s11" };
  assert.equal(core.waitRelease(reveal, "es:1:s11", "continue", true), "next");
  assert.equal(core.waitRelease(reveal, "es:1:s11", "repeat", true), "repeat");
  assert.equal(core.waitRelease(reveal, "es:1:s12", "continue", true), null);
  assert.equal(core.waitRelease(reveal, "es:1:s11", "pause", true), "stay");
  assert.equal(core.waitRelease(reveal, "es:1:s11", "continue", false), "stay");
  assert.equal(core.waitRelease(reveal, "es:1:s11", "repeat", false), "repeat");
});

const LESSON_TEXT = ["Hola, ¿qué tal?", LONG, "Muy bien.", "  Adiós.  ", "¿Y tú?"].map((text, index) => ({
  text,
  timestamp: [index * 2, index * 2 + 1.5],
}));

test("lists the sentences after the active one as Neighbor Sentences", () => {
  assert.deepEqual(core.neighborSentences(LESSON_TEXT, 1, 3), [
    { number: 2, text: LONG },
    { number: 3, text: "Muy bien." },
    { number: 4, text: "Adiós." },
  ]);
  assert.deepEqual(core.neighborSentences(LESSON_TEXT, 2, 2), [
    { number: 3, text: "Muy bien." },
    { number: 4, text: "Adiós." },
  ]);
});

test("lists fewer Neighbor Sentences near the lesson's end and none after the last", () => {
  assert.deepEqual(core.neighborSentences(LESSON_TEXT, 3, 3), [
    { number: 4, text: "Adiós." },
    { number: 5, text: "¿Y tú?" },
  ]);
  assert.deepEqual(core.neighborSentences(LESSON_TEXT, 4, 3), [{ number: 5, text: "¿Y tú?" }]);
  assert.deepEqual(core.neighborSentences(LESSON_TEXT, 5, 3), []);
});

test("lists no Neighbor Sentences for an unknown active sentence or missing text", () => {
  for (const active of [0, 6, -1, 1.5, NaN, undefined, "1"]) {
    assert.deepEqual(core.neighborSentences(LESSON_TEXT, active, 3), [], String(active));
  }
  assert.deepEqual(core.neighborSentences(null, 1, 3), []);
  assert.deepEqual(
    core.neighborSentences([{ text: "Uno." }, { text: " " }, {}, { text: "Cuatro." }], 1, 3),
    [{ number: 4, text: "Cuatro." }],
  );
});

test("fits as many leading Neighbor Sentences as the height left allows", () => {
  assert.equal(core.neighborCount([29, 29, 54], 200), 3);
  assert.equal(core.neighborCount([29, 29, 54], 111), 2);
  assert.equal(core.neighborCount([29, 29, 54], 58), 2);
  assert.equal(core.neighborCount([29, 29, 54], 57), 1);
  assert.equal(core.neighborCount([54, 29, 29], 57), 1);
  assert.equal(core.neighborCount([29, 29], 28), 0);
  assert.equal(core.neighborCount([29], -40), 0);
  assert.equal(core.neighborCount([29], NaN), 0);
  assert.equal(core.neighborCount([], 100), 0);
});

test("shows Neighbor Sentences with Always and Show on Pause but never Listen First", () => {
  const settings = (sentenceVisibility, neighborSentences = true) =>
    core.companionSettings({ sentenceVisibility, neighborSentences });
  assert.equal(core.showsNeighbors(settings("always")), true);
  assert.equal(core.showsNeighbors(settings("show-on-pause")), true);
  assert.equal(core.showsNeighbors(settings("listen-first")), false);
  for (const visibility of ["always", "listen-first", "show-on-pause"]) {
    assert.equal(core.showsNeighbors(settings(visibility, false)), false);
  }
});

test("plays a neighbor on a single click or a fresh Enter and keeps every press from LingQ", () => {
  const event = (type, extra = {}) => ({ type, key: undefined, repeat: false, detail: 1, ...extra });
  assert.equal(core.neighborAction(event("click")), "play");
  assert.equal(core.neighborAction(event("click", { detail: 0 })), "play");
  assert.equal(core.neighborAction(event("keydown", { key: "Enter" })), "play");
  assert.equal(core.neighborAction(event("click", { detail: 2 })), "keep");
  assert.equal(core.neighborAction(event("click", { detail: 3 })), "keep");
  assert.equal(core.neighborAction(event("keydown", { key: "Enter", repeat: true })), "keep");
  assert.equal(core.neighborAction(event("keyup", { key: "Enter" })), "keep");
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick", "auxclick", "contextmenu"]) {
    assert.equal(core.neighborAction(event(type)), "keep", type);
  }
  for (const key of [" ", "n", "r", "Tab", "ArrowRight"]) {
    assert.equal(core.neighborAction(event("keydown", { key })), null, key);
    assert.equal(core.neighborAction(event("keyup", { key })), null, key);
  }
});

test("takes a press at a played neighbor's spot, soon after, as the rest of its double click", () => {
  const click = { x: 400, y: 300, time: 10000 };
  assert.equal(core.followsNeighborClick({ x: 400, y: 300, time: 10140 }, click), true);
  assert.equal(core.followsNeighborClick({ x: 405, y: 304, time: 11000 }, click), true);
  assert.equal(core.followsNeighborClick({ x: 400, y: 300, time: 11001 }, click), false);
  assert.equal(core.followsNeighborClick({ x: 409, y: 300, time: 10140 }, click), false);
  assert.equal(core.followsNeighborClick({ x: 400, y: 300, time: 9990 }, click), false);
  assert.equal(core.followsNeighborClick({ x: 400, y: 300, time: 10140 }, null), false);
});

test("keeps the whole press that follows a played neighbor's click, wherever it lands", () => {
  const shown = { atWords: true, hidden: false, guarded: false };
  assert.equal(core.pressKept(true, { ...shown, kept: false, following: true }), true);
  assert.equal(core.pressKept(false, { ...shown, kept: true }), true);
  assert.equal(core.pressKept(true, { atWords: false, hidden: false, guarded: false, kept: false, following: true }), true);
  assert.equal(core.pressKept(true, { ...shown, kept: false, following: false }), false);
  assert.equal(core.pressKept(true, { ...shown, kept: false }), false);
});

test("pins the neighbor click's 8px radius as a true distance", () => {
  const click = { x: 400, y: 300, time: 10000 };
  const at = (x, y) => core.followsNeighborClick({ x, y, time: 10100 }, click);
  assert.equal(at(408, 300), true);
  assert.equal(at(392, 300), true);
  assert.equal(at(400, 308), true);
  assert.equal(at(400, 292), true);
  assert.equal(at(406, 306), false);
  assert.equal(at(400, 309), false);
  assert.equal(at(409, 300), false);
  assert.equal(at(405, 306), true);
});

test("sizes the video with neighbors so a taller window never has a smaller one", () => {
  const rem = 16;
  assert.equal(core.neighborVideoHeight(660, rem), 340);
  assert.equal(core.neighborVideoHeight(600, rem), 280);
  assert.equal(core.neighborVideoHeight(300, rem), 72);
  assert.equal(core.neighborVideoHeight(661, rem), 340);
  assert.equal(core.neighborVideoHeight(725, rem), 340);
  assert.equal(core.neighborVideoHeight(788, rem), 340);
  assert.equal(core.neighborVideoHeight(789, rem), 341);
  assert.equal(core.neighborVideoHeight(847, rem), 399);
  let previous = 0;
  for (let viewport = 300; viewport <= 1400; viewport += 1) {
    const height = core.neighborVideoHeight(viewport, rem);
    assert.ok(height >= previous, `${viewport}px: ${height} < ${previous}`);
    // Never below the short layout's video at the same height, where it applies.
    if (viewport <= 660) assert.equal(height, Math.max(72, viewport - 320));
    previous = height;
  }
});

test("cycles the speed button through 1x, 0.75x, and 0.5x", () => {
  assert.equal(core.nextPlaybackRate(1), 0.75);
  assert.equal(core.nextPlaybackRate(0.75), 0.5);
  assert.equal(core.nextPlaybackRate(0.5), 1);
});

test("returns to 1x from a rate chosen in YouTube's own menu", () => {
  assert.equal(core.nextPlaybackRate(1.5), 1);
  assert.equal(core.nextPlaybackRate(0.25), 1);
  assert.equal(core.nextPlaybackRate(Number.NaN), 1);
});

test("sends the player only a playback rate YouTube's embed offers", () => {
  const rate = core.bridgeCommand("rate", 3, 0.75);
  assert.deepEqual(core.parseBridgeCommand(rate), rate);
  assert.equal(rate.rate, 0.75);
  assert.deepEqual(core.parseBridgeCommand(core.bridgeCommand("rate", 3, 2)).rate, 2);
  assert.deepEqual(core.parseBridgeCommand(core.bridgeCommand("rate", 3, 0.25)).rate, 0.25);

  for (const bad of [0, 0.1, 2.5, -1, Number.NaN, Infinity, "0.75", null, undefined]) {
    assert.equal(core.bridgeCommand("rate", 3, bad), null, String(bad));
  }
  assert.equal(core.bridgeCommand("rate", 0, 0.75), null);
  assert.equal(core.bridgeCommand("play", 3, 0.75), null);
  assert.equal(core.bridgeCommand("seek", 3, 0.75), null);
  assert.equal(core.parseBridgeCommand({ ...rate, rate: 5 }), null);
  assert.equal(core.parseBridgeCommand({ ...rate, segment: { start: 0, end: 1 } }), null);
  assert.equal(core.parseBridgeCommand({ ...rate, method: "setVolume" }), null);
});

test("accepts a reported playback rate only as a positive finite number", () => {
  const event = core.bridgeEvent("rate", 4, { rate: 1.5 });
  assert.deepEqual(core.parseBridgeEvent(event, 4), event);
  assert.deepEqual(event.detail, { rate: 1.5 });
  assert.equal(core.parseBridgeEvent(event, 5), null);
  for (const bad of [0, -1, Number.NaN, Infinity, "1"]) {
    assert.equal(core.bridgeEvent("rate", 4, { rate: bad }), null, String(bad));
  }
  assert.equal(core.bridgeEvent("rate", 4), null);
  assert.equal(core.bridgeEvent("rate", 4, { rate: 1, extra: 1 }), null);
});
