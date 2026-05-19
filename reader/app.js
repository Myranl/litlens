const API = `${location.origin}/api`;
const D = "d" + "iv";

let articles = [];
let termsDoc = { categories: [], terms: [] };
let tagsDoc = { tags: [] };
let currentId = null;
let currentArticleTagIds = [];
let currentArticleHtml = "";
const activeTagFilters = new Set();

window.litlensCurrentId = () => currentId;
window.litlensGetArticles = () => articles;

const COLOR_PALETTE = [
  "#4f98a3", "#e8af34", "#6daa45", "#d163a7", "#fdab43", "#5591c7",
  "#a06fdf", "#dd6974", "#bb653b", "#7ec8c8", "#c8e87e", "#e87ec8",
];

let colorPickCallback = null;

const $ = (sel) => document.querySelector(sel);

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function escHtml(t) {
  return String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function textToHtml(text) {
  return text
    .split(/\n{2,}/)
    .map((p) => {
      p = p.trim();
      if (!p) return "";
      return `<p>${escHtml(p)}</p>`;
    })
    .filter(Boolean)
    .join("\n");
}

function stripHtmlToText(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body?.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
}

function mkEl(tag, className, text) {
  const node = document.createElement(tag || D);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

async function checkServer() {
  const el = $("#server-status");
  try {
    const h = await api("/health");
    el.textContent = `Data: ${h.dataRoot}`;
    el.classList.add("ok");
    return true;
  } catch {
    el.textContent = "Server not running (npm start)";
    el.classList.remove("ok");
    return false;
  }
}

function getTag(id) {
  return tagsDoc.tags.find((t) => t.id === id);
}

let metaSaveTimer = null;

function readMetadataForm() {
  const base = {
    title: $("#meta-title").value.trim(),
    authors: $("#meta-authors").value.trim(),
    year: $("#meta-year").value.trim(),
    journal: $("#meta-journal").value.trim(),
    url: $("#meta-url").value.trim(),
  };
  if (window.StructuredMeta) {
    const extra = StructuredMeta.readPayload();
    return { ...base, ...extra };
  }
  return base;
}

function fillMetadataForm(article) {
  if (!article) {
    ["meta-title", "meta-authors", "meta-year", "meta-journal", "meta-url"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    $("#meta-actions").style.display = "none";
    if (window.StructuredMeta) StructuredMeta.setFromArticle(null);
    if (window.BookmarksUI) BookmarksUI.clear();
    return;
  }
  $("#meta-title").value = article.title || "";
  $("#meta-authors").value = article.authors || "";
  $("#meta-year").value = article.year || "";
  $("#meta-journal").value = article.journal || "";
  $("#meta-url").value = article.url || "";
  $("#meta-actions").style.display = "flex";
  if (window.StructuredMeta) StructuredMeta.setFromArticle(article);
}

function scheduleSaveMetadata() {
  clearTimeout(metaSaveTimer);
  metaSaveTimer = setTimeout(() => saveMetadata(), 400);
}
window.litlensScheduleSaveMetadata = scheduleSaveMetadata;

async function saveMetadata() {
  if (!currentId) return;
  const data = readMetadataForm();
  const updated = await api(`/articles/${currentId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  const a = articles.find((x) => x.id === currentId);
  if (a) Object.assign(a, data);
  if (data.structured) a.structured = data.structured;
  $("#topbar-title").textContent = updated.title || "Untitled";
  const link = $("#source-link");
  if (updated.url) {
    link.href = updated.url;
    link.style.display = "inline-flex";
  }
  renderArticleList();
}

function fillFieldFromSelection(field) {
  const sel = window.getSelection().toString().trim();
  if (!sel) {
    alert("Select text in the article first, then click +");
    return;
  }
  const map = {
    title: "meta-title",
    authors: "meta-authors",
    year: "meta-year",
    journal: "meta-journal",
    url: "meta-url",
  };
  const id = map[field];
  if (!id) return;
  let value = sel;
  if (field === "year") {
    const m = sel.match(/\b(19|20)\d{2}\b/);
    value = m ? m[0] : sel;
  }
  $(`#${id}`).value = value;
  scheduleSaveMetadata();
}

function autofillMetadataFromSavedHtml() {
  if (!currentId) return;
  const html = currentArticleHtml || $("#article-body").innerHTML;
  if (!html || !window.LitLensMetadata) return;
  const doc = new DOMParser().parseFromString(
    html.includes("<html") ? html : `<html><body>${html}</body></html>`,
    "text/html"
  );
  const extracted = LitLensMetadata.extractMetadata(doc, $("#meta-url").value);
  if (extracted.title) $("#meta-title").value = extracted.title;
  if (extracted.authors) $("#meta-authors").value = extracted.authors;
  if (extracted.year) $("#meta-year").value = extracted.year;
  if (extracted.journal) $("#meta-journal").value = extracted.journal;
  if (extracted.url && !$("#meta-url").value) $("#meta-url").value = extracted.url;
  scheduleSaveMetadata();
}

function articleListSubtitle(a) {
  const parts = [];
  if (a.authors) {
    const first = a.authors.split(";")[0].trim();
    parts.push(a.authors.includes(";") ? `${first} et al.` : first);
  }
  if (a.year) parts.push(a.year);
  const date = new Date(a.addedAt).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
  });
  parts.push(date);
  return parts.join(" · ");
}

async function loadAll() {
  if (!(await checkServer())) return;
  [articles, termsDoc, tagsDoc] = await Promise.all([
    api("/articles"),
    api("/terms"),
    api("/tags"),
  ]);
  if (window.StructuredMeta) {
    await StructuredMeta.loadVocab();
    StructuredMeta.init();
  }
  if (!tagsDoc.tags) tagsDoc.tags = [];
  renderTagFilters();
  renderArticleList();
  renderTermsPanel();
  renderTagsPanel();
}

function showColorPicker(anchorEl, currentColor, onPick) {
  const popup = $("#color-picker-popup");
  colorPickCallback = onPick;
  popup.innerHTML = `<div class="color-pick-wrap">${COLOR_PALETTE.map(
    (c) =>
      `<div class="color-swatch${c === currentColor ? " selected" : ""}" data-color="${c}" style="background:${c}" title="${c}"></motion>`
  )
    .join("")
    .replace(/<\/?motion>/g, (t) => (t[1] === "/" ? "</motion>" : "<motion>"))
    .replace(/<motion>/g, "<motion>")
    .replace(/<\/motion>/g, "</div>")}`;
  popup.querySelectorAll(".color-swatch").forEach((sw) => {
    sw.addEventListener("click", (e) => {
      e.stopPropagation();
      if (colorPickCallback) colorPickCallback(sw.dataset.color);
      popup.classList.remove("show");
      colorPickCallback = null;
    });
  });
  const rect = anchorEl.getBoundingClientRect();
  popup.style.left = Math.min(rect.left, innerWidth - 180) + "px";
  popup.style.top = rect.bottom + 6 + "px";
  popup.classList.add("show");
}

document.addEventListener("click", (e) => {
  const popup = $("#color-picker-popup");
  if (popup.classList.contains("show") && !popup.contains(e.target)) {
    popup.classList.remove("show");
    colorPickCallback = null;
  }
});

function renderTagFilters() {
  const section = $("#tag-filter-section");
  const wrap = $("#tag-filter-wrap");
  const clearBtn = $("#tag-filter-clear");
  wrap.replaceChildren();

  if (!tagsDoc.tags.length) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";

  for (const tag of tagsDoc.tags) {
    const chip = mkEl("button", "tag-filter-chip" + (activeTagFilters.has(tag.id) ? " active" : ""));
    chip.type = "button";
    chip.textContent = tag.label;
    chip.style.background = activeTagFilters.has(tag.id) ? tag.color + "44" : "";
    chip.style.borderColor = activeTagFilters.has(tag.id) ? tag.color : "";
    chip.addEventListener("click", () => {
      if (activeTagFilters.has(tag.id)) activeTagFilters.delete(tag.id);
      else activeTagFilters.add(tag.id);
      renderTagFilters();
      renderArticleList();
    });
    wrap.appendChild(chip);
  }

  clearBtn.style.display = activeTagFilters.size ? "block" : "none";
}

$("#tag-filter-clear").addEventListener("click", () => {
  activeTagFilters.clear();
  renderTagFilters();
  renderArticleList();
});

function renderArticleList() {
  const q = $("#search-input").value.trim().toLowerCase();
  const list = $("#article-list");
  list.replaceChildren();
  const filtered = articles.filter((a) => {
    if (q) {
      const hay = [a.title, a.authors, a.journal, a.year]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (activeTagFilters.size) {
      const ids = a.tagIds || [];
      const has = [...activeTagFilters].some((tid) => ids.includes(tid));
      if (!has) return false;
    }
    return true;
  });
  if (!filtered.length) {
    const empty = mkEl("p", null, "No articles yet");
    empty.style.cssText =
      "padding:12px;text-align:center;color:var(--color-text-faint);font-size:12px";
    list.appendChild(empty);
    return;
  }
  for (const a of filtered) {
    const item = mkEl(
      D,
      "article-item" + (a.id === currentId ? " active" : "")
    );
    item.dataset.id = a.id;
    item.append(mkEl(D, "article-item-title", a.title));
    item.append(mkEl(D, "article-item-meta", articleListSubtitle(a)));
    const tagRow = mkEl(D, "article-item-tags");
    for (const tid of a.tagIds || []) {
      const tag = getTag(tid);
      if (!tag) continue;
      const dot = mkEl(D, "article-tag-dot");
      dot.style.background = tag.color;
      dot.title = tag.label;
      tagRow.appendChild(dot);
    }
    if (tagRow.childElementCount) item.appendChild(tagRow);
    item.addEventListener("click", () => selectArticle(a.id));
    list.appendChild(item);
  }
}

async function selectArticle(id) {
  currentId = id;
  const article = await api(`/articles/${id}`);
  $("#empty-state").style.display = "none";
  const body = $("#article-body");
  body.style.display = "block";
  $("#topbar-title").textContent = article.title;
  const link = $("#source-link");
  if (article.url) {
    link.href = article.url;
    link.style.display = "inline-flex";
  } else {
    link.style.display = "none";
  }
  $("#delete-btn").style.display = "flex";
  $("#notes-area").value = article.notes || "";
  currentArticleTagIds = [...(article.tagIds || [])];
  fillMetadataForm(article);
  currentArticleHtml = article.html || "";
  renderTagsPanel();

  if (article.html) {
    body.className = "article-body saved-html";
    body.innerHTML = article.html;
  } else {
    body.className = "article-body";
    body.innerHTML = textToHtml(article.text || "");
  }

  LitLensHighlight.applyHighlights(body, termsDoc);
  if (window.BookmarksUI) {
    BookmarksUI.setFromArticle(article);
    BookmarksUI.applyMarkers();
  }
  renderArticleList();
}

function renderTermsPanel() {
  const wrap = $("#terms-panel");
  wrap.replaceChildren();
  for (const cat of termsDoc.categories) {
    const group = mkEl(D, "kw-group");
    const header = mkEl(D, "kw-group-header");
    const dot = mkEl(D, "kw-group-color");
    dot.style.background = cat.color;
    dot.title = "Change color";
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      showColorPicker(dot, cat.color, async (color) => {
        cat.color = color;
        await saveTerms();
      });
    });
    const nameInput = document.createElement("input");
    nameInput.className = "kw-group-name";
    nameInput.value = cat.label;
    nameInput.dataset.catLabel = cat.id;
    const delCat = document.createElement("button");
    delCat.className = "icon-btn";
    delCat.dataset.delCat = cat.id;
    delCat.style.cssText = "width:22px;height:22px;font-size:11px";
    delCat.textContent = "✕";
    header.append(dot, nameInput, delCat);

    const chips = mkEl(D, "kw-chip-wrap");
    for (const t of termsDoc.terms.filter((x) => x.categoryId === cat.id)) {
      const chip = mkEl(D, "kw-chip");
      chip.style.background = cat.color + "33";
      chip.append(document.createTextNode(t.lemma + " "));
      const del = mkEl("span", "kw-chip-del", "×");
      del.dataset.delTerm = t.id;
      chip.appendChild(del);
      chips.appendChild(chip);
    }

    const addRow = mkEl(D, "kw-add-input");
    const inp = document.createElement("input");
    inp.className = "kw-input";
    inp.placeholder = "Add term…";
    inp.dataset.termInput = cat.id;
    const addBtn = document.createElement("button");
    addBtn.className = "kw-add-btn";
    addBtn.dataset.termAdd = cat.id;
    addBtn.textContent = "+";
    addRow.append(inp, addBtn);

    group.append(header, chips, addRow);
    wrap.appendChild(group);
  }

  wrap.querySelectorAll("[data-cat-label]").forEach((inp) => {
    inp.addEventListener("change", async () => {
      const cat = termsDoc.categories.find((c) => c.id === inp.dataset.catLabel);
      if (cat) cat.label = inp.value;
      await saveTerms();
    });
  });
  wrap.querySelectorAll("[data-term-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const inp = wrap.querySelector(`[data-term-input="${btn.dataset.termAdd}"]`);
      addTerm(btn.dataset.termAdd, inp.value.trim());
      inp.value = "";
    });
  });
  wrap.querySelectorAll("[data-term-input]").forEach((inp) => {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        addTerm(inp.dataset.termInput, inp.value.trim());
        inp.value = "";
      }
    });
  });
  wrap.querySelectorAll("[data-del-term]").forEach((el) => {
    el.addEventListener("click", async () => {
      termsDoc.terms = termsDoc.terms.filter((t) => t.id !== el.dataset.delTerm);
      await saveTerms();
    });
  });
  wrap.querySelectorAll("[data-del-cat]").forEach((el) => {
    el.addEventListener("click", async () => {
      const id = el.dataset.delCat;
      termsDoc.categories = termsDoc.categories.filter((c) => c.id !== id);
      termsDoc.terms = termsDoc.terms.filter((t) => t.categoryId !== id);
      await saveTerms();
    });
  });
}

