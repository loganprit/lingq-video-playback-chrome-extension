(() => {
  "use strict";

  const core = globalThis.LingqPlaybackCore;
  if (!core || globalThis.__lingqSentencePlayerBridge) return;
  globalThis.__lingqSentencePlayerBridge = true;

  let activeSegment = null;
  let boundaryPending = null;
  let boundaryTimer = null;
  let frame = null;
  let generation = 0;
  let player = null;
  let ready = false;

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

  function stopBoundaryWatcher() {
    if (boundaryTimer === null) return;
    clearInterval(boundaryTimer);
    boundaryTimer = null;
  }

  function failPlayer() {
    boundaryPending = null;
    stopBoundaryWatcher();
    ready = false;
    emit("error", { reason: "player-error" });
  }

  function playerReady() {
    return ["getCurrentTime", "pauseVideo", "playVideo", "seekTo"].every(
      (method) => typeof player?.[method] === "function",
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
        boundaryPending = activeSegment.end;
        player.pauseVideo();
      } catch {
        failPlayer();
      }
    }, 50);
  }

  function seekSegment(segment, play) {
    if (!ready) return;
    try {
      activeSegment = segment;
      boundaryPending = null;
      stopBoundaryWatcher();
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
      player = new YT.Player(frame.id, {
        events: {
          onReady(event) {
            player = event.target;
            markReady(expectedGeneration);
          },
          onError(event) {
            if (event.target !== player) return;
            failPlayer();
          },
          onStateChange(event) {
            if (event.target !== player || !ready) return;
            try {
              if (
                event.data === core.PLAYER_STATES.PAUSED &&
                boundaryPending !== null
              ) {
                const currentTime = boundaryPending;
                boundaryPending = null;
                emit("state", {
                  state: core.PLAYER_STATES.ENDED,
                  currentTime,
                });
                return;
              }
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
          },
        },
      });
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
      if (ready) {
        emit("ready");
      } else {
        waitForPlayer(generation);
      }
      return;
    }

    stopBoundaryWatcher();
    activeSegment = null;
    boundaryPending = null;
    frame = found;
    player = null;
    ready = false;
    attach(generation);
  }

  window.addEventListener("message", (message) => {
    if (message.source !== window || message.origin !== location.origin) return;
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
