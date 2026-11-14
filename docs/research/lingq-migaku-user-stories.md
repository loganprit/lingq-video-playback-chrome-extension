# LingQ and Migaku user stories for the extension

On 2026-11-14 an agent drove Logan's signed-in browser read-only through LingQ web, the Migaku YouTube extension, and Migaku Memory. It also used Logan's screenshots of the LingQ and Migaku iOS players. The full write-up targets the separate `language-video-study` app (`docs/research/lingq-migaku-user-stories.md` in that repo). This copy checks each finding against this extension's spec (#7), `PRODUCT.md`, and the current code.

The extension keeps LingQ's vocabulary system and adds playback to it. So the questions here are which stories the extension can deliver by coordinating playback around LingQ's real Sentence View, and which ones LingQ already handles.

## What Logan relies on

- **Editing words while the video is on screen.** LingQ's iOS player can't do this. Migaku's can. On desktop this extension already delivers it, because LingQ's real interactive sentence sits under the video (spec stories 3, 7, 31). This is the feature to protect above everything else. See also the "Why LingQ over Migaku" project memory: per-form word tracking and free phrase selection.
- **LingQ settings:** "Paging moves to known" is off. "Auto LingQ creation" is on. "Show vocabulary in sentence view" is on. Text-to-speech plays when he clicks a word. The highlight style is Foreground. The default sentence translation is ChatGPT.
- **LingQ account:** free tier and out of imports, with 7,281 known word forms and 13,118 cards due. The review system goes unused.
- **Migaku:** Lifetime Plus. He imports yt-dlp subtitle files (`.es.srt` for the target language, `.en.srt` for the second track) instead of using YouTube's captions.

## Status key

- **Covered (n):** spec #7 story n, or the current code, already does this.
- **LingQ:** LingQ already does it inside the preserved Sentence View, so the extension doesn't need to.
- **Candidate:** fits the extension's scope and would need a new ticket.
- **Decide:** conflicts with the spec or needs Logan's call.
- **Out:** matches spec #7's Out of Scope list.

## Player and navigation

| # | Story | Source | Status |
|---|---|---|---|
| P1 | Look up a word and set its status or meaning without leaving the video. | Migaku iOS; Logan | Covered (3, 7, 31) on desktop. The touch version is Out (mobile). |
| P2 | Pause playback when a word or phrase is selected. | Migaku "Pause on interaction" | Covered (31) |
| P2b | Resume playback when the word panel closes. | Migaku "Resume after ending interaction" | Decided: yes. Replaces spec story 33. See Vocabulary Hold. |
| P3 | Have a visible Replay Now button, not just the `R` shortcut. | Migaku iOS; LingQ iOS | Candidate. Today `R` is the only way to trigger Replay Now (`src/core.js:188`). |
| P3b | Have a previous-Sentence shortcut to pair with `N`. | Migaku; LingQ iOS | Candidate. Only Next has a key. Check that LingQ's own keys don't already cover it. |
| P4 | Skip back and forward 5 s. | LingQ iOS; Migaku `⌥←/→` | Covered (9) by YouTube's native controls. A page-level key would be a low-priority Candidate, and it would need to work with seek sync (29). |
| P5 | Have a speed control near the Playback Mode group. | LingQ iOS `1x` | Covered (9) by YouTube's speed menu. Adding one would also need a playback-rate command in the bridge allowlist. Low. |
| P6 | See a progress bar with a mark at each Sentence start. | LingQ iOS | LingQ. Its lesson-progress sentence marks already do this, and seek sync uses them. |
| P7 | See the next few Sentences dimmed beside the active one. | LingQ iOS on iPad | Decided: build it behind a setting so it can be removed later. See Neighbor Sentences. |
| P8 | See the active Sentence's saved words and phrases with their meanings. | LingQ "Show vocabulary in sentence view" | LingQ; Covered (7) |
| P9 | Keep the Sentence visible when the video is fullscreen. | Migaku's subtitle overlay | Decided: build Focus Mode, modeled on the LingQ and Migaku iOS players. |

