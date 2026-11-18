# LingQ Sentence Playback

This context describes sentence-scoped playback behavior layered onto LingQ lessons without replacing LingQ's reading and vocabulary experience.

## Language

**Sentence View**:
LingQ's reader state in which one lesson sentence is active at a time.

**Sentence Boundary**:
The end of playback for the active sentence, where the selected Playback Mode determines what happens next.

**Playback Mode**:
The persistent choice governing behavior at a Sentence Boundary: Pause, Continue, or Repeat.

**Pause**:
A Playback Mode that remains on the active sentence after its Sentence Boundary.
_Avoid_: Pause button

**Continue**:
A Playback Mode that advances to the next sentence and starts it after a Sentence Boundary.
_Avoid_: Autoplay

**Repeat**:
A Playback Mode that starts the active sentence again after its Sentence Boundary.
_Avoid_: Replay

**Replay Now**:
A one-time action that restarts the active sentence without changing the Playback Mode.
_Avoid_: Repeat

**Vocabulary Hold**:
The state in which a word or phrase selection is open when the active sentence reaches its Sentence Boundary. Playback pauses and waits. When the selection ends, the Playback Mode's reaction runs.
_Avoid_: Pause on interaction

**Boundary Delay**:
A setting that waits at each Sentence Boundary before Continue or Repeat acts: Off, a fixed number of seconds, or an estimated reading time for the sentence. A Vocabulary Hold comes first, and the delay starts when it ends. A selection still open when the delay runs out becomes a Vocabulary Hold, and the Playback Mode acts when the selection ends.

**Sentence Visibility**:
A setting that decides when the active sentence's text shows: Always, Listen First, or Show on Pause. It works with every Playback Mode.

**Listen First**:
A Sentence Visibility choice that hides the active sentence until its first play reaches the Sentence Boundary, then reveals it.
_Avoid_: Intensive listening

**Show on Pause**:
A Sentence Visibility choice that shows the active sentence only while playback is paused.

**Neighbor Sentences**:
Dimmed, read-only text of the sentences that follow the active sentence. The active sentence stays LingQ's real interactive sentence.

**Focus Mode**:
A layout that fills the browser window with the video, the active sentence, and the companion controls, modeled on the LingQ and Migaku iOS players.
_Avoid_: Fullscreen

**Timing Offset**:
A per-lesson shift applied to LingQ's sentence bounds before the companion plays them. LingQ's stored timestamps stay unchanged.
