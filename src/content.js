(() => {
  "use strict";

  const core = globalThis.LingqPlaybackCore;
  if (!core || document.getElementById("lingq-playback-companion")) {
    return;
  }

  const { MODES, PLAYER_STATES } = core;
  const ROOT_ID = "lingq-playback-companion";
  const STORAGE_KEY = "sentencePlaybackMode";
  const MODE_LABELS = Object.freeze({
    [MODES.PAUSE]: "Pause",
    [MODES.CONTINUE]: "Continue",
    [MODES.REPEAT]: "Repeat",
  });

  const state = {
    mode: MODES.PAUSE,
    sentenceKey: null,
    playerState: PLAYER_STATES.UNSTARTED,
    segmentStart: null,
    sawPlaying: false,
    busy: false,
    syncTimer: null,
  };

  function makeToolbar() {
    const root = document.createElement("aside");
    root.id = ROOT_ID;
    root.hidden = true;
    root.setAttribute("aria-label", "LingQ sentence playback controls");
    root.innerHTML = `
      <div class="lspc__header">
        <span class="lspc__mark" aria-hidden="true"></span>
        <strong>Sentence playback</strong>
        <span class="lspc__status" aria-live="polite">Ready</span>
      </div>
      <div class="lspc__modes" role="group" aria-label="Playback mode">
        <button type="button" data-mode="pause" title="Stop after this sentence">Pause</button>
        <button type="button" data-mode="continue" title="Play the next sentence automatically">Continue</button>
        <button type="button" data-mode="repeat" title="Repeat the current sentence">Repeat</button>
      </div>
      <div class="lspc__keys" aria-label="Keyboard shortcuts">
        <kbd>Space</kbd> play/pause <span aria-hidden="true">·</span>
        <kbd>N</kbd> next <span aria-hidden="true">·</span>
        <kbd>R</kbd> replay
      </div>
    `;

    for (const button of root.querySelectorAll("[data-mode]")) {
      button.addEventListener("click", () => setMode(button.dataset.mode));
    }

    document.body.append(root);
    return root;
  }

  const toolbar = makeToolbar();
  const statusElement = toolbar.querySelector(".lspc__status");

  function setStatus(label, action = label.toLowerCase().replace(/\s+/g, "-")) {
    statusElement.textContent = label;
    toolbar.dataset.status = label;
    toolbar.dataset.lastAction = action;
  }

  function renderMode() {
    toolbar.dataset.mode = state.mode;
    for (const button of toolbar.querySelectorAll("[data-mode]")) {
      const selected = button.dataset.mode === state.mode;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
  }

  async function readStoredMode() {
    try {
      if (globalThis.chrome?.storage?.local) {
        const result = await chrome.storage.local.get(STORAGE_KEY);
        return core.normalizeMode(result[STORAGE_KEY]);
      }
    } catch (error) {
      console.warn("LingQ Playback Companion could not read extension storage", error);
    }

    return core.normalizeMode(localStorage.getItem(`lspc:${STORAGE_KEY}`));
  }

  async function persistMode(mode) {
    try {
      if (globalThis.chrome?.storage?.local) {
        await chrome.storage.local.set({ [STORAGE_KEY]: mode });
        return;
      }
    } catch (error) {
      console.warn("LingQ Playback Companion could not write extension storage", error);
    }

    localStorage.setItem(`lspc:${STORAGE_KEY}`, mode);
  }

  function setMode(mode, { persist = true } = {}) {
    state.mode = core.normalizeMode(mode);
    renderMode();
    setStatus(`${MODE_LABELS[state.mode]} mode`, `mode-${state.mode}`);
    if (persist) {
      void persistMode(state.mode);
    }
  }

  function findSentenceIframe() {
    const containers = [
      ".sent-video-player",
      ".sentence--video-player",
      "#sentence-video-player-portal",
    ];
    const hosts = ["youtube.com/embed/", "youtube-nocookie.com/embed/"];

    for (const container of containers) {
      for (const host of hosts) {
        const iframe = document.querySelector(`${container} iframe[src*='${host}']`);
        if (iframe) {
          return iframe;
        }
      }
    }

    return null;
  }

  function findPlayButton() {
    return document.querySelector(
      ".sentence-text .sentence-audio-controls .play-button, .sentence-text .play-button",
    );
  }

  function findPauseButton() {
    return document.querySelector(
      ".sentence-text .sentence-audio-controls .pause-button, .sentence-text .pause-button",
    );
  }

  function findPlaybackControl() {
    return findPauseButton() || findPlayButton();
  }

  function findVideoModeButton() {
    return document
      .querySelector(".svg-icon--videoYT-s")
      ?.closest("button, a, [role='button']");
  }

  function findNextControl() {
    const marker = document.querySelector(".next-page-button");
    return marker?.closest("a, button, [role='button']") || marker;
  }

  function isAvailable() {
    return Boolean(
      document.querySelector("#lesson-reader.is-sentence-mode") &&
        document.querySelector(".sentence") &&
        (findSentenceIframe() || findVideoModeButton()),
    );
  }

  function resetForSentence(key) {
    state.sentenceKey = key;
    state.playerState = PLAYER_STATES.UNSTARTED;
    state.segmentStart = null;
    state.sawPlaying = false;
    toolbar.dataset.sentenceKey = key || "";
    toolbar.dataset.playerState = String(state.playerState);
  }

  function syncPageContext() {
    const key = core.sentenceKey(document);
    if (key !== state.sentenceKey) {
      resetForSentence(key);
    }

    toolbar.hidden = !isAvailable();
    toolbar.dataset.available = String(!toolbar.hidden);
  }

  function scheduleSync() {
    clearTimeout(state.syncTimer);
    state.syncTimer = setTimeout(syncPageContext, 30);
  }

  function sendYouTubeCommand(func, args = []) {
    const iframe = findSentenceIframe();
    if (!iframe?.contentWindow) {
      return false;
    }

    let targetOrigin = "*";
    try {
      targetOrigin = new URL(iframe.src).origin;
    } catch {
      // Keep the wildcard fallback for an iframe whose URL is still being set.
    }

    iframe.contentWindow.postMessage(
      JSON.stringify({ event: "command", func, args, id: iframe.id }),
      targetOrigin,
    );
    return true;
  }

  function clickNativePlay() {
    const button = findPlayButton();
    if (!button) {
      setStatus("Play control unavailable", "play-unavailable");
      return false;
    }

    button.click();
    setStatus("Starting…", "play");
    return true;
  }

  async function ensureSentencePlayer() {
    const existing = findSentenceIframe();
    if (existing) {
      return existing;
    }

    const videoButton = findVideoModeButton();
    if (!videoButton) {
      setStatus("Select a YouTube lesson", "video-unavailable");
      return null;
    }

    setStatus("Selecting video…", "select-video");
    videoButton.click();
    const iframe = await waitFor(findSentenceIframe, 3000);
    if (!iframe) {
      setStatus("Video player unavailable", "video-timeout");
    }
    return iframe;
  }

  async function startCurrent() {
    const iframe = await ensureSentencePlayer();
    return iframe ? clickNativePlay() : false;
  }

  async function replayCurrent(source = "manual") {
    if (source === "loop" || state.playerState === PLAYER_STATES.ENDED) {
      const clicked = await startCurrent();
      if (clicked) {
        setStatus(source === "loop" ? "Repeating…" : "Replaying…", `replay-${source}`);
      }
      return clicked;
    }

    const pauseButton = findPauseButton();
    if (pauseButton) {
      pauseButton.click();
      await waitFor(findPlayButton, 750);
    }

    if (Number.isFinite(state.segmentStart)) {
      sendYouTubeCommand("seekTo", [state.segmentStart, true]);
      await delay(35);
    }

    const clicked = await startCurrent();
    if (clicked) {
      setStatus("Replaying…", `replay-${source}`);
    }
    return clicked;
  }

  function togglePlay() {
    if (!findSentenceIframe()) {
      void startCurrent();
      return;
    }

    if (state.playerState === PLAYER_STATES.ENDED) {
      void replayCurrent("space");
      return;
    }

    const control = findPlaybackControl();
    if (!control) {
      setStatus("Playback control unavailable", "playback-unavailable");
      return;
    }

    control.click();
    setStatus(
      state.playerState === PLAYER_STATES.PLAYING ? "Pausing…" : "Starting…",
      state.playerState === PLAYER_STATES.PLAYING ? "pause-playback" : "resume",
    );
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function waitFor(predicate, timeout = 3000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const value = predicate();
      if (value) {
        return value;
      }
      await delay(50);
    }
    return null;
  }

  async function advance({ play = false, source = "manual" } = {}) {
    if (state.busy) {
      return false;
    }

    const nextControl = findNextControl();
    if (!nextControl) {
      setStatus("End of lesson", "end-of-lesson");
      return false;
    }

    state.busy = true;
    const previousKey = core.sentenceKey(document);
    setStatus("Advancing…", `advance-${source}`);
    nextControl.click();

    try {
      const nextKey = await waitFor(() => {
        const key = core.sentenceKey(document);
        return key && key !== previousKey && findSentenceIframe() ? key : null;
      });

      if (!nextKey) {
        setStatus("Could not find next sentence", "advance-timeout");
        return false;
      }

      resetForSentence(nextKey);
      await delay(80);
      if (play) {
        await startCurrent();
      } else {
        setStatus("Ready", "advanced");
      }
      return true;
    } finally {
      state.busy = false;
      scheduleSync();
    }
  }

  function handleEnded() {
    const reaction = core.reactionForEnded(state.mode);
    state.sawPlaying = false;

    if (reaction === "advance-and-play") {
      void advance({ play: true, source: "automatic" });
      return;
    }

    if (reaction === "replay") {
      setTimeout(() => void replayCurrent("loop"), 80);
      return;
    }

    setStatus("Paused at sentence", "paused-at-boundary");
  }

  function applyPlayerUpdate(update) {
    if (Number.isFinite(update.currentTime)) {
      if (
        state.segmentStart === null &&
        (update.state === PLAYER_STATES.PLAYING ||
          state.playerState === PLAYER_STATES.PLAYING)
      ) {
        state.segmentStart = update.currentTime;
        toolbar.dataset.segmentStart = String(update.currentTime);
      }
    }

    if (!Number.isFinite(update.state)) {
      return;
    }

    const previousState = state.playerState;
    state.playerState = update.state;
    toolbar.dataset.playerState = String(update.state);

    if (update.state === PLAYER_STATES.PLAYING) {
      state.sawPlaying = true;
      setStatus("Playing", "playing");
    } else if (update.state === PLAYER_STATES.PAUSED) {
      setStatus("Paused", "paused");
    } else if (
      core.shouldReactToEnded(previousState, update.state, state.sawPlaying)
    ) {
      handleEnded();
    }
  }

  function handleYouTubeMessage(event) {
    if (!core.isYouTubeOrigin(event.origin)) {
      return;
    }

    const iframe = findSentenceIframe();
    if (!iframe || event.source !== iframe.contentWindow) {
      return;
    }

    const update = core.parseYouTubeMessage(event.data);
    if (update) {
      applyPlayerUpdate(update);
    }
  }

  function handleShortcut(event) {
    if (!isAvailable()) {
      return;
    }

    const action = core.shortcutAction(event);
    if (!action) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    switch (action) {
      case "toggle-play":
        togglePlay();
        break;
      case "next":
        void advance({ play: false, source: "shortcut" });
        break;
      case "replay":
        void replayCurrent("shortcut");
        break;
      case "toggle-continue":
        setMode(core.toggleContinueMode(state.mode));
        break;
      case "continue":
        setMode(MODES.CONTINUE);
        break;
      default:
        break;
    }
  }

  window.addEventListener("message", handleYouTubeMessage);
  document.addEventListener("keydown", handleShortcut, true);

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (globalThis.chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      const changed = changes[STORAGE_KEY];
      if (areaName === "local" && changed) {
        setMode(changed.newValue, { persist: false });
      }
    });
  }

  void readStoredMode().then((mode) => {
    setMode(mode, { persist: false });
    syncPageContext();
  });
})();