async function addTerm(categoryId, lemma) {
  if (!lemma) return;
  const exists = termsDoc.terms.some(
    (t) => t.lemma.toLowerCase() === lemma.toLowerCase()
  );
  if (exists) return;
  termsDoc.terms.push({
    id: uid(),
    lemma,
    aliases: [],
    categoryId,
    caseSensitive: false,
  });
  await saveTerms();
}

async function saveTerms() {
  termsDoc = await api("/terms", { method: "PUT", body: JSON.stringify(termsDoc) });
  renderTermsPanel();
  if (currentId && $("#article-body").style.display !== "none") {
    LitLensHighlight.applyHighlights($("#article-body"), termsDoc);
  }
}

$("#add-category-btn").addEventListener("click", async () => {
  termsDoc.categories.push({
    id: uid(),
    label: "New category",
    color: COLOR_PALETTE[termsDoc.categories.length % COLOR_PALETTE.length],
  });
  await saveTerms();
});

async function saveTags() {
  tagsDoc = await api("/tags", { method: "PUT", body: JSON.stringify(tagsDoc) });
  renderTagFilters();
  renderArticleList();
  renderTagsPanel();
}

async function saveArticleTags() {
  if (!currentId) return;
  await api(`/articles/${currentId}`, {
    method: "PATCH",
    body: JSON.stringify({ tagIds: currentArticleTagIds }),
  });
  const a = articles.find((x) => x.id === currentId);
  if (a) a.tagIds = [...currentArticleTagIds];
  renderArticleList();
}

