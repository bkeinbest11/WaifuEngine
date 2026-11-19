// popup.js for WaifuEngine
const LIST_JSON_URL = "https://raw.githubusercontent.com/bkeinbest11/WaifuEngine/main/list.json";
const MAX_ACTIVE = 2;

const getStorage = (keys) => new Promise(res => chrome.storage.local.get(keys, r => res(r)));
const setStorage = (obj) => new Promise(res => chrome.storage.local.set(obj, () => res()));

let allChars = [];
let favorites = [];
let selectedCharacters = []; // up to MAX_ACTIVE character objects, in slot order
let pendingGifDataUrl = null;

document.addEventListener("DOMContentLoaded", () => {
  const uploadedGrid = document.getElementById("uploadedGrid");
  const sizeRowsContainer = document.getElementById("sizeRows");

  // ── Per-slot size sliders ────────────────────────────────────────────────
  // One row per active character (slot 0 / slot 1), each with its own stored
  // scale (animeGirlSize_0 / animeGirlSize_1) so gif 1 and gif 2 can differ.
  function sizeStorageKey(slot) { return "animeGirlSize_" + slot; }

  function sendScaleToTab(slot, val) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { action: "setScale", slot, scale: val }, () => {
        chrome.runtime.lastError;
      });
    });
  }

  let sizeRowsRenderId = 0;
  async function renderSizeRows() {
    const renderId = ++sizeRowsRenderId;
    sizeRowsContainer.innerHTML = "";
    if (selectedCharacters.length === 0) return;

    const keys = selectedCharacters.map((_, i) => sizeStorageKey(i));
    const stored = await getStorage([...keys, "animeGirlSize"]);

    if (renderId !== sizeRowsRenderId) return;
    sizeRowsContainer.innerHTML = "";

    selectedCharacters.forEach((ch, i) => {
      const key = sizeStorageKey(i);
      const val = (typeof stored[key] === "number")
        ? stored[key]
        : (i === 0 && typeof stored.animeGirlSize === "number" ? stored.animeGirlSize : 1.0);

      const row = document.createElement("div");
      row.className = "size-row";

      const label = document.createElement("label");
      const shortName = ch.name.length > 14 ? ch.name.slice(0, 13) + "…" : ch.name;
      label.textContent = `Size ${i + 1} (${shortName}):`;
      label.setAttribute("for", "sizeRange_" + i);
      row.appendChild(label);

      const range = document.createElement("input");
      range.type = "range";
      range.id = "sizeRange_" + i;
      range.min = "0.5";
      range.max = "3.0";
      range.step = "0.05";
      range.value = val;
      row.appendChild(range);

      const valueSpan = document.createElement("span");
      valueSpan.id = "sizeValue_" + i;
      valueSpan.textContent = val.toFixed(2) + "x";
      row.appendChild(valueSpan);

      range.addEventListener("input", () => {
        const v = parseFloat(range.value);
        valueSpan.textContent = v.toFixed(2) + "x";
        chrome.storage.local.set({ [key]: v });
        sendScaleToTab(i, v);
      });

      sizeRowsContainer.appendChild(row);
    });
  }

  // ── UI refs ──────────────────────────────────────────────────────────────
  const uploadBanner   = document.getElementById("uploadBanner");
  const uploadModal    = document.getElementById("uploadModal");
  const modalClose     = document.getElementById("modalClose");
  const gifFile        = document.getElementById("gifFile");
  const gifDrop        = document.getElementById("gifDrop");
  const gifPreviewRow  = document.getElementById("gifPreviewRow");
  const gifPreviewImg  = document.getElementById("gifPreviewImg");
  const gifPreviewName = document.getElementById("gifPreviewName");
  const gifPreviewSize = document.getElementById("gifPreviewSize");
  const applyGifBtn    = document.getElementById("applyGifBtn");
  const runBtn         = document.getElementById("runBtn");
  const stopBtn        = document.getElementById("stopBtn");
  const searchInput    = document.getElementById("search");
  const grid           = document.getElementById("grid");
  const favGrid        = document.getElementById("favGrid");
  const noresult       = document.getElementById("noresult");

  // ── Upload modal ─────────────────────────────────────────────────────────
  uploadBanner.addEventListener("click", () => {
    uploadModal.classList.toggle("open");
  });

  modalClose.addEventListener("click", () => {
    uploadModal.classList.remove("open");
  });

  // ── GIF file selection ───────────────────────────────────────────────────
  gifFile.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleGifFile(file);
  });

  gifDrop.addEventListener("dragover", (e) => {
    e.preventDefault();
    gifDrop.classList.add("dragover");
  });

  gifDrop.addEventListener("dragleave", () => {
    gifDrop.classList.remove("dragover");
  });

  gifDrop.addEventListener("drop", (e) => {
    e.preventDefault();
    gifDrop.classList.remove("dragover");
    const file = e.dataTransfer.files[0];
    if (file && file.type === "image/gif") handleGifFile(file);
  });

  function handleGifFile(file) {
    if (!file.type.includes("gif")) {
      alert("Please select a .gif file only!");
      return;
    }

    const maxMB = 5;
    if (file.size > maxMB * 1024 * 1024) {
      alert(`GIF must be under ${maxMB}MB. Yours is ${(file.size / 1024 / 1024).toFixed(1)}MB.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      pendingGifDataUrl = ev.target.result;
      gifPreviewImg.src = pendingGifDataUrl;
      gifPreviewName.textContent = file.name;
      gifPreviewSize.textContent = (file.size / 1024).toFixed(1) + " KB";
      gifPreviewRow.style.display = "flex";
      applyGifBtn.disabled = false;
    };
    reader.readAsDataURL(file);
  }

  // ── Apply GIF ────────────────────────────────────────────────────────────
  applyGifBtn.addEventListener("click", async () => {
    if (!pendingGifDataUrl) return;

    const customChar = {
      name: "My Custom GIF",
      img: pendingGifDataUrl,
      isCustom: true
    };

    await setStorage({ customGif: pendingGifDataUrl });

    // Add the custom GIF into the active selection just like any other card.
    await selectCharacter(customChar);

    applyGifBtn.textContent = "✓ Applied!";
    setTimeout(() => {
      applyGifBtn.textContent = "Apply GIF as Overlay";
      uploadModal.classList.remove("open");
    }, 800);
  });

  // ── Run / Stop ───────────────────────────────────────────────────────────
  runBtn.addEventListener("click", async () => {
    await setStorage({
      animeEnabled: true,
      animeVisible: true,
      hiddenSlots: {}
    });
  });

  stopBtn.addEventListener("click", async () => {
    await setStorage({
      animeEnabled: false
    });
  });

  // ── Search ───────────────────────────────────────────────────────────────
  searchInput.addEventListener("input", applySearch);

  function applySearch() {
    const q = searchInput.value.trim().toLowerCase();
    const cards = [...document.querySelectorAll(".card")];
    let visibleCount = 0;

    for (const c of cards) {
      const n = c.dataset.name || "";
      if (n.includes(q)) {
        c.style.display = "flex";
        visibleCount++;
      } else {
        c.style.display = "none";
      }
    }

    noresult.style.display = visibleCount === 0 ? "block" : "none";
  }

  // ── Selection (up to MAX_ACTIVE characters active at once) ────────────────
  function slotIndexOf(name) {
    return selectedCharacters.findIndex(c => c.name === name);
  }

  async function selectCharacter(ch) {
    const idx = slotIndexOf(ch.name);

    if (idx !== -1) {
      selectedCharacters.splice(idx, 1);
    } else if (selectedCharacters.length < MAX_ACTIVE) {
      selectedCharacters.push(ch);
    } else {
      alert(`You can only have ${MAX_ACTIVE} active at once. Click an active one to remove it first.`);
      return;
    }

    await setStorage({
      selectedCharacters,
      animeEnabled: selectedCharacters.length > 0,
      animeVisible: true
    });

    render();
  }

  // ── Character grid ───────────────────────────────────────────────────────
  async function init() {
    const store = await getStorage(["favorites", "customGif", "selectedCharacters"]);

    favorites = store.favorites || [];
    selectedCharacters = Array.isArray(store.selectedCharacters)
      ? store.selectedCharacters
      : [];

    let customChars = [];

    if (store.customGif) {
      customChars = [{
        name: "My Custom GIF",
        img: store.customGif,
        isCustom: true
      }];
    }

    try {
      const resp = await fetch(LIST_JSON_URL, { cache: "no-store" });
      if (!resp.ok) throw new Error("fetch failed");
      allChars = [...customChars, ...(await resp.json())];
    } catch (e) {
      allChars = customChars;
    }

    render();
  }

  function render() {
    favGrid.innerHTML = "";
    grid.innerHTML = "";

    const uploadedItems = allChars.filter(c => c.isCustom);
    const favItems = allChars.filter(c => favorites.includes(c.name) && !c.isCustom);
    const otherItems = allChars.filter(c => !favorites.includes(c.name) && !c.isCustom);

    uploadedGrid.innerHTML = uploadedItems.length === 0
      ? `<div class="empty">No uploads yet.</div>`
      : "";

    for (const ch of uploadedItems) {
      uploadedGrid.appendChild(makeCard(ch));
    }

    favGrid.innerHTML = favItems.length === 0
      ? `<div class="empty">No favorites yet. Click the ❤ to favorite.</div>`
      : "";

    for (const ch of favItems) {
      favGrid.appendChild(makeCard(ch));
    }

    grid.innerHTML = otherItems.length === 0
      ? `<div class="empty">No characters available.</div>`
      : "";

    for (const ch of otherItems) {
      grid.appendChild(makeCard(ch));
    }

    applySearch();
    renderSizeRows();
  }

  function makeCard(ch) {
    const card = document.createElement("div");
    const slot = slotIndexOf(ch.name);
    const isActive = slot !== -1;

    card.className = "card" +
      (ch.isCustom ? " custom-gif" : "") +
      (isActive ? " selected" : "");

    card.dataset.name = ch.name.toLowerCase();

    const img = document.createElement("img");
    img.className = "thumb";
    img.src = ch.img;
    img.alt = ch.name;
    card.appendChild(img);

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = ch.isCustom ? "🎨 " + ch.name : ch.name;
    card.appendChild(name);

    if (isActive) {
      const badge = document.createElement("div");
      badge.className = "slot-badge";
      badge.textContent = "✓ " + (slot + 1);
      badge.title = "Active in slot " + (slot + 1) + " — click card to remove";
      card.appendChild(badge);
    }

    const heart = document.createElement("div");
    heart.className = "heart";
    heart.textContent = favorites.includes(ch.name) ? "❤" : "♡";
    heart.title = "Favorite";

    heart.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      toggleFavorite(ch.name);
    });

    card.appendChild(heart);

    card.addEventListener("click", async () => {
      await selectCharacter(ch);
    });

    return card;
  }

  async function toggleFavorite(name) {
    const idx = favorites.indexOf(name);

    if (idx === -1) favorites.push(name);
    else favorites.splice(idx, 1);

    await setStorage({ favorites });
    render();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    // Only rebuild the popup when something affecting the grid/cards changed.
    // Avoid rebuilding on every size-slider update.
    if (!changes.favorites && !changes.selectedCharacters) return;

    if (changes.favorites) favorites = changes.favorites.newValue || [];
    if (changes.selectedCharacters) selectedCharacters = changes.selectedCharacters.newValue || [];

    render();
  });

  init();
});