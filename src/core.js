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

  function sentenceAtTime(sentences, time) {
    if (!Array.isArray(sentences) || !sentences.length || !Number.isFinite(time)) {
      return null;
    }

    let previousEnd = 0;
    for (let index = 0; index < sentences.length; index += 1) {
      const timestamp = sentences[index]?.timestamp;
      if (
        !Array.isArray(timestamp) ||
        timestamp.length !== 2 ||
        !Number.isFinite(timestamp[0]) ||
        !Number.isFinite(timestamp[1]) ||
        timestamp[0] < 0 ||
        timestamp[0] < previousEnd ||
        timestamp[1] <= timestamp[0]
      ) {
        return null;
      }
      previousEnd = timestamp[1];
    }
    const index = sentences.findIndex(({ timestamp }) => time < timestamp[1]);
    return index < 0 ? sentences.length : index + 1;
  }

  function seekTarget(sentences, currentSentence, time, settled, synchronizing) {
    if (!settled || synchronizing || !Number.isSafeInteger(currentSentence)) return null;
    const target = sentenceAtTime(sentences, time);
    return target && target !== currentSentence ? target : null;
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

  function cueCommand(cue, request, now) {
    const requested =
      cue.activation &&
      Boolean(request) &&
      request.lessonKey === cue.lessonKey &&
      now <= request.until;
    return cue.play || requested ? "seek-play" : "seek";
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

  function segmentTransition(play, currentTime, segment) {
    return play &&
      validSegment(segment) &&
      Number.isFinite(currentTime) &&
      currentTime >= segment.start - 0.25 &&
      currentTime <= segment.start + 0.25 &&
      currentTime < segment.end
      ? "resume"
      : "seek";
  }

  function playbackMode(value) {
    return ["pause", "continue", "repeat"].includes(value) ? value : "pause";
  }

  const SETTINGS_KEY = "settings";
  // Before the settings record, the Playback Mode was stored on its own.
  const LEGACY_MODE_KEY = "playbackMode";

  function boundaryDelay(value) {
    if (
      value?.kind === "seconds" &&
      Number.isInteger(value.seconds) &&
      value.seconds >= 1 &&
      value.seconds <= 10
    ) {
      return { kind: "seconds", seconds: value.seconds };
    }
    return value?.kind === "reading" ? { kind: "reading" } : { kind: "off" };
  }

  const SENTENCE_VISIBILITIES = ["always", "listen-first", "show-on-pause"];

  function sentenceVisibility(value) {
    return SENTENCE_VISIBILITIES.includes(value) ? value : "always";
  }

  function companionSettings(value) {
    return {
      playbackMode: playbackMode(value?.playbackMode),
      boundaryDelay: boundaryDelay(value?.boundaryDelay),
      sentenceVisibility: sentenceVisibility(value?.sentenceVisibility),
      neighborSentences: value?.neighborSentences !== false,
    };
  }

  function storedSettings(stored) {
    return companionSettings(
      stored?.[SETTINGS_KEY] ?? { playbackMode: stored?.[LEGACY_MODE_KEY] },
    );
  }

  // One second for every 15 characters of the sentence, from 1 to 15 seconds.
  function readingSeconds(text) {
    const length = [...String(text ?? "").trim()].length;
    return Math.min(15, Math.max(1, Math.round(length / 15)));
  }

  // Seconds to wait at a Sentence Boundary before the action runs. Only
  // Continue's next sentence and Repeat's replay wait.
  function boundaryWait(action, delay, text) {
    if (!["next", "repeat"].includes(action)) return 0;
    if (delay.kind === "seconds") return delay.seconds;
    return delay.kind === "reading" ? readingSeconds(text) : 0;
  }

  // The Playback Mode's reaction at a Sentence Boundary, and the seconds the
  // Boundary Delay waits before it. hidden says the sentence's text was hidden
  // when its play reached the boundary. Listen First reveals it there, and with
  // no Boundary Delay to read it in, Continue and Repeat "reveal": they pause
  // until Play, which then moves on or replays.
  function boundaryReaction(settings, hasNext, selectionOpen, text, hidden) {
    const action = boundaryAction(settings.playbackMode, hasNext, selectionOpen);
    const wait = boundaryWait(action, settings.boundaryDelay, text);
    return hidden &&
      !wait &&
      settings.sentenceVisibility === "listen-first" &&
      ["next", "repeat"].includes(action)
      ? { action: "reveal", wait: 0 }
      : { action, wait };
  }

  // Show on Pause counts the video as paused when it isn't playing or
  // buffering and the companion isn't about to play it. A Vocabulary Hold, a
  // Boundary Delay, and Pause at end all stop it. At a Sentence Boundary (ENDED),
  // Continue and Repeat start their play at once, so only a boundary that stays
  // counts.
  function videoPaused(playerState, playPending) {
    return (
      !playPending &&
      ![PLAYER_STATES.PLAYING, PLAYER_STATES.BUFFERING].includes(playerState)
    );
  }

  // Whether the active sentence's text shows. listened: its first play has
  // reached the Sentence Boundary. requested: the reader clicked the hidden text
  // or pressed one of LingQ's word keys. selected: it holds a word or phrase
  // selection, which LingQ can make itself. failed: the video can't play, so
  // nothing would ever show it.
  function sentenceShown(visibility, { paused, listened, requested, selected, failed }) {
    if (requested || selected || failed) return true;
    if (visibility === "listen-first") return listened;
    if (visibility === "show-on-pause") return paused;
    return true;
  }

  // Whether Neighbor Sentences show. Under Listen First they never do: the
  // sentences after this one haven't been heard yet.
  function showsNeighbors(settings) {
    return settings.neighborSentences && settings.sentenceVisibility !== "listen-first";
  }

  // The Neighbor Sentences after the active sentence: up to count of them,
  // fewer near the lesson's end, and none when the active sentence is unknown.
  // Numbers count from 1, like LingQ's sentence ids.
  function neighborSentences(sentences, sentenceNumber, count) {
    if (
      !Array.isArray(sentences) ||
      !Number.isSafeInteger(sentenceNumber) ||
      sentenceNumber < 1 ||
      sentenceNumber > sentences.length
    ) {
      return [];
    }
    return sentences
      .slice(sentenceNumber, sentenceNumber + count)
      .map((sentence, index) => ({
        number: sentenceNumber + 1 + index,
        text: typeof sentence?.text === "string" ? sentence.text.trim() : "",
      }))
      .filter(({ text }) => text);
  }

  // How many Neighbor Sentences fit in the height left under the active
  // sentence: the most leading ones whose heights add up to no more than it.
  function neighborCount(heights, available) {
    let used = 0;
    let count = 0;
    for (const height of heights) {
      used += height;
      if (!(used <= available)) break;
      count += 1;
    }
    return count;
  }

  // What the companion does with an event on a Neighbor Sentence: "play" its
  // sentence, or "keep" the event from LingQ. A press and Enter are all kept,
  // and only a single click or a fresh Enter plays, so a double click moves one
  // sentence. Other keys are left alone (null).
  function neighborAction(event) {
    const key = event.type === "keydown" || event.type === "keyup";
    if (key && event.key !== "Enter") return null;
    const play =
      event.type === "keydown" ? !event.repeat : event.type === "click" && event.detail <= 1;
    return play ? "play" : "keep";
  }

  // Whether a press starts where a click that played a Neighbor Sentence just
  // was: the rest of a double click. That click moved LingQ to the sentence,
  // whose words may now lie under the pointer. A press's pointerdown carries
  // no click count, so time and place decide.
  const NEIGHBOR_FOLLOW_MS = 1000;
  const NEIGHBOR_FOLLOW_PX = 8;

  function followsNeighborClick(press, click) {
    return (
      Boolean(click) &&
      press.time >= click.time &&
      press.time - click.time <= NEIGHBOR_FOLLOW_MS &&
      Math.hypot(press.x - click.x, press.y - click.y) <= NEIGHBOR_FOLLOW_PX
    );
  }

  // The keys of LingQ's Sentence View reader that land on a word: ArrowLeft and
  // ArrowRight step to the next word and b to the next new word, with any
  // modifier but Shift, and Shift+Space opens the selected word's popup. With
  // Auto LingQ creation on, landing on a new word saves it.
  function wordKey(event) {
    if (event.shiftKey) return event.key === " " || event.code === "Space";
    return ["ArrowLeft", "Left", "ArrowRight", "Right", "b"].includes(event.key);
  }

  // Whether a press stays away from LingQ: one aimed at the sentence's words
  // (a pointer press on the sentence, or a word key) while the text is hidden or
  // guarded just after it showed, or one that follows a click on a Neighbor
  // Sentence, wherever it lands. A press's start (pointerdown, or a key's
  // first keydown) decides for all of it, so its release, click, a double
  // click's dblclick, and a held key's repeats stay away too once the text shows.
  function pressKept(start, { atWords, hidden, guarded, kept, following = false }) {
    const now = following || (atWords && (hidden || guarded));
    return start ? now : kept || now;
  }

  // What the companion does with a key while the sentence is hidden or just
  // shown. A word key LingQ would get (not typed into a field, and not in a
  // companion popover, which handles its own keys) is kept from LingQ. A plain
  // key's first press "reveal"s the sentence, and its other events are
  // "consume"d. A key held with Alt, Ctrl, or Meta is only "keep"t from LingQ, so
  // the browser still acts on it, as Alt+Left goes Back. kept: this key's press
  // began kept.
  function keyAction(event, { editable, popover, hidden, guarded, kept }) {
    const start = event.type === "keydown" && !event.repeat;
    const atWords = !editable && !popover && wordKey(event);
    if (!pressKept(start, { atWords, hidden, guarded, kept })) return null;
    if (event.altKey || event.ctrlKey || event.metaKey) return "keep";
    return start && hidden ? "reveal" : "consume";
  }

  // A Boundary Delay at a position (lesson and sentence) that started at a time
  // and runs out at started + wait.
  function boundaryDelayWait(at, reaction, started) {
    return {
      kind: "delay",
      at,
      action: reaction.action,
      started,
      until: started + reaction.wait * 1000,
    };
  }

  // A settings change during a Boundary Delay decides again from the new
  // settings, as if the boundary had been reached when the wait began. A
  // reaction that stays ends the wait. Any other keeps the wait's start with the
  // new action and length, so Off acts at once.
  function changedDelay(wait, reaction) {
    return ["next", "repeat"].includes(reaction.action)
      ? boundaryDelayWait(wait.at, reaction, wait.started)
      : null;
  }

  // What a Boundary Delay does when it runs out. It drops itself once its
  // sentence or lesson is no longer active, and becomes a Vocabulary Hold while
  // a selection is open.
  function delayEnd(wait, at, selectionOpen) {
    if (!at || wait.at !== at) return "drop";
    return selectionOpen ? "hold" : wait.action;
  }

  // Readiness is only announced. The other states ask the reader to wait or act.
  const COMPANION_STATUSES = Object.freeze({
    loading: { message: "Preparing video…", visible: true },
    ready: { message: "Video ready.", visible: false },
    paused: { message: "Playback paused. Press Play in the video to continue.", visible: true },
    failed: { message: "Video unavailable. Reload this page to retry.", visible: true },
    unsupported: { message: "This video isn’t supported in Sentence View.", visible: true },
  });

  function companionStatus(value) {
    return Object.hasOwn(COMPANION_STATUSES, value) ? COMPANION_STATUSES[value] : null;
  }

  // Only a play that settled paused asks the reader to press Play. The
  // companion's own Pause at a Sentence Boundary is expected.
  function playbackStatus(autoplayBlocked, synchronizing, playerState, ready) {
    if (
      autoplayBlocked ||
      (synchronizing === "play" &&
        [PLAYER_STATES.PAUSED, PLAYER_STATES.CUED].includes(playerState))
    ) {
      return "paused";
    }
    return ready ? "ready" : null;
  }

  function boundaryAction(mode, hasNext, selectionOpen = false) {
    if (selectionOpen) return "hold";
    if (playbackMode(mode) === "repeat") return "repeat";
    return mode === "continue" && hasNext ? "next" : "stay";
  }

  // LingQ reads a selected word aloud from a text-to-speech file.
  const WORD_AUDIO = /^https:\/\/(?:s3\.amazonaws\.com\/)?media\.lingq\.com\/resources\/tts\//;

  function wordAudio(src) {
    return typeof src === "string" && WORD_AUDIO.test(src);
  }

  // The video's volume while a word is read aloud over it.
  function duckedVolume(volume) {
    return Number.isFinite(volume) ? Math.round(volume * 0.3) : null;
  }

  // The action a wait at a Sentence Boundary releases into when it ends or is
  // cut short. A Boundary Delay keeps its action. A Vocabulary Hold and Listen
  // First's reveal run the Playback Mode's reaction. A selection that ends outside a wait, such as one
  // made while paused, never starts playback.
  function waitRelease(wait, at, mode, hasNext) {
    if (!wait || !at || wait.at !== at) return null;
    return wait.kind === "delay" ? wait.action : boundaryAction(mode, hasNext);
  }

  function boundaryEvent(armed, playerState, expectedPlayback = false) {
    if (expectedPlayback) return { armed: true, reached: false };
    if (armed && playerState === PLAYER_STATES.ENDED) {
      return { armed: false, reached: true };
    }
    return { armed, reached: false };
  }

  function shortcutAction(value) {
    // LingQ answers Space on a focused button or link by playing its lesson audio,
    // so only the letter keys yield to a focused control. The companion's own
    // Playback Mode menu handles every key itself.
    if (
      !value ||
      value.modified ||
      value.editable ||
      value.menu ||
      (value.interactive && value.key !== "Space")
    ) {
      return null;
    }

    const action = { Space: "toggle", N: "next", P: "previous", R: "replay" }[value.key];
    if (!action) return null;
    if (value.type === "keyup") return "consume";
    if (value.repeat) return value.key === "Space" ? "consume" : null;
    return action;
  }

  function claimShortcut(event, enabled, target) {
    if (!enabled) return null;
    const action = shortcutAction({
      key: event.code === "Space" ? "Space" : event.key.toUpperCase(),
      type: event.type,
      modified: event.altKey || event.ctrlKey || event.metaKey || event.shiftKey,
      repeat: event.repeat,
      ...target,
    });
    if (!action) return null;

    event.preventDefault();
    event.stopImmediatePropagation();
    return action;
  }

  function menuKey(event, index, count) {
    if (event.altKey || event.ctrlKey || event.metaKey) return null;
    switch (event.key) {
      case "ArrowDown":
        return { type: "focus", index: (index + 1) % count };
      case "ArrowUp":
        return { type: "focus", index: (index + count - 1) % count };
      case "Home":
        return { type: "focus", index: 0 };
      case "End":
        return { type: "focus", index: count - 1 };
      case "Enter":
      case " ":
        return event.repeat ? { type: "hold" } : { type: "choose", index };
      case "Escape":
        return { type: "close" };
      case "Tab":
        return { type: "leave" };
      default:
        return null;
    }
  }

  function menuButtonKey(event) {
    if (event.altKey || event.ctrlKey || event.metaKey) return null;
    if (event.key === "Escape" || event.key === " " || (event.key === "Enter" && event.repeat)) {
      return "consume";
    }
    return event.type === "keydown" && ["ArrowDown", "ArrowUp"].includes(event.key)
      ? "open"
      : null;
  }

  function validGeneration(value) {
    return Number.isSafeInteger(value) && value > 0;
  }

  function lifecycleAction(current, next) {
    return !current ||
      current.lessonKey !== next.lessonKey ||
      current.frame !== next.frame ||
      layoutAction(current, next) === "rebind"
      ? "bind"
      : "retain";
  }

  function layoutAction(current, next) {
    if (!current || current.modal !== next.modal) return "replace";
    return current.portal === next.portal &&
      current.reader === next.reader &&
      current.footer === next.footer
      ? "retain"
      : "rebind";
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
      !["bind", "seek", "seek-play", "play", "pause"].includes(type)
    ) {
      return null;
    }
    const usesSegment = ["seek", "seek-play"].includes(type);
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
      !["ready", "state", "blocked", "error"].includes(type)
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
    LEGACY_MODE_KEY,
    SETTINGS_KEY,
    boundaryAction,
    boundaryDelay,
    boundaryDelayWait,
    boundaryEvent,
    boundaryReaction,
    changedDelay,
    claimShortcut,
    companionSettings,
    companionStatus,
    cueCommand,
    delayEnd,
    duckedVolume,
    explicitPlayback,
    followsNeighborClick,
    initialCue,
    keyAction,
    layoutAction,
    lifecycleAction,
    menuButtonKey,
    menuKey,
    neighborAction,
    neighborCount,
    neighborSentences,
    parseBridgeCommand,
    parseBridgeEvent,
    playbackMode,
    playbackStatus,
    pressKept,
    readerLesson,
    readingSeconds,
    segmentTransition,
    seekTarget,
    sentenceAtTime,
    sentenceResponse,
    sentenceShown,
    sentenceVisibility,
    shortcutAction,
    showsNeighbors,
    storedSettings,
    videoPaused,
    waitRelease,
    wordAudio,
    wordKey,
    youtubeEmbedId,
  });
});
