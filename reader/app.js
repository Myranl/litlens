const API = `${location.origin}/api`;
const D = "d" + "iv";

let articles = [];
let termsDoc = { categories: [], terms: [] };
let tagsDoc = { tags: [] };
let currentId = null;
let currentArticleTagIds = [];
let currentArticleHtml = "";
let currentArticle = null;
let currentHighlightForceShown = [];
/** @type {{ offset: number, length: number, methodLabel: string, expandToSentence: boolean } | null} */
let activePassagePin = null;
/** @type {{ methodLabel: string } | null} */
let returnToMethodCard = null;
const activeTagFilters = new Set();
const ARTICLE_STATUS_CHECKED = "checked";
const HIDE_CHECKED_KEY = "litlens-hide-checked-articles";
let hideCheckedArticles =
  typeof localStorage !== "undefined" &&
  localStorage.getItem(HIDE_CHECKED_KEY) === "1";

function isArticleChecked(article) {
  return article?.status === ARTICLE_STATUS_CHECKED;
}

/** Cache: invalidated by toggleReadParagraph, setMethodsParagraphTotal, selectArticle. */
let _paragraphReadCountsCache = null;

function invalidateParagraphReadCountsCache() {
  _paragraphReadCountsCache = null;
}

function paragraphReadCounts(article) {
  if (_paragraphReadCountsCache?.forId === article?.id) {
    return { read: _paragraphReadCountsCache.read, total: _paragraphReadCountsCache.total };
  }
  const PB = window.LitLensParagraphBlocks;
  const body =
    article?.id && currentId === article.id
      ? document.getElementById("article-body")
      : null;
  let read, total;
  if (
    body &&
    body.style.display !== "none" &&
    PB?.getMethodsSectionBlocks &&
    PB?.syncReadStateForMethodsBlocks
  ) {
    const bookmarks =
      article?.bookmarks ||
      currentArticle?.bookmarks ||
      articles.find((x) => x.id === article.id)?.bookmarks ||
      [];
    const blocks = PB.getMethodsSectionBlocks(body, bookmarks);
    const synced = PB.syncReadStateForMethodsBlocks(
      blocks,
      article?.readParagraphKeys || []
    );
    read = synced.read;
    total = synced.total;
  } else {
    total = article?.methodsParagraphTotal || 0;
    read = article?.readParagraphKeys?.length || 0;
    if (total > 0) read = Math.min(read, total);
  }
  if (article?.id) {
    _paragraphReadCountsCache = { forId: article.id, read, total };
  }
  return { read, total };
}

function isArticleParagraphReviewComplete(article) {
  const { read, total } = paragraphReadCounts(article);
  return total > 0 && read >= total;
}

function formatParagraphReadProgress(article) {
  const { read, total } = paragraphReadCounts(article);
  if (total > 0) return `${read}/${total}`;
  if (read > 0) return String(read);
  return "0";
}

function formatParagraphReadProgressTitle(article) {
  const { read, total } = paragraphReadCounts(article);
  if (total > 0 && read >= total) {
    return "All Methods paragraphs marked read — article processed";
  }
  if (total > 0) {
    return `${read} of ${total} Methods paragraphs marked read`;
  }
  if (read > 0) {
    return `${read} paragraph(s) marked read — open article to count total`;
  }
  return "Mark paragraphs Read in the Methods section";
}

function articleForReviewCheck(id) {
  if (currentId === id && currentArticle) return currentArticle;
  return articles.find((x) => x.id === id) || null;
}

