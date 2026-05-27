/**
 * Per-paragraph "read" checkmarks — skipped on Study metadata rescan.
 */
(function () {
  const MARK_CLASS = "article-paragraph-read-mark";
  const READ_CLASS = "article-paragraph-is-read";

  function $(id) {
    return document.getElementById(id);
  }

  function readKeySet() {
    return new Set(window.StructuredMeta?.getReadParagraphKeys?.() || []);
  }

  function getMethodsBlocks(body) {
    return (
      window.ArticleMethodRail?.getMethodsBlocks?.(body) ||
      window.LitLensParagraphBlocks?.getMethodsSectionBlocks?.(body, []) ||
      []
    );
  }

  function blockKey(block) {
    const PB = window.LitLensParagraphBlocks;
    return PB?.blockKey ? PB.blockKey(block) : block.key || "";
  }

  function clear(body) {
    const root = body || $("article-body");
    if (!root) return;
    root.querySelectorAll(`.${MARK_CLASS}`).forEach((el) => el.remove());
    root.querySelectorAll(`.${READ_CLASS}`).forEach((el) => {
      el.classList.remove(READ_CLASS);
    });
  }

  function buildReadMark(paragraphKey, checked) {
    const label = document.createElement("label");
    label.className = MARK_CLASS;
    label.title = checked
      ? "Marked as read — skipped on rescan"
      : "Mark paragraph as read when done extracting methods";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.setAttribute("aria-label", "Paragraph read");
    input.dataset.paragraphKey = paragraphKey;

    const text = document.createElement("span");
    text.className = "article-paragraph-read-label";
    text.textContent = "Read";

    input.addEventListener("change", () => {
      const key = String(input.dataset.paragraphKey || "").trim();
      if (!key) return;
      window.StructuredMeta?.toggleReadParagraph?.(key, input.checked);
      const blockEl = label.parentElement;
      if (blockEl) blockEl.classList.toggle(READ_CLASS, input.checked);
    });

    label.addEventListener("click", (e) => e.stopPropagation());
    label.append(input, text);
    return label;
  }

  function applyReadMarksToBlocks(blocks, keys) {
    const PB = window.LitLensParagraphBlocks;
    for (const block of blocks) {
      const key = blockKey(block);
      if (!key) continue;
      const checked = PB?.blockMatchesReadKey
        ? PB.blockMatchesReadKey(block, keys)
        : keys.has(key);
      block.el.classList.toggle(READ_CLASS, checked);
      block.el.insertBefore(buildReadMark(key, checked), block.el.firstChild);
    }
  }

  function syncBlock(paragraphKey, read) {
    const body = $("article-body");
    if (!body) return;
    const key = String(paragraphKey || "").trim();
    const input = body.querySelector(
      `.${MARK_CLASS} input[data-paragraph-key="${CSS.escape(key)}"]`
    );
    if (!input) return;
    input.checked = read;
    const blockEl = input.closest("p, li, blockquote, h3, h4, [role='paragraph']");
    if (blockEl) blockEl.classList.toggle(READ_CLASS, read);
  }

  /** Single DOM pass: read marks + method rail chips. */
  function refreshCombined(body) {
    const root = body || $("article-body");
    if (!root || root.style.display === "none") return;

    window.ArticleMethodRail?.clear?.(root);
    clear(root);

    const PB = window.LitLensParagraphBlocks;
    PB?.invalidateBlocksForBody?.(root);
    const blocks = getMethodsBlocks(root);
    if (!blocks.length) return;

    applyReadMarksToBlocks(blocks, readKeySet());

    if (window.ArticleMethodRail?.applyToBlocks) {
      const ctx =
        typeof window.litlensGetArticleContext === "function"
          ? window.litlensGetArticleContext()
          : null;
      const evidence =
        window.StructuredMeta?.getMethodEvidence?.() ||
        ctx?.article?.methodEvidence ||
        {};
      window.ArticleMethodRail.applyToBlocks(blocks, evidence);
    }

    window.StructuredMeta?.rebuildReadParagraphRanges?.(blocks);
  }

  function refresh() {
    refreshCombined();
  }

  window.ArticleParagraphRead = { refresh, refreshCombined, clear, syncBlock };
})();
