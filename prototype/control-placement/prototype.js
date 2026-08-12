// Three control-placement variants on LingQ's existing reader, switchable via ?lspc-variant=A|B|C.
(() => {
  "use strict";

  if (document.querySelector("#lspc-placement-prototype")) return;

  const variants = ["A", "B", "C"];
  const names = {
    A: "Footer companion",
    B: "Sentence companion",
    C: "Compact popover",
  };
  let mode = "Pause";

  const root = document.createElement("div");
  root.id = "lspc-placement-prototype";
  document.body.append(root);

  const variantFromUrl = () => {
    const value = new URL(location.href).searchParams.get("lspc-variant");
    return variants.includes(value) ? value : "A";
  };

  const setVariant = (variant) => {
    const url = new URL(location.href);
    url.searchParams.set("lspc-variant", variant);
    location.assign(url.href);
  };

  const cycle = (offset) => {
    const index = variants.indexOf(variantFromUrl());
    setVariant(variants[(index + offset + variants.length) % variants.length]);
  };

  const modeButtons = (className = "") => `
    <div class="lspc-modes ${className}" role="group" aria-label="Playback mode">
      ${["Pause", "Continue", "Repeat"]
        .map(
          (label) => `
            <button type="button" data-mode="${label}" aria-pressed="${mode === label}">
              ${label}
            </button>`,
        )
        .join("")}
    </div>`;

  const variantMarkup = (variant) => {
    if (variant === "A") {
      return `
        <section class="lspc-variant lspc-footer" aria-label="Sentence playback">
          <span class="lspc-label">After sentence</span>
          ${modeButtons()}
        </section>`;
    }

    if (variant === "B") {
      return `
        <section class="lspc-variant lspc-sentence" aria-label="Sentence playback">
          <div>
            <strong>After each sentence</strong>
            <span>Choose what playback does next</span>
          </div>
          ${modeButtons("lspc-modes-wide")}
          <small><kbd>Space</kbd> play · <kbd>N</kbd> next · <kbd>R</kbd> replay</small>
        </section>`;
    }

    return `
      <section class="lspc-variant lspc-popover" aria-label="Sentence playback">
        <button class="lspc-popover-trigger" type="button" aria-expanded="false">
          <span>After sentence</span><strong>${mode}</strong><span aria-hidden="true">▾</span>
        </button>
        <div class="lspc-popover-menu" hidden>
          <span class="lspc-label">Playback mode</span>
          ${modeButtons("lspc-modes-stack")}
          <small><kbd>Space</kbd> · <kbd>N</kbd> · <kbd>R</kbd></small>
        </div>
      </section>`;
  };

  function render() {
    const variant = variantFromUrl();
    root.innerHTML = `
      ${variantMarkup(variant)}
      <nav class="lspc-switcher" aria-label="Prototype variants">
        <button type="button" data-cycle="-1" aria-label="Previous variant">←</button>
        <span><strong>${variant} — ${names[variant]}</strong><small>Mode: ${mode}</small></span>
        <button type="button" data-cycle="1" aria-label="Next variant">→</button>
      </nav>`;

    root.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        mode = button.dataset.mode;
        render();
      });
    });

    root.querySelectorAll("[data-cycle]").forEach((button) => {
      button.addEventListener("click", () => cycle(Number(button.dataset.cycle)));
    });

    const trigger = root.querySelector(".lspc-popover-trigger");
    trigger?.addEventListener("click", () => {
      const menu = root.querySelector(".lspc-popover-menu");
      menu.hidden = !menu.hidden;
      trigger.setAttribute("aria-expanded", String(!menu.hidden));
    });
  }

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        !["ArrowLeft", "ArrowRight"].includes(event.key) ||
        event.target.closest?.("input, textarea, select, [contenteditable]")
      ) {
        return;
      }
      event.preventDefault();
      cycle(event.key === "ArrowLeft" ? -1 : 1);
    },
    true,
  );

  render();
})();
