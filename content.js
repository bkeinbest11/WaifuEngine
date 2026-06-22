// content.js for WaifuEngine overlay
(() => {
  const STORAGE_POS_KEY = "animeGirlPos";
  let img = null;
  let isDragging = false;
  let offsetX = 0, offsetY = 0;

  function create(imgUrl) {
    remove();
    img = document.createElement("img");
    img.id = "waifuDeskOverlay";
    img.src = imgUrl;
    img.style.position = "fixed";
    img.style.width = "150px";
    img.style.zIndex = "2147483647";
    img.style.cursor = "grab";
    img.style.touchAction = "none";
    img.style.userSelect = "none";
    img.style.pointerEvents = "auto";

    // initial position (saved global) or center
    chrome.storage.local.get([STORAGE_POS_KEY, "animeGirlSize"], (res) => {
      const pos = res[STORAGE_POS_KEY] || { x: window.innerWidth/2 - 75, y: window.innerHeight/2 - 75 };
      img.style.left = pos.x + "px";
      img.style.top = pos.y + "px";

      const size = res.animeGirlSize || 1.0;
      img.style.transform = `scale(${size})`;
    });

    // dragging (mouse)
    img.addEventListener("mousedown", (e) => {
      if (e.button === 2) return; // ignore right-click start
      isDragging = true;
      const rect = img.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      img.style.cursor = "grabbing";
      e.preventDefault();
    });

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onUp);

    // touch support
    img.addEventListener("touchstart", (e) => {
      isDragging = true;
      const t = e.touches[0];
      const rect = img.getBoundingClientRect();
      offsetX = t.clientX - rect.left;
      offsetY = t.clientY - rect.top;
      e.preventDefault();
    }, { passive: false });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onUp);

    // hide on right click
    img.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      img.style.display = "none";
      chrome.storage.local.set({ animeVisible: false });
    });

    // listen for size/speed changes from popup
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!img) return;
      if (msg.action === "setScale") {
        img.style.transform = `scale(${msg.scale})`;
        chrome.storage.local.set({ animeGirlSize: msg.scale });
      }
    });

    document.body.appendChild(img);
  }

  function onMouseMove(e) {
    if (!isDragging || !img) return;
    const x = e.clientX - offsetX;
    const y = e.clientY - offsetY;
    place(x, y);
  }
  function onTouchMove(e) {
    if (!isDragging || !img) return;
    const t = e.touches[0];
    const x = t.clientX - offsetX;
    const y = t.clientY - offsetY;
    place(x, y);
    e.preventDefault();
  }
  function onUp() {
    if (!isDragging) return;
    isDragging = false;
    if (img) img.style.cursor = "grab";
    if (img) {
      const left = parseInt(img.style.left || 0, 10);
      const top = parseInt(img.style.top || 0, 10);
      chrome.storage.local.set({ [STORAGE_POS_KEY]: { x: left, y: top } });
    }
  }

  function place(x, y) {
    if (!img) return;
    let nx = Math.max(0, Math.min(window.innerWidth - img.offsetWidth, x));
    let ny = Math.max(0, Math.min(window.innerHeight - img.offsetHeight, y));
    img.style.left = nx + "px";
    img.style.top = ny + "px";
  }

  function remove() {
    if (img) {
      img.remove();
      img = null;
    }
  }

  function applyState(state) {
    const enabled = !!state.animeEnabled;
    const visible = (typeof state.animeVisible === "boolean") ? state.animeVisible : true;
    const selected = state.selectedCharacter;

    if (!enabled) { remove(); return; }
    if (!selected || !selected.img) { remove(); return; }

    if (!img) create(selected.img);
    else if (img.src !== selected.img) img.src = selected.img;

    img.style.display = visible ? "block" : "none";
  }

  // initial load
  chrome.storage.local.get(["animeEnabled","animeVisible","selectedCharacter",STORAGE_POS_KEY], (res) => {
    applyState(res);
  });

  // watch for storage changes (global)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    chrome.storage.local.get(["animeEnabled","animeVisible","selectedCharacter"], (res) => {
      applyState(res);
    });
  });

  // cleanup if page unloads
  window.addEventListener("beforeunload", () => { remove(); });
})();