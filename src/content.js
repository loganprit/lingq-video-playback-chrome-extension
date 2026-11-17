(() => {
  "use strict";

  const core = globalThis.LingqPlaybackCore;
  if (!core || window !== window.top) return;

  const STORAGE_KEY = "playbackMode";
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
    // null, or the Vocabulary Hold: { sentence } waiting for its selection to end.
    hold: null,
    ignoreResetUntil: 0,
    layout: null,
    lessonKey: null,
    navigation: null,
    mode: "pause",
    modeControl: null,
    pendingCue: null,
    playbackQueue: [],
    playerState: core.PLAYER_STATES.UNSTARTED,
    playerTime: 0,
    playRequest: null,
    ready: false,
    recoveryAttemptedLessonKey: null,
    revision: 0,
    segment: null,
    sentences: null,
    statusControl: null,
    statusKind: null,
    // false, or the state ("play" or "pause") a sent command is settling into.
    synchronizing: false,
    timer: null,
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
      layout.reader.classList.remove("lspc-reader");
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
    cancelHold();
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
  };
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

  function renderMode() {
    const control = state.modeControl;
    if (!control) return;
    const current = MODES.find(({ mode }) => mode === state.mode);
    const button = control.querySelector(".lspc-mode-button");
    button.setAttribute("aria-label", `Playback Mode: ${current.label}`);
    button.dataset.tip = current.label;
    for (const node of control.querySelectorAll("[data-mode]")) {
      const selected = node.dataset.mode === state.mode;
      if (node.getAttribute("role") === "menuitemradio") {
        node.setAttribute("aria-checked", String(selected));
      } else {
        node.classList.toggle("lspc-current", selected);
      }
    }
  }

  // A focused control keeps the letter shortcuts for itself, so a mouse click
  // gives focus back to the page. Keyboard activation (detail 0) keeps it.
  function releasePointerFocus(event) {
    if (event.detail > 0) document.activeElement?.blur();
  }

  function menuItems() {
    return [...(state.modeControl?.querySelectorAll("[role='menuitemradio']") || [])];
  }

  function setMenuOpen(open) {
    const control = state.modeControl;
    if (!control) return;
    control.querySelector(".lspc-popover").hidden = !open;
    control.querySelector(".lspc-mode-button").setAttribute("aria-expanded", String(open));
    if (open) menuItems().find((item) => item.dataset.mode === state.mode)?.focus();
  }

  function closeMenu(focusButton) {
    setMenuOpen(false);
    if (focusButton) state.modeControl?.querySelector(".lspc-mode-button").focus();
  }

  function chooseMode(mode) {
    state.mode = mode;
    renderMode();
    void chrome.storage.local.set({ [STORAGE_KEY]: mode });
  }

  function handleMenuKey(event) {
    const items = menuItems();
    const index = items.indexOf(event.target);
    const action = index < 0 ? null : core.menuKey(event, index, items.length);
    if (!action || action.type === "leave") {
      if (action && event.type === "keydown") closeMenu(true);
      return;
    }
    // Every other menu key stays in the menu, so LingQ never sees it.
    event.preventDefault();
    event.stopPropagation();
    if (event.type !== "keydown") return;
    if (action.type === "focus") items[action.index].focus();
    else if (action.type === "close") closeMenu(true);
    else if (action.type === "choose") {
      chooseMode(items[action.index].dataset.mode);
      closeMenu(true);
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
        chooseMode(mode);
        closeMenu(event.detail === 0);
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
    modeButton.setAttribute("aria-expanded", "false");
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
    modeButton.append(glyphs, labels);
    modeButton.addEventListener("click", (event) => {
      const open = modeButton.getAttribute("aria-expanded") !== "true";
      setMenuOpen(open);
      if (!open) releasePointerFocus(event);
    });
    // LingQ never sees Escape or Space here. Escape would close its video, and
    // Space would play its lesson audio.
    const handleButtonKey = (event) => {
      const action = core.menuButtonKey(event);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (action === "open") setMenuOpen(true);
    };
    modeButton.addEventListener("keydown", handleButtonKey);
    modeButton.addEventListener("keyup", handleButtonKey);

    const picker = element("div", "lspc-mode-picker");
    picker.append(modeButton, modeMenu());
    picker.addEventListener("focusout", (event) => {
      if (!picker.contains(event.relatedTarget)) setMenuOpen(false);
    });
    control.append(replay, element("span", "lspc-divider"), picker);
    footer.append(control);
    state.modeControl = control;
    renderMode();
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
      state.layout.reader.classList.remove("lspc-reader");
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
    cancelHold();
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

    cancelHold();
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
    cancelHold();
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

  const selectionWatch = new MutationObserver(() => {
    const context = readerContext();
    if (!state.hold || selectionOpen(context)) return;
    const action = core.holdRelease(
      state.hold,
      context?.sentence.id,
      state.mode,
      hasNextSentence(context),
    );
    cancelHold();
    if (action) runBoundaryAction(action);
  });

  function cancelHold() {
    state.hold = null;
    selectionWatch.disconnect();
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
    const action = core.boundaryAction(
      state.mode,
      hasNextSentence(context),
      selectionOpen(context),
    );
    if (action === "hold") {
      state.hold = { sentence: context.sentence.id };
      selectionWatch.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
        childList: true,
        subtree: true,
      });
    }
    runBoundaryAction(action);
  }

  function sendPlayback(command) {
    if (command === "load") replayNow();
    else postBridgeCommand(core.bridgeCommand(command, state.generation));
  }

  function togglePlayback() {
    if (!state.ready || !state.segment) return;
    cancelHold();
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

  window.addEventListener("message", (message) => {
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
        cancelHold();
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

  new MutationObserver(scheduleSync).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  window.addEventListener("popstate", scheduleSync);
  void chrome.storage.local.get(STORAGE_KEY).then((stored) => {
    state.mode = core.playbackMode(stored[STORAGE_KEY]);
    return sync();
  });
})();
