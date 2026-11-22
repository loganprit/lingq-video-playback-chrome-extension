# LingQ Sentence Playback Companion

A private Chrome Manifest V3 extension that keeps LingQ's vocabulary and phrase workflow intact while adding Migaku-style sentence playback behavior to YouTube lessons.

## What it does

On a supported YouTube-backed LingQ lesson in **Sentence View**, the extension:

- presents LingQ's full-video iframe as the visible 16:9 player;
- seeks to the active Sentence's exact timestamp and pauses there;
- keeps LingQ's real interactive Sentence and translation controls beneath it;
- plays adjacent Sentences immediately through LingQ's native Previous and Next controls.

The extension drives only the visible player, mainly through the YouTube IFrame Player API (see Scope and maintenance for the undocumented messages it also relies on). It does not use LingQ's hidden Sentence player or replace LingQ's reader and vocabulary UI.

## Footer controls

The extension adds four items to LingQ's footer, styled like LingQ's own *Page View* and *Review Sentence*:

- **Replay** replays the current sentence once (Replay Now).
- **Playback Mode** shows what happens at the end of each sentence: *Pause at end*, *Continue at end*, or *Repeat at end*. Click it, or focus it and press `Enter` or an arrow key, to open its menu. In the menu, the arrow keys, `Home`, and `End` move, `Enter` or `Space` chooses, and `Escape` closes. The menu also lists the keyboard shortcuts. The choice is saved across reloads.
- **Focus** enters Focus Mode (see below).
- **Settings** opens the companion's settings panel: the Boundary Delay, Sentence Visibility, Neighbor Sentences, and this lesson's Timing Offset. Focus starts on the chosen delay. The arrow keys choose, `Tab` moves from the delay to the seconds list, Sentence Visibility, Neighbor Sentences, and each Timing Offset button, and `Escape` or a click outside closes the panel. Keys pressed in the panel never reach LingQ, so `Escape` there doesn't also close a word card or the video.

The Playback Mode and the settings are saved together in one record. An older install's saved Playback Mode carries over once. The Timing Offset is saved per lesson, apart from them.

A short status appears just above the footer only while the video loads or when it needs you, for example to press Play after the browser blocked playback. Pausing at the end of a sentence in Pause mode shows nothing. Screen readers still hear "Video ready."

## Boundary Delay

The Boundary Delay waits at the end of each sentence before Continue moves on or Repeat replays. Pause ignores it.

- **Off** acts at once.
- **Fixed** waits the same 1 to 10 seconds after every sentence.
- **Reading time** waits one second for every 15 characters of the sentence's text, from 1 to 15 seconds. The text is the one LingQ's sentence endpoint returns.

The video pauses at the end of the sentence while it waits. The Playback Mode button counts down in place, as "Next in 3 s" or "Repeat in 3 s" under a ring that empties. Play, `N`, `P`, and Replay end the wait and act at once. In Continue, Play moves on to the next sentence.

If a word or phrase selection is open when the wait runs out, the video holds there as a Vocabulary Hold, and the Playback Mode acts once the selection ends, with no second wait. Changing the Playback Mode or the delay during a wait decides it again from the wait's start: Pause ends the wait and stays paused, Off acts at once, and a new mode or delay keeps the time already waited and counts down what is left. A wait whose sentence or lesson is no longer active when it runs out does nothing.

## Sentence Visibility

Sentence Visibility decides when the active sentence's text shows. It works with every Playback Mode and Boundary Delay.

- **Always** shows it the whole time.
- **Listen First** hides each new sentence until its first play reaches the end, then shows it. Replays keep it shown, and moving to another sentence hides that one. With the Boundary Delay Off, Continue and Repeat pause at that first end so you can read the text. Play then moves on in Continue or replays in Repeat, and `N`, `P`, and Replay act as usual. With a delay, the text shows during the wait.
- **Show on Pause** shows it only while the video is paused. That includes Pause at end, a Vocabulary Hold, a Boundary Delay's wait, the end of the video, and a play the browser left paused. A sentence end that moves straight on, or a sentence the companion is about to play, doesn't count, so the next sentence's text never flashes.

Under every choice, the sentence shows if the video fails or while it holds a word or phrase selection.

Neighbor Sentences hide with the sentence. Under Listen First they never show.

The hidden sentence keeps its place, so nothing below it moves. Its words can't be seen, hovered, or clicked. To show it for the rest of that sentence, click where it sits, or press one of LingQ's word keys: `←`, `→`, `b`, or `Shift`+`Space`. That click or key never reaches LingQ, so it never selects a word or creates a LingQ. Neither does a press that began on the hidden text, or any press in the half second after the text shows, so a click already on its way can't land on a word. LingQ also steps words on `←`, `→`, and `b` held with `Alt`, `Ctrl`, or `Cmd`. While the text is hidden, LingQ never sees those either, but the browser still acts on them, so `Alt`+`←` still goes back. Keys typed into a field or pressed in the companion's menu and panel are left alone. LingQ's translation and its list of the sentence's saved words stay as LingQ shows them.

