---
name: LingQ Sentence Playback Companion
description: A quiet video-first control layer for LingQ Sentence View
colors:
  playback-violet: "#5c5ce0"
  playback-violet-dark: "#8f8ff0"
  hover-tint: "rgb(127 127 127 / 10%)"
  divider: "currentColor at 12% opacity"
  menu-surface: "Canvas"
  menu-text: "CanvasText"
  menu-surface-dark: "#2d3238"
  menu-text-dark: "#e8eaed"
  focus-ring: "Highlight"
typography:
  footer-label:
    fontFamily: "inherit"
    fontSize: "0.875rem (0.65rem below 850px, as LingQ)"
    fontWeight: 400
  menu-name:
    fontFamily: "inherit"
    fontSize: "0.875rem"
    fontWeight: 600
  caption:
    fontFamily: "inherit"
    fontSize: "0.75rem"
    fontWeight: 400
rounded:
  item: "8px"
  menu: "12px"
  kbd: "4px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  player-gap: "24px"
elevation:
  menu: "0 8px 28px rgb(9 26 47 / 18%), 0 0 0 1px rgb(127 127 127 / 18%)"
  menu-dark: "0 8px 28px rgb(0 0 0 / 45%), 0 0 0 1px rgb(255 255 255 / 8%)"
components:
  footer-item:
    backgroundColor: "transparent"
    textColor: "inherit"
    rounded: "{rounded.item}"
    padding: "6px 12px"
    minWidth: "64px"
    minHeight: "44px"
    icon: "22px line icon, 1.3 stroke, currentColor"
  playback-mode-menu:
    backgroundColor: "{colors.menu-surface}"
    textColor: "{colors.menu-text}"
    rounded: "{rounded.menu}"
    padding: "6px"
    width: "20rem"
    shadow: "{elevation.menu}"
  playback-mode-option-selected:
    backgroundColor: "{colors.playback-violet} at 12%"
    checkColor: "{colors.playback-violet}"
    rounded: "{rounded.item}"
    minHeight: "44px"
---

# Design System: LingQ Sentence Playback Companion

## Overview

**Creative North Star: "Quiet Instrument Panel"**

The companion is restrained and precise: a compact set of controls that supports the lesson without competing with LingQ's sentence, vocabulary workflow, or YouTube player. It inherits the host page's typography and text color, adds one violet selected state, and uses literal product language.

The system is intentionally narrow rather than a standalone brand world. Its visual authority comes from the live LingQ surface, browser-native system colors, and accessible interaction states.

**Key Characteristics:**

- Video-first composition with the real LingQ sentence directly below.
- Footer items that look like LingQ's own: a line icon over a label, no box, LingQ's type.
- One menu for the Playback Mode, with the shortcuts at its foot.
- A single Playback Violet accent, used only for the selected Playback Mode in the menu.
- Responsive reflow for narrow and short desktop windows.

## Colors

The palette inherits the host page and adds only the colors required to communicate extension-owned state.

### Primary

- **Playback Violet** (`#5c5ce0`, `#8f8ff0` in dark): the check and row tint that mark the selected Playback Mode in the menu. The dark tint keeps the check above 3:1 against the dark menu surface.

### Neutral

- **Hover Tint** (`rgb(127 127 127 / 10%)`): theme-agnostic hover and open-menu background for footer items and menu options.
- **Divider** (`currentColor` at 12%): the hairline between Replay and the Playback Mode button.
- **Menu Surface / Text** (`Canvas` / `CanvasText`; `#2d3238` / `#e8eaed` in dark): the menu's paired colors. The text is never inherited, so a LingQ reader theme cannot leave light text on a light surface.
- **Focus Ring** (`Highlight`): system-aware keyboard focus.

### Theme

LingQ marks its dark theme with `theme-luminosity-dark` on `body`. It keeps `is-light-theme` set in dark, so never key on that class. The companion's colors are custom properties on `.lspc-controls`, redefined under `.theme-luminosity-dark`.

**The One Accent Rule.** Playback Violet marks the selected Playback Mode inside the menu and nothing else. Footer items stay neutral like LingQ's own, and violet never spreads into LingQ-owned content or decoration.

## Typography

**Body Font:** inherited from LingQ (DM Sans)
**Label Font:** inherited from LingQ

