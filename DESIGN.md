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
- One menu for the Playback Mode, with the shortcuts at its foot, and one settings panel beside it.
- A single Playback Violet accent, used only for the selected choice in the menu and the settings panel.
- Compact icon-only items for narrow footers, and a smaller player floor for short windows.
- Focus Mode: a second layout that fills the window, built from LingQ's own reader with CSS.

## Colors

The palette inherits the host page and adds only the colors required to communicate extension-owned state.

### Primary

- **Playback Violet** (`#5c5ce0`, `#8f8ff0` in dark): the check and row tint that mark the selected Playback Mode in the menu and the selected choice in the settings panel. The dark tint keeps the check above 3:1 against the dark menu surface.

### Neutral

- **Hover Tint** (`rgb(127 127 127 / 10%)`): theme-agnostic hover and open-menu background for footer items and menu options.
- **Divider** (`currentColor` at 12%): the hairline between Replay and the Playback Mode button.
- **Menu Surface / Text** (`Canvas` / `CanvasText`; `#2d3238` / `#e8eaed` in dark): the menu's paired colors. The text is never inherited, so a LingQ reader theme cannot leave light text on a light surface.
- **Focus Ring** (`Highlight`): system-aware keyboard focus.

### Theme

LingQ marks its dark theme with `theme-luminosity-dark` on `body`. It keeps `is-light-theme` set in dark, so never key on that class. The companion's colors are custom properties on `.lspc-controls`, redefined under `.theme-luminosity-dark`, which also sets `color-scheme: dark` so the panel's seconds list opens dark.

**The One Accent Rule.** Playback Violet marks the selected choice inside the menu or the settings panel and nothing else. Footer items stay neutral like LingQ's own, and violet never spreads into LingQ-owned content or decoration.

## Typography

**Body Font:** inherited from LingQ (DM Sans)
**Label Font:** inherited from LingQ

**Character:** The companion follows the host page's type voice. Weight and compact sizing create hierarchy without introducing a competing font system.

### Hierarchy

- **Footer label** (400, `0.875rem` on a 21px line): Replay and the Playback Mode button, matching LingQ's *Page View* and *Review Sentence*. Below 850px wide it drops to `0.65rem`, as LingQ's labels do.
- **Menu option name** (600, `0.875rem`).
- **Caption** (400–600, `0.75rem`): the menu and panel headings, option descriptions, the shortcuts line, and the readiness status.

## Layout

The 16:9 player is centered and sized from both reader width and available viewport height. The real LingQ sentence remains centered below it. The companion's footer items sit after LingQ's `section--last` and match its two equal rows for icon and label, so icons and label baselines line up with *Review Sentence*. The companion always stays in LingQ's single footer row. LingQ's footer container is the size container: where its content box is under `37rem` (LingQ's 480px footer below a 640px viewport, or a 600px footer beside the word panel at about 1024px), the items drop their labels and keep 44px icon targets. Their accessible names are unchanged. Short windows reduce the player's floor at `41.25rem` viewport height so the complete study loop remains usable. With Neighbor Sentences, `core.neighborVideoHeight` sets the player's height through `--lspc-video-height`: the short layout's height at `41.25rem` or less, and above it the larger of `100dvh - 28rem` (4rem less than without neighbors) and `21.25rem`, the short layout's height at its top. So a taller window never has a smaller player, and up to `49.25rem` (788px) the player holds 340px while neighbors take only the height left. They sit in their own grid row between the sentence and LingQ's translation, which keeps at least 40px. Only the leading neighbors that fit show, so the player, sentence, and footer never move.

### Focus Mode

Focus Mode restyles LingQ's reader to fill the window (`position: fixed`, above LingQ's sticky header) on its own background color, `--readerGlobalBackground`. LingQ's own modals still open above it. The four LingQ containers between the reader and its video and sentence get `display: contents`, so the reader's grid places LingQ's parts directly and nothing moves in the DOM. `core.focusLayout` sizes the video from the window and sets the reader's `--lspc-focus-video-width` and `--lspc-focus-video-height`.

