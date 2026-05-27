/**
 * Margin notes per paragraph: confirmed method passages (methodEvidence), inverted view.
 * Refreshed only when an article is opened (see litlensRefreshArticleMethodRail), not on each method +.
 */
(function () {
  const INSET_CLASS = "article-method-rail-inset";

  function $(id) {
    return document.getElementById(id);
  }

  function getEvidence() {
    const ctx =
      typeof window.litlensGetArticleContext === "function"
        ? window.litlensGetArticleContext()
        : null;
    const fromArticle = ctx?.article?.methodEvidence;
    if (fromArticle && Object.values(fromArticle).some((arr) => arr?.length)) {
      return fromArticle;
    }
    if (window.StructuredMeta?.getMethodEvidence) {
      return window.StructuredMeta.getMethodEvidence() || {};
    }
    return fromArticle || {};
  }

  function getBookmarks() {
    const ctx =
      typeof window.litlensGetArticleContext === "function"
        ? window.litlensGetArticleContext()
        : null;
    return ctx?.bookmarks || [];
  }

  function getMethodsBlocks(body) {
    const PB = window.LitLensParagraphBlocks;
    if (!body || !PB?.getMethodsSectionBlocks) return [];
    return PB.getMethodsSectionBlocks(body, getBookmarks());
  }

  /** Confirmed links: saved offsets + linked marks already in the paragraph. */
  function confirmedMethodsForBlock(block, evidence) {
    const labels = new Set();
    for (const mark of block.el.querySelectorAll("mark.litlens-method-linked")) {
      const name = String(mark.dataset?.methodLabel || "").trim();
      if (name) labels.add(name);
    }
    for (const [label, entries] of Object.entries(evidence || {})) {
      const name = String(label || "").trim();
      if (!name) continue;
      for (const e of entries || []) {
        if (e?.offset == null) continue;
        const start = e.offset;
        const end = e.offset + Math.max(1, e.length || 1);
        if (start < block.end && end > block.start) labels.add(name);
      }
    }
    return labels;
  }

  function makeChip(label) {
    const chip = document.createElement("span");
    chip.className = "article-method-rail-chip";
    chip.textContent = label;
    chip.setAttribute("role", "button");
    chip.tabIndex = 0;
    chip.title = `${label} — linked passage in this paragraph`;
    const open = () => {
      if (window.LitLensMethodsMap?.openMethodCard) {
        void window.LitLensMethodsMap.openMethodCard(label);
      }
    };
    chip.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      open();
    });
    chip.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
    return chip;
  }

  function buildInset(labels) {
    const clean = labels.map((l) => String(l).trim()).filter(Boolean);
    if (!clean.length) return null;
    const inset = document.createElement("div");
    inset.className = INSET_CLASS;
    inset.setAttribute("aria-label", "Confirmed methods in this paragraph");
    const chips = document.createElement("div");
    chips.className = "article-method-rail-chips";
    for (const label of clean) chips.appendChild(makeChip(label));
    inset.appendChild(chips);
    return inset;
  }

  function clear(body) {
    const root = body || $("article-body");
    if (!root) return;
    root.querySelectorAll(`.${INSET_CLASS}`).forEach((el) => el.remove());
  }

  function applyToBlocks(blocks, evidence) {
    const hasEvidence = Object.values(evidence || {}).some((arr) => arr?.length);
    if (!hasEvidence && !blocks.some((b) => b.el.querySelector("mark.litlens-method-linked"))) {
      return;
    }
    for (const block of blocks) {
      const labelSet = confirmedMethodsForBlock(block, evidence);
      if (!labelSet.size) continue;
      const labels = [...labelSet].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" })
      );
      const inset = buildInset(labels);
      if (!inset) continue;
      block.el.insertBefore(inset, block.el.firstChild);
    }
  }

  function refresh() {
    const body = $("article-body");
    if (!body || body.style.display === "none") return;
    clear(body);
    applyToBlocks(getMethodsBlocks(body), getEvidence());
  }

  window.ArticleMethodRail = { refresh, clear, applyToBlocks, getMethodsBlocks };
})();