function renderTagsPanel() {
  const assignBlock = $("#article-tags-assign");
  const toggles = $("#article-tag-toggles");
  const defList = $("#tags-def-list");

  if (currentId && tagsDoc.tags.length) {
    assignBlock.style.display = "block";
    toggles.replaceChildren();
    for (const tag of tagsDoc.tags) {
      const on = currentArticleTagIds.includes(tag.id);
      const btn = mkEl("button", "article-tag-toggle" + (on ? " on" : ""));
      btn.type = "button";
      btn.textContent = tag.label;
      btn.style.background = on ? tag.color + "44" : "";
      btn.style.borderColor = on ? tag.color : "";
      btn.addEventListener("click", async () => {
        if (on) {
          currentArticleTagIds = currentArticleTagIds.filter((id) => id !== tag.id);
        } else {
          currentArticleTagIds.push(tag.id);
        }
        await saveArticleTags();
        renderTagsPanel();
      });
      toggles.appendChild(btn);
    }
  } else {
    assignBlock.style.display = "none";
  }

  defList.replaceChildren();
  for (const tag of tagsDoc.tags) {
    const row = mkEl(D, "tag-def-row");
    const dot = mkEl(D, "kw-group-color");
    dot.style.background = tag.color;
    dot.title = "Change color";
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      showColorPicker(dot, tag.color, async (color) => {
        tag.color = color;
        await saveTags();
      });
    });
    const nameInp = document.createElement("input");
    nameInp.value = tag.label;
    nameInp.addEventListener("change", async () => {
      tag.label = nameInp.value.trim() || tag.label;
      await saveTags();
    });
    const del = document.createElement("button");
    del.className = "icon-btn";
    del.textContent = "✕";
    del.style.cssText = "width:22px;height:22px;font-size:11px";
    del.addEventListener("click", async () => {
      if (!confirm(`Delete tag "${tag.label}"?`)) return;
      tagsDoc.tags = tagsDoc.tags.filter((t) => t.id !== tag.id);
      for (const a of articles) {
        if ((a.tagIds || []).includes(tag.id)) {
          a.tagIds = a.tagIds.filter((id) => id !== tag.id);
          await api(`/articles/${a.id}`, {
            method: "PATCH",
            body: JSON.stringify({ tagIds: a.tagIds }),
          });
        }
      }
      currentArticleTagIds = currentArticleTagIds.filter((id) => id !== tag.id);
      activeTagFilters.delete(tag.id);
      await saveTags();
    });
    row.append(dot, nameInp, del);
    defList.appendChild(row);
  }
}

