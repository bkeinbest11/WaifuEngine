// content.js for WaifuEngine overlay
// Supports up to 2 simultaneous overlays ("slots"), each independently
// draggable/hideable/positioned. Slot index comes from the position of the
// character inside the `selectedCharacters` array in storage.
(() => {
  const POS_KEY_PREFIX = "animeGirlPos_"; // + slot index -> {x,y}
  const overlays = {}; // slot(string) -> { img, isDragging, offsetX, offsetY }

  function ensureOverlay(slot) {
    if (!overlays[slot]) overlays[slot] = { img: null, isDragging: false, offsetX: 0, offsetY: 0 };
    return overlays[slot];
  }

  function create(slot, imgUrl) {
    removeSlot(slot);
    const state = ensureOverlay(slot);

    const img = document.createElement("img");
    img.className = "waifuDeskOverlay";
    img.dataset.slot = slot;
    img.src = imgUrl;
    img.style.position = "fixed";
    img.style.width = "150px";
    img.style.zIndex = "2147483647";
    img.style.cursor = "grab";
    img.style.touchAction = "none";
    img.style.userSelect = "none";
    img.style.pointerEvents = "auto";

    const posKey = POS_KEY_PREFIX + slot;
    const sizeKey = "animeGirlSize_" + slot;
    chrome.storage.local.get([posKey, sizeKey, "animeGirlSize"], (res) => {
      // stagger default positions so slot 0 and slot 1 don't stack exactly
      const defaultX = window.innerWidth / 2 - 75 + (slot === "1" ? 160 : -160);
      const pos = res[posKey] || { x: defaultX, y: window.innerHeight / 2 - 75 };
      img.style.left = pos.x + "px";
      img.style.top = pos.y + "px";

      // per-slot size, falling back to the old global key for slot 0 on
      // upgrades from single-overlay versions
      const size = (typeof res[sizeKey] === "number")
        ? res[sizeKey]
        : (slot === "0" && typeof res.animeGirlSize === "number" ? res.animeGirlSize : 1.0);
      img.style.transform = `scale(${size})`;
    });

    // dragging (mouse)
    img.addEventListener("mousedown", (e) => {
      if (e.button === 2) return; // ignore right-click start
      state.isDragging = true;
      const rect = img.getBoundingClientRect();
      state.offsetX = e.clientX - rect.left;
      state.offsetY = e.clientY - rect.top;
      img.style.cursor = "grabbing";
      e.preventDefault();
    });

    // touch support
    img.addEventListener("touchstart", (e) => {
      state.isDragging = true;
      const t = e.touches[0];
      const rect = img.getBoundingClientRect();
      state.offsetX = t.clientX - rect.left;
      state.offsetY = t.clientY - rect.top;
      e.preventDefault();
    }, { passive: false });

    // hide THIS overlay on right click (per-slot, not global)
    img.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      img.style.display = "none";
      chrome.storage.local.get(["hiddenSlots"], (res) => {
        const hiddenSlots = res.hiddenSlots || {};
        hiddenSlots[slot] = true;
        chrome.storage.local.set({ hiddenSlots });
      });
    });

    state.img = img;
    document.body.appendChild(img);
  }

  // ── shared drag listeners (dispatch to whichever slot is being dragged) ──
  function onMouseMove(e) {
    for (const slot in overlays) {
      const state = overlays[slot];
      if (!state.isDragging || !state.img) continue;
      place(slot, e.clientX - state.offsetX, e.clientY - state.offsetY);
    }
  }
  function onTouchMove(e) {
    let handled = false;
    for (const slot in overlays) {
      const state = overlays[slot];
      if (!state.isDragging || !state.img) continue;
      const t = e.touches[0];
      place(slot, t.clientX - state.offsetX, t.clientY - state.offsetY);
      handled = true;
    }
    if (handled) e.preventDefault();
  }
  function onUp() {
    for (const slot in overlays) {
      const state = overlays[slot];
      if (!state.isDragging) continue;
      state.isDragging = false;
      if (state.img) {
        state.img.style.cursor = "grab";
        const left = parseInt(state.img.style.left || 0, 10);
        const top = parseInt(state.img.style.top || 0, 10);
        chrome.storage.local.set({ [POS_KEY_PREFIX + slot]: { x: left, y: top } });
      }
    }
  }
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onUp);
  document.addEventListener("touchmove", onTouchMove, { passive: false });
  document.addEventListener("touchend", onUp);

  function place(slot, x, y) {
    const state = overlays[slot];
    if (!state || !state.img) return;
    const img = state.img;
    let nx = Math.max(0, Math.min(window.innerWidth - img.offsetWidth, x));
    let ny = Math.max(0, Math.min(window.innerHeight - img.offsetHeight, y));
    img.style.left = nx + "px";
    img.style.top = ny + "px";
  }

  function removeSlot(slot) {
    const state = overlays[slot];
    if (state && state.img) {
      state.img.remove();
      state.img = null;
    }
  }

  function removeAll() {
    for (const slot in overlays) removeSlot(slot);
  }

  function applyState(state) {
    const enabled = !!state.animeEnabled;
    const globalVisible = (typeof state.animeVisible === "boolean") ? state.animeVisible : true;
    const chars = Array.isArray(state.selectedCharacters) ? state.selectedCharacters.slice(0, 2) : [];
    const hiddenSlots = state.hiddenSlots || {};

    if (!enabled || chars.length === 0) { removeAll(); return; }

    // remove any slot that's no longer in use (e.g. went from 2 chars to 1)
    const activeSlots = chars.map((_, i) => String(i));
    for (const slot in overlays) {
      if (!activeSlots.includes(slot)) removeSlot(slot);
    }

    chars.forEach((ch, i) => {
      const slot = String(i);
      if (!ch || !ch.img) { removeSlot(slot); return; }

      const s = ensureOverlay(slot);
      if (!s.img) create(slot, ch.img);
      else if (s.img.src !== ch.img) s.img.src = ch.img;

      const slotHidden = !!hiddenSlots[slot];
      s.img.style.display = (globalVisible && !slotHidden) ? "block" : "none";
    });
  }

  // respond to per-slot scale messages from the popup
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "setScale") {
      const slot = (msg.slot === undefined || msg.slot === null) ? "0" : String(msg.slot);
      const s = overlays[slot];
      if (s && s.img) s.img.style.transform = `scale(${msg.scale})`;
      chrome.storage.local.set({ ["animeGirlSize_" + slot]: msg.scale });
    }
  });

  // initial load
  chrome.storage.local.get(["animeEnabled", "animeVisible", "selectedCharacters", "hiddenSlots"], (res) => {
    applyState(res);
  });

  // watch for storage changes (global)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    chrome.storage.local.get(["animeEnabled", "animeVisible", "selectedCharacters", "hiddenSlots"], (res) => {
      applyState(res);
    });
  });

  // cleanup if page unloads
  window.addEventListener("beforeunload", () => { removeAll(); });
})();
