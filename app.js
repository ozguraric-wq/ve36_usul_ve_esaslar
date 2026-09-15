(() => {
  "use strict";

  const TOTAL_SLIDES = 67;
  const EDITS_KEY = "ratel-vizyon-eskisehir-sunum-edits-v1";
  const CONTENT_EDITS_KEY = "ratel-vizyon-eskisehir-sunum-content-edits-v1";
  const SEARCH_INDEX = window.SLIDE_SEARCH_INDEX || [];
  const EDITABLE_SLIDES = window.EDITABLE_SLIDES || {};

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const imagePath = (number) => `./slides/slide-${String(number).padStart(2, "0")}.png`;

  function showApp() {
    buildThumbnails();
    initDeck();
  }

  function readSlideFromHash() {
    const match = window.location.hash.match(/slide=(\d+)/i);
    const requested = match ? Number(match[1]) : 1;
    return Math.min(TOTAL_SLIDES, Math.max(1, Number.isFinite(requested) ? requested : 1));
  }

  function buildThumbnails() {
    const grid = $("#thumbnail-grid");
    if (!grid || grid.childElementCount) return;
    const fragment = document.createDocumentFragment();
    for (let number = 1; number <= TOTAL_SLIDES; number += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "thumb-button";
      button.dataset.slide = String(number);
      button.setAttribute("aria-label", `Slayt ${number}`);
      button.innerHTML = `<img loading="lazy" src="${imagePath(number)}" alt="" /><span class="thumb-label">Slayt ${number}</span>`;
      fragment.append(button);
    }
    grid.append(fragment);
    grid.addEventListener("click", (event) => {
      const button = event.target.closest(".thumb-button");
      if (!button) return;
      setSlide(Number(button.dataset.slide));
      closeToc();
    });
  }

  let currentSlide = 1;
  let toastTimer;
  let searchFocusIndex = -1;
  let navigationLockUntil = 0;

  function normalize(value) {
    return String(value || "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function tokenize(value) {
    return normalize(value).split(/[^a-z0-9çğıöşü]+/i).filter((token) => token.length > 2);
  }

  function isTypingTarget(target) {
    return Boolean(target && (target.matches?.("input, textarea, select, [contenteditable='true']") || target.isContentEditable));
  }

  function getEdits() {
    try { return JSON.parse(localStorage.getItem(EDITS_KEY) || "{}"); } catch { return {}; }
  }

  function saveEdits(edits) {
    localStorage.setItem(EDITS_KEY, JSON.stringify(edits));
  }

  function getContentEdits() {
    try { return JSON.parse(localStorage.getItem(CONTENT_EDITS_KEY) || "{}"); } catch { return {}; }
  }

  function saveContentEdits(edits) {
    localStorage.setItem(CONTENT_EDITS_KEY, JSON.stringify(edits));
  }

  function getEditableBlocks(number) {
    return EDITABLE_SLIDES[String(number)]?.text || [];
  }

  function getContentValue(block, edits) {
    return Object.prototype.hasOwnProperty.call(edits, block.id) ? edits[block.id] : block.text;
  }

  function hasContentEdits(number) {
    const edits = getContentEdits()[String(number)];
    return Boolean(edits && Object.keys(edits).length);
  }

  function isContentEditMode() {
    const canvas = $("#slide-edit-canvas");
    return Boolean(canvas && !canvas.classList.contains("is-hidden"));
  }

  function updateEditableScale() {
    const frame = $(".slide-frame");
    if (!frame) return;
    const scale = frame.clientWidth / 1600;
    frame.style.setProperty("--slide-scale", String(scale || 1));
    $$(".editable-text, .rendered-text", frame).forEach((node) => {
      const size = Number(node.dataset.fontSize || 16.5);
      const line = Number(node.dataset.lineHeight || size * 1.18);
      const editable = node.classList.contains("editable-text");
      node.style.fontSize = `${size * 1.333 * scale}px`;
      node.style.lineHeight = `${line * 1.333 * scale}px`;
      node.style.borderRadius = `${Math.max(2, 7 * scale)}px`;
      node.style.padding = editable ? `${Math.max(1, 7 * scale)}px ${Math.max(2, 9 * scale)}px` : "0";
      if (!editable) node.style.background = "transparent";
    });
  }

  function positionTextNode(node, block) {
    node.style.left = `${(block.x / 1600) * 100}%`;
    node.style.top = `${(block.y / 900) * 100}%`;
    node.style.width = `${(block.w / 1600) * 100}%`;
    node.style.height = `${(block.h / 900) * 100}%`;
    node.dataset.fontSize = String(block.style?.fontSize || 16.5);
    node.dataset.lineHeight = String((block.style?.fontSize || 16.5) * 1.18);
    node.style.color = block.style?.color || "#17203a";
    node.style.fontFamily = block.style?.fontFamily || "Aptos, Arial, sans-serif";
    node.style.fontWeight = block.style?.bold ? "700" : "400";
    node.style.fontStyle = block.style?.italic ? "italic" : "normal";
    node.style.textAlign = block.style?.align || "left";
    node.style.background = block.style?.editorBackground || "transparent";
    node.style.setProperty("--editor-fill", block.style?.fill || "transparent");
  }

  function buildContentFieldList(blocks, edits) {
    const list = $("#slide-content-fields");
    if (!list) return;
    list.innerHTML = "";
    if (!blocks.length) {
      const empty = document.createElement("p");
      empty.className = "content-fields-empty";
      empty.textContent = "Bu slaytta düzenlenebilir metin bulunamadı.";
      list.append(empty);
      return;
    }
    blocks.forEach((block, index) => {
      const label = document.createElement("label");
      label.className = "content-field-label";
      const caption = document.createElement("span");
      caption.textContent = `${block.kind === "cell" ? "Tablo hücresi" : "Metin kutusu"} ${index + 1}`;
      const field = document.createElement("textarea");
      field.className = "content-field";
      field.dataset.blockId = block.id;
      field.rows = block.text.includes("\n") ? 3 : 2;
      field.value = getContentValue(block, edits);
      field.setAttribute("aria-label", `${caption.textContent} düzenleme alanı`);
      label.append(caption, field);
      list.append(label);
    });
  }

  function buildEditableCanvas() {
    const canvas = $("#slide-edit-canvas");
    if (!canvas) return;
    const blocks = getEditableBlocks(currentSlide);
    const allEdits = getContentEdits();
    const edits = allEdits[String(currentSlide)] || {};
    canvas.innerHTML = "";
    blocks.forEach((block) => {
      const field = document.createElement("textarea");
      field.className = "editable-text";
      field.dataset.blockId = block.id;
      field.dataset.original = block.text;
      field.value = getContentValue(block, edits);
      field.setAttribute("aria-label", `Slayt ${currentSlide} metin alanı`);
      field.spellcheck = false;
      positionTextNode(field, block);
      canvas.append(field);
    });
    canvas.classList.toggle("has-blocks", blocks.length > 0);
    buildContentFieldList(blocks, edits);
    updateEditableScale();
  }

  function buildRenderedTextLayer() {
    const layer = $("#slide-rendered-text");
    if (!layer) return;
    const blocks = getEditableBlocks(currentSlide);
    const allEdits = getContentEdits();
    const edits = allEdits[String(currentSlide)] || {};
    layer.innerHTML = "";
    blocks.forEach((block) => {
      const node = document.createElement("div");
      node.className = "rendered-text";
      node.dataset.fontSize = String(block.style?.fontSize || 16.5);
      node.dataset.lineHeight = String((block.style?.fontSize || 16.5) * 1.18);
      node.textContent = getContentValue(block, edits);
      positionTextNode(node, block);
      node.style.background = "transparent";
      layer.append(node);
    });
    updateEditableScale();
  }

  function refreshSlideVisual() {
    const image = $("#slide-image");
    const editCanvas = $("#slide-edit-canvas");
    const rendered = $("#slide-rendered-text");
    const useClean = isContentEditMode() || hasContentEdits(currentSlide);
    image.src = useClean ? `./clean-slides/slide-${String(currentSlide).padStart(2, "0")}.png` : imagePath(currentSlide);
    editCanvas.classList.toggle("is-hidden", !isContentEditMode());
    rendered.classList.toggle("is-hidden", !(hasContentEdits(currentSlide) && !isContentEditMode()));
    if (isContentEditMode()) buildEditableCanvas();
    if (hasContentEdits(currentSlide) && !isContentEditMode()) buildRenderedTextLayer();
    updateEditableScale();
  }

  function persistContentDraft() {
    const canvas = $("#slide-edit-canvas");
    if (!canvas || canvas.classList.contains("is-hidden")) return;
    const blocks = getEditableBlocks(currentSlide);
    const byId = Object.fromEntries(blocks.map((block) => [block.id, block]));
    const next = {};
    $$(".editable-text", canvas).forEach((field) => {
      const block = byId[field.dataset.blockId];
      if (block && field.value !== block.text) next[block.id] = field.value;
    });
    const edits = getContentEdits();
    if (Object.keys(next).length) edits[String(currentSlide)] = next;
    else delete edits[String(currentSlide)];
    saveContentEdits(edits);
  }

  function getSlideEdit(number) {
    const edits = getEdits();
    return edits[String(number)] || { title: "", note: "" };
  }

  function updateSlideOverlay() {
    const edit = getSlideEdit(currentSlide);
    const overlay = $("#slide-edit-overlay");
    $("#overlay-title").textContent = edit.title || "";
    $("#overlay-note").textContent = edit.note || "";
    overlay.classList.toggle("is-hidden", !(edit.title || edit.note));
    const title = $("#slide-edit-title");
    const note = $("#slide-edit-note");
    const directTitle = $("#direct-edit-title");
    const directNote = $("#direct-edit-note");
    if (title && note) { title.value = edit.title || ""; note.value = edit.note || ""; $("#edit-current").textContent = `Slayt ${currentSlide} için düzenleme`; }
    if (directTitle && directNote) { directTitle.value = edit.title || ""; directNote.value = edit.note || ""; }
  }

  function setSlide(number, { updateHash = true } = {}) {
    currentSlide = Math.min(TOTAL_SLIDES, Math.max(1, number));
    const image = $("#slide-image");
    image.alt = `Vizyon Eskişehir 2036 eğitim sunumu, slayt ${currentSlide}`;
    $("#slide-caption").textContent = `Slayt ${currentSlide} / ${TOTAL_SLIDES}`;
    $("#header-slide-count").textContent = `${currentSlide} / ${TOTAL_SLIDES}`;
    $("#progress-title").textContent = `Slayt ${currentSlide}`;
    const percent = Math.round((currentSlide / TOTAL_SLIDES) * 100);
    $("#progress-percent").textContent = `%${percent}`;
    const range = $("#progress-range");
    range.value = String(currentSlide);
    range.style.setProperty("--progress", `${((currentSlide - 1) / (TOTAL_SLIDES - 1)) * 100}%`);
    $$(".thumb-button").forEach((button) => {
      const active = Number(button.dataset.slide) === currentSlide;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-current", active ? "true" : "false");
      if (active && button.parentElement) button.scrollIntoView({ block: "nearest" });
    });
    updateSlideOverlay();
    refreshSlideVisual();
    if (updateHash) history.replaceState(null, "", `#slide=${currentSlide}`);
  }

  function navigationIsLocked() {
    return Date.now() < navigationLockUntil || isContentEditMode();
  }

  function nextSlide() { if (!navigationIsLocked()) setSlide(currentSlide >= TOTAL_SLIDES ? 1 : currentSlide + 1); }
  function previousSlide() { if (!navigationIsLocked()) setSlide(currentSlide <= 1 ? TOTAL_SLIDES : currentSlide - 1); }

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
  }

  function openToc() {
    $("#toc-drawer").classList.add("is-open");
    $("#toc-drawer").setAttribute("aria-hidden", "false");
    $("#drawer-scrim").classList.add("is-visible");
    $("#close-toc").focus();
  }

  function closeToc() {
    $("#toc-drawer").classList.remove("is-open");
    $("#toc-drawer").setAttribute("aria-hidden", "true");
    $("#drawer-scrim").classList.remove("is-visible");
  }

  function openEdit() {
    closeToc();
    updateSlideOverlay();
    $("#presentation-stage").classList.add("is-editing");
    $("#slide-edit-canvas").classList.remove("is-hidden");
    $("#slide-direct-editor").classList.remove("is-hidden");
    $("#edit-drawer").classList.remove("is-open");
    $("#edit-drawer").setAttribute("aria-hidden", "true");
    $("#drawer-scrim").classList.remove("is-visible");
    refreshSlideVisual();
    $("#direct-edit-title").focus();
  }

  function closeEdit() {
    navigationLockUntil = Date.now() + 500;
    persistContentDraft();
    $("#presentation-stage").classList.remove("is-editing");
    $("#slide-edit-canvas").classList.add("is-hidden");
    $("#slide-direct-editor").classList.add("is-hidden");
    $("#edit-drawer").classList.remove("is-open");
    $("#edit-drawer").setAttribute("aria-hidden", "true");
    $("#drawer-scrim").classList.remove("is-visible");
    refreshSlideVisual();
  }

  function closeDrawers() {
    closeToc();
    closeEdit();
  }

  function saveCurrentEdit() {
    persistContentDraft();
    const edits = getEdits();
    const directEditor = $("#slide-direct-editor");
    const directIsOpen = directEditor && !directEditor.classList.contains("is-hidden");
    const title = (directIsOpen ? $("#direct-edit-title") : $("#slide-edit-title")).value.trim();
    const note = (directIsOpen ? $("#direct-edit-note") : $("#slide-edit-note")).value.trim();
    if (title || note) edits[String(currentSlide)] = { title, note };
    else delete edits[String(currentSlide)];
    saveEdits(edits);
    updateSlideOverlay();
    showToast(`Slayt ${currentSlide} düzenlemesi kaydedildi.`);
  }

  function resetCurrentEdit() {
    const edits = getEdits();
    delete edits[String(currentSlide)];
    saveEdits(edits);
    const contentEdits = getContentEdits();
    delete contentEdits[String(currentSlide)];
    saveContentEdits(contentEdits);
    updateSlideOverlay();
    refreshSlideVisual();
    showToast(`Slayt ${currentSlide} düzenlemesi temizlendi.`);
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function countOccurrences(text, term) {
    let count = 0;
    let from = 0;
    while (from < text.length) {
      const found = text.indexOf(term, from);
      if (found < 0) break;
      count += 1;
      from = found + term.length;
    }
    return count;
  }

  function searchSource(item) {
    const blocks = getEditableBlocks(item.slide);
    const edits = getContentEdits()[String(item.slide)] || {};
    const editableText = blocks.map((block) => getContentValue(block, edits)).join(" ");
    return { title: item.title || "", text: editableText || item.text || "" };
  }

  function searchSlides(query) {
    const cleanQuery = String(query || "").replace(/\s+/g, " ").trim();
    const terms = tokenize(cleanQuery);
    if (!terms.length) return [];
    const phrase = normalize(cleanQuery);
    return SEARCH_INDEX.map((item) => {
      const source = searchSource(item);
      const haystack = normalize(`${source.title} ${source.text}`);
      const titleHaystack = normalize(source.title);
      let score = 0;
      let matchedTerms = 0;
      terms.forEach((term) => {
        const occurrences = countOccurrences(haystack, term);
        if (occurrences) {
          matchedTerms += 1;
          score += Math.min(occurrences, 4) * 2;
          if (titleHaystack.includes(term)) score += 10;
          if (haystack.split(/\s+/).some((word) => word.startsWith(term))) score += 3;
        }
      });
      if (phrase.length > 2 && haystack.includes(phrase)) score += 24;
      if (terms.length > 1 && matchedTerms === terms.length) score += 10;
      if (terms.length > 1 && matchedTerms < terms.length) score -= (terms.length - matchedTerms) * 1.5;
      const firstTerm = terms[0];
      const sourceIndex = normalize(source.text).indexOf(firstTerm);
      const snippetStart = sourceIndex > 60 ? sourceIndex - 60 : 0;
      const rawSnippet = source.text.slice(snippetStart, snippetStart + 190).replace(/\s+/g, " ").trim();
      return { ...item, ...source, score, matchedTerms, totalTerms: terms.length, snippet: rawSnippet || source.text.slice(0, 190) };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || b.matchedTerms - a.matchedTerms || a.slide - b.slide).slice(0, 10);
  }

  function normalizedWithMap(value) {
    const original = String(value || "");
    let normalized = "";
    const map = [];
    Array.from(original).forEach((character, index) => {
      const piece = character.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      Array.from(piece).forEach((part) => { normalized += part; map.push(index); });
    });
    return { original, normalized, map };
  }

  function highlightSearchText(value, query) {
    const mapped = normalizedWithMap(value);
    const ranges = [];
    tokenize(query).forEach((term) => {
      let from = 0;
      while (from < mapped.normalized.length) {
        const position = mapped.normalized.indexOf(term, from);
        if (position < 0) break;
        const start = mapped.map[position];
        const end = mapped.map[position + term.length - 1] + 1;
        ranges.push([start, end]);
        from = position + term.length;
      }
    });
    if (!ranges.length) return escapeHtml(mapped.original);
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged = [];
    ranges.forEach(([start, end]) => {
      const previous = merged[merged.length - 1];
      if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
      else merged.push([start, end]);
    });
    let output = "";
    let cursor = 0;
    merged.forEach(([start, end]) => {
      output += escapeHtml(mapped.original.slice(cursor, start));
      output += `<mark>${escapeHtml(mapped.original.slice(start, end))}</mark>`;
      cursor = end;
    });
    return output + escapeHtml(mapped.original.slice(cursor));
  }

  function renderSearchResults(results, query) {
    const box = $("#search-results");
    const input = $("#slide-search");
    const clear = $("#clear-search");
    const hasQuery = Boolean(query.trim());
    clear?.classList.toggle("is-visible", hasQuery);
    input?.setAttribute("aria-expanded", hasQuery && results.length ? "true" : "false");
    if (!hasQuery) { box.classList.remove("is-visible"); box.innerHTML = ""; return; }
    box.classList.add("is-visible");
    if (!results.length) { box.innerHTML = '<div class="search-empty">Eşleşen slayt bulunamadı.<small>Başlığı, madde numarasını veya birkaç anahtar kelimeyi deneyin.</small></div>'; return; }
    box.innerHTML = results.map((item, index) => `<button class="search-result${index === searchFocusIndex ? " is-focused" : ""}" id="search-result-${item.slide}" type="button" data-slide="${item.slide}" role="option" aria-selected="${index === searchFocusIndex ? "true" : "false"}"><strong>Slayt ${item.slide} · ${highlightSearchText(item.title || `Slayt ${item.slide}`, query)}</strong><span>${highlightSearchText(item.snippet || item.text, query)}</span><em>${item.matchedTerms === item.totalTerms ? "Tam eşleşme" : `${item.matchedTerms}/${item.totalTerms} kelime eşleşti`}</em></button>`).join("");
    if (searchFocusIndex >= 0) input?.setAttribute("aria-activedescendant", `search-result-${results[searchFocusIndex]?.slide || ""}`);
    else input?.removeAttribute("aria-activedescendant");
  }

  function initSearch() {
    const input = $("#slide-search");
    const box = $("#search-results");
    const clear = $("#clear-search");
    if (!input || !box) return;
    const clearSearch = ({ blur = false } = {}) => {
      input.value = "";
      searchFocusIndex = -1;
      renderSearchResults([], "");
      if (blur) input.blur();
    };
    input.addEventListener("input", () => { searchFocusIndex = -1; renderSearchResults(searchSlides(input.value), input.value); });
    input.addEventListener("focus", () => { if (input.value.trim()) renderSearchResults(searchSlides(input.value), input.value); });
    input.addEventListener("keydown", (event) => {
      const results = searchSlides(input.value);
      if (event.key === "ArrowDown" && results.length) { event.preventDefault(); searchFocusIndex = (searchFocusIndex + 1) % results.length; renderSearchResults(results, input.value); }
      if (event.key === "ArrowUp" && results.length) { event.preventDefault(); searchFocusIndex = searchFocusIndex <= 0 ? results.length - 1 : searchFocusIndex - 1; renderSearchResults(results, input.value); }
      if (event.key === "Enter" && results.length) { event.preventDefault(); setSlide(results[Math.max(0, searchFocusIndex)].slide); box.classList.remove("is-visible"); input.setAttribute("aria-expanded", "false"); }
      if (event.key === "Escape") { event.preventDefault(); clearSearch({ blur: true }); }
    });
    clear?.addEventListener("click", () => { clearSearch(); input.focus(); });
    box.addEventListener("click", (event) => { const result = event.target.closest(".search-result"); if (!result) return; setSlide(Number(result.dataset.slide)); box.classList.remove("is-visible"); input.setAttribute("aria-expanded", "false"); input.focus(); });
    document.addEventListener("click", (event) => { if (!event.target.closest(".search-box")) { box.classList.remove("is-visible"); input.setAttribute("aria-expanded", "false"); } });
    document.addEventListener("keydown", (event) => { if (event.key === "/" && document.activeElement !== input && !isTypingTarget(event.target)) { event.preventDefault(); input.focus(); } });
  }

  async function togglePresentationMode() {
    const shell = $("#app-shell");
    shell.classList.toggle("is-presenting");
    if (shell.classList.contains("is-presenting")) {
      try {
        if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      } catch {
        showToast("Tarayıcı tam ekran izni vermedi; sunum görünümü açıldı.");
      }
      $("#presentation-stage").focus();
    } else if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
    }
  }

  function initDeck() {
    currentSlide = readSlideFromHash();
    setSlide(currentSlide, { updateHash: false });
    $("#previous-button").addEventListener("click", previousSlide);
    $("#next-button").addEventListener("click", nextSlide);
    $("#stage-prev").addEventListener("click", previousSlide);
    $("#stage-next").addEventListener("click", nextSlide);
    $("#progress-range").addEventListener("input", (event) => setSlide(Number(event.target.value)));
    $("#open-toc").addEventListener("click", openToc);
    $("#open-toc-inline").addEventListener("click", openToc);
    $("#close-toc").addEventListener("click", closeToc);
    $("#drawer-scrim").addEventListener("click", closeDrawers);
    $("#edit-button").addEventListener("click", openEdit);
    $("#close-edit").addEventListener("click", closeEdit);
    $("#save-edit").addEventListener("click", saveCurrentEdit);
    $("#reset-edit").addEventListener("click", resetCurrentEdit);
    $("#close-direct-edit").addEventListener("click", closeEdit);
    $("#direct-save-edit").addEventListener("click", saveCurrentEdit);
    $("#direct-cancel-edit").addEventListener("click", closeEdit);
    $("#direct-edit-title").addEventListener("input", (event) => { $("#slide-edit-title").value = event.target.value; });
    $("#direct-edit-note").addEventListener("input", (event) => { $("#slide-edit-note").value = event.target.value; });
    $("#slide-edit-title").addEventListener("input", (event) => { $("#direct-edit-title").value = event.target.value; });
    $("#slide-edit-note").addEventListener("input", (event) => { $("#direct-edit-note").value = event.target.value; });
    $("#slide-edit-canvas").addEventListener("input", (event) => {
      const source = event.target.closest?.(".editable-text");
      if (source) {
        const mirror = Array.from($("#slide-content-fields")?.querySelectorAll(".content-field") || []).find((field) => field.dataset.blockId === source.dataset.blockId);
        if (mirror) mirror.value = source.value;
      }
      persistContentDraft();
      $("#edit-current").textContent = `Slayt ${currentSlide} için düzenleme · otomatik kaydedildi`;
    });
    $("#slide-content-fields").addEventListener("input", (event) => {
      const source = event.target.closest?.(".content-field");
      if (!source) return;
      const mirror = Array.from($("#slide-edit-canvas")?.querySelectorAll(".editable-text") || []).find((field) => field.dataset.blockId === source.dataset.blockId);
      if (mirror) mirror.value = source.value;
      persistContentDraft();
      $("#edit-current").textContent = `Slayt ${currentSlide} için düzenleme · otomatik kaydedildi`;
    });
    $("#presentation-button").addEventListener("click", togglePresentationMode);
    $("#presenting-prev").addEventListener("click", previousSlide);
    $("#presenting-next").addEventListener("click", nextSlide);
    $("#presenting-exit").addEventListener("click", togglePresentationMode);
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement) $("#app-shell").classList.remove("is-presenting");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && ($("#toc-drawer").classList.contains("is-open") || $("#edit-drawer").classList.contains("is-open") || !$("#slide-direct-editor").classList.contains("is-hidden"))) { closeDrawers(); return; }
      if (isTypingTarget(event.target)) return;
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") { event.preventDefault(); nextSlide(); }
      if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); previousSlide(); }
      if (event.key === "Home") { event.preventDefault(); setSlide(1); }
      if (event.key === "End") { event.preventDefault(); setSlide(TOTAL_SLIDES); }
      if (event.key.toLowerCase() === "f") { event.preventDefault(); togglePresentationMode(); }
    });
    let pointerStart = null;
    $("#presentation-stage").addEventListener("pointerdown", (event) => {
      const insideEditor = event.target.closest?.("#slide-direct-editor, #slide-edit-canvas");
      pointerStart = insideEditor || isTypingTarget(event.target) || navigationIsLocked() ? null : event.clientX;
    });
    $("#presentation-stage").addEventListener("pointerup", (event) => {
      if (event.target.closest?.("#slide-direct-editor, #slide-edit-canvas") || navigationIsLocked()) { pointerStart = null; return; }
      if (pointerStart === null) return;
      const distance = event.clientX - pointerStart;
      if (Math.abs(distance) > 45) (distance < 0 ? nextSlide : previousSlide)();
      pointerStart = null;
    });
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateEditableScale);
      observer.observe($(".slide-frame"));
    } else {
      window.addEventListener("resize", updateEditableScale);
    }
    initSearch();
  }

  showApp();
})();
