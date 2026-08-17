# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Logan uses the private extension in desktop Chrome while studying YouTube-backed Spanish lessons in LingQ Sentence View.

## Product Purpose

The companion makes LingQ's existing sentence study workflow video-first: it presents the lesson's visible YouTube player above the real interactive sentence and provides predictable sentence-bounded playback. Success means Logan can watch, listen, repeat, continue, navigate, seek, and study vocabulary without losing LingQ's native learning interface.

## Positioning

The extension improves LingQ's own Sentence View rather than replacing it. It coordinates LingQ's sentence timestamps and native navigation with the documented YouTube IFrame Player API while leaving LingQ's vocabulary, translation, sidebar, reader controls, and sentence DOM intact.

## Operating Context

- Installed unpacked in Logan's logged-in desktop browser.
- Used on YouTube-backed LingQ lessons in Sentence View.
- Evaluated on the live LingQ surface, including normal desktop and narrow or short split-screen layouts.

## Capabilities and Constraints

- Pause, Continue, and Repeat are Playback Modes applied at the next Sentence Boundary; Replay Now is a one-time action.
- The visible LingQ YouTube iframe is the only playback engine.
- The extension fails closed outside eligible YouTube-backed Sentence View contexts.
- Extension-owned UI must not obscure or replace LingQ or YouTube controls.
- Mobile browsers, non-YouTube lessons, publication, telemetry, accounts, and remote configuration are out of scope.

## Brand Commitments

The companion is visually subordinate to LingQ. Its language is compact, literal, and uses the established domain terms Sentence View, Sentence Boundary, Playback Mode, Pause, Continue, Repeat, and Replay Now.

## Evidence on Hand

- GitHub issue #7 is the approved product specification.
- GitHub issues #8 through #17 record implemented vertical slices and live acceptance evidence.
- The repository's Node test suite covers the deterministic public core.
- Final acceptance uses Logan's logged-in Aside Browser on the real LingQ reader.

## Product Principles

- Preserve the real learning surface.
- Make sentence playback explicit and predictable.
- Fail closed when the live page is unsupported or uncertain.
- Prove behavior on the logged-in LingQ surface, not from local checks alone.
- Keep extension-owned UI compact and accessible.

## Accessibility & Inclusion

Playback controls use native buttons, visible focus, accessible selected-state semantics, keyboard-operable help, and status announcements. Page shortcuts must not hijack editable controls or YouTube iframe interaction.
