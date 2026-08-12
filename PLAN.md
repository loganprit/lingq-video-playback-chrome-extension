# LingQ Sentence Playback Companion — implementation plan

## Destination

A loadable private Chrome MV3 extension that leaves LingQ's reader intact while adding reliable pause, continue, and repeat behavior to YouTube lessons in Sentence View, verified in the user's logged-in Aside Browser.

## Why this does not need a Wayfinder issue map

The chat thread and live page inspection resolved the product boundary and exposed only implementation-sized questions. There is no multi-session fog to track on an issue map, so the route is recorded here and execution can continue in this session.

## Decisions

- **Scope:** LingQ web reader pages, Sentence View, YouTube-backed lessons only.
- **Integration seam:** Observe the sentence-specific YouTube iframe's `postMessage` state events, then use LingQ's existing next-sentence and play controls. Do not recreate subtitles, vocabulary, or the player.
- **Modes:**
  - **Pause** — LingQ's existing sentence-boundary stop remains in effect.
  - **Continue** — when the sentence iframe reports `ENDED`, click LingQ's next control and start the next sentence.
  - **Repeat** — when the sentence iframe reports `ENDED`, seek back to the observed segment start and replay it.
- **Persistence:** save the selected mode with `chrome.storage.local`.
- **Shortcuts:** `Space` play/pause, `N` next sentence, `R` replay now, `C` toggle Pause/Continue, `A` select Continue.
- **Robustness:** prefer stable semantic seams (`.is-sentence-mode`, `.sentence`, `.play-button`, `.next-page-button`, `.sentence--video-player iframe`) and isolate selectors in one adapter. Re-detect after LingQ DOM remounts.
- **No build step:** plain JavaScript, CSS, and a Manifest V3 file so the folder can be loaded unpacked directly.

## Acceptance checks

1. The toolbar appears only on a YouTube lesson in LingQ Sentence View.
2. Pause mode ends without changing the current sentence.
3. Continue mode changes to the next sentence and starts it automatically.
4. Repeat mode plays the same sentence at least twice.
5. Mode selection survives a page reload.
6. Keyboard shortcuts work without hijacking text inputs or editable content.
7. LingQ word/phrase interactions and its native reader UI remain available.
8. Unit tests cover event parsing, mode transitions, hotkey filtering, sentence key extraction, and ended-state reactions.

## Known maintenance risk

LingQ exposes no public reader playback API. Its DOM selectors may change. YouTube iframe events are the more stable part of the integration; the LingQ adapter is deliberately small so selector updates stay localized.
