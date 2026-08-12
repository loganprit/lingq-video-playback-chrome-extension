(() => {
  "use strict";

  const core = globalThis.LingqPlaybackCore;
  if (!core || window !== window.top) return;

  const state = {
    blockedFrame: null,
    cache: null,
    cueKey: null,
    frame: null,
    generation: 0,
    layout: null,
    pendingCue: null,
    ready: false,
    revision: 0,
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
      try {
        const url = new URL(frame.src, location.href);
        const youtube = ["www.youtube.com", "youtube.com", "www.youtube-nocookie.com"];
        if (
          youtube.includes(url.hostname) &&
          /^\/embed\/[^/]+$/.test(url.pathname) &&
          url.searchParams.get("enablejsapi") === "1" &&
          url.searchParams.get("origin") === location.origin
        ) {
          return frame;
        }
      } catch {
        // An incomplete iframe URL is not eligible.
      }
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
    state.cueKey = null;
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
  }

  async function sentencesFor(lesson) {
    if (state.cache?.key !== lesson.key) {
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

  function post(command) {
    if (command) window.postMessage(command, location.origin);
  }

  function cuePending() {
    if (!state.ready || !state.pendingCue || state.pendingCue.key === state.cueKey) return;
    post(core.bridgeCommand("cue", state.generation, state.pendingCue.segment));
    state.cueKey = state.pendingCue.key;
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
    const key = `${context.lesson.key}:${segment.sentenceNumber}:${segment.start}:${segment.end}`;
    state.pendingCue = { key, segment };

    if (state.frame !== player.frame) {
      state.frame = player.frame;
      state.ready = false;
      state.cueKey = null;
      state.generation += 1;
      post(core.bridgeCommand("bind", state.generation));
    }
    cuePending();
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

    state.blockedFrame = state.frame;
    warnOnce(`player bridge failed: ${event.detail.reason}`);
    restoreLayout();
  });

  new MutationObserver(scheduleSync).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  window.addEventListener("popstate", scheduleSync);
  void sync();
})();