- **Split** (1024px and wider, where LingQ docks its word panel): a 5rem bar row over two columns. The left column is the video's width, 2rem from the window's edge, with the controls 1.5rem under it. The right column, 3.5rem away, takes the rest: at least 24rem, and 36% of the window up to 40rem while the video is width-bound. It holds the sentence at 1.5em with a 1.7 line height, start-aligned, then *Show Translation*, then the Neighbor Sentences or LingQ's word panel filling the rest.
- **Stack** (narrower): one centered column up to 48rem wide, with 1.5rem margins. The bar, the video, the controls 1rem under it, then the sentence at 1.15em, *Show Translation*, and the Neighbor Sentences or the word panel in at least 10rem.
- **Video:** 16:9, as large as its column allows. Split, it leaves 10.5rem under the bar for the controls and margins. Stacked, it leaves 31rem for the controls, the sentence, and the panel. Never shorter than 9rem; a window too short for that scrolls.
- **Word panel:** LingQ's docked panel fills the space below *Show Translation*, with its own middle section scrolling between the word and its status buttons. LingQ's floating card docks in the same place at full width, positioned relative so its close button stays on it. Either one hides the Neighbor Sentences with `visibility`, so they keep their fit.
- **Hidden in Focus Mode:** LingQ's header (kept at zero height but laid out, since seek sync presses its progress marks, and 8000px wide inside the clip so each mark gets whole pixels), its side arrows, its footer items, and the sentence's saved-word list.

Spacing uses a 4px item gap, a 24px player-to-sentence gap, and an 8px gap between the menu and its button.

## Elevation & Depth

Footer items are flat: transparent at rest, with a tonal hover. The Playback Mode menu, the settings panel, and the visible readiness status are the elevated surfaces. All three float over the reader, so they carry a soft shadow plus a 1px hairline ring that keeps their edges crisp in dark.

**The Flat-by-Default Rule.** Do not add shadows, borders, or blur to in-flow controls. Only a temporary surface that overlaps other content, such as the Playback Mode menu or a visible status, is elevated.

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
- **Shortcuts line:** the page shortcuts as key chips under a hairline: Space, P and N, R, and W for the next new word. Each shortcut keeps its keys and action together, 12px apart with no separator, and the line wraps only between shortcuts. It replaces the separate help button.
- **Keyboard:** the arrow keys move with wrap-around, Home and End jump, Enter or Space chooses, Escape closes, and Tab closes and moves on. Choosing from the keyboard returns focus to the button. Choosing with the mouse returns focus to the page, so the letter shortcuts keep working.

### Boundary Delay Countdown

- **Where:** while a Boundary Delay runs, the Playback Mode button's icon becomes a ring that empties as the wait runs out (drawn from the wait's own start and end, so a remounted footer picks up mid-wait), and its label reads "Next in 3 s" or "Repeat in 3 s". Both share the button's stacked grid cells, so the footer never moves. In the compact footer the ring remains and the hover caption carries the text.
- **Semantics:** the button's accessible name stays "Playback Mode: <label>".

### Focus Button

- **Button:** a footer item with four corner brackets over "Focus", after Settings, with the accessible name "Focus Mode". Focus Mode hides it. Pressing it from the keyboard moves focus to Exit Focus. A held `Enter` toggles once.
- **Double click:** entering can put LingQ's word panel, with its status buttons, under the pointer, and leaving puts LingQ's header under Exit Focus. So the rest of a double click on either, a press within 1 s and 8px, never reaches LingQ, as with a Neighbor Sentence. Each such press starts the second again, so a triple click or a run of clicks stays away to its last press.

### Focus Bar

- **Style:** a 3.5rem row across the top of Focus Mode. On the left, a `0.875rem` caption at 70% opacity: the sentence's number out of the lesson's count, then the lesson's title, cut off with an ellipsis. On the right, Exit Focus: inward corner brackets, "Exit Focus", and an `Esc` key chip, styled as a flat item with the hover tint.
- **Behavior:** Exit Focus and `Escape` leave Focus Mode. When Exit Focus had keyboard focus, leaving returns focus to the Focus button. Otherwise `Escape` leaves focus where it was, so the letter shortcuts keep working on the page.

### Focus Mode Controls

