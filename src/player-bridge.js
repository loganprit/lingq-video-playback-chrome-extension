(() => {
  "use strict";

  const core = globalThis.LingqPlaybackCore;
  if (!core || globalThis.__lingqSentencePlayerBridge) return;
  globalThis.__lingqSentencePlayerBridge = true;

  const EMBED_ORIGINS = ["https://www.youtube.com", "https://www.youtube-nocookie.com"];
  const EMBED_EVENTS = ["onStateChange", "onError", "onAutoplayBlocked", "onPlaybackRateChange"];
  const DUCK_LIMIT_MS = 10000;
  const ECHO_LIMIT_MS = 1000;
  // The video keeps playing while it buffers, so a word spoken then is ducked too.
  const AUDIBLE_STATES = [core.PLAYER_STATES.PLAYING, core.PLAYER_STATES.BUFFERING];

  let activeSegment = null;
  // null, or the video's volume lowered while LingQ reads words aloud:
  // { player, volume, lowered, clips, timer }.
  let duck = null;
  let restored = null;
  const watchedClips = new WeakSet();
  const latestPlay = new WeakMap();
  let boundaryTimer = null;
  let frame = null;
  let generation = 0;
  // The embed windows that have announced they are ready. It is null until the
  // bridge reads a first announcement.
  let liveEmbeds = null;
  let player = null;
  let ready = false;
  // The video's duration last reported for this bind, which clamps a Timing
  // Offset at the video's end.
  let reportedDuration = null;
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

  // The YT player's getVolume reads a copy the embed updates a few ms after
  // each setVolume, so the bridge remembers its last restore until the copy
  // catches up. Otherwise a word that starts right after another ends would
  // take the lowered volume as the video's own.
  function videoVolume() {
    const volume = player.getVolume?.();
    const lagging =
      restored?.player === player &&
      volume === restored.lowered &&
      Date.now() - restored.at < ECHO_LIMIT_MS;
    if (lagging) return restored.volume;
    restored = null;
    return volume;
  }

  function restoreVolume() {
    if (!duck) return;
    const { player: ducked, volume, lowered, timer } = duck;
    clearTimeout(timer);
    duck = null;
    restored = { player: ducked, volume, lowered, at: Date.now() };
    try {
      ducked.setVolume(volume);
    } catch {
      // A destroyed player has no volume to restore.
    }
  }

  // LingQ may reuse an Audio element, and changing its source fires pause and
  // emptied after play() has started the next word, so only a clip that has
  // stopped ends the duck.
  function clipEnded(clip, stopped = clip.paused) {
    if (stopped && duck?.clips.delete(clip) && !duck.clips.size) restoreVolume();
  }

  // While LingQ reads a selected word aloud, the video plays quieter so the
  // two don't talk over each other (#36).
  function duckFor(clip, started) {
    if (!ready || !core.wordAudio(clip.src || clip.currentSrc)) return;
    if (!duck) {
      if (!AUDIBLE_STATES.includes(player.getPlayerState?.())) return;
      const volume = videoVolume();
      const lowered = core.duckedVolume(volume);
      if (lowered === null) return;
      player.setVolume(lowered);
      duck = { player, volume, lowered, clips: new Set(), timer: null };
    }
    // A clip whose source stalls without an error never ends.
    clearTimeout(duck.timer);
    duck.timer = setTimeout(restoreVolume, DUCK_LIMIT_MS);
    duck.clips.add(clip);
    if (!watchedClips.has(clip)) {
      watchedClips.add(clip);
      for (const type of ["ended", "pause", "emptied"]) {
        clip.addEventListener(type, () => clipEnded(clip));
      }
      clip.addEventListener("error", () => clipEnded(clip, true));
    }
    // Starting a new source aborts the clip's previous play(), which isn't an end.
    latestPlay.set(clip, started);
    Promise.resolve(started).catch(() => {
      if (latestPlay.get(clip) === started) clipEnded(clip, true);
    });
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

  function reportDuration() {
    const duration = player?.getDuration?.();
    if (!Number.isFinite(duration) || duration <= 0 || duration === reportedDuration) return;
    reportedDuration = duration;
    emit("duration", { duration });
  }

  // A Timing Offset changed while the segment plays. Inside the new bounds the
  // play goes on, and the boundary watcher, which reads activeSegment, stops
  // at the new end. An end now behind the video is reached at once, and a
  // start still ahead of it is sought, so the play never runs outside the
  // segment it now belongs to.
  function retimeSegment(segment) {
    activeSegment = segment;
    if (!AUDIBLE_STATES.includes(player.getPlayerState?.())) return;
    const currentTime = player.getCurrentTime();
    if (currentTime >= segment.end) {
      stopBoundaryWatcher();
      emit("state", { state: core.PLAYER_STATES.ENDED, currentTime: segment.end });
    } else if (currentTime < segment.start) {
      stopBoundaryWatcher();
      player.seekTo(segment.start, true);
      player.playVideo();
    }
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
    reportDuration();
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
      reportDuration();
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

  // The rate changes from the companion's speed button or YouTube's own menu.
  function onPlaybackRateChange(event) {
    if (event.target === player && ready) emit("rate", { rate: event.data });
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
        player.addEventListener("onPlaybackRateChange", onPlaybackRateChange);
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
    reportedDuration = null;
    const found = playerFrame();
    if (!found) {
      emit("error", { reason: "invalid-video" });
      return;
    }

    if (found === frame && player) {
      ready &&= playerReady();
      if (ready) {
        reportDuration();
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
        } else if (command.type === "rate") {
          player.setPlaybackRate(command.rate);
        } else if (command.type === "retime") {
          retimeSegment(command.segment);
        } else {
          seekSegment(command.segment, command.type === "seek-play");
        }
      } catch {
        failPlayer();
      }
    }
  });
})();
