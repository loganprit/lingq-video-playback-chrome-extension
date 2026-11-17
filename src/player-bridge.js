(() => {
  "use strict";

  const core = globalThis.LingqPlaybackCore;
  if (!core || globalThis.__lingqSentencePlayerBridge) return;
  globalThis.__lingqSentencePlayerBridge = true;

  const EMBED_ORIGINS = ["https://www.youtube.com", "https://www.youtube-nocookie.com"];
  const EMBED_EVENTS = ["onStateChange", "onError", "onAutoplayBlocked"];

  let activeSegment = null;
  // null, or the video's volume lowered while LingQ reads words aloud:
  // { player, volume, clips }.
  let duck = null;
  const watchedClips = new WeakSet();
  let boundaryTimer = null;
  let frame = null;
  let generation = 0;
  // The embed windows that have announced they are ready. It is null until the
  // bridge reads a first announcement.
  let liveEmbeds = null;
  let player = null;
  let ready = false;
  const subscribed = new WeakSet();

  function emit(type, detail) {
    const event = core.bridgeEvent(type, generation, detail);
    if (event) window.postMessage(event, location.origin);
  }

  function playerFrame() {
    for (const candidate of document.querySelectorAll(".lspc-player iframe")) {
      if (candidate.closest(".sentence--video-player, .sent-video-player")) continue;
      const id = core.youtubeEmbedId(candidate.src, location.href, location.origin);
      if (id) return candidate;
    }
    return null;
  }

  function restoreVolume() {
    if (!duck) return;
    const { player: ducked, volume } = duck;
    duck = null;
    try {
      ducked.setVolume(volume);
    } catch {
      // A destroyed player has no volume to restore.
    }
  }

  function clipEnded(clip) {
    if (duck?.clips.delete(clip) && !duck.clips.size) restoreVolume();
  }

  // While LingQ reads a selected word aloud, the video plays quieter so the
  // two don't talk over each other (#36).
  function duckFor(clip, started) {
    if (!ready || duck?.clips.has(clip) || !core.wordAudio(clip.currentSrc || clip.src)) {
      return;
    }
    if (!duck) {
      if (player.getPlayerState?.() !== core.PLAYER_STATES.PLAYING) return;
      const volume = player.getVolume?.();
      const lowered = core.duckedVolume(volume);
      if (lowered === null) return;
      player.setVolume(lowered);
      duck = { player, volume, clips: new Set() };
    }
    duck.clips.add(clip);
    if (!watchedClips.has(clip)) {
      watchedClips.add(clip);
      for (const type of ["ended", "pause", "error", "emptied"]) {
        clip.addEventListener(type, () => clipEnded(clip));
      }
    }
    Promise.resolve(started).catch(() => clipEnded(clip));
  }

  // LingQ plays word audio from Audio elements outside the document, whose
  // events never reach it, so the bridge sees each clip start through play().
  const mediaPlay = globalThis.HTMLMediaElement?.prototype.play;
  if (mediaPlay) {
    HTMLMediaElement.prototype.play = function play(...args) {
      const started = mediaPlay.apply(this, args);
      try {
        duckFor(this, started);
      } catch {
        // Word audio plays at full volume rather than break LingQ's playback.
      }
      return started;
    };
  }

  function stopBoundaryWatcher() {
    if (boundaryTimer === null) return;
    clearInterval(boundaryTimer);
    boundaryTimer = null;
  }

  function failPlayer() {
    stopBoundaryWatcher();
    ready = false;
    emit("error", { reason: "player-error" });
  }

  // Moving the iframe in the DOM reloads its embed into a new window, and the
  // YT player keeps its methods meanwhile. Only the embed's own announcement
  // shows that the frame's current window is listening. If the bridge never
  // read an announcement, the player's methods decide alone.
  function embedLive() {
    return !liveEmbeds || liveEmbeds.has(frame.contentWindow);
  }

  function playerReady() {
    return (
      ["getCurrentTime", "pauseVideo", "playVideo", "seekTo"].every(
        (method) => typeof player?.[method] === "function",
      ) && embedLive()
    );
  }

  function watchBoundary(currentTime) {
    stopBoundaryWatcher();
    if (!activeSegment || currentTime >= activeSegment.end) return;

    // ponytail: active-tab polling is subject to browser timer throttling; use a
    // native segment-end event if YouTube adds one.
    boundaryTimer = setInterval(() => {
      try {
        if (player.getCurrentTime() < activeSegment.end) return;
        stopBoundaryWatcher();
        emit("state", {
          state: core.PLAYER_STATES.ENDED,
          currentTime: activeSegment.end,
        });
      } catch {
        failPlayer();
      }
    }, 50);
  }

  function seekSegment(segment, play) {
    if (!ready) return;
    try {
      const currentTime = player.getCurrentTime();
      activeSegment = segment;
      stopBoundaryWatcher();
      if (core.segmentTransition(play, currentTime, segment) === "resume") {
        player.playVideo();
        watchBoundary(currentTime);
        emit("state", {
          state: core.PLAYER_STATES.PLAYING,
          currentTime,
        });
        return;
      }
      if (!play) player.pauseVideo();
      player.seekTo(segment.start, true);
      player[play ? "playVideo" : "pauseVideo"]();
    } catch {
      failPlayer();
    }
  }

  function markReady(expectedGeneration) {
    if (
      expectedGeneration !== generation ||
      ready ||
      !playerReady()
    ) {
      return;
    }
    ready = true;
    emit("ready");
  }

  function waitForPlayer(expectedGeneration, attempts = 400) {
    if (expectedGeneration !== generation || ready) return;
    if (playerReady()) {
      markReady(expectedGeneration);
    } else if (attempts > 0) {
      setTimeout(() => waitForPlayer(expectedGeneration, attempts - 1), 50);
    } else {
      emit("error", { reason: "player-unavailable" });
    }
  }

  function onReady(event) {
    if (event.target === player) markReady(generation);
  }

  function onError(event) {
    if (event.target === player) failPlayer();
  }

  function onStateChange(event) {
    if (event.target !== player || !ready) return;
    try {
      const currentTime = event.target.getCurrentTime();
      if (event.data === core.PLAYER_STATES.PLAYING) {
        watchBoundary(currentTime);
      } else {
        stopBoundaryWatcher();
      }
      emit("state", {
        state: event.data,
        currentTime,
      });
    } catch {
      failPlayer();
    }
  }

  function onAutoplayBlocked(event) {
    if (event.target !== player || !ready) return;
    stopBoundaryWatcher();
    emit("blocked");
  }

  // An embed posts {"event":"onReady","id":1,"channel":"widget"} each time it
  // finishes loading. This is YouTube's widget protocol, which is undocumented.
  function embedAnnounced(message) {
    if (
      !message.source ||
      !EMBED_ORIGINS.includes(message.origin) ||
      typeof message.data !== "string" ||
      !message.data.includes('"onReady"')
    ) {
      return;
    }
    let announcement;
    try {
      announcement = JSON.parse(message.data);
    } catch {
      return;
    }
    if (announcement?.event !== "onReady" || announcement.channel !== "widget") return;

    liveEmbeds ??= new WeakSet();
    liveEmbeds.add(message.source);
    if (message.source !== frame?.contentWindow) return;

    // The YT player asks an embed for each event type once, so a reloaded embed
    // reports no events to LingQ or to this bridge until it is asked again. An
    // embed ignores a request for an event it already reports.
    for (const type of EMBED_EVENTS) {
      message.source.postMessage(
        JSON.stringify({
          event: "command",
          func: "addEventListener",
          args: [type],
          id: announcement.id,
          channel: "widget",
        }),
        message.origin,
      );
    }
    ready = false;
    markReady(generation);
  }

  function attach(expectedGeneration, attempts = 400) {
    if (expectedGeneration !== generation) return;
    if (!globalThis.YT?.Player) {
      if (attempts > 0) {
        setTimeout(() => attach(expectedGeneration, attempts - 1), 50);
      } else {
        emit("error", { reason: "youtube-api-timeout" });
      }
      return;
    }

    try {
      // LingQ creates this iframe with its own YT.Player. The embed completes its
      // handshake with one player per iframe, so a second one either never gets
      // its methods or takes them from LingQ's. YT.get is undocumented.
      player =
        (typeof YT.get === "function" && YT.get(frame.id)) ||
        new YT.Player(frame.id);
      // YT players can't remove a listener by reference, so subscribe each one
      // once; the handlers ignore events from any player but the current one.
      if (!subscribed.has(player)) {
        subscribed.add(player);
        player.addEventListener("onReady", onReady);
        player.addEventListener("onError", onError);
        player.addEventListener("onStateChange", onStateChange);
        player.addEventListener("onAutoplayBlocked", onAutoplayBlocked);
      }
      waitForPlayer(expectedGeneration);
    } catch {
      if (attempts > 0) {
        setTimeout(() => attach(expectedGeneration, attempts - 1), 50);
      } else {
        emit("error", { reason: "player-unavailable" });
      }
    }
  }

  function bind(command) {
    generation = command.generation;
    const found = playerFrame();
    if (!found) {
      emit("error", { reason: "invalid-video" });
      return;
    }

    if (found === frame && player) {
      ready &&= playerReady();
      if (ready) {
        emit("ready");
      } else {
        waitForPlayer(generation);
      }
      return;
    }

    stopBoundaryWatcher();
    restoreVolume();
    activeSegment = null;
    frame = found;
    player = null;
    ready = false;
    attach(generation);
  }

  window.addEventListener("message", (message) => {
    if (message.source !== window) {
      embedAnnounced(message);
      return;
    }
    if (message.origin !== location.origin) return;
    const command = core.parseBridgeCommand(message.data);
    if (!command) return;

    if (command.type === "bind") {
      bind(command);
    } else if (command.generation === generation && ready) {
      try {
        if (command.type === "play" || command.type === "pause") {
          if (command.type === "pause") stopBoundaryWatcher();
          player[`${command.type}Video`]();
        } else {
          seekSegment(command.segment, command.type === "seek-play");
        }
      } catch {
        failPlayer();
      }
    }
  });
})();
