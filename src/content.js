(() => {
  "use strict";

  const core = globalThis.LingqPlaybackCore;
  if (!core || window !== window.top) return;

  // A play request expires when no activation cue follows it. It outlasts the
  // bridge's own waits: 20 s for the YouTube API and 20 s for the player.
  const PLAY_REQUEST_MS = 45000;

  const state = {
    autoplayBlocked: false,
    blockedFrame: null,
    boundaryArmed: false,
    // The Escape press that left Focus Mode, whose repeats stay away from LingQ.
    escapeKept: false,
    // null, or Focus Mode on the reader it's applied to: { reader, bar,
    // hadStyle, pressed, dismissed }. pressed: the position whose word was
    // pressed since Escape last put the docked panel away. dismissed: the word
    // selection whose docked panel Escape put away.
    focus: null,
    cache: null,
    // The lesson and sentence of the last cue, and its key, which adds the
    // bounds it played.
    cueAt: null,
    cueKey: null,
    // The bound video's duration, once the player knows it.
    duration: null,
    frame: null,
    generation: 0,
    ignoreResetUntil: 0,
    layout: null,
    lessonKey: null,
    navigation: null,
    modeControl: null,
    // The Neighbor Sentences list, and the lesson and sentence it shows.
    neighbors: null,
    neighborKey: null,
    pendingCue: null,
    playbackQueue: [],
    playerState: core.PLAYER_STATES.UNSTARTED,
    playerTime: 0,
    playRequest: null,
    ready: false,
    // The playback rate for this page session, kept across player reloads.
    rate: 1,
    recoveryAttemptedLessonKey: null,
    // The active sentence's reveal: { at, listened, requested }. listened: its
    // first play reached the Sentence Boundary. requested: the reader clicked its
    // hidden text or pressed a word key.
    reveal: null,
    // Presses aimed at the sentence until this time never reach LingQ.
    revealGuard: 0,
    // Whether LingQ never saw the current pointer press, whether that press
    // follows a click that moved the page, and the codes of the held keys whose
    // presses it never saw.
    pointerKept: false,
    pointerFollows: false,
    // The click that last moved the page under the pointer, by playing a
    // Neighbor Sentence or toggling Focus Mode: { x, y, time }.
    movingClick: null,
    keysKept: new Set(),
    // Until this time, a play the companion started counts as playing.
    playPendingUntil: 0,
    revision: 0,
    segment: null,
    sentences: null,
    settings: core.companionSettings(),
    // The Timing Offset of a lesson: { key, offset, promise }. offset is null
    // until it loads from storage.
    timing: null,
    // Timing Offset writes, one after another.
    timingWrite: Promise.resolve(),
    statusControl: null,
    statusKind: null,
    // false, or the state ("play" or "pause") a sent command is settling into.
    synchronizing: false,
    timer: null,
    // null, or a wait at the Sentence Boundary of the lesson and sentence at:
    // the Vocabulary Hold { kind: "hold", at, delayed } until its selection
    // ends, the Boundary Delay { kind: "delay", at, action, started, until,
    // timer } until it runs out, or Listen First's { kind: "reveal", at } until
    // Play.
    wait: null,
    warnings: new Set(),
  };

  function warnOnce(key, error) {
    if (state.warnings.has(key)) return;
    state.warnings.add(key);
    console.warn("LingQ Sentence Playback Companion:", key, error || "");
  }

  function eligibleFrame(modal) {
    for (const frame of modal?.querySelectorAll("iframe") || []) {
      if (frame.closest(".sentence--video-player, .sent-video-player")) continue;
      if (core.youtubeEmbedId(frame.src, location.href, location.origin)) return frame;
    }
    return null;
  }

  function readerContext() {
    const reader = document.querySelector("#lesson-reader.is-sentence-mode");
    const lesson = core.readerLesson(location.pathname);
    const sentence = reader?.querySelector(".sentence-text .sentence[id^='s']");
    const portal = reader?.querySelector("#sentence-video-player-portal");
    const footer = reader?.querySelector(".main-footer .lesson-bottom");

    return reader && lesson && sentence && portal && footer
      ? { reader, lesson, sentence, portal, footer }
      : null;
  }

  function playerContext(context) {
    const modal = document.querySelector(".video-player.lspc-player, .video-player.is-active");
    // LingQ renders the modal through a React portal into this container, and
    // React removes the modal from it when the video closes. So the companion
    // moves the container and leaves the modal inside it.
    const container = modal?.parentElement;
    const frame = eligibleFrame(modal);

    return container?.matches(".modal-container") && frame && frame !== state.blockedFrame
      ? { ...context, modal, container, frame }
      : null;
  }

  function restoreLayout() {
    const layout = state.layout;
    if (state.frame) {
      postBridgeCommand(core.bridgeCommand("pause", state.generation));
      state.generation += 1;
      // mount() also runs this reset on the way to the first bind, while the
      // request still waits for its player, so only a bound player drops it.
      state.playRequest = null;
    }
    leaveFocus();
    if (layout) {
      layout.modal.classList.remove("lspc-player");
      layout.portal.classList.remove("lspc-portal");
      layout.reader.classList.remove("lspc-reader", "lspc-sentence-hidden");
      // LingQ removes the container itself when it closes the video, so only a
      // container still in the portal goes back.
      if (layout.container.parentNode === layout.portal) {
        const sibling = layout.nextSibling;
        layout.parent.insertBefore(
          layout.container,
          sibling?.parentNode === layout.parent ? sibling : null,
        );
      }
    }

    state.layout = null;
    state.lessonKey = null;
    state.frame = null;
    state.ready = false;
    state.pendingCue = null;
    state.playbackQueue = [];
    state.playerState = core.PLAYER_STATES.UNSTARTED;
    state.playerTime = 0;
    state.segment = null;
    state.cueAt = null;
    state.cueKey = null;
    state.duration = null;
    state.navigation = null;
    state.boundaryArmed = false;
    cancelWait();
    state.reveal = null;
    removeNeighbors();
    state.playPendingUntil = 0;
    state.ignoreResetUntil = 0;
    state.synchronizing = false;
    state.autoplayBlocked = false;
    state.modeControl?.remove();
    state.modeControl = null;
    state.statusControl?.remove();
    state.statusControl = null;
    state.statusKind = null;
  }

  function setStatus(kind, footer = state.layout?.footer) {
    const status = core.companionStatus(kind);
    if (!footer || !status) return;
    if (state.statusControl?.parentNode !== footer) {
      state.statusControl?.remove();
      state.statusControl = document.createElement("span");
      state.statusControl.className = "lspc-status";
      state.statusControl.setAttribute("role", "status");
      state.statusControl.setAttribute("aria-live", "polite");
      state.statusControl.setAttribute("aria-atomic", "true");
      footer.append(state.statusControl);
      state.statusKind = null;
    }
    if (state.statusKind === kind) return;
    state.statusControl.textContent = status.message;
    state.statusControl.classList.toggle("lspc-quiet", !status.visible);
    state.statusKind = kind;
  }

  const MODES = [
    {
      mode: "pause",
      name: "Pause",
      label: "Pause at end",
      description: "Stop so you can study the sentence",
      icon: ["M2.5 12h10", "M16 6.5v11", "M20.5 6.5v11"],
    },
    {
      mode: "continue",
      name: "Continue",
      label: "Continue at end",
      description: "Keep playing into the next sentence",
      icon: ["M3 12h15", "M14 7l5 5-5 5"],
    },
    {
      mode: "repeat",
      name: "Repeat",
      label: "Repeat at end",
      description: "Loop the sentence until you move on",
      icon: [
        "M17 3l3 3-3 3",
        "M4 11V9a3 3 0 0 1 3-3h13",
        "M7 21l-3-3 3-3",
        "M20 13v2a3 3 0 0 1-3 3H4",
      ],
    },
  ];
  const ICONS = {
    replay: ["M4 12a8 8 0 1 0 2.6-5.9", "M4 4v4.5h4.5", "M10.5 9.2v5.6l4.4-2.8z"],
    chevron: ["M6 9l6 6 6-6"],
    previous: ["M6 5v14", "M18 6l-9 6 9 6z"],
    next: ["M18 5v14", "M6 6l9 6-9 6z"],
    play: ["M8 5.5v13l11-6.5z"],
    pause: ["M7 5h3.5v14H7z", "M13.5 5H17v14h-3.5z"],
    focus: ["M4 9V4h5", "M20 9V4h-5", "M4 15v5h5", "M20 15v5h-5"],
    exitFocus: ["M9 4v5H4", "M15 4v5h5", "M9 20v-5H4", "M15 20v-5h5"],
    check: ["M5 12.5l4.5 4.5L19 7.5"],
    minus: ["M6 12h12"],
    plus: ["M6 12h12", "M12 6v12"],
    settings: [
      "M4 7h8",
      "M16 7h4",
      "M12 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
      "M4 17h3",
      "M11 17h9",
      "M7 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
    ],
  };
  const DELAYS = [
    { value: "off", name: "Off", description: "Act as soon as the sentence ends" },
    { value: "seconds", name: "Fixed", description: "The same wait every sentence" },
    { value: "reading", name: "Reading time", description: "Longer sentences wait longer" },
  ];
  const VISIBILITIES = [
    { value: "always", name: "Always", description: "Show the text the whole time" },
    {
      value: "listen-first",
      name: "Listen First",
      description: "Hide it until it has played once",
    },
    {
      value: "show-on-pause",
      name: "Show on Pause",
      description: "Show it only while the video is paused",
    },
  ];
  const NEIGHBOR_CHOICES = [
    { value: "on", name: "On", description: "Show the next sentences, dimmed" },
    { value: "off", name: "Off", description: "Show only this sentence" },
  ];
  const SHORTCUTS = [
    [["Space"], "play/pause"],
    [["P", "N"], "prev/next"],
    [["R"], "replay"],
  ];

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function icon(paths, className = "lspc-icon") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", className);
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    for (const d of paths) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.append(path);
    }
    return svg;
  }

  function countdown() {
    const wait = state.wait;
    if (wait?.kind !== "delay") return "";
    const seconds = Math.max(1, Math.ceil((wait.until - Date.now()) / 1000));
    return `${wait.action === "next" ? "Next" : "Repeat"} in ${seconds} s`;
  }

  // The ring empties over the Boundary Delay. It follows the wait's own times,
  // so a ring mounted mid-wait starts where the wait is.
  function drainRing(ring) {
    const wait = state.wait?.kind === "delay" ? state.wait : null;
    const id = wait ? `${wait.started}:${wait.until}` : "";
    for (const animation of ring.getAnimations()) {
      if (animation.id !== id) animation.cancel();
    }
    if (!wait || ring.getAnimations().length) return;
    const drain = ring.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: 1 }], {
      duration: Math.max(1, wait.until - wait.started),
      fill: "forwards",
      id,
    });
    drain.currentTime = Date.now() - wait.started;
  }

  function render() {
    const control = state.modeControl;
    if (!control) return;
    const { playbackMode, boundaryDelay, sentenceVisibility, neighborSentences } = state.settings;
    const current = MODES.find(({ mode }) => mode === playbackMode);
    const button = control.querySelector(".lspc-mode-button");
    const left = countdown();
    button.setAttribute("aria-label", `Playback Mode: ${current.label}`);
    button.dataset.tip = left || current.label;
    // A running Boundary Delay takes the button's icon and label for its countdown.
    const shown = left ? "wait" : playbackMode;
    for (const node of control.querySelectorAll("[data-mode]")) {
      if (node.getAttribute("role") === "menuitemradio") {
        node.setAttribute("aria-checked", String(node.dataset.mode === playbackMode));
      } else {
        node.classList.toggle("lspc-current", node.dataset.mode === shown);
      }
    }
    control.querySelector(".lspc-countdown .lspc-label-text").textContent = left;
    drainRing(control.querySelector(".lspc-ring-left"));
    for (const input of control.querySelectorAll("[name='lspc-delay']")) {
      input.checked = input.value === boundaryDelay.kind;
    }
    for (const input of control.querySelectorAll("[name='lspc-visibility']")) {
      input.checked = input.value === sentenceVisibility;
    }
    for (const input of control.querySelectorAll("[name='lspc-neighbors']")) {
      input.checked = (input.value === "on") === neighborSentences;
    }
    if (boundaryDelay.kind === "seconds") {
      control.querySelector(".lspc-seconds").value = String(boundaryDelay.seconds);
    }
    renderTiming();
    renderPlayback();
  }

  // The Timing Offset buttons: each one's change to the lesson's offset.
  const TIMING_STEPS = {
    "shift-down": ({ shift }) => ({ shift: shift - 0.1 }),
    "shift-up": ({ shift }) => ({ shift: shift + 0.1 }),
    "shift-reset": () => ({ shift: 0 }),
    "pad-down": ({ pad }) => ({ pad: pad - 0.05 }),
    "pad-up": ({ pad }) => ({ pad: pad + 0.05 }),
  };

  function sameTiming(a, b) {
    return a.shift === b.shift && a.pad === b.pad;
  }

  // The settings panel's Timing Offset rows show the active lesson's offset.
  // A step that changes nothing, past a limit or a reset at 0, stays
  // focusable and only looks unavailable.
  function renderTiming() {
    const panel = state.modeControl?.querySelector(".lspc-timing");
    if (!panel) return;
    const offset = state.timing?.offset ?? core.timingOffset();
    const text = core.timingText(offset);
    panel.querySelector("[data-value='shift']").textContent = text.shift;
    panel.querySelector("[data-value='pad']").textContent = text.pad;
    for (const button of panel.querySelectorAll("[data-step]")) {
      const next = core.timingOffset({ ...offset, ...TIMING_STEPS[button.dataset.step](offset) });
      button.setAttribute("aria-disabled", String(sameTiming(next, offset)));
    }
  }

  // The Focus Mode controls that follow the player: Play or Pause, and the rate.
  function renderPlayback() {
    const control = state.modeControl;
    if (!control) return;
    const playing = [core.PLAYER_STATES.PLAYING, core.PLAYER_STATES.BUFFERING].includes(
      state.playerState,
    );
    const play = control.querySelector(".lspc-play");
    play.setAttribute("aria-label", playing ? "Pause" : "Play");
    play.dataset.tip = playing ? "Pause" : "Play";
    for (const glyph of play.querySelectorAll("[data-glyph]")) {
      glyph.classList.toggle("lspc-current", glyph.dataset.glyph === (playing ? "pause" : "play"));
    }
    const rate = `${state.rate}x`;
    const speed = control.querySelector(".lspc-speed");
    speed.setAttribute("aria-label", `Speed: ${rate}`);
    speed.dataset.tip = `Speed ${rate}`;
    speed.querySelector(".lspc-rate").textContent = rate;
  }

  // A focused control keeps the letter shortcuts for itself, so a mouse click
  // gives focus back to the page. Keyboard activation (detail 0) keeps it.
  function releasePointerFocus(event) {
    if (event.detail > 0) document.activeElement?.blur();
  }

  // A picker is a footer button and the popover it opens: the Playback Mode menu
  // or the settings panel.
  function setPopoverOpen(picker, open) {
    const popover = picker?.querySelector(".lspc-popover");
    if (!popover) return;
    popover.hidden = !open;
    picker.querySelector(".lspc-item").setAttribute("aria-expanded", String(open));
    if (open) popover.querySelector("[aria-checked='true'], input:checked")?.focus();
  }

  function closePopover(picker, focusButton) {
    setPopoverOpen(picker, false);
    if (focusButton) picker?.querySelector(".lspc-item").focus();
  }

  function saveSettings(change) {
    state.settings = core.companionSettings({ ...state.settings, ...change });
    redecideDelay();
    render();
    renderVisibility();
    void chrome.storage.local.set({ [core.SETTINGS_KEY]: state.settings });
  }

  function handleMenuKey(event) {
    const picker = event.currentTarget.closest(".lspc-picker");
    const items = [...event.currentTarget.querySelectorAll("[role='menuitemradio']")];
    const index = items.indexOf(event.target);
    const action = index < 0 ? null : core.menuKey(event, index, items.length);
    if (!action || action.type === "leave") {
      if (action && event.type === "keydown") closePopover(picker, true);
      return;
    }
    // Every other menu key stays in the menu, so LingQ never sees it.
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== "keydown") return;
    if (action.type === "focus") items[action.index].focus();
    else if (action.type === "close") closePopover(picker, true);
    else if (action.type === "choose") {
      saveSettings({ playbackMode: items[action.index].dataset.mode });
      closePopover(picker, true);
    }
  }

  // No key pressed in the settings panel reaches LingQ. Its document listener
  // would close a word card or the video on Escape and read the lesson aloud on
  // Space.
  function handlePanelKey(event) {
    event.stopPropagation();
    if (event.type === "keydown" && event.key === "Escape") {
      event.preventDefault();
      closePopover(event.currentTarget.closest(".lspc-picker"), true);
    }
  }

  function modeMenu() {
    const popover = element("div", "lspc-popover");
    popover.hidden = true;
    // Clicks on the menu's text keep focus in the menu, so it stays open.
    popover.addEventListener("mousedown", (event) => event.preventDefault());
    const heading = element("div", "lspc-menu-heading", "At the end of each sentence");
    heading.id = "lspc-mode-menu-heading";
    const menu = element("div", "lspc-menu");
    menu.id = "lspc-mode-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-labelledby", heading.id);
    menu.addEventListener("keydown", handleMenuKey);
    menu.addEventListener("keyup", handleMenuKey);
    for (const { mode, name, description, icon: paths } of MODES) {
      const item = element("button", "lspc-menu-item");
      item.type = "button";
      item.tabIndex = -1;
      item.dataset.mode = mode;
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-labelledby", `lspc-mode-${mode}-name`);
      item.setAttribute("aria-describedby", `lspc-mode-${mode}-description`);
      const text = element("span", "lspc-menu-text");
      const title = element("span", "lspc-menu-name", name);
      title.id = `lspc-mode-${mode}-name`;
      const detail = element("span", "lspc-menu-description", description);
      detail.id = `lspc-mode-${mode}-description`;
      text.append(title, detail);
      item.append(icon(paths), text, icon(ICONS.check, "lspc-icon lspc-check"));
      item.addEventListener("click", (event) => {
        saveSettings({ playbackMode: mode });
        closePopover(item.closest(".lspc-picker"), event.detail === 0);
        releasePointerFocus(event);
      });
      menu.append(item);
    }
    const shortcuts = element("p", "lspc-menu-shortcuts");
    SHORTCUTS.forEach(([keys, action], index) => {
      if (index) shortcuts.append(" · ");
      for (const key of keys) shortcuts.append(element("kbd", "", key), " ");
      shortcuts.append(action);
    });
    popover.append(heading, menu, shortcuts);
    return popover;
  }

  // A settings section: a caption heading and description over radio rows
  // styled as menu options. A row's control, such as the seconds list, sits
  // before its check.
  function settingSection(key, heading, about, choices, choose) {
    const title = element("div", "lspc-menu-heading", heading);
    title.id = `lspc-${key}-heading`;
    const description = element("p", "lspc-setting-description", about);
    description.id = `lspc-${key}-description`;
    const group = element("div", "lspc-choices");
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-labelledby", title.id);
    group.setAttribute("aria-describedby", description.id);

    for (const { value, name, description: detail, control } of choices) {
      const row = element("label", "lspc-menu-item lspc-choice");
      const input = element("input", "lspc-choice-input");
      input.type = "radio";
      input.name = `lspc-${key}`;
      input.value = value;
      input.setAttribute("aria-labelledby", `lspc-${key}-${value}-name`);
      input.setAttribute("aria-describedby", `lspc-${key}-${value}-description`);
      input.addEventListener("change", () => {
        choose(value);
        input.focus();
      });
      const text = element("span", "lspc-menu-text");
      const caption = element("span", "lspc-menu-description", detail);
      caption.id = `lspc-${key}-${value}-description`;
      const label = element("span", "lspc-menu-name", name);
      label.id = `lspc-${key}-${value}-name`;
      text.append(label, caption);
      row.append(input, text);
      if (control) row.append(control);
      row.append(icon(ICONS.check, "lspc-icon lspc-check"));
      group.append(row);
    }
    return [title, description, group];
  }

  function settingsPanel() {
    const panel = element("div", "lspc-popover");
    panel.id = "lspc-settings";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Settings");
    // As in the menu, clicks on the panel's text keep focus inside it. The
    // seconds list still opens on its own press.
    panel.addEventListener("mousedown", (event) => {
      if (!event.target.closest("select")) event.preventDefault();
    });
    panel.addEventListener("keydown", handlePanelKey);
    panel.addEventListener("keyup", handlePanelKey);

    const seconds = element("select", "lspc-seconds");
    seconds.setAttribute("aria-label", "Seconds to wait");
    for (let value = 1; value <= 10; value += 1) {
      const option = element("option", "", `${value} s`);
      option.value = String(value);
      seconds.append(option);
    }
    seconds.value = "3";
    seconds.addEventListener("change", () => {
      saveSettings({ boundaryDelay: { kind: "seconds", seconds: Number(seconds.value) } });
    });

    panel.append(
      ...settingSection(
        "delay",
        "Boundary Delay",
        "Wait at the end of each sentence before Continue or Repeat.",
        DELAYS.map((choice) => (choice.value === "seconds" ? { ...choice, control: seconds } : choice)),
        (kind) => saveSettings({ boundaryDelay: { kind, seconds: Number(seconds.value) } }),
      ),
      ...settingSection(
        "visibility",
        "Sentence Visibility",
        "When the sentence's text shows. Click hidden text to show it.",
        VISIBILITIES,
        (sentenceVisibility) => saveSettings({ sentenceVisibility }),
      ),
      ...settingSection(
        "neighbors",
        "Neighbor Sentences",
        "The next sentences under this one. Click one to play it. Listen First hides them.",
        NEIGHBOR_CHOICES,
        (value) => saveSettings({ neighborSentences: value === "on" }),
      ),
      ...timingSection(),
    );
    return panel;
  }

  // The Timing Offset of this lesson: the shift in 0.1 s steps with a reset,
  // and the pad in 0.05 s steps. Each change applies at once.
  function timingSection() {
    const title = element("div", "lspc-menu-heading", "Timing Offset");
    title.id = "lspc-timing-heading";
    const description = element(
      "p",
      "lspc-setting-description",
      "Moves this lesson's sentences earlier or later. Pad lengthens both ends of each.",
    );
    const rows = element("div", "lspc-timing");
    rows.setAttribute("role", "group");
    rows.setAttribute("aria-labelledby", title.id);
    // A stepper shows a minus or plus icon, and the reset its text.
    const button = (step, label, text = "") => {
      const node = element("button", text ? "lspc-timing-reset" : "lspc-step", text);
      node.type = "button";
      node.dataset.step = step;
      node.setAttribute("aria-label", label);
      if (!text) node.append(icon(ICONS[step.endsWith("up") ? "plus" : "minus"]));
      node.addEventListener("click", () => {
        const offset = state.timing?.offset;
        if (offset) saveTiming(TIMING_STEPS[step](offset));
      });
      return node;
    };
    const value = (name) => {
      const node = element("output", "lspc-timing-value");
      node.dataset.value = name;
      node.setAttribute("aria-labelledby", `lspc-timing-${name}`);
      return node;
    };
    const name = (key, text) => {
      const node = element("span", "lspc-menu-name", text);
      node.id = `lspc-timing-${key}`;
      return node;
    };
    rows.append(
      name("shift", "Shift"),
      button("shift-down", "Shift earlier by 0.1 s"),
      value("shift"),
      button("shift-up", "Shift later by 0.1 s"),
      button("shift-reset", "Reset the shift", "Reset"),
      name("pad", "Pad"),
      button("pad-down", "Pad less by 0.05 s"),
      value("pad"),
      button("pad-up", "Pad more by 0.05 s"),
    );
    return [title, description, rows];
  }

  function countdownRing() {
    const ring = icon([], "lspc-icon lspc-ring");
    ring.dataset.mode = "wait";
    for (const className of ["lspc-ring-track", "lspc-ring-left"]) {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("class", className);
      circle.setAttribute("cx", "12");
      circle.setAttribute("cy", "12");
      circle.setAttribute("r", "8.5");
      circle.setAttribute("pathLength", "1");
      ring.append(circle);
    }
    return ring;
  }

  function picker(button, popover) {
    const node = element("div", "lspc-picker");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", (event) => {
      const open = button.getAttribute("aria-expanded") !== "true";
      setPopoverOpen(node, open);
      if (!open) releasePointerFocus(event);
    });
    // LingQ never sees Escape or Space here. Escape would close its video, and
    // Space would play its lesson audio.
    const handleButtonKey = (event) => {
      const action = core.menuButtonKey(event, {
        open: button.getAttribute("aria-expanded") === "true",
        focus: Boolean(state.focus),
      });
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === "open") setPopoverOpen(node, true);
      else if (event.key === "Escape" && event.type === "keydown") setPopoverOpen(node, false);
    };
    button.addEventListener("keydown", handleButtonKey);
    button.addEventListener("keyup", handleButtonKey);
    node.addEventListener("focusout", (event) => {
      if (!node.contains(event.relatedTarget)) setPopoverOpen(node, false);
    });
    node.append(button, popover);
    return node;
  }

  function footerItem(paths, label, className = "") {
    const button = element("button", `lspc-item ${className}`.trim());
    button.type = "button";
    const text = element("span", "lspc-item-label");
    text.append(element("span", "lspc-label-text", label));
    button.append(icon(paths), text);
    return button;
  }

  // A Focus Mode control that runs a companion action, like its shortcut.
  function focusItem(paths, label, shortcut, action, className = "") {
    const button = footerItem(paths, label, `lspc-focus-only ${className}`);
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-keyshortcuts", shortcut);
    button.dataset.tip = label;
    button.addEventListener("click", (event) => {
      releasePointerFocus(event);
      action();
    });
    return button;
  }

  function mountModeControl() {
    const footer = state.layout?.footer;
    if (!footer) return;
    if (state.modeControl?.parentNode === footer) return;

    state.modeControl?.remove();
    const control = element("div", "lspc-controls");
    const replay = footerItem(ICONS.replay, "Replay");
    replay.setAttribute("aria-label", "Replay Now");
    replay.dataset.tip = "Replay Now";
    replay.setAttribute("aria-keyshortcuts", "R");
    replay.addEventListener("click", (event) => {
      releasePointerFocus(event);
      replayNow();
    });

    const modeButton = element("button", "lspc-item lspc-mode-button");
    modeButton.type = "button";
    modeButton.setAttribute("aria-haspopup", "menu");
    modeButton.setAttribute("aria-controls", "lspc-mode-menu");
    const glyphs = element("span", "lspc-stack");
    const labels = element("span", "lspc-stack");
    for (const { mode, label, icon: paths } of MODES) {
      const glyph = icon(paths);
      glyph.dataset.mode = mode;
      glyphs.append(glyph);
      const text = element("span", "lspc-item-label");
      text.dataset.mode = mode;
      text.append(
        element("span", "lspc-label-text", label),
        icon(ICONS.chevron, "lspc-icon lspc-chevron"),
      );
      labels.append(text);
    }
    glyphs.append(countdownRing());
    const waiting = element("span", "lspc-item-label lspc-countdown");
    waiting.dataset.mode = "wait";
    waiting.append(
      element("span", "lspc-label-text"),
      icon(ICONS.chevron, "lspc-icon lspc-chevron"),
    );
    labels.append(waiting);
    modeButton.append(glyphs, labels);

    const settingsButton = footerItem(ICONS.settings, "Settings");
    settingsButton.setAttribute("aria-haspopup", "dialog");
    settingsButton.setAttribute("aria-controls", "lspc-settings");
    settingsButton.dataset.tip = "Settings";

    // Focus Mode adds Previous, Play or Pause, Next, and the speed to the row,
    // and the Focus button enters it.
    const previous = focusItem(ICONS.previous, "Previous sentence", "P", () => navigate("previous"));
    const next = focusItem(ICONS.next, "Next sentence", "N", () => navigate("next"));
    const play = focusItem([], "Play", "Space", togglePlayback, "lspc-play");
    const playGlyphs = element("span", "lspc-stack");
    for (const mode of ["play", "pause"]) {
      const glyph = icon(ICONS[mode], "lspc-icon lspc-solid");
      glyph.dataset.glyph = mode;
      playGlyphs.append(glyph);
    }
    play.querySelector(".lspc-icon").replaceWith(playGlyphs);
    const speed = element("button", "lspc-item lspc-speed lspc-focus-only");
    speed.type = "button";
    const speedLabel = element("span", "lspc-item-label");
    speedLabel.append(element("span", "lspc-label-text", "Speed"));
    speed.append(element("span", "lspc-rate"), speedLabel);
    speed.addEventListener("click", (event) => {
      releasePointerFocus(event);
      setRate(core.nextPlaybackRate(state.rate));
    });
    const focus = footerItem(ICONS.focus, "Focus", "lspc-normal-only");
    focus.setAttribute("aria-label", "Focus Mode");
    focus.dataset.tip = "Focus Mode";
    focus.addEventListener("click", (event) => {
      noteMovingClick(event);
      enterFocus(event.detail === 0);
    });
    ignoreHeldEnter(focus);

    const transport = element("div", "lspc-transport");
    transport.append(previous, replay, play, next);
    const options = element("div", "lspc-options");
    options.append(
      speed,
      element("span", "lspc-divider"),
      picker(modeButton, modeMenu()),
      picker(settingsButton, settingsPanel()),
      focus,
    );
    control.append(transport, options);
    footer.append(control);
    state.modeControl = control;
    render();
  }

  function mount({ reader, portal, footer, modal, container }) {
    const next = { modal, portal, reader, footer, container };
    const action = core.layoutAction(state.layout, next);
    if (
      action === "retain" &&
      container.parentNode === portal &&
      state.modeControl?.parentNode === footer
    ) {
      modal.classList.add("lspc-player");
      portal.classList.add("lspc-portal");
      reader.classList.add("lspc-reader");
      return;
    }
    if (action === "rebind" || action === "retain") {
      state.layout.portal.classList.remove("lspc-portal");
      state.layout.reader.classList.remove("lspc-reader", "lspc-sentence-hidden");
      state.modeControl?.remove();
      state.modeControl = null;
      state.layout = { ...state.layout, ...next };
      portal.classList.add("lspc-portal");
      reader.classList.add("lspc-reader");
      portal.append(container);
      if (state.statusKind) setStatus(state.statusKind, footer);
      mountModeControl();
      return;
    }
    restoreLayout();
    state.layout = {
      modal,
      container,
      portal,
      reader,
      footer,
      parent: container.parentNode,
      nextSibling: container.nextSibling,
    };
    modal.classList.add("lspc-player");
    portal.classList.add("lspc-portal");
    reader.classList.add("lspc-reader");
    portal.append(container);
    mountModeControl();
  }

  async function sentencesFor(lesson) {
    if (state.cache?.key !== lesson.key) {
      state.sentences = null;
      state.cache = {
        key: lesson.key,
        promise: fetch(lesson.endpoint, { credentials: "same-origin" })
          .then((response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          })
          .then(core.sentenceResponse)
          .catch((error) => {
            warnOnce(`could not load sentence bounds for ${lesson.key}`, error);
            return null;
          }),
      };
    }
    return state.cache.promise;
  }

  // Loads the lesson's Timing Offset from storage once, into state.timing.
  function timingFor(lesson) {
    if (state.timing?.key !== lesson.key) {
      const timing = { key: lesson.key, offset: null, promise: null };
      timing.promise = chrome.storage.local
        .get(core.TIMING_KEY)
        .then((stored) => core.storedTiming(stored[core.TIMING_KEY], lesson.key))
        .catch((error) => {
          warnOnce(`could not load the Timing Offset for ${lesson.key}`, error);
          return core.timingOffset();
        })
        .then((offset) => {
          timing.offset ??= offset;
        });
      state.timing = timing;
    }
    return state.timing.promise;
  }

  // A Timing Offset change re-times the active sentence at once and saves the
  // lesson's offset. Stored offsets are re-read before each write, so another
  // lesson's change in another tab isn't lost.
  function saveTiming(change) {
    const timing = state.timing;
    if (!timing?.offset) return;
    const offset = core.timingOffset({ ...timing.offset, ...change });
    if (sameTiming(offset, timing.offset)) return;
    timing.offset = offset;
    renderTiming();
    void sync();
    state.timingWrite = state.timingWrite
      .then(() => chrome.storage.local.get(core.TIMING_KEY))
      .then((stored) => {
        const record = core.savedTiming(stored[core.TIMING_KEY], timing.key, offset, Date.now());
        return Object.keys(record).length
          ? chrome.storage.local.set({ [core.TIMING_KEY]: record })
          : chrome.storage.local.remove(core.TIMING_KEY);
      })
      .catch((error) => warnOnce(`could not save the Timing Offset for ${timing.key}`, error));
  }

  function postBridgeCommand(command) {
    if (command) window.postMessage(command, location.origin);
  }

  // The active sentence's bounds changed with its Timing Offset. A play under
  // way is retimed: the bridge keeps it inside the new bounds. A play still
  // starting would report a time from the old bounds, so it starts again at
  // the new start. A paused sentence is cued again at its new start.
  function retimeCue(cue) {
    const starting = state.synchronizing === "play" || Date.now() < state.playPendingUntil;
    const expected = state.playbackQueue.at(-1)?.expectedState ?? state.playerState;
    const playing = [core.PLAYER_STATES.PLAYING, core.PLAYER_STATES.BUFFERING].includes(expected);
    if (starting) {
      state.synchronizing = "play";
      expectPlay();
      state.ignoreResetUntil = Date.now() + 1000;
    }
    if (starting || !playing) state.boundaryArmed = false;
    const type = starting ? "seek-play" : playing ? "retime" : "seek";
    postBridgeCommand(core.bridgeCommand(type, state.generation, cue.segment));
    state.cueKey = cue.key;
  }

  function cuePending() {
    if (!state.ready || !state.pendingCue || state.pendingCue.key === state.cueKey) return;
    if (state.pendingCue.at === state.cueAt && !state.pendingCue.play) {
      retimeCue(state.pendingCue);
      state.pendingCue = null;
      return;
    }
    const type = core.cueCommand(
      {
        play: state.pendingCue.play,
        activation: state.cueKey === null,
        lessonKey: state.lessonKey,
      },
      state.playRequest,
      Date.now(),
    );
    state.playRequest = null;
    cancelWait();
    if (type === "seek-play") {
      state.synchronizing = "play";
      expectPlay();
    }
    postBridgeCommand(
      core.bridgeCommand(
        type,
        state.generation,
        state.pendingCue.continued ?? state.pendingCue.segment,
      ),
    );
    state.ignoreResetUntil = Date.now() + 1000;
    state.boundaryArmed = false;
    state.cueAt = state.pendingCue.at;
    state.cueKey = state.pendingCue.key;
    state.pendingCue = null;
  }

  async function sync() {
    const revision = ++state.revision;
    const context = readerContext();
    if (!context) {
      restoreLayout();
      return;
    }

    const [sentences] = await Promise.all([
      sentencesFor(context.lesson),
      timingFor(context.lesson),
    ]);
    if (revision !== state.revision) return;
    state.sentences = sentences;
    // The offset as it is now, which a change in the settings panel replaces.
    const offset = state.timing.offset;

    const bounds = core.initialCue(sentences, context.sentence.id, true);
    if (!bounds) {
      warnOnce(`invalid bounds for ${context.lesson.key}:${context.sentence.id}`);
      restoreLayout();
      return;
    }

    const player = playerContext(context);
    if (!player) {
      const invoked = document.querySelector(".video-player.is-active iframe");
      if (state.layout) restoreLayout();
      if (invoked) setStatus("unsupported", context.footer);
      else if (state.statusControl) restoreLayout();
      return;
    }

    const lifecycle = core.lifecycleAction(
      state.frame
        ? { lessonKey: state.lessonKey, frame: state.frame, ...state.layout }
        : null,
      { lessonKey: context.lesson.key, ...player },
    );
    mount(player);
    state.lessonKey = context.lesson.key;
    if (lifecycle === "bind") {
      state.frame = player.frame;
      state.ready = false;
      state.cueAt = null;
      state.cueKey = null;
      // The new player reports its own duration before it's ready.
      state.duration = null;
      state.autoplayBlocked = false;
      state.generation += 1;
      setStatus("loading");
      postBridgeCommand(core.bridgeCommand("bind", state.generation));
    }
    renderTiming();
    const segment = core.offsetSegment(bounds, offset, state.duration);
    state.segment = segment;
    const at = `${context.lesson.key}:${bounds.sentenceNumber}`;
    const key = `${at}:${segment.start}:${segment.end}`;
    const play =
      state.navigation?.target === context.sentence.id && state.navigation.play;
    // The segment Continue plays: on through a padded overlap rather than
    // back to the segment's start.
    const resume = play ? state.navigation.resume : null;
    const continued = resume ? core.continuedSegment(segment, resume.time, resume.after) : null;
    if (state.navigation && context.sentence.id !== state.navigation.from) {
      state.navigation = null;
    }
    state.pendingCue = { at, key, play, segment, continued };
    cuePending();
    renderVisibility();
  }

  function navigationOwner(direction) {
    const marker = state.layout?.reader.querySelector(
      direction === "previous" ? ".nav--left > a.button" : ".next-page-button",
    );
    return marker?.closest("a, button, [role='button']") || marker;
  }

  function navigationDirection(target) {
    const owner = target?.closest?.("a, button, [role='button']");
    if (owner?.closest(".nav--left")) return "previous";
    if (target?.closest?.(".next-page-button") || owner?.querySelector(".next-page-button")) {
      return "next";
    }
    return null;
  }

  function armNavigation(direction) {
    const context = readerContext();
    const current = Number(context?.sentence.id.slice(1));
    const target = core.adjacentSentence(current, state.sentences?.length, direction);
    if (!state.layout || !target) return false;

    cancelWait();
    state.navigation = { from: context.sentence.id, target: `s${target}`, play: true };
    expectPlay();
    return true;
  }

  // continuing: Continue moves on, so the next sentence may play on from
  // where the video stopped (core.continuedSegment). The click arms the
  // navigation again as LingQ's own, so resume is set after it.
  function navigate(direction, continuing = false) {
    const owner = navigationOwner(direction);
    const after = state.segment?.end;
    if (!owner || !armNavigation(direction)) return;
    owner.click();
    if (state.navigation && continuing) {
      state.navigation.resume = { time: state.playerTime, after };
    }
  }

  function navigateToSentence(sentenceNumber, play) {
    const context = readerContext();
    const progress = state.layout?.reader.querySelector(".rc-slider-with-marks");
    const marks = progress?.querySelectorAll(".rc-slider-dot");
    const mark = marks?.[sentenceNumber - 1];
    if (!context || marks?.length !== state.sentences?.length || !mark) return;

    const bounds = progress.getBoundingClientRect();
    const percentage = Number.parseFloat(mark.style.left);
    if (!Number.isFinite(percentage) || !bounds.width) return;

    cancelWait();
    state.boundaryArmed = false;
    state.synchronizing = play ? "play" : "pause";
    state.navigation = {
      from: context.sentence.id,
      target: `s${sentenceNumber}`,
      play,
    };
    if (play) expectPlay();
    // A mouse event's clientX is a whole pixel, so the nearest one is used.
    const options = {
      bubbles: true,
      buttons: 1,
      clientX: Math.round(bounds.left + bounds.width * (percentage / 100)),
      clientY: bounds.top + bounds.height / 2,
    };
    for (const type of [
      "pointerdown",
      "mousedown",
      "pointerup",
      "mouseup",
      "click",
    ]) {
      progress.dispatchEvent(new MouseEvent(type, options));
    }
  }

  function replayNow() {
    if (!state.ready || !state.segment) return;
    cancelWait();
    state.boundaryArmed = false;
    state.synchronizing = "play";
    state.ignoreResetUntil = Date.now() + 1000;
    expectPlay();
    postBridgeCommand(core.bridgeCommand("seek-play", state.generation, state.segment));
  }

  function hasNextSentence(context) {
    const current = Number(context?.sentence.id.slice(1));
    return Boolean(core.adjacentSentence(current, state.sentences?.length, "next"));
  }

  // LingQ marks a selected word with is-selected and a selected phrase with
  // selected-text, and removes the mark when the reader clicks off the sentence.
  function selectionOpen(context) {
    return Boolean(context?.sentence.querySelector(".is-selected, .selected-text"));
  }

  function sentenceText(context) {
    return state.sentences?.[Number(context?.sentence.id.slice(1)) - 1]?.text;
  }

  // Where a wait belongs: the active lesson and sentence.
  function position(context) {
    return context ? `${context.lesson.key}:${context.sentence.id}` : null;
  }

  // The active sentence's reveal. A new sentence starts a new one, so Listen
  // First hides it again.
  function revealOf(context) {
    const at = position(context);
    if (state.reveal?.at !== at) state.reveal = { at, listened: false, requested: false };
    return state.reveal;
  }

  // A play the companion starts counts as playing before the video reports it,
  // so Show on Pause never flashes the sentence it is about to play. It ends
  // when the video plays or settles paused, or after this long without either.
  const PLAY_PENDING_MS = 2000;

  function expectPlay() {
    state.playPendingUntil = Date.now() + PLAY_PENDING_MS;
    setTimeout(renderVisibility, PLAY_PENDING_MS + 20);
  }

  function sentenceShown(context) {
    const { listened, requested } = revealOf(context);
    return core.sentenceShown(state.settings.sentenceVisibility, {
      paused: core.videoPaused(state.playerState, Date.now() < state.playPendingUntil),
      listened,
      requested,
      selected: selectionOpen(context),
      failed: state.statusKind === "failed",
    });
  }

  // Text that just showed may lie under a press or key aimed at it while it was
  // hidden, so presses in the next half second stay away from LingQ.
  const REVEAL_GUARD_MS = 500;

  function renderVisibility() {
    const context = state.layout && readerContext();
    if (!context) return;
    const reader = state.layout.reader;
    const hidden = !sentenceShown(context);
    if (!hidden && reader.classList.contains("lspc-sentence-hidden")) {
      state.revealGuard = Date.now() + REVEAL_GUARD_MS;
    }
    reader.classList.toggle("lspc-sentence-hidden", hidden);
    renderNeighbors(context);
    renderFocus(context);
  }

  // Neighbor Sentences: the text of the next few sentences, dimmed, in a list
  // of the companion's own between LingQ's sentence and its translation. They
  // hide with the sentence.
  const NEIGHBOR_LIMIT = 3;
  // LingQ's translation and saved words, under the list, keep this much height.
  const RESOURCES_FLOOR = 40;

  // A fit can show or hide the reader's scrollbar, which resizes the observed
  // sentence box. Fitting in the next frame keeps that out of the observer's
  // own delivery, which would report a loop.
  let fitFrame = 0;
  const neighborResize = new ResizeObserver(() => {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(fitNeighbors);
  });

  function removeNeighbors() {
    neighborResize.disconnect();
    state.neighbors?.parentElement?.style.removeProperty("--lspc-video-height");
    state.neighbors?.remove();
    state.neighbors = null;
    state.neighborKey = null;
  }

  function renderNeighbors(context) {
    const wrapper = context.sentence.closest(".reader-container-wrapper");
    // Only sentences of the bound lesson: another lesson's text never shows.
    if (
      !wrapper?.parentElement ||
      !state.sentences ||
      state.lessonKey !== context.lesson.key ||
      !core.showsNeighbors(state.settings)
    ) {
      removeNeighbors();
      return;
    }
    if (state.neighbors?.previousElementSibling !== wrapper) {
      removeNeighbors();
      state.neighbors = element("div", "lspc-neighbors");
      wrapper.after(state.neighbors);
      for (const box of [wrapper.closest(".sentence-text"), wrapper, state.layout.portal]) {
        neighborResize.observe(box);
      }
    }
    const key = position(context);
    if (state.neighborKey === key) return;
    state.neighborKey = key;
    const neighbors = core.neighborSentences(
      state.sentences,
      Number(context.sentence.id.slice(1)),
      NEIGHBOR_LIMIT,
    );
    state.neighbors.replaceChildren(
      ...neighbors.map(({ number, text }) => {
        const button = element("button", "lspc-neighbor", text);
        button.type = "button";
        button.dataset.sentence = String(number);
        return button;
      }),
    );
    fitNeighbors();
  }

  // Shows the leading neighbors that fit above the translation's floor, so the
  // video, the sentence, and the footer never move or scroll away.
  function fitNeighbors() {
    const list = state.neighbors;
    if (!list?.isConnected) return;
    list.parentElement.style.setProperty(
      "--lspc-video-height",
      `${core.neighborVideoHeight(
        innerHeight,
        Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      )}px`,
    );
    const items = [...list.children];
    list.hidden = false;
    for (const item of items) item.hidden = false;
    // The reader scrolls inside .sentence-text, whose box stays put while
    // every neighbor shows. In Focus Mode the list fills its own grid area.
    const free = state.focus
      ? list.clientHeight - (Number.parseFloat(getComputedStyle(list).paddingTop) || 0)
      : list.closest(".sentence-text").getBoundingClientRect().bottom -
        list.getBoundingClientRect().top -
        (Number.parseFloat(getComputedStyle(list.parentElement).rowGap) || 0) -
        RESOURCES_FLOOR;
    const count = core.neighborCount(
      items.map((item) => item.offsetHeight),
      free,
    );
    items.forEach((item, index) => {
      item.hidden = index >= count;
    });
    // An empty list leaves the grid, so it adds no row gap.
    list.hidden = !count;
  }

  // No press on a Neighbor Sentence reaches LingQ, so its text is never taken
  // for a word, and neither does Enter on one. A click or Enter plays that
  // sentence through LingQ's direct sentence navigation.
  function handleNeighborEvent(event) {
    const neighbor = event.target?.closest?.(".lspc-neighbor");
    const action =
      neighbor?.parentNode === state.neighbors ? core.neighborAction(event) : null;
    if (!action) return;
    event.stopImmediatePropagation();
    // A press selects no text, and Enter makes no second click.
    if (event.type === "mousedown" || event.type.startsWith("key")) event.preventDefault();
    if (action !== "play") return;
    if (event.type === "click") {
      // The rest of a double click, and a held Enter's repeats and release,
      // land after the list changes, so they stay away from LingQ too.
      noteMovingClick(event);
    } else {
      state.keysKept.add(event.code);
    }
    // The press left focus where it was, maybe in the video or a field, so a
    // click hands it back to the page and the letter shortcuts work.
    releasePointerFocus(event);
    navigateToSentence(Number(neighbor.dataset.sentence), true);
  }

  // Focus Mode fills the window with the video, the controls, and the active
  // sentence, using classes on LingQ's own reader. Nothing of LingQ's moves:
  // the reader's grid places its parts, and leaving takes the classes, the
  // reader's two size properties, and the companion's bar away again.
  const FOCUS_CLASSES = ["lspc-focus", "lspc-focus-split", "lspc-focus-stack", "lspc-focus-panel"];
  const FOCUS_PROPERTIES = ["--lspc-focus-video-width", "--lspc-focus-video-height"];

  function focusBar() {
    const bar = element("div", "lspc-focus-bar");
    const exit = element("button", "lspc-focus-exit");
    exit.type = "button";
    exit.setAttribute("aria-keyshortcuts", "Escape");
    exit.append(icon(ICONS.exitFocus), element("span", "", "Exit Focus"), element("kbd", "", "Esc"));
    exit.addEventListener("click", (event) => {
      noteMovingClick(event);
      leaveFocus(event.detail === 0);
    });
    ignoreHeldEnter(exit);
    bar.append(element("span", "lspc-focus-where"), exit);
    return bar;
  }

  // A click that moves what lies under the pointer. The rest of its double
  // click stays away from LingQ (see handleRevealPress).
  function noteMovingClick(event) {
    if (event.detail > 0) state.movingClick = { x: event.clientX, y: event.clientY, time: Date.now() };
  }

  // A held Enter's repeats would toggle Focus Mode at the key-repeat rate.
  function ignoreHeldEnter(button) {
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.repeat) event.preventDefault();
    });
  }

  function enterFocus(keyboard) {
    if (!state.layout || state.focus) return;
    state.focus = { reader: null, bar: null, hadStyle: false, pressed: null, dismissed: null };
    renderVisibility();
    fitNeighbors();
    if (keyboard) state.focus.bar?.querySelector(".lspc-focus-exit").focus();
    else document.activeElement?.blur();
  }

  // Leaves Focus Mode. A keyboard exit returns focus to the Focus button.
  function leaveFocus(keyboard = false) {
    if (!state.focus) return;
    unapplyFocus(state.focus);
    state.focus = null;
    fitNeighbors();
    if (keyboard) state.modeControl?.querySelector(".lspc-normal-only").focus();
  }

  function unapplyFocus(focus) {
    if (!focus.reader) return;
    focus.reader.classList.remove(...FOCUS_CLASSES);
    for (const property of FOCUS_PROPERTIES) focus.reader.style.removeProperty(property);
    if (!focus.hadStyle && !focus.reader.getAttribute("style")) {
      focus.reader.removeAttribute("style");
    }
    focus.bar?.remove();
    focus.reader = null;
    focus.bar = null;
  }

  // The selected words of the active sentence, as one string.
  function selectionMarks(context) {
    return [...(context?.sentence.querySelectorAll(".is-selected, .selected-text") || [])]
      .map((mark) => mark.id || mark.textContent)
      .join(" ");
  }

  function focusPanelOpen(context) {
    const reader = state.focus?.reader;
    return Boolean(reader) && core.wordPanelOpen({
      docked: Boolean(reader.querySelector(":scope > .widget-area")),
      floating: Boolean(reader.querySelector(":scope > .reader-widget.is-floating")),
      pressed: state.focus.pressed !== null && state.focus.pressed === position(context),
      marks: selectionMarks(context),
      dismissed: state.focus.dismissed,
    });
  }

  // Applies Focus Mode to the current reader, and takes it off a reader LingQ
  // replaced. Running it again changes nothing.
  function renderFocus(context = state.layout && readerContext()) {
    const focus = state.focus;
    const reader = state.layout?.reader;
    if (!focus) return;
    if (focus.reader !== reader) unapplyFocus(focus);
    if (!reader) return;
    if (!focus.reader) {
      focus.reader = reader;
      focus.hadStyle = reader.hasAttribute("style");
      focus.bar = focusBar();
      reader.append(focus.bar);
    } else if (focus.bar.parentNode !== reader) {
      reader.append(focus.bar);
    }
    const root = document.documentElement;
    const layout = core.focusLayout(
      root.clientWidth,
      root.clientHeight,
      Number.parseFloat(getComputedStyle(root).fontSize),
    );
    // toggle, unlike add, leaves a class already there untouched, so the
    // class observer that runs this sees no change and stops.
    reader.classList.toggle("lspc-focus", true);
    reader.classList.toggle("lspc-focus-split", layout.kind === "split");
    reader.classList.toggle("lspc-focus-stack", layout.kind === "stack");
    reader.classList.toggle("lspc-focus-panel", focusPanelOpen(context));
    reader.style.setProperty("--lspc-focus-video-width", `${layout.videoWidth}px`);
    reader.style.setProperty("--lspc-focus-video-height", `${layout.videoHeight}px`);
    const number = Number(context?.sentence.id.slice(1));
    const where = `${number || ""} / ${state.sentences?.length || ""} · ${document.title}`;
    const label = focus.bar.querySelector(".lspc-focus-where");
    if (label.textContent !== where) label.textContent = where;
  }

  // Escape in Focus Mode puts away an open word panel, then leaves. It never
  // reaches LingQ's document, whose listeners would close the video. This
  // listener runs after LingQ's own and the companion's popovers', which keep
  // their Escape.
  function handleFocusEscape(event) {
    const context = state.focus && readerContext();
    const action = core.focusEscape(event, {
      focus: Boolean(state.focus?.reader),
      panelOpen: focusPanelOpen(context),
      editable: targetKind(event.target).editable,
      covered: coveredAtPress.get(event) ?? focusCovered(),
      kept: state.escapeKept,
    });
    if (!action) return;
    event.stopPropagation();
    if (action === "exit") {
      state.escapeKept = true;
      // Exit Focus goes away, so focus it held returns to the Focus button.
      // Anywhere else, focus stays, so the letter shortcuts keep working.
      leaveFocus(Boolean(state.focus.bar?.contains(document.activeElement)));
    } else if (action === "close-panel") {
      closeWordPanel(context);
    }
  }

  // Whether something above Focus Mode, such as one of LingQ's dialogs, covers
  // the middle of the window. Escape is LingQ's dialog's, and LingQ's own
  // Escape would also close the video, so Focus Mode keeps it and stays. A
  // dialog may close itself on that Escape before it bubbles up, so the check
  // runs when the key goes down (coveredAtPress).
  const coveredAtPress = new WeakMap();

  function focusCovered() {
    const reader = state.focus?.reader;
    const top = reader && document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return Boolean(top) && !reader.contains(top);
  }

  // LingQ closes its floating card on Escape, so the companion uses the card's
  // own close button. LingQ's docked panel has none and keeps the word
  // selected, so Focus Mode puts the panel away until the selection changes,
  // and does the same for a card without its close button.
  function closeWordPanel(context) {
    const close = state.focus.reader.querySelector(
      ":scope > .reader-widget.is-floating .widget-close-trigger",
    );
    if (close) close.click();
    else {
      state.focus.pressed = null;
      state.focus.dismissed = selectionMarks(context);
    }
    renderVisibility();
  }

  // A press on a word of the sentence shows LingQ's docked panel, even for
  // the word it already shows, which LingQ doesn't mark.
  function handleFocusPress(event) {
    if (!state.focus || !event.isTrusted) return;
    const context = readerContext();
    const word = event.target?.closest?.(".sentence-item");
    if (word && context?.sentence.contains(word)) {
      state.focus.pressed = position(context);
      state.focus.dismissed = null;
      renderVisibility();
    }
  }

  function setRate(rate) {
    if (!state.ready) return;
    const command = core.bridgeCommand("rate", state.generation, rate);
    if (!command) return;
    state.rate = rate;
    renderPlayback();
    postBridgeCommand(command);
  }

  function requestReveal(context) {
    revealOf(context).requested = true;
    renderVisibility();
  }

  // A press on the hidden sentence itself: inside its box, on it or on what
  // lies under it, never on something that floats over it.
  function onSentence(sentence, event) {
    const box = sentence.getBoundingClientRect();
    const target = event.target;
    return (
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom &&
      (sentence.contains(target) ||
        (target?.contains?.(sentence) &&
          Boolean(sentence.closest(".reader-container")?.contains(target))))
    );
  }

  // A click on the hidden sentence shows it. No part of a press aimed at hidden
  // or just-shown text reaches LingQ, so it can't select a word, and Auto LingQ
  // creation can't save one.
  function handleRevealPress(event) {
    const context = state.layout && readerContext();
    // The companion's own scripted presses, such as a seek's progress-mark
    // press, neither start nor end a press.
    const start = event.type === "pointerdown" && event.isTrusted;
    const hidden = Boolean(context) && !sentenceShown(context);
    const following =
      start &&
      core.followsMovingClick(
        { x: event.clientX, y: event.clientY, time: Date.now() },
        state.movingClick,
      );
    const kept = core.pressKept(start, {
      atWords: Boolean(context) && onSentence(context.sentence, event),
      hidden,
      guarded: Date.now() < state.revealGuard,
      kept: state.pointerKept && event.isTrusted,
      following,
    });
    if (start) {
      state.pointerKept = kept;
      state.pointerFollows = following;
    }
    // Each kept press of a click chain re-arms the window, so a triple click
    // or a run of clicks stays away from LingQ to its last press.
    if (following) state.movingClick = { ...state.movingClick, time: Date.now() };
    // The press ends with its pointerup. Its mouseup, click, and a double
    // click's dblclick come in the same task, so they still count as the press.
    if (state.pointerKept && event.type === "pointerup" && event.isTrusted) {
      setTimeout(() => {
        state.pointerKept = false;
      }, 0);
    }
    if (!kept) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "click" && hidden && !state.pointerFollows) requestReveal(context);
  }

  // LingQ's word keys would land on a hidden word, so they never reach LingQ,
  // and a plain one shows the sentence instead.
  function handleRevealKey(event) {
    const context = state.layout && readerContext();
    const action =
      context &&
      core.keyAction(event, {
        editable: targetKind(event.target).editable,
        popover: Boolean(event.target?.closest?.(".lspc-popover")),
        hidden: !sentenceShown(context),
        guarded: Date.now() < state.revealGuard,
        kept: state.keysKept.has(event.code),
      });
    if (event.type === "keyup") state.keysKept.delete(event.code);
    else if (action) state.keysKept.add(event.code);
    if (!action) return;
    if (action !== "keep") event.preventDefault();
    event.stopImmediatePropagation();
    if (action === "reveal") requestReveal(context);
  }

  const selectionWatch = new MutationObserver(() => {
    const context = readerContext();
    const hold = state.wait;
    if (hold?.kind !== "hold" || selectionOpen(context)) return;
    const action = core.waitRelease(
      hold,
      position(context),
      state.settings.playbackMode,
      hasNextSentence(context),
    );
    cancelWait();
    // A hold that began when its Boundary Delay ran out has already waited.
    if (action && hold.delayed) runBoundaryAction(action);
    else if (action) react(context, reactionAt(context, false));
  });

  function hold(context, delayed) {
    state.wait = { kind: "hold", at: position(context), delayed };
    selectionWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
      childList: true,
      subtree: true,
    });
  }

  function cancelWait() {
    const delay = state.wait?.kind === "delay" ? state.wait : null;
    state.wait = null;
    selectionWatch.disconnect();
    if (!delay) return;
    clearTimeout(delay.timer);
    render();
  }

  function startDelay(wait) {
    cancelWait();
    if (!wait) return;
    state.wait = { ...wait, timer: null };
    tickDelay();
  }

  function tickDelay() {
    const wait = state.wait;
    if (wait?.kind !== "delay") return;
    const left = wait.until - Date.now();
    if (left > 0) {
      render();
      wait.timer = setTimeout(tickDelay, left % 1000 || 1000);
      return;
    }
    const context = readerContext();
    const end = core.delayEnd(wait, position(context), selectionOpen(context));
    cancelWait();
    if (end === "hold") hold(context, true);
    else if (end !== "drop") runBoundaryAction(end);
  }

  // A settings change during a Boundary Delay decides the wait again.
  function redecideDelay() {
    if (state.wait?.kind !== "delay") return;
    const context = readerContext();
    startDelay(core.changedDelay(state.wait, reactionAt(context, false)));
  }

  function reactionAt(context, selection) {
    return core.boundaryReaction(
      state.settings,
      hasNextSentence(context),
      selection,
      sentenceText(context),
      !sentenceShown(context),
    );
  }

  // Runs the Playback Mode's reaction at the Sentence Boundary: a Vocabulary
  // Hold while a selection is open, Listen First's pause to read what it
  // revealed, or the action after any Boundary Delay.
  function react(context, reaction) {
    if (reaction.action === "hold") {
      hold(context, false);
      runBoundaryAction("hold");
    } else if (reaction.action === "reveal") {
      state.wait = { kind: "reveal", at: position(context) };
      runBoundaryAction("stay");
    } else if (!reaction.wait) {
      runBoundaryAction(reaction.action);
    } else {
      runBoundaryAction("stay");
      startDelay(core.boundaryDelayWait(position(context), reaction, Date.now()));
    }
  }

  function runBoundaryAction(action) {
    if (action === "next") navigate("next", true);
    else if (action === "repeat") replayNow();
    else {
      state.synchronizing = "pause";
      postBridgeCommand(core.bridgeCommand("pause", state.generation));
    }
  }

  function handleSentenceBoundary() {
    state.boundaryArmed = false;
    state.ignoreResetUntil = Date.now() + 1000;
    const context = readerContext();
    const reaction = reactionAt(context, selectionOpen(context));
    if (context) revealOf(context).listened = true;
    renderVisibility();
    react(context, reaction);
  }

  function sendPlayback(command) {
    if (command === "load") replayNow();
    else {
      if (command === "play") expectPlay();
      postBridgeCommand(core.bridgeCommand(command, state.generation));
    }
  }

  function togglePlayback() {
    if (!state.ready || !state.segment) return;
    // Play during a wait acts at once. In Continue it moves on rather than
    // replay the sentence.
    const context = readerContext();
    const release = core.waitRelease(
      state.wait,
      position(context),
      state.settings.playbackMode,
      hasNextSentence(context),
    );
    cancelWait();
    if (release === "next" && navigationOwner("next")) {
      navigate("next", true);
      return;
    }
    if (release === "repeat") {
      replayNow();
      return;
    }
    const command = core.explicitPlayback(
      state.playbackQueue.at(-1)?.expectedState ?? state.playerState,
      state.playerTime,
      state.segment,
    );
    state.playbackQueue.push({
      command,
      expectedState:
        command === "pause" ? core.PLAYER_STATES.PAUSED : core.PLAYER_STATES.PLAYING,
    });
    if (state.playbackQueue.length === 1) sendPlayback(command);
  }

  function targetKind(target) {
    const editable = Boolean(
      target?.isContentEditable || target?.closest?.("input, textarea, select, [contenteditable]"),
    );
    const interactiveTarget = target?.closest?.(
      "a, button, input, select, textarea, summary, audio[controls], video[controls], " +
        "[href], [tabindex], [role='button'], [role='link'], [role='checkbox'], " +
        "[role='radio'], [role='switch'], [role='slider'], [role='spinbutton'], " +
        "[role='textbox'], [role='combobox'], [role='listbox'], [role='menuitem'], " +
        "[role='option'], [role='tab']",
    );
    const interactive = Boolean(interactiveTarget?.getClientRects().length);
    // The Playback Mode menu and the settings panel handle their own keys.
    const menu = Boolean(target?.closest?.(".lspc-popover"));
    return { editable, interactive, menu };
  }

  function scheduleSync() {
    clearTimeout(state.timer);
    state.timer = setTimeout(() => void sync(), 40);
  }

  function handleBridgeMessage(message) {
    if (message.source !== window || message.origin !== location.origin) return;
    const event = core.parseBridgeEvent(message.data, state.generation);
    if (!event) return;

    if (event.type === "ready") {
      state.ready = true;
      state.recoveryAttemptedLessonKey = null;
      setStatus("ready");
      cuePending();
      // A reloaded player starts at 1x, so the page session's rate goes back.
      if (state.rate !== 1) setRate(state.rate);
      return;
    }

    if (event.type === "rate") {
      state.rate = event.detail.rate;
      renderPlayback();
      return;
    }

    // The duration clamps a Timing Offset at the video's end.
    if (event.type === "duration") {
      state.duration = event.detail.duration;
      scheduleSync();
      return;
    }

    if (event.type === "blocked") {
      // The browser refused to play, so the player never left its last state,
      // though the bridge may already have reported PLAYING for a resume. Space
      // should play, and the status should ask for Play (#7 story 40).
      state.autoplayBlocked = true;
      state.playPendingUntil = 0;
      state.playerState = core.PLAYER_STATES.PAUSED;
      state.playbackQueue = [];
      state.boundaryArmed = false;
      setStatus("paused");
      return;
    }

    if (event.type === "state") {
      state.playerTime = event.detail.currentTime;
      if (event.detail.state === core.PLAYER_STATES.PLAYING) {
        state.autoplayBlocked = false;
        state.playPendingUntil = 0;
        cancelWait();
      }
      const pendingPlayback = state.playbackQueue[0];
      if (!pendingPlayback || pendingPlayback.expectedState === event.detail.state) {
        state.playerState = event.detail.state;
        renderPlayback();
      }
      if (pendingPlayback?.expectedState === event.detail.state) {
        state.playbackQueue.shift();
        if (state.playbackQueue[0]) sendPlayback(state.playbackQueue[0].command);
      }
      const status = core.playbackStatus(
        state.autoplayBlocked,
        state.synchronizing,
        event.detail.state,
        state.ready,
      );
      if (status) setStatus(status);
      // A play that settled paused is no longer on its way.
      if (status === "paused") state.playPendingUntil = 0;
      if (state.ignoreResetUntil) {
        if (
          Date.now() <= state.ignoreResetUntil &&
          event.detail.state === core.PLAYER_STATES.PAUSED &&
          event.detail.currentTime < 0.25
        ) {
          state.ignoreResetUntil = 0;
          return;
        }
        if (Date.now() > state.ignoreResetUntil) state.ignoreResetUntil = 0;
      }
      if (
        state.synchronizing &&
        state.segment &&
        event.detail.state === core.PLAYER_STATES.PLAYING &&
        event.detail.currentTime >= state.segment.start - 0.25 &&
        event.detail.currentTime < state.segment.end
      ) {
        state.synchronizing = false;
      }
      if (state.synchronizing) state.boundaryArmed = false;
      const boundary = core.boundaryEvent(
        state.boundaryArmed,
        event.detail.state,
        !state.synchronizing &&
          event.detail.state === core.PLAYER_STATES.PLAYING &&
          state.segment &&
          event.detail.currentTime >= state.segment.start - 0.25 &&
          event.detail.currentTime < state.segment.end,
      );
      state.boundaryArmed = boundary.armed;
      if (boundary.reached) {
        handleSentenceBoundary();
        return;
      }

      const context = readerContext();
      const target = core.seekTarget(
        state.sentences,
        Number(context?.sentence.id.slice(1)),
        event.detail.currentTime,
        [core.PLAYER_STATES.PLAYING, core.PLAYER_STATES.PAUSED].includes(
          event.detail.state,
        ),
        state.synchronizing,
        { shift: state.timing?.offset?.shift ?? 0, segment: state.segment },
      );
      if (target) {
        navigateToSentence(target, event.detail.state === core.PLAYER_STATES.PLAYING);
      }
      return;
    }

    warnOnce(`player bridge failed: ${event.detail.reason}`);
    state.ready = false;
    state.playbackQueue = [];
    if (event.detail.reason === "invalid-video") {
      const footer = state.layout?.footer;
      restoreLayout();
      setStatus("unsupported", footer);
      return;
    }
    setStatus("failed");
    if (
      event.detail.reason === "player-unavailable" &&
      state.layout &&
      state.recoveryAttemptedLessonKey !== state.lessonKey
    ) {
      const close = state.layout.modal.querySelector(".modal-close");
      state.recoveryAttemptedLessonKey = state.lessonKey;
      restoreLayout();
      close?.click();
      setTimeout(
        () => document.querySelector(".svg-icon--videoYT-s")?.closest("button")?.click(),
        500,
      );
      return;
    }
    state.blockedFrame = null;
  }

  window.addEventListener("message", (message) => {
    handleBridgeMessage(message);
    renderVisibility();
  });

  document.addEventListener(
    "click",
    (event) => {
      const direction = navigationDirection(event.target);
      if (direction) armNavigation(direction);
      // The player-unavailable recovery clicks this button itself. Only the
      // user's own click in Sentence View, before a player is bound, asks to watch.
      if (
        event.isTrusted &&
        !state.frame &&
        readerContext() &&
        event.target?.closest?.("button")?.querySelector(".svg-icon--videoYT-s")
      ) {
        state.playRequest = {
          lessonKey: core.readerLesson(location.pathname)?.key,
          until: Date.now() + PLAY_REQUEST_MS,
        };
      }
    },
    true,
  );

  function handleShortcut(event) {
    const action = core.claimShortcut(
      event,
      state.layout && state.ready,
      targetKind(event.target),
    );
    if (!action) return;
    if (action === "consume") return;
    if (action === "toggle") togglePlayback();
    else if (action === "next" || action === "previous") navigate(action);
    else replayNow();
  }

  document.addEventListener("keydown", handleShortcut, true);
  document.addEventListener("keyup", handleShortcut, true);
  for (const type of [
    "pointerdown",
    "mousedown",
    "pointerup",
    "mouseup",
    "click",
    "dblclick",
    "auxclick",
    "contextmenu",
  ]) {
    window.addEventListener(type, handleRevealPress, true);
    window.addEventListener(type, handleNeighborEvent, true);
  }
  window.addEventListener(
    "pointercancel",
    () => {
      state.pointerKept = false;
    },
    true,
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (state.focus && event.key === "Escape") coveredAtPress.set(event, focusCovered());
    },
    true,
  );
  // An Escape's release ends its press wherever it lands. A capture listener
  // here runs before anything, such as a menu button, can stop the keyup.
  window.addEventListener(
    "keyup",
    (event) => {
      if (event.key === "Escape") state.escapeKept = false;
    },
    true,
  );
  // The root's bubble phase comes after LingQ's React handlers and before its
  // document listeners.
  document.documentElement.addEventListener("keydown", handleFocusEscape);
  window.addEventListener("pointerdown", handleFocusPress, true);
  window.addEventListener("resize", () => {
    if (!state.focus) return;
    renderFocus();
    fitNeighbors();
  });
  window.addEventListener("keydown", handleRevealKey, true);
  window.addEventListener("keyup", handleRevealKey, true);
  window.addEventListener("keydown", handleNeighborEvent, true);
  window.addEventListener("keyup", handleNeighborEvent, true);
  window.addEventListener("blur", () => {
    state.escapeKept = false;
    state.keysKept.clear();
    state.pointerKept = false;
  });

  // LingQ's next sentence is hidden before it paints, since observer callbacks
  // run before rendering. A selection's class shows the sentence that holds it.
  new MutationObserver(renderVisibility).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
    subtree: true,
  });
  new MutationObserver(scheduleSync).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  window.addEventListener("popstate", scheduleSync);
  void chrome.storage.local
    .get([core.SETTINGS_KEY, core.LEGACY_MODE_KEY])
    .then((stored) => {
      state.settings = core.storedSettings(stored);
      render();
      renderVisibility();
      if (!Object.hasOwn(stored, core.SETTINGS_KEY)) {
        void chrome.storage.local
          .set({ [core.SETTINGS_KEY]: state.settings })
          .then(() => chrome.storage.local.remove(core.LEGACY_MODE_KEY));
      }
      return sync();
    });
})();