- **Rows:** split, the transport (Previous, Replay, Play or Pause, Next) sits centered over the options (Speed, the divider, Playback Mode, Settings). Stacked, they share one centered row. Transport items are icon-only 48px targets. The options keep their labels at `0.875rem` while LingQ's footer is at least 37rem wide. Narrower, as in a split window at 1024×768, where the footer is the video's 520px width, every item drops to its icon, as in the normal compact footer. Its hover caption then opens downward, away from YouTube's controls.
- **Play or Pause:** the one filled control, a 56px disc in the text color with the icon in the page's `Canvas` color, so it inverts with the theme. It isn't elevated, and it doesn't use Playback Violet.
- **Speed:** the rate ("1x", "0.75x", "0.5x", or YouTube's own rate) in semibold tabular figures over "Speed". Its accessible name is "Speed: 0.75x".
- **Popovers:** the Playback Mode menu and the settings panel still open upward, over the video while open, and scroll inside a height that stops short of the window's top. The readiness status stays off the video and the sentence: under the controls when split, and centered at the window's foot when stacked.

### Settings Button

- **Button:** a footer item with a sliders icon over "Settings", after the Playback Mode button. It opens the settings panel, with `aria-haspopup="dialog"` and `aria-expanded`. Escape and Space never reach LingQ from it.

### Settings Panel

- **Popover:** the menu's surface, radius, elevation, motion, and placement, aligned to the Settings button's right edge.
- **Boundary Delay:** a caption heading and a one-line description over three rows styled as menu options: Off, Fixed with a 1–10 s list, and Reading time. Each row wraps a native radio that stays focusable but unseen. The selected row takes the violet tint and check, and the focused row takes the focus ring.
- **Sentence Visibility:** the same section shape under a hairline: Always, Listen First, and Show on Pause.
- **Neighbor Sentences:** the same shape again: On and Off.
- **Timing Offset:** the same heading and description over two rows, Shift and Pad, in shared columns: the bold name, a 40px stepper pair (1px outline, 6px radius, a minus and a plus icon) around the value in semibold tabular figures ("+0.5 s", "0.10 s"), and a text Reset on the Shift row. A step that would change nothing stays focusable at 40% opacity. No violet: the value, not a selection, is the state. The panel scrolls if a short window can't fit every section.
- **Keyboard:** focus moves to the selected choice on open. The arrow keys choose among a section's radios, each section, the seconds list, and each Timing Offset button is its own Tab stop, and Escape closes and returns focus to the button. No key pressed in the panel reaches LingQ, so Escape never also closes a word card or the video, and Space never reads the lesson aloud.
- **Closing:** Escape, a click outside, or focus leaving the panel. Choosing keeps it open.

### Hidden Sentence

- **Style:** while Sentence Visibility hides it, LingQ's real sentence stays in place under `visibility: hidden`, so the layout never jumps. Its words can't be hovered, selected, or clicked. A `0.875rem` caption at 55% of the text color, "Click to show the sentence", sits at its center.
- **Reveal:** a click on the sentence's box shows it, and so does a LingQ word key (`←`, `→`, `b`, `Shift`+`Space`) or the companion's `W`, which then opens no word. A press or key that begins on the hidden text stays away from LingQ to its end, and so does every press in the half second after any reveal, so no word is selected or saved. The same keys held with `Alt`, `Ctrl`, or `Cmd` never reach LingQ either, but keep the browser's own action. Something LingQ floats over the sentence still gets its clicks. A sentence that holds a selection always shows.

### Neighbor Sentences

- **Style:** up to three native buttons, centered under the sentence, each one sentence's text at `0.875em` of the reader's size on a 1.6 line height, at 50% opacity. Hover and keyboard focus raise them to 75% on the hover tint, and focus adds the focus ring. No violet, no border, no card.
- **Behavior:** a click or `Enter` plays that sentence and returns focus to the page. Presses never select their text and never reach LingQ, and neither does a press that starts within 1 s and 8px of the click that played one (the rest of a double click), nor a held `Enter`'s repeats and release. They take the sentence's visibility, so they hide with it and keep their space.
- **Fit:** only the leading neighbors that fit show. An empty list leaves the grid, so it adds no gap.

### Readiness Status

- **Style:** a `0.75rem` caption on the menu surface, with the menu's elevation and an 8px radius. It sits 8px above the right end of LingQ's footer, out of the layout flow, so it never moves or wraps the footer controls. It ignores the pointer, so it never blocks what is beneath it.
- **Copy:** one concise state or recovery action, announced through a polite atomic live region.
- **Visibility:** it shows only when the reader must wait or act: loading, a play the browser refused (press Play), failed, or unsupported. The companion's own Pause at a Sentence Boundary is expected and shows nothing. "Video ready." stays in the live region, visually hidden, so readiness is still announced without permanent footer text.

## Do's and Don'ts

### Do:

- **Do** inherit LingQ typography, text color, and theme behavior.
- **Do** reserve Playback Violet for the selected choice in the menu and the settings panel.
- **Do** keep interactive targets at least 44px and preserve visible focus.
- **Do** validate normal, narrow, and short desktop compositions, light and dark, on the live reader.

### Don't:

- **Don't** replace, cover, or restyle LingQ-owned sentence, vocabulary, translation, sidebar, reader, or YouTube controls. Two exceptions: Sentence Visibility hides the real sentence in place and adds only its caption, and Focus Mode, while it's on, lays out LingQ's own reader and enlarges its sentence. Leaving Focus Mode restores both exactly.
- **Don't** add cards, decorative shadows, gradients, new fonts, or extra accent colors.
- **Don't** turn compact status or help into permanent footer clutter.