async function setArticleProcessedStatus(id, processed) {
  const article = articleForReviewCheck(id);
  if (!article) return;
  if (isArticleChecked(article) === processed) return;
  const status = processed ? ARTICLE_STATUS_CHECKED : "new";
  try {
    const updated = await api(`/articles/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    const idx = articles.findIndex((x) => x.id === id);
    if (idx >= 0) {
      articles[idx] = { ...articles[idx], ...updated, status: updated.status || status };
    }
    if (currentId === id && currentArticle) {
      currentArticle = { ...currentArticle, status: updated.status || status };
    }
    updateArticleListProgress(id);
    updateLibraryStats();
    updateTopbarParagraphProgress();
  } catch (e) {
    console.error("[LitLens] setArticleProcessedStatus failed:", e);
  }
}

async function syncArticleProcessedStatus(id) {
  const article = articleForReviewCheck(id);
  if (!article) return;
  await setArticleProcessedStatus(id, isArticleParagraphReviewComplete(article));
}
window.litlensSyncArticleProcessedStatus = syncArticleProcessedStatus;

function updateArticleListProgress(id) {
  const article = articles.find((x) => x.id === id);
  if (!article) return;
  const item = document.querySelector(
    `.article-item[data-id="${CSS.escape(id)}"]`
  );
  if (!item) return;
  const badge = item.querySelector(".article-item-read-progress");
  if (badge) {
    badge.textContent = formatParagraphReadProgress(article);
    badge.title = formatParagraphReadProgressTitle(article);
    badge.classList.toggle(
      "article-item-read-progress--done",
      isArticleParagraphReviewComplete(article)
    );
  }
  item.classList.toggle("article-item--checked", isArticleChecked(article));
}

function updateTopbarParagraphProgress() {
  const el = $("#topbar-paragraph-progress");
  if (!el) return;
  const show = Boolean(currentId);
  el.hidden = !show;
  if (!show) return;
  const article = articleForReviewCheck(currentId);
  if (!article) {
    el.hidden = true;
    return;
  }
  const { read, total } = paragraphReadCounts(article);
  el.textContent =
    total > 0
      ? `${read}/${total} ¶ read`
      : read > 0
        ? `${read} ¶ read`
        : "0 ¶ read";
  el.title = formatParagraphReadProgressTitle(article);
  el.classList.toggle(
    "topbar-paragraph-progress--done",
    isArticleParagraphReviewComplete(article)
  );
}

function clearActivePassagePin() {
  const body = document.getElementById("article-body");
  if (body && window.LitLensBookmarks?.clearMethodEvidencePin) {
    LitLensBookmarks.clearMethodEvidencePin(body);
  }
  activePassagePin = null;
}

function resolvePassageForBody(body, pin) {
  if (!pin || pin.offset == null) return pin;
  const BM = window.LitLensBookmarks;
  const PL = window.LitLensPassageLinks;
  if (!BM || !PL?.findPassageInPlain || !pin.quote) {
    return { ...pin, citationOffsets: Boolean(pin.quote) };
  }

  const citationPlain = BM.extractCitationPlainText?.(body) || "";
  const fullPlain = BM.extractPlainText?.(body) || "";
  let resolved = PL.findPassageInPlain(citationPlain || fullPlain, pin);
  let citationOffsets = Boolean(citationPlain);

  if (fullPlain && citationPlain && fullPlain !== citationPlain) {
    const alt = PL.findPassageInPlain(fullPlain, pin);
    const citeOk = PL.sliceMatchesQuote?.(
      citationPlain,
      resolved.offset,
      resolved.length,
      pin.quote
    );
    const fullOk = PL.sliceMatchesQuote?.(
      fullPlain,
      alt.offset,
      alt.length,
      pin.quote
    );
    if (fullOk && !citeOk) {
      resolved = alt;
      citationOffsets = false;
    }
  }

  return {
    ...pin,
    offset: resolved.offset,
    length: resolved.length,
    citationOffsets,
  };
}

function applyActivePassagePin(opts = {}) {
  if (!activePassagePin) return false;
  const body = document.getElementById("article-body");
  if (!body || body.style.display === "none" || !window.LitLensBookmarks?.scrollToTextSpan) {
    return false;
  }
  const pin = resolvePassageForBody(body, activePassagePin);
  const { offset, length, methodLabel, expandToSentence, citationOffsets } = pin;
  return LitLensBookmarks.scrollToTextSpan(body, offset, length || 20, {
    persistent: true,
    methodLabel,
    expandToSentence: expandToSentence === true,
    citationOffsets: pin.citationOffsets !== false,
    scroll: opts.scroll !== false,
  });
}

function ensureTopbarMethodBackButton() {
  let btn = document.getElementById("topbar-method-back");
  if (!btn) {
    const topbar = document.getElementById("topbar");
    if (!topbar) return null;
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "topbar-method-back";
    btn.className = "btn-sm btn-ghost topbar-method-back";
    btn.hidden = true;
    btn.title = "Return to method card";
    btn.textContent = "← Method";
    topbar.insertBefore(btn, topbar.firstChild);
  }
  if (!btn.dataset.bound) {
    btn.dataset.bound = "1";
    btn.addEventListener("click", onTopbarMethodBackClick);
  }
  return btn;
}

function onTopbarMethodBackClick() {
  const label = returnToMethodCard?.methodLabel;
  if (!label) return;
  returnToMethodCard = null;
  updateTopbarMethodBack();
  clearActivePassagePin();
  if (window.LitLensMethodsMap?.openMethodCard) {
    void window.LitLensMethodsMap.openMethodCard(label);
  }
}

function updateTopbarMethodBack() {
  const btn = ensureTopbarMethodBackButton();
  if (!btn) return;
  const label = String(returnToMethodCard?.methodLabel || "").trim();
  if (!label) {
    btn.hidden = true;
    btn.removeAttribute("style");
    return;
  }
  btn.hidden = false;
  btn.removeAttribute("style");
  btn.textContent = `← ${label}`;
}

function clearActiveMethodEvidencePin() {
  clearActivePassagePin();
}

window.litlensPinMethodEvidence = (pin, opts = {}) => {
  if (!pin || pin.offset == null) {
    clearActivePassagePin();
    return false;
  }
  const sentenceBounds = pin.sentenceBounds === true;
  activePassagePin = {
    offset: pin.offset,
    length: pin.length || 20,
    methodLabel: pin.methodLabel || "",
    sentenceBounds,
    expandToSentence: !sentenceBounds && pin.expandToSentence !== false,
  };
  return applyActivePassagePin(opts);
};
window.litlensReapplyMethodEvidencePin = (opts) => applyActivePassagePin(opts);
window.litlensClearMethodEvidencePin = clearActivePassagePin;

window.litlensCurrentId = () => currentId;
window.litlensGetArticleContext = () => ({
  article: currentArticle,
  bookmarks: currentArticle?.bookmarks || [],
  body: document.getElementById("article-body"),
});
window.litlensGetArticles = () => articles;
window.litlensSelectArticle = (id, options) => selectArticle(id, options);
window.litlensGetTermsDoc = () => termsDoc;
window.litlensSaveTermsDoc = async (doc) => {
  termsDoc = await api("/terms", { method: "PUT", body: JSON.stringify(doc) });
  if (!termsDoc.categoryColumnLinks) termsDoc.categoryColumnLinks = {};
  renderTermsPanel();
  refreshArticleHighlights();
};
window.litlensRenderTermsPanel = () => renderTermsPanel();
window.litlensOnColumnLinksChanged = () => {
  if (currentArticle) reconcileAndSaveHighlightForceShown(currentArticle);
  renderTermsPanel();
  refreshArticleHighlights();
};

const COLOR_PALETTE = [
  "#4f98a3", "#e8af34", "#6daa45", "#d163a7", "#fdab43", "#5591c7",
  "#a06fdf", "#dd6974", "#bb653b", "#7ec8c8", "#c8e87e", "#e87ec8",
];

let colorPickCallback = null;

const $ = (sel) => document.querySelector(sel);

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Prepare saved HTML for display in the reader. */
function prepareArticleDisplayHtml(article) {
  let html = article.html || "";
  if (!html) return textToHtml(article.text || "");

  if (
    window.LitLensArticleExtract &&
    !LitLensArticleExtract.isCleanExtractedHtml(html) &&
    (html.includes('data-core-wrapper="header"') ||
      html.includes('id="bodymatter"'))
  ) {
    const wrap = html.includes("<html")
      ? html
      : `<html><head></head><body>${html}</body></html>`;
    const doc = new DOMParser().parseFromString(wrap, "text/html");
    const extracted = LitLensArticleExtract.extractArticleContent(doc.body);
    if ((extracted.text || "").length > 200) html = extracted.html;
  }

  if (!/<h1[\s>]/i.test(html) && article.title) {
    const metaBits = [
      article.authors ? `<p class="litlens-article-authors">${escapeHtml(article.authors)}</p>` : "",
      article.journal || article.year
        ? `<p class="litlens-article-meta">${escapeHtml(
            [article.journal, article.year].filter(Boolean).join(" · ")
          )}</p>`
        : "",
    ].join("");
    html =
      `<header class="litlens-article-header"><h1>${escapeHtml(article.title)}</h1>${metaBits}</header>` +
      html;
  }
  return html;
}

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
window.litlensApi = api;

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
let metaSideEffectsTimer = null;
let metaSaveInFlight = false;
let metaSavePendingKind = null;
/** @type {"scalar" | "full"} */
let metaSaveQueuedKind = "scalar";

function readScalarFields() {
  return {
    title: $("#meta-title").value.trim(),
    authors: $("#meta-authors").value.trim(),
    year: $("#meta-year").value.trim(),
    journal: $("#meta-journal").value.trim(),
    url: $("#meta-url").value.trim(),
    nAnimals: ($("meta-n-animals")?.value || "").trim(),
    cellFilterCriterion: ($("meta-cell-filter")?.value || "").trim(),
  };
}

function readMetadataForm() {
  const base = readScalarFields();
  if (window.StructuredMeta) {
    const extra = StructuredMeta.readPayload();
    if (currentArticle?.methodsParagraphTotal != null) {
      extra.methodsParagraphTotal = currentArticle.methodsParagraphTotal;
    }
    return { ...base, ...extra };
  }
  return base;
}

function fillMetadataForm(article) {
  if (!article) {
    ["meta-title", "meta-authors", "meta-year", "meta-journal", "meta-url", "meta-n-animals", "meta-cell-filter"].forEach((id) => {
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

function scheduleSaveMetadata({ structured = false } = {}) {
  if (structured) metaSaveQueuedKind = "full";
  clearTimeout(metaSaveTimer);
  const delay = metaSaveQueuedKind === "full" ? 500 : 1000;
  metaSaveTimer = setTimeout(() => {
    const kind = metaSaveQueuedKind;
    metaSaveQueuedKind = "scalar";
    void flushMetadataSave(kind);
  }, delay);
}
window.litlensScheduleSaveMetadata = scheduleSaveMetadata;

async function flushMetadataSave(kind) {
  if (metaSaveInFlight) {
    if (kind === "full") metaSavePendingKind = "full";
    else if (metaSavePendingKind !== "full") metaSavePendingKind = "scalar";
    return;
  }
  metaSaveInFlight = true;
  try {
    if (kind === "full") await saveMetadataFull();
    else await saveMetadataScalars();
  } finally {
    metaSaveInFlight = false;
    if (metaSavePendingKind) {
      const next = metaSavePendingKind;
      metaSavePendingKind = null;
      void flushMetadataSave(next);
    }
  }
}

function updateCurrentArticleListItem(article) {
  if (!currentId || !article) return;
  const item = document.querySelector(
    `.article-item[data-id="${CSS.escape(currentId)}"]`
  );
  if (!item) return;
  const titleEl = item.querySelector(".article-item-title");
  const metaEl = item.querySelector(".article-item-meta");
  if (titleEl) titleEl.textContent = article.title || "Untitled";
  if (metaEl) metaEl.textContent = articleListSubtitle(article);
}

function scheduleMetadataSideEffects(article) {
  const articleId = currentId;
  clearTimeout(metaSideEffectsTimer);
  metaSideEffectsTimer = setTimeout(async () => {
    metaSideEffectsTimer = null;
    if (!articleId || currentId !== articleId) return;
    // Persist column-link prefs only; article DOM refresh on reopen.
    await reconcileAndSaveHighlightForceShown(article, { skipRefresh: true });
  }, 700);
}

function getFilteredTermsDoc() {
  if (!window.LitLensColumnLinks || !currentArticle) return termsDoc;
  return LitLensColumnLinks.filterTermsForArticle(termsDoc, {
    ...currentArticle,
    highlightForceShown: currentHighlightForceShown,
  });
}

function refreshMethodAssociationHighlights(body) {
  if (!body || !window.LitLensHighlight?.applyMethodAssociationHighlights) return;
  if (!window.LitLensMethodProfiles || !window.StructuredMeta?.getVocab) {
    LitLensHighlight.removeMethodAssociationHighlights?.(body);
    return;
  }
  const vocab = StructuredMeta.getVocab();
  if (!vocab) {
    LitLensHighlight.removeMethodAssociationHighlights(body);
    return;
  }
  const selected = StructuredMeta.getSelectedMethods?.() || [];
  const patterns = LitLensMethodProfiles.getAssociationHighlightPatterns(
    vocab,
    selected
  );
  LitLensHighlight.applyMethodAssociationHighlights(body, patterns);
}

function collectMethodEvidenceLinks() {
  const evidence =
    window.StructuredMeta?.getMethodEvidence?.() ||
    currentArticle?.methodEvidence ||
    {};
  const links = [];
  for (const [methodLabel, entries] of Object.entries(evidence)) {
    for (const entry of entries || []) {
      if (entry?.offset == null) continue;
      links.push({
        offset: entry.offset,
        length: entry.length || 20,
        methodLabel,
      });
    }
  }
  return links;
}

function articleHasMethodEvidence(article) {
  const evidence = article?.methodEvidence;
  if (!evidence || typeof evidence !== "object") return false;
  return Object.values(evidence).some(
    (entries) => Array.isArray(entries) && entries.length
  );
}

function articleNeedsMethodsParagraphUi(article) {
  if (!article) return false;
  const bookmarks = article.bookmarks || [];
  if (bookmarks.some((b) => /^methods$/i.test(String(b.label || "").trim()))) {
    return true;
  }
  if (Array.isArray(article.readParagraphKeys) && article.readParagraphKeys.length) {
    return true;
  }
  if (articleHasMethodEvidence(article)) return true;
  return false;
}

function articleHasSavedStudyMetadata(article) {
  return window.LitLensColumnLinks?.articleHasSavedStudyMetadata?.(article) === true;
}

function articleMethodsAreUnset(article) {
  return window.LitLensColumnLinks?.articleMethodsAreUnset?.(article) !== false;
}

function refreshMethodEvidenceLinks(body) {
  if (!body || !window.LitLensBookmarks?.applyMethodEvidenceLinks) return;
  const links = collectMethodEvidenceLinks();
  LitLensBookmarks.applyMethodEvidenceLinks(body, links);
}

function appendOneMethodEvidenceLink(link) {
  const body = $("#article-body");
  if (!body || body.style.display === "none") return false;
  if (!window.LitLensBookmarks?.appendMethodEvidenceLink) return false;
  return LitLensBookmarks.appendMethodEvidenceLink(body, link);
}
window.litlensAppendMethodEvidenceLink = appendOneMethodEvidenceLink;

function bindMethodEvidenceLinkInteractions() {
  document.getElementById("litlens-method-linked-tooltip")?.remove();
  const body = document.getElementById("article-body");
  if (!body || body.dataset.methodLinksBound) return;
  body.dataset.methodLinksBound = "1";

  body.addEventListener("click", (e) => {
    const mark = e.target.closest?.("mark.litlens-method-linked");
    if (!mark) return;
    const label = String(mark.dataset.methodLabel || "").trim();
    if (!label || !window.LitLensMethodsMap?.openMethodCard) return;
    e.preventDefault();
    e.stopPropagation();
    void window.LitLensMethodsMap.openMethodCard(label);
  });
}

function refreshArticleHighlights(opts = {}) {
  const body = $("#article-body");
  if (!body || body.style.display === "none" || !window.LitLensHighlight) return;
  const { skipTerms = false, skipAssociation = false, skipEvidence = false } = opts;
  if (!skipTerms) {
    LitLensHighlight.applyHighlights(body, getFilteredTermsDoc());
  }
  if (!skipAssociation) {
    refreshMethodAssociationHighlights(body);
  }
  if (!skipEvidence) {
    refreshMethodEvidenceLinks(body);
  }
  if (activePassagePin) {
    applyActivePassagePin({ scroll: false });
  }
}
window.litlensRefreshHighlights = refreshArticleHighlights;

/** Margin notes + read marks — one deferred pass per article open. */
let paragraphAnnotationsIdle = 0;

function invalidateParagraphBlockCache(body) {
  window.LitLensParagraphBlocks?.invalidateBlocksForBody?.(body);
}

function refreshParagraphAnnotationsNow() {
  window.ArticleParagraphRead?.refreshCombined?.() ||
    window.ArticleParagraphRead?.refresh?.();
}

function scheduleParagraphAnnotationsRefresh() {
  if (typeof cancelIdleCallback === "function" && paragraphAnnotationsIdle) {
    cancelIdleCallback(paragraphAnnotationsIdle);
  } else if (paragraphAnnotationsIdle) {
    clearTimeout(paragraphAnnotationsIdle);
  }
  paragraphAnnotationsIdle = 0;
  const run = () => {
    paragraphAnnotationsIdle = 0;
    refreshParagraphAnnotationsNow();
  };
  if (typeof requestIdleCallback === "function") {
    paragraphAnnotationsIdle = requestIdleCallback(run, { timeout: 1200 });
  } else {
    paragraphAnnotationsIdle = window.setTimeout(run, 150);
  }
}

function refreshArticleMethodRail() {
  scheduleParagraphAnnotationsRefresh();
}
window.litlensRefreshArticleMethodRail = refreshArticleMethodRail;

function refreshArticleParagraphRead() {
  scheduleParagraphAnnotationsRefresh();
}
window.litlensRefreshArticleParagraphRead = refreshArticleParagraphRead;
window.litlensScheduleParagraphAnnotationsRefresh = scheduleParagraphAnnotationsRefresh;

let readParagraphSaveTimer = 0;
let readParagraphSaveInFlight = false;
let readParagraphSavePending = false;
/** @type {Promise<void> | null} */
let readParagraphSavePromise = null;

async function saveReadParagraphsNow(articleId = currentId) {
  if (!articleId || !window.StructuredMeta?.getReadParagraphKeys) return;
  let keys = StructuredMeta.getReadParagraphKeys();
  const article = articles.find((x) => x.id === articleId);
  let total =
    articleId === currentId
      ? currentArticle?.methodsParagraphTotal || 0
      : article?.methodsParagraphTotal || 0;
  if (articleId === currentId) {
    const body = document.getElementById("article-body");
    const PB = window.LitLensParagraphBlocks;
    if (
      body &&
      body.style.display !== "none" &&
      PB?.syncReadStateForMethodsBlocks
    ) {
      const blocks = PB.getMethodsSectionBlocks(
        body,
        currentArticle?.bookmarks || []
      );
      const synced = PB.syncReadStateForMethodsBlocks(blocks, keys);
      keys = synced.keys;
      total = synced.total;
    }
  }
  try {
    const updated = await api(`/articles/${articleId}`, {
      method: "PATCH",
      body: JSON.stringify({
        readParagraphKeys: keys,
        readParagraphOffsets: [],
        methodsParagraphTotal: total,
      }),
    });
    const a = articles.find((x) => x.id === articleId);
    if (a) {
      a.readParagraphKeys = [...keys];
      a.readParagraphOffsets = [];
      a.methodsParagraphTotal = updated?.methodsParagraphTotal ?? total;
    }
    if (currentId === articleId && currentArticle) {
      currentArticle.readParagraphKeys = [...keys];
      currentArticle.readParagraphOffsets = [];
      currentArticle.methodsParagraphTotal =
        updated?.methodsParagraphTotal ?? total;
    }
    if (currentId === articleId) {
      updateArticleListProgress(articleId);
      updateTopbarParagraphProgress();
      await syncArticleProcessedStatus(articleId);
    }
  } catch (e) {
    console.error("[LitLens] save read paragraphs failed:", e);
  }
}

async function flushReadParagraphsSave() {
  clearTimeout(readParagraphSaveTimer);
  readParagraphSaveTimer = 0;
  if (readParagraphSaveInFlight && readParagraphSavePromise) {
    readParagraphSavePending = true;
    await readParagraphSavePromise;
    if (readParagraphSavePending && currentId) {
      readParagraphSavePending = false;
      return flushReadParagraphsSave();
    }
    readParagraphSavePending = false;
    return;
  }
  if (!currentId) return;
  const articleId = currentId;
  readParagraphSaveInFlight = true;
  readParagraphSavePromise = saveReadParagraphsNow(articleId);
  try {
    await readParagraphSavePromise;
  } finally {
    readParagraphSaveInFlight = false;
    readParagraphSavePromise = null;
    if (readParagraphSavePending && currentId === articleId) {
      readParagraphSavePending = false;
      await flushReadParagraphsSave();
    } else {
      readParagraphSavePending = false;
    }
  }
}
window.litlensFlushReadParagraphsSave = flushReadParagraphsSave;

function setMethodsParagraphTotal(total) {
  if (!currentId || !currentArticle) return;
  const n = Math.max(0, Math.floor(total));
  const prev = currentArticle.methodsParagraphTotal || 0;
  currentArticle.methodsParagraphTotal = n;
  const a = articles.find((x) => x.id === currentId);
  if (a) a.methodsParagraphTotal = n;
  invalidateParagraphReadCountsCache();
  updateTopbarParagraphProgress();
  updateArticleListProgress(currentId);
  if (n !== prev) {
    scheduleSaveReadParagraphs();
  } else {
    void syncArticleProcessedStatus(currentId);
  }
}
window.litlensSetMethodsParagraphTotal = setMethodsParagraphTotal;

function applyReadParagraphKeysLocal(keys) {
  if (!currentId) return;
  const list = [...keys];
  if (currentArticle) currentArticle.readParagraphKeys = list;
  const a = articles.find((x) => x.id === currentId);
  if (a) a.readParagraphKeys = list;
  invalidateParagraphReadCountsCache();
  updateArticleListProgress(currentId);
  updateTopbarParagraphProgress();
  void syncArticleProcessedStatus(currentId);
}
window.litlensApplyReadParagraphKeysLocal = applyReadParagraphKeysLocal;

function scheduleSaveReadParagraphs() {
  clearTimeout(readParagraphSaveTimer);
  readParagraphSaveTimer = window.setTimeout(() => {
    readParagraphSaveTimer = 0;
    void flushReadParagraphsSave();
  }, 280);
}
window.litlensSaveReadParagraphs = scheduleSaveReadParagraphs;

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    void flushReadParagraphsSave();
  }
});

/** Lighter refresh when only method links / association change (not all term highlights). */
function refreshMethodMetaHighlights(kind = "both", { reapplyPin = true } = {}) {
  const body = $("#article-body");
  if (!body || body.style.display === "none") return;
  if (kind === "association" || kind === "both") {
    refreshMethodAssociationHighlights(body);
  }
  if (kind === "evidence" || kind === "both") {
    refreshMethodEvidenceLinks(body);
  }
  if (reapplyPin && activePassagePin) {
    applyActivePassagePin({ scroll: false });
  }
}
window.litlensRefreshMethodMetaHighlights = refreshMethodMetaHighlights;

async function reconcileAndSaveHighlightForceShown(article, { skipRefresh = false } = {}) {
  if (!currentId || !window.LitLensColumnLinks) return;
  const next = LitLensColumnLinks.reconcileHighlightForceShown(
    { ...article, highlightForceShown: currentHighlightForceShown },
    termsDoc
  );
  const prev = [...currentHighlightForceShown].sort().join(",");
  const nxt = [...next].sort().join(",");
  if (prev !== nxt) {
    currentHighlightForceShown = next;
    await api(`/articles/${currentId}`, {
      method: "PATCH",
      body: JSON.stringify({ highlightForceShown: next }),
    });
    const a = articles.find((x) => x.id === currentId);
    if (a) a.highlightForceShown = [...next];
    if (currentArticle) currentArticle.highlightForceShown = [...next];
  }
  if (!skipRefresh && prev !== nxt) refreshArticleHighlights();
}

async function toggleHighlightForceShown(categoryId) {
  if (!currentId) return;
  const set = new Set(currentHighlightForceShown);
  if (set.has(categoryId)) set.delete(categoryId);
  else set.add(categoryId);
  currentHighlightForceShown = [...set];
  await api(`/articles/${currentId}`, {
    method: "PATCH",
    body: JSON.stringify({ highlightForceShown: currentHighlightForceShown }),
  });
  const a = articles.find((x) => x.id === currentId);
  if (a) a.highlightForceShown = [...currentHighlightForceShown];
  if (currentArticle) {
    currentArticle.highlightForceShown = [...currentHighlightForceShown];
  }
  refreshArticleHighlights();
  renderTermsPanel();
}

function applyScalarMetaToUi(updated) {
  $("#topbar-title").textContent = updated.title || "Untitled";
  const link = $("#source-link");
  if (updated.url) {
    link.href = updated.url;
    link.style.display = "inline-flex";
  } else {
    link.style.display = "none";
  }
  updateCurrentArticleListItem(updated);
}

async function saveMetadataScalars() {
  if (!currentId) return;
  const data = readScalarFields();
  const updated = await api(`/articles/${currentId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  const a = articles.find((x) => x.id === currentId);
  if (a) Object.assign(a, data);
  if (currentArticle) Object.assign(currentArticle, updated);
  applyScalarMetaToUi(updated);
  updateTopbarParagraphProgress();
}

async function saveMetadataFull() {
  if (!currentId) return;
  const data = readMetadataForm();
  const updated = await api(`/articles/${currentId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  const a = articles.find((x) => x.id === currentId);
  if (a) {
    Object.assign(a, data);
    if (data.structured) a.structured = data.structured;
  }
  if (currentArticle) Object.assign(currentArticle, updated);
  applyScalarMetaToUi(updated);
  scheduleMetadataSideEffects(updated);
  updateTopbarParagraphProgress();
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
    nAnimals: "meta-n-animals",
    cellFilterCriterion: "meta-cell-filter",
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
  if (!termsDoc.categoryColumnLinks) termsDoc.categoryColumnLinks = {};
  updateLibraryStats();
  renderTagFilters();
  renderArticleList();
  renderTermsPanel();
  renderTagsPanel();
  updateTopbarParagraphProgress();
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

function getArticleTagCounts() {
  const byTag = new Map();
  for (const tag of tagsDoc.tags || []) byTag.set(tag.id, 0);
  for (const a of articles) {
    for (const tid of a.tagIds || []) {
      if (byTag.has(tid)) byTag.set(tid, byTag.get(tid) + 1);
    }
  }
  return { total: articles.length, byTag };
}

function tagLabelWithCount(tag, byTag) {
  const n = byTag.get(tag.id) || 0;
  return `${tag.label} (${n})`;
}

function updateLibraryStats() {
  const { total } = getArticleTagCounts();
  const checkedCount = articles.filter((a) => isArticleChecked(a)).length;
  const short =
    checkedCount > 0
      ? `${total} articles · ${checkedCount} processed`
      : total === 1
        ? "1 article"
        : `${total} articles`;
  const full =
    checkedCount > 0
      ? `${total} articles in library · ${checkedCount} processed`
      : total === 1
        ? "1 article in library"
        : `${total} articles in library`;
  const sidebar = document.getElementById("sidebar-library-stats");
  if (sidebar) sidebar.textContent = short;
  const tagsTab = document.getElementById("tags-library-stats");
  if (tagsTab) tagsTab.textContent = full;
  const manage = document.getElementById("tags-manage-label");
  if (manage) {
    manage.textContent =
      total === 1
        ? `Manage tags (${total} article)`
        : `Manage tags (${total} articles)`;
  }
}

/** @deprecated */
function renderTagsLibraryStats() {
  updateLibraryStats();
}

function renderTagFilters() {
  const section = $("#tag-filter-section");
  const wrap = $("#tag-filter-wrap");
  const clearBtn = $("#tag-filter-clear");
  const labelEl = section?.querySelector(".tag-filter-label");
  wrap.replaceChildren();
  const { total, byTag } = getArticleTagCounts();
  updateLibraryStats();

  if (!tagsDoc.tags.length) {
    section.style.display = "none";
    return;
  }
  section.style.display = "block";
  if (labelEl) {
    labelEl.textContent =
      total === 1
        ? `Filter by tag (${total} article)`
        : `Filter by tag (${total} articles)`;
  }

  for (const tag of tagsDoc.tags) {
    const chip = mkEl("button", "tag-filter-chip" + (activeTagFilters.has(tag.id) ? " active" : ""));
    chip.type = "button";
    chip.textContent = tagLabelWithCount(tag, byTag);
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

/** Toggle active row only — avoids rebuilding the whole library list on every open. */
function updateArticleListActive(id) {
  const list = $("#article-list");
  if (!list) return;
  for (const item of list.querySelectorAll(".article-item")) {
    item.classList.toggle("active", item.dataset.id === id);
  }
}

function renderArticleList() {
  updateLibraryStats();
  const list = $("#article-list");
  list.replaceChildren();
  const filtered = articles.filter((a) => {
    if (hideCheckedArticles && isArticleChecked(a)) return false;
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
    const done = isArticleParagraphReviewComplete(a);
    const item = mkEl(
      D,
      "article-item" +
        (a.id === currentId ? " active" : "") +
        (isArticleChecked(a) ? " article-item--checked" : "")
    );
    item.dataset.id = a.id;

    const progressBadge = document.createElement("span");
    progressBadge.className =
      "article-item-read-progress" +
      (done ? " article-item-read-progress--done" : "");
    progressBadge.textContent = formatParagraphReadProgress(a);
    progressBadge.title = formatParagraphReadProgressTitle(a);

    const body = mkEl(D, "article-item-body");
    body.append(mkEl(D, "article-item-title", a.title));
    body.append(mkEl(D, "article-item-meta", articleListSubtitle(a)));
    const tagRow = mkEl(D, "article-item-tags");
    for (const tid of a.tagIds || []) {
      const tag = getTag(tid);
      if (!tag) continue;
      const dot = mkEl(D, "article-tag-dot");
      dot.style.background = tag.color;
      dot.title = tag.label;
      tagRow.appendChild(dot);
    }
    if (tagRow.childElementCount) body.appendChild(tagRow);

    item.append(progressBadge, body);
    item.addEventListener("click", () => selectArticle(a.id));
    list.appendChild(item);
  }
}

let articleSwitchGen = 0;

async function selectArticle(id, options = {}) {
  const switchGen = ++articleSwitchGen;
  if (window.StructuredMeta?.cancelScheduledSuggest) {
    StructuredMeta.cancelScheduledSuggest();
  }
  if (currentId && currentId !== id) {
    await flushReadParagraphsSave();
  }
  clearTimeout(metaSideEffectsTimer);
  metaSideEffectsTimer = null;
  clearTimeout(readParagraphSaveTimer);
  readParagraphSaveTimer = 0;
  if (window.LitLensMethodsMap?.isOpen?.()) {
    window.LitLensMethodsMap.hide();
  }
  const scrollToTextSpan = options.scrollToTextSpan || null;
  const backLabel = String(options.returnToMethodLabel || "").trim();
  if (backLabel) {
    returnToMethodCard = { methodLabel: backLabel };
  } else if (!options.keepReturnToMethod) {
    returnToMethodCard = null;
  }
  updateTopbarMethodBack();

  if (scrollToTextSpan && scrollToTextSpan.offset != null) {
    const expandToSentence = scrollToTextSpan.expandToSentence === true;
    activePassagePin = {
      offset: scrollToTextSpan.offset,
      length: scrollToTextSpan.length || 20,
      methodLabel: scrollToTextSpan.methodLabel || "",
      expandToSentence,
      quote: scrollToTextSpan.quote || "",
    };
  } else {
    activePassagePin = null;
  }
  currentId = id;
  const article = await api(`/articles/${id}`);
  if (switchGen !== articleSwitchGen) return;
  currentArticle = article;
  currentHighlightForceShown = Array.isArray(article.highlightForceShown)
    ? [...article.highlightForceShown]
    : [];
  $("#empty-state").style.display = "none";
  const body = $("#article-body");
  body.style.display = "block";
  $("#topbar-title").textContent = article.title;
  updateTopbarMethodBack();
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

  window.ArticleMethodRail?.clear?.(body);
  window.ArticleParagraphRead?.clear?.(body);
  invalidateParagraphBlockCache(body);
  invalidateParagraphReadCountsCache();
  if (article.html) {
    body.className = "article-body saved-html";
    const displayHtml = prepareArticleDisplayHtml(article);
    currentArticleHtml = displayHtml;
    body.innerHTML = displayHtml;
  } else {
    currentArticleHtml = "";
    body.className = "article-body";
    body.innerHTML = textToHtml(article.text || "");
  }

  if (switchGen !== articleSwitchGen) return;

  fillMetadataForm(article);
  renderTagsPanel();
  updateArticleListActive(id);
  updateTopbarParagraphProgress();

  void reconcileAndSaveHighlightForceShown(article, { skipRefresh: true });
  if (switchGen !== articleSwitchGen) return;

  const savedStudyMeta = articleHasSavedStudyMetadata(article);
  const methodsUnset = articleMethodsAreUnset(article);
  const needsMethodsParagraphUi = articleNeedsMethodsParagraphUi(article);
  const selectedMethods = article.structured?.methods || [];
  const hasMethodEvidence = articleHasMethodEvidence(article);

  const runPostLoadHeavy = () => {
    if (switchGen !== articleSwitchGen) return;
    const body = $("#article-body");
    if (!body || body.style.display === "none") return;
    if (selectedMethods.length) {
      refreshMethodAssociationHighlights(body);
    }
    const afterSections = () => {
      if (switchGen !== articleSwitchGen) return;
      const liveArticle = currentArticle || article;
      if (articleNeedsMethodsParagraphUi(liveArticle)) {
        scheduleParagraphAnnotationsRefresh();
      }
      if (activePassagePin) {
        requestAnimationFrame(() => {
          window.setTimeout(
            () => applyActivePassagePin({ scroll: true }),
            120
          );
        });
      }
    };
    if (window.BookmarksUI) {
      void BookmarksUI.autoDetectSectionsIfNeeded({
        scrollToMethods: !scrollToTextSpan && !methodsUnset,
        skipDetect: savedStudyMeta,
      }).then(afterSections);
    } else {
      afterSections();
    }
  };

  const runPostLoad = () => {
    if (switchGen !== articleSwitchGen) return;
    try {
      const applyHighlights = () => {
        if (switchGen !== articleSwitchGen) return;
        refreshArticleHighlights({
          skipAssociation: true,
          skipEvidence: !hasMethodEvidence,
        });
      };
      if (window.BookmarksUI) {
        BookmarksUI.setFromArticle(article);
        BookmarksUI.applyMarkers();
      }
      if (methodsUnset) {
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(applyHighlights, { timeout: 2500 });
        } else {
          setTimeout(applyHighlights, 200);
        }
      } else {
        applyHighlights();
      }
      if (
        savedStudyMeta &&
        methodsUnset &&
        !needsMethodsParagraphUi &&
        !selectedMethods.length
      ) {
        if (activePassagePin) {
          requestAnimationFrame(() => {
            window.setTimeout(
              () => applyActivePassagePin({ scroll: true }),
              120
            );
          });
        }
        return;
      }
      if (methodsUnset && !savedStudyMeta && !selectedMethods.length) {
        if (window.BookmarksUI) {
          void BookmarksUI.autoDetectSectionsIfNeeded({
            scrollToMethods: false,
            skipDetect: false,
          }).then(() => {
            if (switchGen !== articleSwitchGen) return;
            scheduleParagraphAnnotationsRefresh();
          });
        }
        return;
      }
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(runPostLoadHeavy, { timeout: 3000 });
      } else {
        setTimeout(runPostLoadHeavy, 250);
      }
    } catch (e) {
      console.error("[LitLens] post-load failed:", e);
    }
  };
  // If article already has section bookmarks we can show Read marks immediately
  // without waiting for idle — sections are known, just need block scan.
  const hasSectionBookmarks = (article.bookmarks || []).some(
    (b) => b.auto && b.kind === "section"
  );
  if (hasSectionBookmarks && needsMethodsParagraphUi) {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(runPostLoad, { timeout: 200 });
    } else {
      setTimeout(runPostLoad, 0);
    }
  } else if (typeof requestIdleCallback === "function") {
    requestIdleCallback(runPostLoad, { timeout: 800 });
  } else {
    setTimeout(runPostLoad, 50);
  }

  const deferTermsPanel = () => {
    if (switchGen !== articleSwitchGen) return;
    renderTermsPanel();
  };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(deferTermsPanel, { timeout: 1500 });
  } else {
    setTimeout(deferTermsPanel, 100);
  }
}

function renderTermsPanel() {
  const wrap = $("#terms-panel");
  wrap.replaceChildren();
  for (const cat of termsDoc.categories) {
    const group = mkEl(D, "kw-group");
    const header = mkEl(D, "kw-group-header");
    const linkCol =
      window.LitLensColumnLinks &&
      LitLensColumnLinks.getCategoryColumnLink(termsDoc, cat.id);
    const colFilled =
      linkCol &&
      currentArticle &&
      LitLensColumnLinks.isInfoColumnFilled(currentArticle, linkCol);
    const hidden =
      colFilled &&
      LitLensColumnLinks.isCategoryHighlightsHidden(
        { ...currentArticle, highlightForceShown: currentHighlightForceShown },
        termsDoc,
        cat.id
      );
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

    if (colFilled) {
      const hideBtn = document.createElement("button");
      hideBtn.type = "button";
      hideBtn.className = "kw-hide-highlights-btn" + (hidden ? " off" : "");
      hideBtn.title = hidden
        ? `${LitLensColumnLinks.columnLabel(linkCol)} filled — highlights hidden. Click to show.`
        : `Highlights visible. Click to hide again (auto-hides when field is filled).`;
      hideBtn.textContent = hidden ? "◌" : "◉";
      hideBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        void toggleHighlightForceShown(cat.id);
      });
      header.append(dot, nameInput, hideBtn, delCat);
    } else {
      header.append(dot, nameInput, delCat);
    }

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
      if (termsDoc.categoryColumnLinks) delete termsDoc.categoryColumnLinks[id];
      currentHighlightForceShown = currentHighlightForceShown.filter(
        (x) => x !== id
      );
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
  if (!termsDoc.categoryColumnLinks) termsDoc.categoryColumnLinks = {};
  termsDoc = await api("/terms", { method: "PUT", body: JSON.stringify(termsDoc) });
  renderTermsPanel();
  refreshArticleHighlights();
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
  renderTagFilters();
  renderTagsPanel();
}

function renderTagsPanel() {
  const assignBlock = $("#article-tags-assign");
  const toggles = $("#article-tag-toggles");
  const defList = $("#tags-def-list");
  const { byTag } = getArticleTagCounts();
  updateLibraryStats();

  if (currentId && tagsDoc.tags.length) {
    assignBlock.style.display = "block";
    toggles.replaceChildren();
    for (const tag of tagsDoc.tags) {
      const on = currentArticleTagIds.includes(tag.id);
      const btn = mkEl("button", "article-tag-toggle" + (on ? " on" : ""));
      btn.type = "button";
      btn.textContent = tagLabelWithCount(tag, byTag);
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
    const nameWrap = mkEl(D, "tag-def-name-wrap");
    const nameInp = document.createElement("input");
    nameInp.value = tag.label;
    const countSpan = mkEl("span", "tag-def-count");
    countSpan.textContent = ` (${byTag.get(tag.id) || 0})`;
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
    nameWrap.append(nameInp, countSpan);
    row.append(dot, nameWrap, del);
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
  currentArticle = null;
  currentHighlightForceShown = [];
  $("#article-body").style.display = "none";
  $("#empty-state").style.display = "flex";
  $("#topbar-title").textContent = "Select an article";
  $("#delete-btn").style.display = "none";
  $("#source-link").style.display = "none";
  updateTopbarParagraphProgress();
  fillMetadataForm(null);
  if (window.BookmarksUI) BookmarksUI.clear();
  await loadAll();
});

document.querySelectorAll(".meta-fill-btn").forEach((btn) => {
  btn.addEventListener("click", () => fillFieldFromSelection(btn.dataset.fill));
});

["meta-title", "meta-authors", "meta-year", "meta-journal", "meta-url"].forEach((id) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("input", () => scheduleSaveMetadata({ structured: false }));
  }
});

$("#meta-autofill-btn").addEventListener("click", autofillMetadataFromSavedHtml);

let modalMode = "text";
const modal = $("#modal-overlay");

function setModalMode(mode) {
  modalMode = mode;
  document.querySelectorAll(".modal-tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.modal === mode)
  );
  $("#modal-text-pane").style.display = mode === "text" ? "block" : "none";
  $("#modal-html-pane").style.display = mode === "html" ? "block" : "none";
}

function openModal(mode = "text") {
  closeAddMenu();
  setModalMode(mode);
  modal.classList.add("show");
}

function closeAddMenu() {
  const menu = $("#sidebar-add-menu");
  const btn = $("#sidebar-add-btn");
  if (menu) menu.classList.remove("open");
  if (btn) btn.setAttribute("aria-expanded", "false");
}

function toggleAddMenu() {
  const menu = $("#sidebar-add-menu");
  const btn = $("#sidebar-add-btn");
  if (!menu) return;
  const open = !menu.classList.contains("open");
  menu.classList.toggle("open", open);
  if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
}

function closeModal() {
  modal.classList.remove("show");
  $("#modal-title").value = "";
  $("#modal-url").value = "";
  $("#modal-text").value = "";
  $("#modal-html").value = "";
}

document.querySelectorAll(".modal-tab").forEach((tab) => {
  tab.addEventListener("click", () => setModalMode(tab.dataset.modal));
});

const sidebarAddBtn = $("#sidebar-add-btn");
const sidebarAddMenu = $("#sidebar-add-menu");
if (sidebarAddBtn) {
  sidebarAddBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleAddMenu();
  });
}
if (sidebarAddMenu) {
  sidebarAddMenu.querySelectorAll("[data-add-action]").forEach((item) => {
    item.addEventListener("click", () => {
      const action = item.dataset.addAction;
      closeAddMenu();
      if (action === "file") {
        $("#import-html-file").click();
        return;
      }
      openModal(action === "html" ? "html" : "text");
    });
  });
}
document.addEventListener("click", (e) => {
  if (e.target.closest(".sidebar-add-wrap")) return;
  closeAddMenu();
});

$("#empty-add-btn").addEventListener("click", () => openModal("text"));
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
  if (window.LitLensArticleExtract && html) {
    const wrap = html.includes("<html") ? html : `<html><head></head><body>${html}</body></html>`;
    const doc = new DOMParser().parseFromString(wrap, "text/html");
    const extracted = LitLensArticleExtract.extractArticleContent(doc.body);
    if ((extracted.text || "").length > 200) {
      html = extracted.html;
      text = extracted.text;
    }
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
  if (window.LitLensSectionDetect && html) {
    const wrap = html.includes("<html") ? html : `<html><head></head><body>${html}</body></html>`;
    payload.bookmarks = LitLensSectionDetect.detectSectionBookmarks(wrap);
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

$("#import-html-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const html = await file.text();
  openModal("html");
  $("#modal-title").value = file.name.replace(/\.html?$/i, "");
  $("#modal-html").value = html;
  e.target.value = "";
});

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function showCtxCopied(msg) {
  const el = $("#ctx-cite-actions")?.querySelector(".ctx-copied-toast");
  if (el) {
    el.textContent = msg;
    window.setTimeout(() => {
      if (el.textContent === msg) el.textContent = "";
    }, 2200);
  }
}

function renderCtxCiteActions() {
  const wrap = $("#ctx-cite-actions");
  if (!wrap) return;
  wrap.replaceChildren();

  const toast = mkEl("p", "ctx-copied-toast");
  wrap.appendChild(toast);

  const body = $("#article-body");
  const PL = window.LitLensPassageLinks;
  const BM = window.LitLensBookmarks;
  if (
    !currentId ||
    !body ||
    body.style.display === "none" ||
    !PL ||
    !BM?.citationSelectionSpan
  ) {
    const off = mkEl("p", "ctx-hint-inline");
    off.textContent = "Open an article and select a passage.";
    wrap.appendChild(off);
    return;
  }

  const span = BM.citationSelectionSpan(body);
  if (!span) {
    const off = mkEl("p", "ctx-hint-inline");
    off.textContent = "Drag to select a passage (not just a click).";
    wrap.appendChild(off);
    return;
  }

  const article =
    articles.find((a) => a.id === currentId) ||
    (currentArticle?.id === currentId ? currentArticle : null);
  const cite = PL.buildFromSelection(article, span, body);
  if (!cite) return;

  const quoteLen = String(cite.quote || "").trim().length;
  if (quoteLen < 4 || (cite.length || 0) < 4) {
    const off = mkEl("p", "ctx-hint-inline");
    off.textContent =
      "Select at least a few characters (whole phrase or sentence), then copy again.";
    wrap.appendChild(off);
    return;
  }

  const linkBtn = mkEl("button", "ctx-item");
  linkBtn.type = "button";
  linkBtn.textContent = `Copy citation link ${cite.label}`;
  linkBtn.title = "Paste into a method card — becomes a clickable passage link";
  linkBtn.addEventListener("click", async () => {
    try {
      const Store = window.LitLensPassageCiteStore;
      if (!Store?.register) throw new Error("Citation store unavailable");
      const { token } = await Store.register({
        articleId: cite.articleId,
        offset: cite.offset,
        length: cite.length,
        quote: cite.quote,
        label: cite.label,
      });
      if (await copyToClipboard(token)) {
        showCtxCopied("Short citation copied — paste into method card.");
      }
    } catch (e) {
      showCtxCopied(e.message || "Could not save citation");
    }
    ctx.classList.remove("show");
  });

  wrap.appendChild(linkBtn);
}

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
  renderCtxCiteActions();
  const citeH = $("#ctx-cite-actions")?.offsetHeight || 0;
  const menuH = Math.min(420, 80 + citeH + termsDoc.categories.length * 36);
  ctx.style.left = Math.min(e.clientX, innerWidth - 240) + "px";
  ctx.style.top = Math.min(e.clientY, innerHeight - menuH) + "px";
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

(function bindSidebarCheckedFilter() {
  const hideCb = $("#hide-checked-articles");
  if (!hideCb) return;
  hideCb.checked = hideCheckedArticles;
  hideCb.addEventListener("change", () => {
    hideCheckedArticles = hideCb.checked;
    localStorage.setItem(HIDE_CHECKED_KEY, hideCheckedArticles ? "1" : "0");
    renderArticleList();
  });
})();

const THEME_STORAGE_KEY = "litlens-theme";
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 20;

function themeFromLocalHour(date = new Date()) {
  const h = date.getHours();
  return h >= DAY_START_HOUR && h < DAY_END_HOUR ? "light" : "dark";
}

function resolvedTheme(pref) {
  return pref === "auto" ? themeFromLocalHour() : pref;
}

function updateThemeToggleUi(pref) {
  const btn = $("#theme-toggle");
  if (!btn) return;
  const labels = {
    auto: "Auto (day/night by system time)",
    light: "Light mode",
    dark: "Dark mode",
  };
  const icons = { auto: "◐", light: "☀", dark: "☾" };
  btn.textContent = icons[pref] || "◐";
  btn.title = labels[pref] || labels.auto;
}

function applyTheme(pref) {
  document.documentElement.setAttribute("data-theme", resolvedTheme(pref));
  updateThemeToggleUi(pref);
}

let themePref = localStorage.getItem(THEME_STORAGE_KEY) || "auto";
if (!["auto", "light", "dark"].includes(themePref)) themePref = "auto";
applyTheme(themePref);

let themeAutoTimer = null;
function scheduleThemeAutoCheck() {
  if (themeAutoTimer) clearInterval(themeAutoTimer);
  if (themePref !== "auto") {
    themeAutoTimer = null;
    return;
  }
  themeAutoTimer = setInterval(() => {
    if (themePref === "auto") applyTheme("auto");
  }, 60_000);
}
scheduleThemeAutoCheck();

$("#theme-toggle").addEventListener("click", () => {
  themePref =
    themePref === "auto" ? "light" : themePref === "light" ? "dark" : "auto";
  localStorage.setItem(THEME_STORAGE_KEY, themePref);
  applyTheme(themePref);
  scheduleThemeAutoCheck();
});

ensureTopbarMethodBackButton();
bindMethodEvidenceLinkInteractions();

loadAll();
