(() => {
  "use strict";

  const core = globalThis.LingqPlaybackCore;
  if (!core || window !== window.top) return;

  const STORAGE_KEY = "playbackMode";

  const state = {
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
    mode: "pause",
    modeControl: null,
    pendingCue: null,
    playerState: core.PLAYER_STATES.UNSTARTED,
    playerTime: 0,
    ready: false,
    recoveryAttemptedLessonKey: null,
    revision: 0,
    segment: null,
    sentences: null,
    statusControl: null,
    statusKind: null,
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
    const frame = eligibleFrame(modal);

    return modal && frame && frame !== state.blockedFrame
      ? { ...context, modal, frame }
      : null;
  }

  function restoreLayout() {
    const layout = state.layout;
    if (state.frame) {
      postBridgeCommand(core.bridgeCommand("pause", state.generation));
      state.generation += 1;
    }
    if (layout) {
      layout.modal.classList.remove("lspc-player");
      layout.portal.classList.remove("lspc-portal");
      layout.reader.classList.remove("lspc-reader");
      if (layout.parent.isConnected) {
        const sibling = layout.nextSibling;
        layout.parent.insertBefore(
          layout.modal,
          sibling?.parentNode === layout.parent ? sibling : null,
        );
      }
    }

    state.layout = null;
    state.lessonKey = null;
    state.frame = null;
    state.ready = false;
    state.pendingCue = null;
    state.playerState = core.PLAYER_STATES.UNSTARTED;
    state.playerTime = 0;
    state.segment = null;
    state.cueKey = null;
    state.navigation = null;
    state.boundaryArmed = false;
    state.ignoreResetUntil = 0;
    state.synchronizing = false;
    state.modeControl?.remove();
    state.modeControl = null;
    state.statusControl?.remove();
    state.statusControl = null;
    state.statusKind = null;
  }

  function setStatus(kind, footer = state.layout?.footer) {
    const message = core.companionStatus(kind);
    if (!footer || !message) return;
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
    state.statusControl.textContent = message;
    state.statusKind = kind;
  }

  function renderMode() {
    for (const button of state.modeControl?.querySelectorAll("button[data-mode]") || []) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode));
    }
  }

  function mountModeControl() {
    const footer = state.layout?.footer;
    if (!footer) return;
    if (state.modeControl?.parentNode === footer) return;

    state.modeControl?.remove();
    const control = document.createElement("div");
    control.className = "lspc-modes";
    control.setAttribute("role", "group");
    control.setAttribute("aria-label", "Playback Mode at the next Sentence Boundary");
    const label = document.createElement("span");
    label.className = "lspc-mode-label";
    label.textContent = "At next Sentence Boundary";
    control.append(label);
    for (const mode of ["pause", "continue", "repeat"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.mode = mode;
      button.textContent = mode[0].toUpperCase() + mode.slice(1);
      button.addEventListener("click", () => {
        state.mode = mode;
        renderMode();
        void chrome.storage.local.set({ [STORAGE_KEY]: mode });
      });
      control.append(button);
    }
    const help = document.createElement("span");
    help.className = "lspc-shortcuts";
    const helpButton = document.createElement("button");
    helpButton.type = "button";
    helpButton.className = "lspc-shortcuts-button";
    helpButton.setAttribute("aria-label", "Keyboard shortcuts");
    helpButton.setAttribute("aria-describedby", "lspc-shortcuts-tooltip");
    helpButton.textContent = "?";
    const tooltip = document.createElement("span");
    tooltip.id = "lspc-shortcuts-tooltip";
    tooltip.className = "lspc-shortcuts-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.textContent = "Space: Play or pause · N: Next · R: Replay Now";
    help.append(helpButton, tooltip);
    control.append(help);
    footer.append(control);
    state.modeControl = control;
    renderMode();
  }

  function mount({ reader, portal, footer, modal }) {
    const next = { modal, portal, reader, footer };
    const action = core.layoutAction(state.layout, next);
    if (
      action === "retain" &&
      modal.parentNode === portal &&
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
      portal.append(modal);
      if (state.statusKind) setStatus(state.statusKind, footer);
      mountModeControl();
      return;
    }
    restoreLayout();
    state.layout = {
      modal,
      portal,
      reader,
      footer,
      parent: modal.parentNode,
      nextSibling: modal.nextSibling,
    };
    modal.classList.add("lspc-player");
    portal.classList.add("lspc-portal");
    reader.classList.add("lspc-reader");
    portal.append(modal);
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
    if (state.pendingCue.play) state.synchronizing = true;
    postBridgeCommand(
      core.bridgeCommand(
        state.pendingCue.play ? "seek-play" : "seek",
        state.generation,
        state.pendingCue.segment,
      ),
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
    state.synchronizing = true;
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
    state.boundaryArmed = false;
    state.synchronizing = true;
    state.ignoreResetUntil = Date.now() + 1000;
    postBridgeCommand(core.bridgeCommand("seek-play", state.generation, state.segment));
  }

  function handleSentenceBoundary() {
    state.boundaryArmed = false;
    state.ignoreResetUntil = Date.now() + 1000;
    const context = readerContext();
    const current = Number(context?.sentence.id.slice(1));
    const hasNext = Boolean(
      core.adjacentSentence(current, state.sentences?.length, "next"),
    );
    const action = core.boundaryAction(state.mode, hasNext);
    if (action === "next") navigate("next");
    else if (action === "repeat") replayNow();
    else {
      state.synchronizing = true;
      postBridgeCommand(core.bridgeCommand("pause", state.generation));
    }
  }

  function togglePlayback() {
    if (!state.ready || !state.segment) return;
    const command = core.explicitPlayback(
      state.playerState,
      state.playerTime,
      state.segment,
    );
    if (command === "load") replayNow();
    else postBridgeCommand(core.bridgeCommand(command, state.generation));
  }

  function targetKind(target) {
    const editable = Boolean(
      target?.isContentEditable || target?.closest?.("input, textarea, select, [contenteditable]"),
    );
    const interactive = Boolean(
      target?.closest?.(
        "a, button, input, select, textarea, summary, audio[controls], video[controls], " +
          "[href], [tabindex], [role='button'], [role='link'], [role='checkbox'], " +
          "[role='radio'], [role='switch'], [role='slider'], [role='spinbutton'], " +
          "[role='textbox'], [role='combobox'], [role='listbox'], [role='menuitem'], " +
          "[role='option'], [role='tab']",
      ),
    );
    return { editable, interactive };
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

    if (event.type === "state") {
      state.playerState = event.detail.state;
      state.playerTime = event.detail.currentTime;
      if (
        state.synchronizing &&
        [core.PLAYER_STATES.PAUSED, core.PLAYER_STATES.CUED].includes(
          event.detail.state,
        )
      ) {
        setStatus("paused");
      } else if (state.ready) {
        setStatus("ready");
      }
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
      if (state.layout && event.target?.closest?.(".sentence-text .sentence-item")) {
        state.boundaryArmed = false;
        postBridgeCommand(core.bridgeCommand("pause", state.generation));
      }
    },
    true,
  );

  document.addEventListener("keydown", (event) => {
    if (!state.layout || !state.ready) return;
    const action = core.shortcutAction({
      key: event.code === "Space" ? "Space" : event.key.toUpperCase(),
      modified: event.altKey || event.ctrlKey || event.metaKey || event.shiftKey,
      repeat: event.repeat,
      ...targetKind(event.target),
    });
    if (!action) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (action === "toggle") togglePlayback();
    else if (action === "next") navigate("next");
    else replayNow();
  }, true);

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
