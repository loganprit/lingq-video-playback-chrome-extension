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

The extension adds three items to LingQ's footer, styled like LingQ's own *Page View* and *Review Sentence*:

- **Replay** replays the current sentence once (Replay Now).
- **Playback Mode** shows what happens at the end of each sentence: *Pause at end*, *Continue at end*, or *Repeat at end*. Click it, or focus it and press `Enter` or an arrow key, to open its menu. In the menu, the arrow keys, `Home`, and `End` move, `Enter` or `Space` chooses, and `Escape` closes. The menu also lists the keyboard shortcuts. The choice is saved across reloads.
- **Settings** opens the companion's settings panel: the Boundary Delay, then Sentence Visibility. Focus starts on the chosen delay. The arrow keys choose, `Tab` moves from the delay to the seconds list to Sentence Visibility, and `Escape` or a click outside closes the panel. Keys pressed in the panel never reach LingQ, so `Escape` there doesn't also close a word card or the video.

The Playback Mode and the settings are saved together in one record. An older install's saved Playback Mode carries over once.

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
- **Show on Pause** shows it only while the video is paused. That includes Pause at end, a Vocabulary Hold, a Boundary Delay's wait, and a play the browser left paused. A sentence end that moves straight on, or a sentence the companion is about to play, doesn't count, so the next sentence's text never flashes.

If the video fails, the sentence shows under every choice.

The hidden sentence keeps its place, so nothing below it moves. Its words can't be seen, hovered, or clicked. To show it for the rest of that sentence, click where it sits, or press one of LingQ's word keys: `←`, `→`, `b`, or `Shift`+`Space`. That click or key never reaches LingQ, so it never selects a word or creates a LingQ. Neither does a press that began on the hidden text, or any press in the half second after the text shows, so a click already on its way can't land on a word. LingQ's translation and its list of the sentence's saved words stay as LingQ shows them.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play/pause |
| `N` | Go to the next sentence |
| `P` | Go to the previous sentence |
| `R` | Replay the current sentence once (also the **Replay** button) |

Shortcuts are ignored for modified or repeated key presses and while an editable control owns focus. `N`, `P`, and `R` are also ignored while a button, link, or other interactive control owns focus. Clicking a companion button or menu option with the mouse returns focus to the page, so the letter keys keep working. `Space` still plays or pauses the video from a focused button or link, because LingQ would otherwise play its own lesson audio. Inside the open Playback Mode menu, `N`, `P`, `R`, and `Space` never trigger shortcuts. `Space` chooses the focused option, and the menu keeps its navigation keys from LingQ. On the Playback Mode button itself, `Escape` and `Space` never reach LingQ.

Anywhere else on the page, `Escape` closes the video, as it does in LingQ without the extension. Click LingQ's YouTube button to open the video again.

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
