# LingQ Sentence Playback Companion

A private Chrome Manifest V3 extension that keeps LingQ's vocabulary and phrase workflow intact while adding Migaku-style sentence playback behavior to YouTube lessons.

## What it does

On a supported YouTube-backed LingQ lesson in **Sentence View**, the extension:

- presents LingQ's full-video iframe as the visible 16:9 player;
- seeks to the active Sentence's exact timestamp and pauses there;
- keeps LingQ's real interactive Sentence and translation controls beneath it;
- plays adjacent Sentences immediately through LingQ's native Previous and Next controls.

The extension drives only the visible player through the documented YouTube IFrame Player API. It does not use LingQ's hidden Sentence player or replace LingQ's reader and vocabulary UI.

## Footer controls

The extension adds two items to LingQ's footer, styled like LingQ's own *Page View* and *Review Sentence*:

- **Replay** replays the current sentence once (Replay Now).
- **Playback Mode** shows what happens at the end of each sentence: *Pause at end*, *Continue at end*, or *Repeat at end*. Click it, or focus it and press `Enter` or an arrow key, to open its menu. In the menu, the arrow keys, `Home`, and `End` move, `Enter` or `Space` chooses, and `Escape` closes. The menu also lists the keyboard shortcuts. The choice is saved across reloads.

A short status appears beside the controls only while the video loads or when it needs you, for example to press Play. Screen readers still hear "Video ready."

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play/pause |
| `N` | Go to the next sentence |
| `P` | Go to the previous sentence |
| `R` | Replay the current sentence once (also the **Replay** button) |

Shortcuts are ignored for modified or repeated key presses and while an editable control owns focus. `N`, `P`, and `R` are also ignored while a button, link, or other interactive control owns focus. Clicking a companion button or menu option with the mouse returns focus to the page, so the letter keys keep working. `Space` still plays or pauses the video from a focused button or link, because LingQ would otherwise play its own lesson audio. Inside the open Playback Mode menu, every key belongs to the menu, so `Space` chooses the focused option.

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

LingQ has no public reader playback API. The selectors used by `src/content.js` may need updates after a LingQ redesign. The extension watches the documented YouTube player time while a Sentence is playing so it can stop at the exact Sentence Boundary without reloading the video.

See [`PLAN.md`](PLAN.md) for the implementation decisions and acceptance checks.
