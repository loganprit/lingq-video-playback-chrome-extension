(function exposeLingqPlaybackCore(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.LingqPlaybackCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createCore() {
  "use strict";

  const SOURCE = "lingq-sentence-playback-companion";
  const VERSION = 1;
  const PLAYER_STATES = Object.freeze({
    UNSTARTED: -1,
    ENDED: 0,
    PLAYING: 1,
    PAUSED: 2,
    BUFFERING: 3,
    CUED: 5,
  });

  function readerLesson(pathname) {
    const match = String(pathname || "").match(
      /^\/[^/]+\/learn\/([^/]+)\/web\/reader\/(\d+)(?:\/|$)/,
    );
    if (!match) return null;

    const [, language, lessonId] = match;
    return {
      key: `${language}:${lessonId}`,
      endpoint: `/api/v3/${encodeURIComponent(language)}/lessons/${lessonId}/sentences/`,
    };
  }

  function activeSegment(sentences, sentenceId) {
    const match = String(sentenceId || "").match(/^s([1-9]\d*)$/);
    if (!Array.isArray(sentences) || !match) return null;

    const sentenceNumber = Number(match[1]);
    const timestamp = sentences[sentenceNumber - 1]?.timestamp;
    if (
      !Array.isArray(timestamp) ||
      timestamp.length !== 2 ||
      !Number.isFinite(timestamp[0]) ||
      !Number.isFinite(timestamp[1]) ||
      timestamp[0] < 0 ||
      timestamp[1] <= timestamp[0]
    ) {
      return null;
    }

    return { sentenceNumber, start: timestamp[0], end: timestamp[1] };
  }

  function sentenceResponse(value) {
    return Array.isArray(value) ? value : null;
  }

  function youtubeEmbedId(value, baseUrl, origin) {
    try {
      const url = new URL(value, baseUrl);
      const youtube = ["www.youtube.com", "youtube.com", "www.youtube-nocookie.com"];
      const id = url.pathname.match(/^\/embed\/([A-Za-z0-9_-]+)$/)?.[1];
      return youtube.includes(url.hostname) &&
        id &&
        url.searchParams.get("enablejsapi") === "1" &&
        url.searchParams.get("origin") === origin
        ? id
        : null;
    } catch {
      return null;
    }
  }

  function initialCue(sentences, sentenceId, playerAvailable) {
    return playerAvailable ? activeSegment(sentences, sentenceId) : null;
  }

  function adjacentSentence(sentenceNumber, sentenceCount, direction) {
    if (
      !Number.isSafeInteger(sentenceNumber) ||
      !Number.isSafeInteger(sentenceCount) ||
      sentenceNumber < 1 ||
      sentenceCount < 1 ||
      !["previous", "next"].includes(direction)
    ) {
      return null;
    }

    const target = sentenceNumber + (direction === "next" ? 1 : -1);
    return target >= 1 && target <= sentenceCount ? target : null;
  }

  function explicitPlayback(playerState, currentTime, segment) {
    if (playerState === PLAYER_STATES.PLAYING) return "pause";
    if (
      playerState === PLAYER_STATES.ENDED ||
      !validSegment(segment) ||
      !Number.isFinite(currentTime) ||
      currentTime < segment.start ||
      currentTime >= segment.end
    ) {
      return "load";
    }
    return "play";
  }

  function playbackMode(value) {
    return ["pause", "continue", "repeat"].includes(value) ? value : "pause";
  }

  function boundaryAction(mode, hasNext) {
    if (playbackMode(mode) === "repeat") return "repeat";
    return mode === "continue" && hasNext ? "next" : "stay";
  }

  function boundaryEvent(armed, playerState, expectedPlayback = false) {
    if (expectedPlayback) return { armed: true, reached: false };
    if (armed && playerState === PLAYER_STATES.ENDED) {
      return { armed: false, reached: true };
    }
    return { armed, reached: false };
  }

  function shortcutAction(value) {
    if (
      !value ||
      value.modified ||
      value.repeat ||
      value.editable ||
      value.interactive
    ) {
      return null;
    }

    return { Space: "toggle", N: "next", R: "replay" }[value.key] || null;
  }

  function validGeneration(value) {
    return Number.isSafeInteger(value) && value > 0;
  }

  function validSegment(value) {
    return (
      value &&
      typeof value === "object" &&
      Object.keys(value).length === 2 &&
      Number.isFinite(value.start) &&
      Number.isFinite(value.end) &&
      value.start >= 0 &&
      value.end > value.start
    );
  }

  function bridgeCommand(type, generation, segment) {
    if (
      !validGeneration(generation) ||
      !["bind", "cue", "load", "play", "pause"].includes(type)
    ) {
      return null;
    }
    const usesSegment = ["cue", "load"].includes(type);
    if (usesSegment !== Boolean(validSegment(segment))) return null;

    return {
      source: SOURCE,
      version: VERSION,
      direction: "to-player",
      type,
      generation,
      ...(usesSegment
        ? { segment: { start: segment.start, end: segment.end } }
        : {}),
    };
  }

  function parseBridgeCommand(value) {
    if (!value || typeof value !== "object") return null;

    const command = bridgeCommand(value.type, value.generation, value.segment);
    return command &&
      value.source === SOURCE &&
      value.version === VERSION &&
      value.direction === "to-player" &&
      Object.keys(value).length === Object.keys(command).length
      ? command
      : null;
  }

  function bridgeEvent(type, generation, detail) {
    const reasons = [
      "player-unavailable",
      "youtube-api-timeout",
      "invalid-video",
      "player-error",
    ];
    if (
      !validGeneration(generation) ||
      !["ready", "state", "error"].includes(type)
    ) {
      return null;
    }
    if (
      type === "error" &&
      (!detail ||
        typeof detail !== "object" ||
        Object.keys(detail).length !== 1 ||
        !reasons.includes(detail.reason))
    ) {
      return null;
    }
    if (
      type === "state" &&
      (!detail ||
        typeof detail !== "object" ||
        Object.keys(detail).length !== 2 ||
        !Object.values(PLAYER_STATES).includes(detail.state) ||
        !Number.isFinite(detail.currentTime) ||
        detail.currentTime < 0)
    ) {
      return null;
    }

    return {
      source: SOURCE,
      version: VERSION,
      direction: "from-player",
      type,
      generation,
      ...(type === "error"
        ? { detail: { reason: detail.reason } }
        : type === "state"
          ? { detail: { state: detail.state, currentTime: detail.currentTime } }
          : {}),
    };
  }

  function parseBridgeEvent(value, expectedGeneration) {
    if (!value || typeof value !== "object") return null;

    const event = bridgeEvent(value.type, value.generation, value.detail);
    return event &&
      value.source === SOURCE &&
      value.version === VERSION &&
      value.direction === "from-player" &&
      value.generation === expectedGeneration &&
      Object.keys(value).length === Object.keys(event).length
      ? event
      : null;
  }

  return Object.freeze({
    PLAYER_STATES,
    activeSegment,
    adjacentSentence,
    bridgeCommand,
    bridgeEvent,
    boundaryAction,
    boundaryEvent,
    explicitPlayback,
    initialCue,
    parseBridgeCommand,
    parseBridgeEvent,
    playbackMode,
    readerLesson,
    sentenceResponse,
    shortcutAction,
    youtubeEmbedId,
  });
});
