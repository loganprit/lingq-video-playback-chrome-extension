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
    cache: null,
    cueKey: null,
    frame: null,
    generation: 0,
    ignoreResetUntil: 0,
    layout: null,
    lessonKey: null,
    navigation: null,
    modeControl: null,
    pendingCue: null,
    playbackQueue: [],
    playerState: core.PLAYER_STATES.UNSTARTED,
    playerTime: 0,
    playRequest: null,
    ready: false,
    recoveryAttemptedLessonKey: null,
    // The active sentence's reveal: { at, listened, requested }. listened: its
    // first play reached the Sentence Boundary. requested: the reader clicked its
    // hidden text or pressed a word key.
    reveal: null,
    // Presses aimed at the sentence until this time never reach LingQ.
    revealGuard: 0,
    // Whether LingQ never saw the current pointer press, and the key whose press
    // it never saw.
    pointerKept: false,
    keyKept: null,
    revision: 0,
    segment: null,
    sentences: null,
    settings: core.companionSettings(),
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
    state.cueKey = null;
    state.navigation = null;
    state.boundaryArmed = false;
    cancelWait();
    state.reveal = null;
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
    check: ["M5 12.5l4.5 4.5L19 7.5"],
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
    const { playbackMode, boundaryDelay, sentenceVisibility } = state.settings;
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
    if (boundaryDelay.kind === "seconds") {
      control.querySelector(".lspc-seconds").value = String(boundaryDelay.seconds);
    }
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
    );
    return panel;
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
      const action = core.menuButtonKey(event);
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

  function footerItem(paths, label) {
    const button = element("button", "lspc-item");
    button.type = "button";
    const text = element("span", "lspc-item-label");
    text.append(element("span", "lspc-label-text", label));
    button.append(icon(paths), text);
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

    control.append(
      replay,
      element("span", "lspc-divider"),
      picker(modeButton, modeMenu()),
      picker(settingsButton, settingsPanel()),
    );
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

  function postBridgeCommand(command) {
    if (command) window.postMessage(command, location.origin);
  }

  function cuePending() {
    if (!state.ready || !state.pendingCue || state.pendingCue.key === state.cueKey) return;
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
    if (type === "seek-play") state.synchronizing = "play";
    postBridgeCommand(
      core.bridgeCommand(type, state.generation, state.pendingCue.segment),
    );
    state.ignoreResetUntil = Date.now() + 1000;
    state.boundaryArmed = false;
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

    const sentences = await sentencesFor(context.lesson);
    if (revision !== state.revision) return;
    state.sentences = sentences;

    const segment = core.initialCue(sentences, context.sentence.id, true);
    if (!segment) {
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
    state.segment = { start: segment.start, end: segment.end };
    const key = `${context.lesson.key}:${segment.sentenceNumber}:${segment.start}:${segment.end}`;
    const play =
      state.navigation?.target === context.sentence.id && state.navigation.play;
    if (state.navigation && context.sentence.id !== state.navigation.from) {
      state.navigation = null;
    }
    state.pendingCue = { key, play, segment: state.segment };

    if (lifecycle === "bind") {
      state.frame = player.frame;
      state.ready = false;
      state.cueKey = null;
      state.autoplayBlocked = false;
      state.generation += 1;
      setStatus("loading");
      postBridgeCommand(core.bridgeCommand("bind", state.generation));
    }
    cuePending();
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
    return true;
  }

  function navigate(direction) {
    const owner = navigationOwner(direction);
    if (owner && armNavigation(direction)) owner.click();
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

    state.boundaryArmed = false;
    state.synchronizing = play ? "play" : "pause";
    state.navigation = {
      from: context.sentence.id,
      target: `s${sentenceNumber}`,
      play,
    };
    const options = {
      bubbles: true,
      buttons: 1,
      clientX: bounds.left + bounds.width * (percentage / 100),
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

  function sentenceShown(context) {
    const { listened, requested } = revealOf(context);
    // A play the companion has sent, or a sentence it is moving to and will
    // play, counts as playing before the video reports it, so Show on Pause
    // never flashes the next sentence's text. A play that settled paused, as
    // the status says, is paused.
    const playPending =
      state.statusKind !== "paused" &&
      (state.synchronizing === "play" || Boolean(state.navigation?.play));
    return core.sentenceShown(state.settings.sentenceVisibility, {
      paused: core.videoPaused(state.playerState, playPending),
      listened,
      requested,
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
    const start = event.type === "pointerdown";
    const hidden = Boolean(context) && !sentenceShown(context);
    const kept = core.pressKept(start, {
      atWords: Boolean(context) && onSentence(context.sentence, event),
      hidden,
      guarded: Date.now() < state.revealGuard,
      kept: state.pointerKept && event.isTrusted,
    });
    if (start) state.pointerKept = kept;
    // The press ends with its click. A double click's dblclick comes in the
    // same task as its second click, so it still counts as that press.
    if (state.pointerKept && ["click", "dblclick"].includes(event.type)) {
      setTimeout(() => {
        state.pointerKept = false;
      }, 0);
    }
    if (!kept) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "click" && hidden) requestReveal(context);
  }

  // LingQ's word keys would land on a hidden word, so they show the sentence
  // instead and never reach LingQ.
  function handleRevealKey(event) {
    const context = state.layout && readerContext();
    const start = event.type === "keydown" && !event.repeat;
    const hidden = Boolean(context) && !sentenceShown(context);
    const kept = core.pressKept(start, {
      atWords:
        Boolean(context) &&
        core.wordKey(event) &&
        !targetKind(event.target).editable &&
        !event.target?.closest?.(".lspc-controls"),
      hidden,
      guarded: Date.now() < state.revealGuard,
      kept: state.keyKept === event.key,
    });
    if (start) state.keyKept = kept ? event.key : null;
    if (event.type === "keyup" && state.keyKept === event.key) state.keyKept = null;
    if (!kept) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (start && hidden) requestReveal(context);
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
    if (action === "next") navigate("next");
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
    else postBridgeCommand(core.bridgeCommand(command, state.generation));
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
      navigate("next");
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
    const menu = Boolean(target?.closest?.(".lspc-menu"));
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
      return;
    }

    if (event.type === "blocked") {
      // The browser refused to play, so the player never left its last state,
      // though the bridge may already have reported PLAYING for a resume. Space
      // should play, and the status should ask for Play (#7 story 40).
      state.autoplayBlocked = true;
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
        cancelWait();
      }
      const pendingPlayback = state.playbackQueue[0];
      if (!pendingPlayback || pendingPlayback.expectedState === event.detail.state) {
        state.playerState = event.detail.state;
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
  }
  window.addEventListener(
    "pointercancel",
    () => {
      state.pointerKept = false;
    },
    true,
  );
  window.addEventListener("keydown", handleRevealKey, true);
  window.addEventListener("keyup", handleRevealKey, true);

  // LingQ's next sentence is hidden before it paints, since observer callbacks
  // run before rendering.
  new MutationObserver(() => {
    renderVisibility();
    scheduleSync();
  }).observe(document.documentElement, {
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