## Listening modes (the strongest fit)

These change what happens around a Sentence Boundary. The extension owns that behavior, and LingQ has nothing like it.

| # | Story | Source | Status |
|---|---|---|---|
| L1 | Hide the active Sentence until it has played, then pause and reveal it, so I test my ear first. | Migaku "Intensive Listening" | Candidate (high). Decided: a setting that works with every Playback Mode. See Listen First. |
| L2 | Show the Sentence only while paused. | Migaku "Show on Pause" | Candidate. Decided: a setting that works with every Playback Mode. See Show on Pause. |
| L3 | Pause at the Sentence Boundary, then continue on my own after a set delay or after an estimated reading time. | Migaku auto-unpause and dynamic unpause | Candidate (high). Decided: a setting that works with every Playback Mode. See Boundary Delay. |
| L4 | When I select a word, pause at the end of the Sentence instead of right away. | Migaku "Delayed pause on interaction" | Decided: yes. Replaces spec story 31. See Vocabulary Hold. |
| L5 | Skip silent stretches. | Migaku "Skip scenes with no dialogue" | Covered (18). Continue loads each bounded segment from its start, so the gaps between Sentences already get skipped. |

## Timing

| # | Story | Source | Status |
|---|---|---|---|
| T1 | Shift every Sentence earlier or later at once when the lesson's timestamps are offset. | Migaku subtitle offset `⌥I/O` | Candidate. Apply an offset to the bounds fetched from LingQ before the cue. It could be per lesson, stored in extension storage. LingQ's own timestamps stay untouched. |
| T2 | Pad each segment slightly so the first and last syllables aren't clipped. | Implied by T1 | Candidate, low. This uses the same seam as T1. |

## Words, vocabulary, and lessons

LingQ already handles all of these inside the preserved reader. Rebuilding them is Out ("Replacing LingQ's vocabulary, translation, progress, sidebar ... systems").

- Vocabulary page with search, filters, and bulk changes (LingQ Vocabulary).
- Graded Learning levels 1 to 4, notes, tags, dictionary links, and related phrases (LingQ word panel).
- Dictionary form and grammar tags, such as "mira → mirar" (LingQ auto grammar tagging).
- Highlight style and text size (LingQ settings and the Aa panel).
- Word text-to-speech. LingQ plays it when Logan clicks a word. Issue #27 already keeps LingQ's audio out of the companion's shortcuts. The pause in story 31 keeps it from overlapping the video.
- Importing transcripts, translation files, and YouTube captions; lesson collections; "Continue Studying"; Sentence review; and lesson-complete summaries.

One word story could still fit the extension:

| # | Story | Source | Status |
|---|---|---|---|
| W1 | Have a key that selects the next new (blue) word in the active Sentence and opens LingQ's panel for it. | Migaku `N` | Candidate. It drives LingQ's own word elements, so it adds no vocabulary system. The key can't be `N`, because that already means Next Sentence. |

## Out of scope

Both apps have these features. Spec #7 excludes them, and Logan's usage doesn't argue for adding them: flashcards and review, streaks and coins, community meanings, AI lesson tools, printing and audio download, AI chat, gender coloring, and mobile layouts.

## Decisions

Logan answered the open questions on 2026-11-14. The goal changed too. Instead of rebuilding LingQ in `language-video-study`, Logan wants to make LingQ pleasant enough to use full time by removing the parts he dislikes and adding Migaku's listening tools.

1. **Resume after vocabulary study.** Yes. When the word or phrase selection ends, playback resumes. This replaces spec story 33.
2. **When a lookup pauses.** At the Sentence Boundary, as Migaku does, not right away. This replaces spec story 31.
3. **Listening settings.** Listen First, Show on Pause, and Boundary Delay are settings that work with every Playback Mode, not new Playback Modes.
4. **Focus Mode.** Build it, modeled on the LingQ and Migaku iOS players.
5. **Neighbor Sentences.** Build it behind a setting, so it can be removed if Logan doesn't like it.

`CONTEXT.md` defines the new terms. The work is tracked under map issue #34.
