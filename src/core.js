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

  function initialCue(sentences, sentenceId, playerAvailable) {
    return playerAvailable ? activeSegment(sentences, sentenceId) : null;
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
    if (!validGeneration(generation) || !["bind", "cue"].includes(type)) {
      return null;
    }
    if (type === "cue" && !validSegment(segment)) return null;

    return {
      source: SOURCE,
      version: VERSION,
      direction: "to-player",
      type,
      generation,
      ...(type === "cue"
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
    if (!validGeneration(generation) || !["ready", "error"].includes(type)) {
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

    return {
      source: SOURCE,
      version: VERSION,
      direction: "from-player",
      type,
      generation,
      ...(type === "error" ? { detail: { reason: detail.reason } } : {}),
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
    activeSegment,
    bridgeCommand,
    bridgeEvent,
    initialCue,
    parseBridgeCommand,
    parseBridgeEvent,
    readerLesson,
    sentenceResponse,
  });
});
