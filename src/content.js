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
    layout: null,
    navigation: null,
    mode: "pause",
    modeControl: null,
    pendingCue: null,
    playerState: core.PLAYER_STATES.UNSTARTED,
    playerTime: 0,
    ready: false,
    revision: 0,
    segment: null,
    sentences: null,
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

    return reader && lesson && sentence && portal
      ? { reader, lesson, sentence, portal }
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
    state.frame = null;
    state.ready = false;
    state.pendingCue = null;
    state.playerState = core.PLAYER_STATES.UNSTARTED;
    state.playerTime = 0;
    state.segment = null;
    state.cueKey = null;
    state.navigation = null;
    state.boundaryArmed = false;
    state.modeControl?.remove();
    state.modeControl = null;
  }

  function renderMode() {
    for (const button of state.modeControl?.querySelectorAll("button") || []) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode));
    }
  }

  function mountModeControl() {
    const footer = state.layout?.reader.querySelector(".main-footer .lesson-bottom");
    if (!footer) return;
    if (state.modeControl?.parentNode === footer) return;

    state.modeControl?.remove();
    const control = document.createElement("div");
    control.className = "lspc-modes";
    control.setAttribute("role", "group");
    control.setAttribute("aria-label", "Playback Mode");
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
    footer.append(control);
    state.modeControl = control;
    renderMode();
  }

  function mount({ reader, portal, modal }) {
    if (state.layout?.modal === modal && modal.parentNode === portal) return;
    restoreLayout();
    state.layout = {
      modal,
      portal,
      reader,
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
    postBridgeCommand(
      core.bridgeCommand(
        state.pendingCue.play ? "load" : "cue",
        state.generation,
        state.pendingCue.segment,
      ),
    );
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
      restoreLayout();
      return;
    }

    mount(player);
    state.segment = { start: segment.start, end: segment.end };
    const key = `${context.lesson.key}:${segment.sentenceNumber}:${segment.start}:${segment.end}`;
    const play = state.navigation?.target === context.sentence.id;
    if (state.navigation && context.sentence.id !== state.navigation.from) {
      state.navigation = null;
    }
    state.pendingCue = { key, play, segment: state.segment };

    if (state.frame !== player.frame) {
      state.frame = player.frame;
      state.ready = false;
      state.cueKey = null;
      state.generation += 1;
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

    state.navigation = { from: context.sentence.id, target: `s${target}` };
    return true;
  }

  function navigate(direction) {
    const owner = navigationOwner(direction);
    if (owner && armNavigation(direction)) owner.click();
  }

  function replayNow() {
    if (!state.ready || !state.segment) return;
    state.boundaryArmed = false;
    postBridgeCommand(core.bridgeCommand("load", state.generation, state.segment));
  }

  function handleSentenceBoundary() {
    state.boundaryArmed = false;
    const context = readerContext();
    const current = Number(context?.sentence.id.slice(1));
    const hasNext = Boolean(
      core.adjacentSentence(current, state.sentences?.length, "next"),
    );
    const action = core.boundaryAction(state.mode, hasNext);
    if (action === "next") navigate("next");
    else if (action === "repeat") replayNow();
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
      cuePending();
      return;
    }

    if (event.type === "state") {
      state.playerState = event.detail.state;
      state.playerTime = event.detail.currentTime;
      const boundary = core.boundaryEvent(
        state.boundaryArmed,
        event.detail.state,
        event.detail.state === core.PLAYER_STATES.PLAYING &&
          state.segment &&
        event.detail.currentTime >= state.segment.start &&
          event.detail.currentTime < state.segment.end,
      );
      state.boundaryArmed = boundary.armed;
      if (boundary.reached) handleSentenceBoundary();
      return;
    }

    state.blockedFrame = state.frame;
    warnOnce(`player bridge failed: ${event.detail.reason}`);
    restoreLayout();
  });

  document.addEventListener(
    "click",
    (event) => {
      const direction = navigationDirection(event.target);
      if (direction) armNavigation(direction);
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
    if (action === "toggle") togglePlayback();
    else if (action === "next") navigate("next");
    else replayNow();
  });

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