**Character:** The companion follows the host page's type voice. Weight and compact sizing create hierarchy without introducing a competing font system.

### Hierarchy

- **Footer label** (400, `0.875rem` on a 21px line): Replay and the Playback Mode button, matching LingQ's *Page View* and *Review Sentence*. Below 850px wide it drops to `0.65rem`, as LingQ's labels do.
- **Menu option name** (600, `0.875rem`).
- **Caption** (400–600, `0.75rem`): the menu heading, option descriptions, the shortcuts line, and the readiness status.

## Layout

The 16:9 player is centered and sized from both reader width and available viewport height. The real LingQ sentence remains centered below it. The companion's footer items sit after LingQ's `section--last` and match its two equal rows for icon and label, so icons and label baselines line up with *Review Sentence*. Below LingQ's own 640px breakpoint, where its footer narrows to 480px, the companion takes a row above LingQ's footer controls. The reader's grid row and LingQ's sentence area both give back that row's 3.5rem, so nothing overlaps. Short windows reduce the player's floor at `41.25rem` viewport height so the complete study loop remains usable.

Spacing uses a 4px item gap, a 24px player-to-sentence gap, and an 8px gap between the menu and its button.

## Elevation & Depth

Footer items are flat: transparent at rest, with a tonal hover. The Playback Mode menu is the one elevated surface. It floats over the reader, so it carries a soft shadow plus a 1px hairline ring that keeps its edge crisp in dark.

**The Flat-by-Default Rule.** Do not add shadows, borders, or blur to in-flow controls. Only a temporary surface that overlaps other content, such as the Playback Mode menu, is elevated.

## Shapes

Footer items and menu options use an 8px radius, the menu 12px, and shortcut key chips 4px. Rounded geometry stays modest and functional rather than pill-like.

## Components

### Replay

- **Button:** a footer item with a replay icon over "Replay". Its accessible name is "Replay Now", and it carries `aria-keyshortcuts="R"`.

### Playback Mode Button

- **Button:** a footer item whose icon and label show the current Playback Mode: "Pause at end", "Continue at end", or "Repeat at end", with a small chevron. The labels share one grid cell, so the button keeps the widest label's width and does not shift the footer when the mode changes.
- **Divider:** a 32px hairline separates it from Replay.
- **Semantics:** a menu button with `aria-haspopup="menu"`, `aria-expanded`, and an accessible name of "Playback Mode: <label>".

### Playback Mode Menu

- **Popover:** opens 8px above the button and aligns to its right edge, so it never overflows the viewport's right side. It fades and rises 4px over 120ms, with no motion under `prefers-reduced-motion`.
- **Heading:** "At the end of each sentence", a caption that labels the menu.
- **Options:** Pause, Continue, and Repeat as `menuitemradio`s, each with an icon, a bold name, a one-line description, and a check on the current one.
- **Shortcuts line:** the page shortcuts as key chips under a hairline. It replaces the separate help button.
- **Keyboard:** the arrow keys move with wrap-around, Home and End jump, Enter or Space chooses, Escape closes, and Tab closes and moves on. Choosing from the keyboard returns focus to the button. Choosing with the mouse returns focus to the page, so the letter shortcuts keep working.

### Readiness Status

- **Style:** inherited color, `0.75rem`, reduced emphasis, right-aligned beside Replay. Below 640px it shares the companion's row.
- **Copy:** one concise state or recovery action, announced through a polite atomic live region.
- **Visibility:** it shows only when the reader must wait or act: loading, press Play, failed, or unsupported. "Video ready." stays in the live region, visually hidden, so readiness is still announced without permanent footer text.

## Do's and Don'ts

### Do:

- **Do** inherit LingQ typography, text color, and theme behavior.
- **Do** reserve Playback Violet for the selected Playback Mode.
- **Do** keep interactive targets at least 44px and preserve visible focus.
- **Do** validate normal, narrow, and short desktop compositions, light and dark, on the live reader.

### Don't:

- **Don't** replace, cover, or restyle LingQ-owned sentence, vocabulary, translation, sidebar, reader, or YouTube controls.
- **Don't** add cards, decorative shadows, gradients, new fonts, or extra accent colors.
- **Don't** turn compact status or help into permanent footer clutter.
