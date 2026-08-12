(function exposeLingqPlaybackCore(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.LingqPlaybackCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createCore() {
  "use strict";

  const MODES = Object.freeze({
    PAUSE: "pause",
    CONTINUE: "continue",
    REPEAT: "repeat",
  });

  const PLAYER_STATES = Object.freeze({
    UNSTARTED: -1,
    ENDED: 0,
    PLAYING: 1,
    PAUSED: 2,
    BUFFERING: 3,
    CUED: 5,
  });

  const SHORTCUTS = Object.freeze({
    " ": "toggle-play",
    Spacebar: "toggle-play",
    n: "next",
    r: "replay",
    c: "toggle-continue",
    a: "continue",
  });

  function normalizeMode(value) {
    return Object.values(MODES).includes(value) ? value : MODES.PAUSE;
  }

  function toggleContinueMode(mode) {
    return normalizeMode(mode) === MODES.CONTINUE
      ? MODES.PAUSE
      : MODES.CONTINUE;
  }

  function reactionForEnded(mode) {
    switch (normalizeMode(mode)) {
      case MODES.CONTINUE:
        return "advance-and-play";
      case MODES.REPEAT:
        return "replay";
      default:
        return "pause";
    }
  }

  function shouldReactToEnded(previousState, nextState, sawPlaying) {
    return (
      sawPlaying === true &&
      nextState === PLAYER_STATES.ENDED &&
      previousState !== PLAYER_STATES.ENDED
    );
  }

  function parseYouTubeMessage(data) {
    let payload = data;

    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        return null;
      }
    }

    if (!payload || typeof payload !== "object") {
      return null;
    }

    if (payload.event === "onStateChange" && Number.isFinite(payload.info)) {
      return {
        kind: "state",
        state: payload.info,
        id: payload.id,
      };
    }

    if (payload.event !== "infoDelivery" || !payload.info) {
      return null;
    }

    const state = Number.isFinite(payload.info.playerState)
      ? payload.info.playerState
      : undefined;
    const currentTime = Number.isFinite(payload.info.currentTime)
      ? payload.info.currentTime
      : undefined;

    if (state === undefined && currentTime === undefined) {
      return null;
    }

    return {
      kind: "info",
      state,
      currentTime,
      duration: Number.isFinite(payload.info.duration)
        ? payload.info.duration
        : undefined,
      id: payload.id,
    };
  }

  function isYouTubeOrigin(origin) {
    try {
      const hostname = new URL(origin).hostname;
      return (
        hostname === "youtube.com" ||
        hostname.endsWith(".youtube.com") ||
        hostname === "youtube-nocookie.com" ||
        hostname.endsWith(".youtube-nocookie.com")
      );
    } catch {
      return false;
    }
  }

  function isEditableTarget(target) {
    if (!target || typeof target !== "object") {
      return false;
    }

    const tagName = String(target.tagName || "").toLowerCase();
    return (
      target.isContentEditable === true ||
      ["input", "textarea", "select", "button"].includes(tagName) ||
      (typeof target.closest === "function" &&
        Boolean(target.closest('[contenteditable="true"], input, textarea, select, button')))
    );
  }

  function shortcutAction(event) {
    if (
      !event ||
      event.defaultPrevented ||
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      isEditableTarget(event.target)
    ) {
      return null;
    }

    const key = event.key === " " ? " " : String(event.key || "").toLowerCase();
    return SHORTCUTS[key] || null;
  }

  function sentenceKey(root) {
    if (!root || typeof root.querySelector !== "function") {
      return null;
    }

    const sentence = root.querySelector(".sentence");
    const article = root.querySelector(".sentence-text");
    if (!sentence && !article) {
      return null;
    }

    const pageClass = String(article?.className || "")
      .split(/\s+/)
      .find((name) => /^is-page-\d+$/.test(name));
    const text = String(sentence?.textContent || "").trim().replace(/\s+/g, " ");

    return sentence?.id || pageClass || text || null;
  }

  return Object.freeze({
    MODES,
    PLAYER_STATES,
    isEditableTarget,
    isYouTubeOrigin,
    normalizeMode,
    parseYouTubeMessage,
    reactionForEnded,
    sentenceKey,
    shouldReactToEnded,
    shortcutAction,
    toggleContinueMode,
  });
});
