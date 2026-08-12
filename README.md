# LingQ Sentence Playback Companion

A private Chrome Manifest V3 extension that keeps LingQ's vocabulary and phrase workflow intact while adding Migaku-style sentence playback behavior to YouTube lessons.

## What it does

On a supported YouTube-backed LingQ lesson in **Sentence View**, the extension:

- presents LingQ's full-video iframe as the visible 16:9 player;
- cues the active Sentence's exact timestamp bounds paused;
- keeps LingQ's real interactive Sentence and translation controls beneath it;
- plays adjacent Sentences immediately through LingQ's native Previous and Next controls.

The extension drives only the visible player through the documented YouTube IFrame Player API. It does not use LingQ's hidden Sentence player or replace LingQ's reader and vocabulary UI.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play/pause |
| `N` | Go to the next sentence |
| `R` | Replay the current sentence once |

Shortcuts are ignored for modified or repeated key presses and while an editable or interactive control owns focus.

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

LingQ has no public reader playback API. The selectors used by `src/content.js` may need updates after a LingQ redesign. The YouTube boundary signal uses the iframe API's state messages and is expected to be more stable.

See [`PLAN.md`](PLAN.md) for the implementation decisions and acceptance checks.
