# LingQ's reliable sentence playback seams

Issue: [#2 — Find LingQ's reliable sentence playback seams](https://github.com/loganprit/lingq-video-playback-chrome-extension/issues/2)

Live probe: 2026-08-11 (America/Chicago), logged-in LingQ YouTube lesson in Sentence View. Existing extension code was not used as evidence. The controls and transitions below were exercised directly against the [live lesson](https://www.lingq.com/en/learn/es/web/reader/39351008). YouTube state names and control methods follow the [official IFrame Player API reference](https://developers.google.com/youtube/iframe_api_reference).

## Answer

Use three seams together:

1. Gate on `#lesson-reader.is-sentence-mode` and identify the active sentence with both `.sentence-text.is-page-N` and `.sentence#sN`.
2. Scope playback to `.sentence--video-player iframe`, then accept YouTube messages only when `event.source === iframe.contentWindow` and the origin is a YouTube origin. Treat state `1` as playback start, state `2` as pause, and state `0` as the sentence boundary only after state `1` was seen for that same iframe. These state meanings are the supported YouTube API contract; the raw `postMessage` envelope (`onStateChange` / `infoDelivery`) is observable in LingQ but is not itself documented by Google.
3. Re-query LingQ's native controls after every sentence or mode change: `.sentence-text .play-button`, `.sentence-text .pause-button`, and `.next-page-button` followed by `closest("a, button, [role='button']")`.

Do not cache the sentence node or iframe, use the lesson URL as sentence identity, inspect unscoped YouTube iframes, or infer timing from the iframe URL.

## Live evidence

| Question | Observed result | Reliable seam |
| --- | --- | --- |
| Active sentence | The first three sentences exposed `s1` / `is-page-1`, `s2` / `is-page-2`, and `s3` / `is-page-3`. The article also exposed `has-pages-208`. The lesson URL did not change. | Require sentence mode, then read `.sentence.id` and the `is-page-N` class from `.sentence-text`. Use the pair as the identity and change signal. |
| Playback start | Sentence 2's scoped iframe emitted state `1` with `currentTime` about `0.55`; the native anchor changed from `.play-button` to `.pause-button`. Sentence 3 emitted state `1` at about `2.47`. | Arm the boundary handler on state `1` from the current scoped iframe. Capture segment start from the state-`1` `currentTime`, not the first unstarted message. |
| Playback end | Sentence 2 emitted state `0` at about `2.76`; sentence 1 emitted state `0` at about `0.55`. The full-video duration remained about 1299 seconds, so `duration` was not the sentence boundary. The active sentence did not advance. | A transition to state `0` after state `1`, from the current scoped iframe, is the Sentence Boundary. De-duplicate repeated state messages. YouTube documents `0` as ended and `1` as playing. |
| Native play/pause | Clicking `.sentence-text .play-button` started the segment. During playback the same anchor node changed class to `.pause-button`; clicking it emitted state `2` and changed it back to `.play-button`. | Click the class that represents the desired current action. Re-query before every click. YouTube documents state `2` as paused. |
| Pause mode | At state `0`, LingQ stayed on the same sentence and restored `.play-button`. | Pause requires no boundary action; leave LingQ on the active sentence. |
| Replay after end | Clicking the restored native `.play-button` replayed sentence 2 from about `0.55` and ended again near `2.76`. | For Repeat at a completed boundary, click the native `.play-button`; no direct seek is needed. |
| Replay Now | From sentence 2 paused around `2.11`, sending `seekTo(0.55, true)` and then `playVideo()` to the scoped iframe restarted near `0.55` and ended near `2.75`. | Capture the start time from the first state-`1` update for the current iframe. For Replay Now while active/paused, send `seekTo(start, true)` then `playVideo()` to that iframe. Google documents both methods, but the direct string-command transport is only live-observed. Google also warns that `seekTo` can invalidate a queued `endSeconds`; LingQ still enforced the observed boundary, so retain the state-`0` guard and treat this as a live LingQ behavior rather than a YouTube guarantee. |
| Next-and-play | Clicking the element owning `.next-page-button` changed `s2` / `is-page-2` to `s3` / `is-page-3`, disconnected the old sentence and iframe, mounted a new iframe, and exposed a fresh `.play-button`. Clicking it produced state `1` on the new iframe. | On boundary: resolve and click the native next owner, wait for the sentence identity to change and a new scoped iframe to exist, then re-query and click native play. |
| Final sentence | The final sentence was `s208` / `is-page-208`. It had no `.next-page-button`; its right navigation contained a completion-check control instead. It did **not** have `.is-last-page`. Playback emitted state `0` near the end of the video and remained on `s208`. | Final means the next marker is absent after the boundary. Do not click the generic right-nav anchor and do not rely on `.is-last-page`. |
| DOM remounts | Next navigation disconnected both the old `.sentence` and old sentence iframe; iframe IDs changed (`widget4`, `widget6`, `widget8`, and later values). Switching to Page View removed `is-sentence-mode`, disconnected the active sentence and iframe, and switching back preserved page 3 but mounted new sentence/player nodes. `.sentence-text` happened to remain the same node in these probes. | Observe child-list changes under `#lesson-reader`, debounce, and re-query all seams. Treat even the currently stable article as discoverable state, not a permanent reference. |
| Vocabulary interactions | Clicking `.sentence .sentence-item.lingq-word` still selected the word and opened LingQ's meaning/status panel. The active sentence and scoped iframe were unchanged across the click. | Playback integration should be passive around `.sentence-item`: no click handlers, overlays, `preventDefault`, or propagation blocking on LingQ's sentence/vocabulary subtree. |

## Selector and signal ranking

### Use

- `#lesson-reader.is-sentence-mode` — required mode gate.
- `.sentence-text` plus `is-page-N` and `.sentence#sN` — active identity and navigation completion.
- `.sentence--video-player iframe[src*="youtube.com/embed/"]` (also allow `youtube-nocookie.com`) — the sentence player only.
- `.sentence-text .play-button` / `.sentence-text .pause-button` — native play, resume, and pause.
- `.next-page-button` plus its closest interactive owner — next sentence.
- `event.source === currentIframe.contentWindow` plus a strict YouTube origin check — reject the full-video player and unrelated messages.
- YouTube state `1 -> 0`, armed per current iframe — Sentence Boundary.

### Reject

- `document.querySelector("iframe[src*='youtube']")` — LingQ simultaneously mounted a full-video iframe and a sentence iframe.
- `#sentence-video-player-portal iframe` — the named portal had zero children while the live sentence iframe was mounted elsewhere under `.sentence--video-player`.
- iframe IDs such as `widget4` — they changed on every remount.
- iframe `start` / `end` query parameters — both were `0` while observed sentence 2 actually ran about `0.55` to `2.76`.
- YouTube `duration` — it was the approximately 1299-second source video, not the segment length.
- `.is-last-page` — absent on observed page 208.
- `.nav--right > a.button` — the same generic shape represented next on ordinary sentences and completion on the final sentence.
- sentence text, accessible labels, or localized button copy — the key playback controls were unlabeled and sentence text is user content.
- lesson URL changes — the URL remained constant while the active sentence changed.

## Minimal control flow

1. Discover the current context and iframe; reset per-sentence state whenever `sN` / `is-page-N` changes or the iframe disconnects.
2. On current-frame state `1`, set `sawPlaying = true` and store that update's `currentTime` as the segment start.
3. On current-frame state `0`, act only if `sawPlaying` is true and the prior handled state was not `0`:
   - Pause: do nothing.
   - Repeat: click current native `.play-button`.
   - Continue: if the next marker exists, click its interactive owner; wait for a new identity and iframe; click the new native `.play-button`. If the marker is absent, stop at End of lesson.
4. Replay Now: if no start has been observed yet, native play already starts the current sentence; otherwise seek the current iframe to the captured start and play it.
5. On any DOM mutation, re-discover rather than repairing cached references.

## Confidence and limits

High confidence for the tested live lesson and current LingQ reader: every recommended seam above was exercised end-to-end. The main maintenance risk is the raw YouTube message/command envelope and LingQ's CSS classes, neither of which is a published LingQ extension API. The state values and player methods are covered by Google's public API, but the extension should keep the LingQ selectors and message parsing in one small adapter and fail closed when the sentence gate, scoped iframe, or current-frame check is missing.