function getArticleSelectionText() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return "";
  const body = $("#article-body");
  if (body && sel.rangeCount) {
    const node = sel.getRangeAt(0).commonAncestorContainer;
    if (!body.contains(node)) return "";
  }
  return sel.toString().trim().replace(/\s+/g, " ");
}

async function addTagFromInputOrSelection() {
  let name = $("#new-tag-name").value.trim();
  const fromSelection = getArticleSelectionText();
  if (!name && fromSelection) name = fromSelection;
  if (!name) {
    alert("Select text in the article or type a tag name, then click +");
    return;
  }

  const existing = tagsDoc.tags.find(
    (t) => t.label.toLowerCase() === name.toLowerCase()
  );
  if (existing) {
    if (currentId && !currentArticleTagIds.includes(existing.id)) {
      currentArticleTagIds.push(existing.id);
      await saveArticleTags();
    }
    $("#new-tag-name").value = "";
    renderTagsPanel();
    return;
  }

  const tag = {
    id: uid(),
    label: name,
    color: COLOR_PALETTE[tagsDoc.tags.length % COLOR_PALETTE.length],
  };
  tagsDoc.tags.push(tag);
  $("#new-tag-name").value = "";
  if (currentId && !currentArticleTagIds.includes(tag.id)) {
    currentArticleTagIds.push(tag.id);
    await saveArticleTags();
  }
  await saveTags();
}