## Neighbor Sentences

Neighbor Sentences show the next three sentences under the active one, dimmed, so you can see what comes next. They're on by default. Turn them off in Settings, and every neighbor is removed from the page.

- The text comes from LingQ's sentence endpoint, the request the companion already makes for timestamps. It's plain text, not LingQ's words, so it can't be hovered, selected, or saved as a LingQ. No click, press, or `Enter` on a neighbor reaches LingQ. Neither does the rest of a double click on one, even where the new sentence's words now lie, nor a held `Enter`'s repeats and release.
- Click a neighbor, or `Tab` to it and press `Enter`, to play that sentence. The companion selects it through LingQ's own sentence navigation, as it does after a seek, and ends a Boundary Delay or Vocabulary Hold the way `N` and `P` do. A double click moves one sentence, and a click returns focus to the page, so the letter shortcuts keep working.
- They follow the active sentence on `N`, `P`, a seek, Continue, and LingQ's own sentence changes. Near the lesson's end fewer show, and none after the last sentence.
- Under Show on Pause they show only while the sentence does, and keep their place while hidden. Under Listen First they never show, because you haven't heard the sentences after this one yet.
- In tall windows the video is 4rem shorter to make room for them. It never gets smaller than in a shorter window, though: at 660px tall or less it keeps its short-window size, and up to 788px tall it holds 340px, the short-window size at 660px. In both ranges neighbors only take the height that's left over, so often none show below about 750px. Only the neighbors that fit above LingQ's *Show Translation* row show, so the video, the sentence, and the footer never move.

## Timing Offset

Some lessons' timestamps are early or late for every sentence, which clips each sentence's start or end. The Timing Offset in the settings panel fixes that for the lesson you're on. LingQ's own timestamps never change.

- **Shift** moves every sentence of the lesson earlier (`−`) or later (`+`) in 0.1 s steps, up to 5 s either way. **Reset** puts it back at 0.0 s. The panel shows the current value, such as "+0.5 s".
- **Pad** lengthens both ends of every sentence, from 0 to 0.5 s in 0.05 s steps, so first and last syllables aren't cut. It starts at 0.
- Everything the companion plays uses the offset: the cued sentence, its end, Replay, Repeat, Continue, `N` and `P`, Neighbor Sentences, and a YouTube seek. It works the same in every Playback Mode and in Focus Mode.
- A change applies at once. A sentence that's playing goes on and stops at its new end, or right away if that end has already passed. A paused sentence is cued again at its new start, so Play then plays it with the new offset.
- A seek picks the sentence by the shifted times. Pad isn't counted there, except that a time inside the playing sentence's padded start or end keeps that sentence.
- With a pad, one sentence's end can reach into the next one's start. Continue then plays on from where the first sentence stopped, so the overlap isn't heard twice.
- No sentence starts before 0 or ends after the video. One shifted past either end keeps its last 0.1 s there.
- Offsets are saved per lesson. A lesson set back to no shift and no pad is removed from storage, and only the 200 most recently changed lessons are kept.

## Focus Mode

Focus Mode fills the browser window with the video, LingQ's sentence, and the companion's controls, like LingQ's iPad and iPhone players. Click **Focus** in the footer to enter it. Click **Exit Focus** at the top right, or press `Escape`, to leave it. Leaving puts the page back exactly as it was. Focus Mode isn't saved: a reload starts in the normal layout.

