---
name: LingQ Sentence Playback Companion
description: A quiet video-first control layer for LingQ Sentence View
colors:
  playback-violet: "#5c5ce0"
  selected-text: "#ffffff"
  tonal-surface: "rgb(127 127 127 / 12%)"
  tooltip-surface: "CanvasText"
  tooltip-text: "Canvas"
  focus-ring: "Highlight"
typography:
  label:
    fontFamily: "inherit"
    fontSize: "0.75rem"
    fontWeight: 600
rounded:
  group: "10px"
  control: "7px"
  round: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  player-gap: "24px"
components:
  playback-mode:
    backgroundColor: "transparent"
    textColor: "inherit"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "44px"
  playback-mode-selected:
    backgroundColor: "{colors.playback-violet}"
    textColor: "{colors.selected-text}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "44px"
---

# Design System: LingQ Sentence Playback Companion

## Overview

**Creative North Star: "Quiet Instrument Panel"**

The companion is restrained and precise: a compact set of controls that supports the lesson without competing with LingQ's sentence, vocabulary workflow, or YouTube player. It inherits the host page's typography and text color, adds one violet selected state, and uses literal product language.

The system is intentionally narrow rather than a standalone brand world. Its visual authority comes from the live LingQ surface, browser-native system colors, and accessible interaction states.

**Key Characteristics:**

- Video-first composition with the real LingQ sentence directly below.
- Compact, native, explicit controls with 44px minimum targets.
- Neutral tonal grouping and a single Playback Violet state accent.
- Responsive reflow for narrow and short desktop windows.

## Colors

The palette inherits the host page and adds only the colors required to communicate extension-owned state.

### Primary

- **Playback Violet** (`#5c5ce0`): selected Playback Mode only.

### Neutral

- **Tonal Surface** (`rgb(127 127 127 / 12%)`): theme-agnostic mode-group background.
- **Tooltip Surface / Text** (`CanvasText` / `Canvas`): system-aware inverse tooltip colors.
- **Focus Ring** (`Highlight`): system-aware keyboard focus.

**The One Accent Rule.** Playback Violet communicates selected extension state; do not spread it into LingQ-owned content or decoration.

## Typography

**Body Font:** inherited from LingQ
**Label Font:** inherited from LingQ

**Character:** The companion follows the host page's type voice. Weight and compact sizing create hierarchy without introducing a competing font system.

### Hierarchy

- **Control** (600, inherited size): mode actions.
- **Label** (600, `0.75rem`): group context.
- **Status / Tooltip** (500–inherited, `0.75rem`): concise readiness, recovery, and shortcut guidance.

## Layout

The 16:9 player is centered and sized from both reader width and available viewport height. The real LingQ sentence remains centered below it. The mode group sits in LingQ's footer, wraps as one compact unit, and moves above native footer controls when the reader container is at most `44rem`. Short windows reduce the player's floor at `41.25rem` viewport height so the complete study loop remains usable.

Spacing uses a compact 6px control gap, 6px group padding, and a 24px player-to-sentence gap. The desktop footer keeps a 4.75rem minimum height so the control cluster has breathing room against the viewport edge.

## Elevation & Depth

The system is flat and tonal. It uses transparent neutral fill and state contrast instead of decorative shadows. The tooltip is a temporary system-colored overlay because it must sit above the footer; no other extension-owned surface is elevated.

**The Flat-by-Default Rule.** Do not add shadows, borders, or blur when tonal contrast and state color already communicate structure.

## Shapes

The mode group uses a 10px radius; rectangular controls and tooltips use 7px. The shortcut-help button is circular because it is a single-symbol compact action. Rounded geometry remains modest and functional rather than pill-like.

## Components

### Playback Mode Group

- **Container:** flexible, wrapping tonal surface with 6px padding and gap.
- **Label:** “At next Sentence Boundary,” shown as compact context rather than a heading.
- **Buttons:** native buttons with at least `44px` width and height, transparent at rest, Playback Violet when selected.
- **Focus:** 2px system Highlight outline with 2px offset.

### Shortcut Help

- **Button:** circular 44px target with an accessible “Keyboard shortcuts” label.
- **Tooltip:** compact inverse system surface, visible on hover and keyboard focus, with a 120ms opacity and translation transition.

### Readiness Status

- **Style:** inherited color, `0.75rem`, reduced emphasis.
- **Copy:** one concise state or recovery action, announced through a polite atomic live region.

## Do's and Don'ts

### Do:

- **Do** inherit LingQ typography, text color, and theme behavior.
- **Do** reserve Playback Violet for selected extension state.
- **Do** keep interactive targets at least 44px and preserve visible focus.
- **Do** validate normal, narrow, and short desktop compositions on the live reader.

### Don't:

- **Don't** replace, cover, or restyle LingQ-owned sentence, vocabulary, translation, sidebar, reader, or YouTube controls.
- **Don't** add cards, decorative shadows, gradients, new fonts, or extra accent colors.
- **Don't** turn compact status or help into permanent footer clutter.