$("#new-tag-btn").addEventListener("click", () => void addTagFromInputOrSelection());

$("#new-tag-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#new-tag-btn").click();
});

async function saveNotes() {
  if (!currentId) return;
  await api(`/articles/${currentId}`, {
    method: "PATCH",
    body: JSON.stringify({ notes: $("#notes-area").value }),
  });
}

$("#notes-area").addEventListener("change", saveNotes);

$("#delete-btn").addEventListener("click", async () => {
  if (!currentId || !confirm("Delete this article from disk?")) return;
  await api(`/articles/${currentId}`, { method: "DELETE" });
  currentId = null;
  $("#article-body").style.display = "none";
  $("#empty-state").style.display = "flex";
  $("#topbar-title").textContent = "Select an article";
  $("#delete-btn").style.display = "none";
  $("#source-link").style.display = "none";
  fillMetadataForm(null);
  if (window.BookmarksUI) BookmarksUI.clear();
  await loadAll();
});

document.querySelectorAll(".meta-fill-btn").forEach((btn) => {
  btn.addEventListener("click", () => fillFieldFromSelection(btn.dataset.fill));
});

["meta-title", "meta-authors", "meta-year", "meta-journal", "meta-url"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", scheduleSaveMetadata);
});

$("#meta-autofill-btn").addEventListener("click", autofillMetadataFromSavedHtml);

let modalMode = "text";
const modal = $("#modal-overlay");

function openModal() {
  modal.classList.add("show");
}
function closeModal() {
  modal.classList.remove("show");
  $("#modal-title").value = "";
  $("#modal-url").value = "";
  $("#modal-text").value = "";
  $("#modal-html").value = "";
}

document.querySelectorAll(".modal-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    modalMode = tab.dataset.modal;
    document.querySelectorAll(".modal-tab").forEach((t) => t.classList.toggle("active", t === tab));
    $("#modal-text-pane").style.display = modalMode === "text" ? "block" : "none";
    $("#modal-html-pane").style.display = modalMode === "html" ? "block" : "none";
  });
});

$("#add-article-btn").addEventListener("click", openModal);
$("#empty-add-btn").addEventListener("click", openModal);
$("#modal-cancel").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