- **Wide windows** (1024px and wider) split in two. The video and the controls are on the left. LingQ's sentence, in larger type, and the Neighbor Sentences are on the right. A slim bar at the top shows the sentence's number, the lesson's title, and Exit Focus.
- **Split-screen windows** (narrower than 1024px) stack the video, the controls, the sentence, and the Neighbor Sentences.
- **The controls** are Previous, Replay, Play or Pause, and Next, then the speed, the Playback Mode, and Settings. They do what `P`, `R`, `Space`, and `N` do.
- **Speed** cycles 1x, 0.75x, and 0.5x, and shows the current rate. A rate chosen in YouTube's own menu shows there too, and the next click returns to 1x. The rate lasts for the page, even when the player reloads, but isn't saved.
- **Word study** works as usual, because the sentence and the word panel are LingQ's own. A word you select opens LingQ's word panel in the Neighbor Sentences' place, under the sentence. Neither the sentence nor the video moves. In wide windows it's LingQ's docked panel, and in split screen it's LingQ's floating card, docked in the same place.
- **Escape** first puts an open word panel away, then leaves Focus Mode. In split screen it closes LingQ's word card with the card's own close button. In wide windows LingQ's panel has no close button, so Focus Mode shows the Neighbor Sentences again until you select another word. Either way the word stays selected, as it does in LingQ, so a Vocabulary Hold still waits for you to click off the sentence. No `Escape` in Focus Mode reaches LingQ, which would close the video. That includes one typed in a field and a held key's repeats. While one of LingQ's own dialogs covers Focus Mode, `Escape` does nothing. Close the dialog with its own button. After `Escape` closes the Playback Mode menu or the settings panel, the next `Escape` leaves Focus Mode as usual.
- **Double clicks** on Focus or Exit Focus act once. The second click never reaches what moved under the pointer, such as LingQ's word panel or its header.
- **Short windows** shrink the video first, so the video, the sentence, and the controls stay in view together. The video never gets shorter than 9rem (144px). In wide windows the video shrinks with the window's height, and below 24.5rem (392px) tall the page scrolls. In split screen the video leaves 26rem (416px) under the controls for the sentence and what follows it. The word panel's space keeps at least 10rem (160px), so a window shorter than the video, the controls, the sentence, and that space scrolls. That's about 600px for a three-line sentence. The video, the controls, and the sentence stay at the top.

Every Playback Mode and setting works the same in Focus Mode. LingQ's header, side arrows, and its own footer items are hidden there, and so is LingQ's list of the sentence's saved words under *Show Translation*.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play/pause |
| `N` | Go to the next sentence |
| `P` | Go to the previous sentence |
| `R` | Replay the current sentence once (also the **Replay** button) |

Shortcuts are ignored for modified or repeated key presses and while an editable control owns focus. `N`, `P`, and `R` are also ignored while a button, link, or other interactive control owns focus. Clicking a companion button or menu option with the mouse returns focus to the page, so the letter keys keep working. `Space` still plays or pauses the video from a focused button or link, because LingQ would otherwise play its own lesson audio. Inside the open Playback Mode menu and the settings panel, `N`, `P`, `R`, and `Space` never trigger shortcuts. `Space` chooses the focused option or presses the focused button, and the menu keeps its navigation keys from LingQ. On the Playback Mode button itself, `Escape` and `Space` never reach LingQ.

Outside Focus Mode, `Escape` anywhere else on the page closes the video, as it does in LingQ without the extension. Click LingQ's YouTube button to open the video again. In Focus Mode, `Escape` puts a word panel away and then leaves Focus Mode instead.

## Vocabulary study

Selecting a word or phrase doesn't pause the video. If the selection is still open when the sentence ends, the video pauses there and holds. Click off the sentence to end the selection, and the Playback Mode reacts: Continue plays the next sentence, Repeat replays it, and Pause stays paused. A selection that ends before the sentence does changes nothing, and one made while the video is paused never starts it. Play, `N`, `P`, and Replay end the hold and act at once; in Continue, Play moves on to the next sentence if there is one. With a Boundary Delay, the hold comes first and the delay starts when the selection ends. While LingQ reads a word aloud, the video plays at 30% of its volume.

## Install

### Persistent local install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this repository directory.

### Ephemeral Aside Browser test install

Aside can load the unpacked extension over browser-level CDP:

```js
await attachActiveBrowserTab();
const loaded = await page.cdp.send('Extensions.loadUnpacked', {
  path: '/Users/logan/programming/lingq-video-playback-chrome-extension'
});
console.log(loaded);
console.log(await page.cdp.send('Extensions.getExtensions'));
```

Reload an already-open LingQ lesson after loading. CDP-loaded extensions are intentionally not restored after the browser restarts.

## Development

No build step or third-party runtime packages are required.

```bash
npm test
npm run check
```

After editing source files, reload the extension from `chrome://extensions` (or uninstall/reload it through CDP), then reload the LingQ lesson.

## Scope and maintenance

Supported scope is deliberately narrow:

- `www.lingq.com` reader pages
- Sentence View
- YouTube-backed lessons

LingQ has no public reader playback API. The selectors used by `src/content.js` may need updates after a LingQ redesign. The extension watches the documented YouTube player time while a Sentence is playing so it can stop at the exact Sentence Boundary without reloading the video. Moving LingQ's video on the page reloads it. To tell when the reloaded video is ready and to get its state changes again, the extension reads and sends the undocumented messages that YouTube's player and embed exchange. If YouTube changes them, the extension falls back to the documented player methods, and the video may stop reporting state changes after a switch to Page View and back.

See [`PLAN.md`](PLAN.md) for the implementation decisions and acceptance checks.
