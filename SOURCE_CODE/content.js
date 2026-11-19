// content.js for WaifuEngine overlay
// Supports up to 2 simultaneous overlays.
(() => {
  const POS_KEY_PREFIX = "animeGirlPos_";
  const SIZE_KEY_PREFIX = "animeGirlSize_";
  const overlays = {};

  function ensureOverlay(slot) {
    if (!overlays[slot]) {
      overlays[slot] = {
        img: null,
        isDragging: false,
        offsetX: 0,
        offsetY: 0
      };
    }
    return overlays[slot];
  }

  function readOverlaySettings(slot, callback) {
    const posKey = POS_KEY_PREFIX + slot;
    const sizeKey = SIZE_KEY_PREFIX + slot;

    chrome.storage.local.get([posKey, sizeKey, "animeGirlSize"], (res) => {
      const defaultX = window.innerWidth / 2 - 75 + (slot === "1" ? 160 : -160);

      const pos = res[posKey] || {
        x: defaultX,
        y: window.innerHeight / 2 - 75
      };

      const size = typeof res[sizeKey] === "number"
        ? res[sizeKey]
        : (slot === "0" && typeof res.animeGirlSize === "number"
          ? res.animeGirlSize
          : 1.0);

      callback(pos, size);
    });
  }

  function applyOverlaySettings(slot) {
    const state = overlays[slot];
    if (!state || !state.img || state.isDragging) return;

    readOverlaySettings(slot, (pos, size) => {
      if (!state.img || state.isDragging) return;

      state.img.style.left = pos.x + "px";
      state.img.style.top = pos.y + "px";
      state.img.style.transform = `scale(${size})`;
    });
  }

  function create(slot, imgUrl) {
    removeSlot(slot);
    const state = ensureOverlay(slot);

    const img = document.createElement("img");
    img.className = "waifuDeskOverlay";
    img.dataset.slot = slot;
    img.src = imgUrl;
    img.draggable = false;

    img.style.position = "fixed";
    img.style.width = "150px";
    img.style.zIndex = "2147483647";
    img.style.cursor = "grab";
    img.style.touchAction = "none";
    img.style.userSelect = "none";
    img.style.webkitUserDrag = "none";
    img.style.pointerEvents = "auto";
    img.style.transformOrigin = "top left";

    state.img = img;
    document.body.appendChild(img);
    applyOverlaySettings(slot);

    // Mouse dragging: preserve the exact grabbed point.
    img.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;

      const rect = img.getBoundingClientRect();

      state.isDragging = true;
      state.offsetX = e.clientX - rect.left;
      state.offsetY = e.clientY - rect.top;

      img.style.cursor = "grabbing";
      e.preventDefault();
    });

    // Touch support.
    img.addEventListener("touchstart", (e) => {
      const touch = e.touches[0];
      if (!touch) return;

      const rect = img.getBoundingClientRect();

      state.isDragging = true;
      state.offsetX = touch.clientX - rect.left;
      state.offsetY = touch.clientY - rect.top;

      e.preventDefault();
    }, { passive: false });

    // Right-click hides this overlay.
    img.addEventListener("contextmenu", (e) => {
      e.preventDefault();

      img.style.display = "none";

      chrome.storage.local.get(["hiddenSlots"], (res) => {
        const hiddenSlots = res.hiddenSlots || {};
        hiddenSlots[slot] = true;
        chrome.storage.local.set({ hiddenSlots });
      });
    });
  }

  function onMouseMove(e) {
    for (const slot in overlays) {
      const state = overlays[slot];

      if (!state.isDragging || !state.img) continue;

      place(
        slot,
        e.clientX - state.offsetX,
        e.clientY - state.offsetY
      );
    }
  }

  function onTouchMove(e) {
    let handled = false;

    for (const slot in overlays) {
      const state = overlays[slot];

      if (!state.isDragging || !state.img) continue;

      const touch = e.touches[0];
      if (!touch) continue;

      place(
        slot,
        touch.clientX - state.offsetX,
        touch.clientY - state.offsetY
      );

      handled = true;
    }

    if (handled) e.preventDefault();
  }

  function onUp() {
    for (const slot in overlays) {
      const state = overlays[slot];

      if (!state.isDragging) continue;

      state.isDragging = false;

      if (!state.img) continue;

      state.img.style.cursor = "grab";

      const left = parseFloat(state.img.style.left || "0");
      const top = parseFloat(state.img.style.top || "0");

      chrome.storage.local.set({
        [POS_KEY_PREFIX + slot]: {
          x: left,
          y: top
        }
      });
    }
  }

  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onUp);
  document.addEventListener("touchmove", onTouchMove, { passive: false });
  document.addEventListener("touchend", onUp);
  document.addEventListener("touchcancel", onUp);

  function place(slot, x, y) {
    const state = overlays[slot];
    if (!state || !state.img) return;

    const img = state.img;
    const rect = img.getBoundingClientRect();

    // Use scaled visible dimensions, not the original dimensions.
    const visibleWidth = rect.width;
    const visibleHeight = rect.height;

    const nx = Math.max(
      0,
      Math.min(window.innerWidth - visibleWidth, x)
    );

    const ny = Math.max(
      0,
      Math.min(window.innerHeight - visibleHeight, y)
    );

    img.style.left = nx + "px";
    img.style.top = ny + "px";
  }

  function removeSlot(slot) {
    const state = overlays[slot];

    if (state && state.img) {
      state.img.remove();
      state.img = null;
      state.isDragging = false;
    }
  }

  function removeAll() {
    for (const slot in overlays) {
      removeSlot(slot);
    }
  }

  function applyState(state) {
    const enabled = !!state.animeEnabled;

    const globalVisible = typeof state.animeVisible === "boolean"
      ? state.animeVisible
      : true;

    const chars = Array.isArray(state.selectedCharacters)
      ? state.selectedCharacters.slice(0, 2)
      : [];

    const hiddenSlots = state.hiddenSlots || {};

    if (!enabled || chars.length === 0) {
      removeAll();
      return;
    }

    const activeSlots = chars.map((_, i) => String(i));

    for (const slot in overlays) {
      if (!activeSlots.includes(slot)) {
        removeSlot(slot);
      }
    }

    chars.forEach((character, i) => {
      const slot = String(i);

      if (!character || !character.img) {
        removeSlot(slot);
        return;
      }

      const overlay = ensureOverlay(slot);

      if (!overlay.img) {
        create(slot, character.img);
      } else {
        if (overlay.img.src !== character.img) {
          overlay.img.src = character.img;
        }

        // Refresh saved position and size.
        applyOverlaySettings(slot);
      }

      const slotHidden = !!hiddenSlots[slot];

      overlay.img.style.display =
        globalVisible && !slotHidden ? "block" : "none";
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "setScale") {
      const slot = message.slot === undefined || message.slot === null
        ? "0"
        : String(message.slot);

      const overlay = overlays[slot];

      if (overlay && overlay.img) {
        overlay.img.style.transform = `scale(${message.scale})`;
      }

      chrome.storage.local.set({
        [SIZE_KEY_PREFIX + slot]: message.scale
      });
    }
  });

  // Initial load.
  chrome.storage.local.get(null, (res) => {
    applyState(res);
  });

  // Listen for changes across all open tabs.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    chrome.storage.local.get(null, (res) => {
      applyState(res);
    });
  });

  window.addEventListener("beforeunload", removeAll);
})();