$("#modal-save").addEventListener("click", async () => {
  const title = $("#modal-title").value.trim() || "Untitled";
  const url = $("#modal-url").value.trim();
  let html = "";
  let text = "";
  if (modalMode === "text") {
    text = $("#modal-text").value.trim();
    if (!text) return alert("Paste the article text");
    html = textToHtml(text);
  } else {
    html = $("#modal-html").value.trim();
    if (!html) return alert("Paste HTML content");
    text = stripHtmlToText(html);
  }
  let payload = { title, url, html, text };
  if (window.LitLensMetadata && html) {
    const wrap = html.includes("<html") ? html : `<html><head></head><body>${html}</body></html>`;
    const doc = new DOMParser().parseFromString(wrap, "text/html");
    const ex = LitLensMetadata.extractMetadata(doc, url);
    payload = {
      title: title || ex.title,
      url: url || ex.url,
      authors: ex.authors,
      year: ex.year,
      journal: ex.journal,
      html,
      text,
    };
  }
  const res = await fetch(`${API}/articles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 409 && body.existing) {
    alert(
      `This URL is already saved as:\n\n"${body.existing.title}"\n\nOpen it from the article list instead.`
    );
    closeModal();
    await loadAll();
    await selectArticle(body.existing.id);
    return;
  }
  if (!res.ok) {
    alert(body.message || body.error || "Could not save article");
    return;
  }
  closeModal();
  await loadAll();
  await selectArticle(body.id);
});

$("#import-html-btn").addEventListener("click", () => $("#import-html-file").click());
$("#import-html-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const html = await file.text();
  openModal();
  modalMode = "html";
  document.querySelectorAll(".modal-tab").forEach((t) => t.classList.toggle("active", t.dataset.modal === "html"));
  $("#modal-text-pane").style.display = "none";
  $("#modal-html-pane").style.display = "block";
  $("#modal-title").value = file.name.replace(/\.html?$/i, "");
  $("#modal-html").value = html;
  e.target.value = "";
});

const ctx = $("#ctx-menu");
$("#article-body").addEventListener("contextmenu", (e) => {
  const sel = window.getSelection().toString().trim();
  if (!sel) return;
  e.preventDefault();
  ctx.dataset.selection = sel;
  const box = $("#ctx-categories");
  box.replaceChildren();
  for (const c of termsDoc.categories) {
    const item = mkEl(D, "ctx-item");
    item.dataset.ctxCat = c.id;
    const dot = mkEl("span", "ctx-dot");
    dot.style.background = c.color;
    item.append(dot, document.createTextNode(`${c.label}: «${sel.slice(0, 40)}»`));
    item.addEventListener("click", () => {
      addTerm(c.id, ctx.dataset.selection);
      ctx.classList.remove("show");
    });
    box.appendChild(item);
  }
  ctx.style.left = Math.min(e.clientX, innerWidth - 220) + "px";
  ctx.style.top = Math.min(e.clientY, innerHeight - 120) + "px";
  ctx.classList.add("show");
});
document.addEventListener("click", () => ctx.classList.remove("show"));

document.querySelectorAll(".panel-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".panel-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel-content").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $(`#tab-${tab.dataset.tab}`).classList.add("active");
  });
});

async function runCrossSearch() {
  const q = $("#cross-search").value.trim();
  const box = $("#search-results");
  box.replaceChildren();
  if (!q) return;
  const hits = await api(`/search?q=${encodeURIComponent(q)}`);
  if (!hits.length) {
    box.appendChild(mkEl("p", null, "No results found"));
    return;
  }
  for (const h of hits) {
    const item = mkEl(D, "occ-item");
    item.dataset.id = h.articleId;
    const title = mkEl("strong");
    title.style.cssText = "font-size:11px;color:var(--color-primary)";
    title.textContent = h.title;
    const snippet = mkEl(D);
    snippet.style.cssText = "margin-top:4px;color:var(--color-text-muted)";
    snippet.textContent = `…${h.snippet}…`;
    item.append(title, snippet);
    item.addEventListener("click", () => selectArticle(h.articleId));
    box.appendChild(item);
  }
}

$("#cross-search-btn").addEventListener("click", runCrossSearch);
$("#cross-search").addEventListener("keydown", (e) => {
  if (e.key === "Enter") runCrossSearch();
});

$("#search-input").addEventListener("input", renderArticleList);

let theme = "dark";
$("#theme-toggle").addEventListener("click", () => {
  theme = theme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", theme);
});

loadAll();
