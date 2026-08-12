# Full-player sentence segments prototype

Issue: [#6 — Define the implementation and verification contract](https://github.com/loganprit/lingq-video-playback-chrome-extension/issues/6)

Question: Can LingQ's existing visible full-video iframe be the sole player for exact sentence-bounded playback and arbitrary sentence navigation?

## Verdict

Yes. A live logged-in Aside probe used LingQ's own sentence timestamps and the documented `YT.Player` API against the visible iframe. No repository implementation was loaded as evidence.

## Evidence

- Active sentence `s5` mapped to API timestamp `[4.27, 7.13]`.
- `loadVideoById({ videoId, startSeconds: 4.27, endSeconds: 7.13 })` entered `PLAYING` at `4.30` and emitted `ENDED` at `7.14`.
- Reloading the same bounds repeated the sentence and emitted `ENDED` again at `7.14`.
- LingQ's native next control changed `s5` to `s6`; the visible iframe remained `widget10`.
- Loading sentence 6 bounds `[7.23, 10.33]` entered `PLAYING` at `7.28` and emitted `ENDED` at `10.33`.
- After each bounded `ENDED`, LingQ reset the full player to paused at time `0`. The bridge must handle the first bounded `ENDED` once and ignore the later reset.
- Clicking LingQ's existing lesson progress bar made one native jump from `s6` to `s105`; the visible iframe again remained `widget10`. Production should target the exact sentence mark rather than reproduce the probe's approximate coordinate calculation.

## Consequence

Use the full-video iframe as the only playback engine. Fetch LingQ's same-origin sentence list, load bounded segments through `YT.Player`, use native previous/next controls for adjacent movement, and use LingQ's progress marks for arbitrary seek-to-sentence synchronization. Do not coordinate with the hidden sentence iframe.
