(() => {
  "use strict";

  const core = globalThis.LingqPlaybackCore;
  if (!core || globalThis.__lingqSentencePlayerBridge) return;
  globalThis.__lingqSentencePlayerBridge = true;

  let frame = null;
  let generation = 0;
  let player = null;
  let ready = false;
  let pendingSegment = null;
  let videoId = null;

  function emit(type, detail) {
    const event = core.bridgeEvent(type, generation, detail);
    if (event) window.postMessage(event, location.origin);
  }

  function playerFrame() {
    const candidate = document.querySelector(".lspc-player iframe");
    if (!candidate || candidate.closest(".sentence--video-player, .sent-video-player")) {
      return null;
    }

    try {
      const url = new URL(candidate.src, location.href);
      const youtube = ["www.youtube.com", "youtube.com", "www.youtube-nocookie.com"];
      const id = url.pathname.match(/^\/embed\/([A-Za-z0-9_-]+)$/)?.[1];
      return youtube.includes(url.hostname) &&
        id &&
        url.searchParams.get("enablejsapi") === "1" &&
        url.searchParams.get("origin") === location.origin
        ? { candidate, id }
        : null;
    } catch {
      return null;
    }
  }

  function cue() {
    if (!ready || !pendingSegment) return;
    try {
      player.cueVideoById({
        videoId,
        startSeconds: pendingSegment.start,
        endSeconds: pendingSegment.end,
      });
      pendingSegment = null;
    } catch {
      ready = false;
      emit("error", { reason: "player-error" });
    }
  }

  function markReady(expectedGeneration) {
    if (
      expectedGeneration !== generation ||
      ready ||
      typeof player?.cueVideoById !== "function"
    ) {
      return;
    }
    ready = true;
    emit("ready");
    cue();
  }

  function waitForPlayer(expectedGeneration, attempts = 400) {
    if (expectedGeneration !== generation || ready) return;
    if (typeof player?.cueVideoById === "function") {
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
      player = new YT.Player(frame, {
        events: {
          onReady() {
            markReady(expectedGeneration);
          },
          onError() {
            ready = false;
            emit("error", { reason: "player-error" });
          },
        },
      });
      waitForPlayer(expectedGeneration);
    } catch {
      emit("error", { reason: "player-unavailable" });
    }
  }

  function bind(command) {
    generation = command.generation;
    pendingSegment = null;
    const found = playerFrame();
    if (!found) {
      emit("error", { reason: "invalid-video" });
      return;
    }

    if (found.candidate === frame && player) {
      if (ready) {
        emit("ready");
      } else {
        waitForPlayer(generation);
      }
      return;
    }

    frame = found.candidate;
    videoId = found.id;
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
    } else if (command.generation === generation) {
      pendingSegment = command.segment;
      cue();
    }
  });
})();
