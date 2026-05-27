/**
 * Paragraph block offsets in article body (for method rail, read marks, suggest scope).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof root !== "undefined") {
    root.LitLensParagraphBlocks = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const BLOCK_SELECTORS = [
    "p",
    "li",
    "blockquote",
    "h3",
    "h4",
    "[role='paragraph']",
    ".c-article-section p",
    "section[data-extent='bodymatter'] p",
  ].join(",");
  const MIN_WORDS = 50;
  const SKIP_INSET_SELECTOR = ".article-method-rail-inset, .article-paragraph-read-mark";
  const STRIP_FOR_FINGERPRINT =
    ".article-paragraph-read-mark, .article-method-rail-inset, mark.litlens-method-linked, mark.method-assoc-highlight, mark.kw-highlight, mark.litlens-method-evidence-pin, mark.litlens-suggest-flash";

  function countWords(text) {
    const t = String(text || "").trim();
    if (!t) return 0;
    return t.split(/\s+/).length;
  }

  /** Stable paragraph id from body text (ignores LitLens UI + highlights). */
  function paragraphFingerprint(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll(STRIP_FOR_FINGERPRINT).forEach((node) => node.remove());
    const text = (clone.innerText || clone.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    const words = countWords(text);
    if (words < MIN_WORDS) return "";
    const head = text.slice(0, 96);
    const tail = text.length > 96 ? text.slice(-48) : "";
    return tail ? `${words}:${text.length}:${head}|${tail}` : `${words}:${text.length}:${head}`;
  }

  function blockKey(block) {
    if (!block) return "";
    if (block.key) return block.key;
    return paragraphFingerprint(block.el);
  }

  /** @deprecated — matches keys saved before word-count fingerprint */
  function legacyParagraphFingerprint(el) {
    if (!el) return "";
    const clone = el.cloneNode(true);
    clone.querySelectorAll(STRIP_FOR_FINGERPRINT).forEach((node) => node.remove());
    return (clone.innerText || clone.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
  }

  function blockMatchesReadKey(block, readKeys) {
    if (!block || !readKeys?.size) return false;
    const key = blockKey(block);
    if (key && readKeys.has(key)) return true;
    const legacy = legacyParagraphFingerprint(block.el);
    return Boolean(legacy && readKeys.has(legacy));
  }

  function normalizeReadKeysForBlocks(blocks, readKeys) {
    const out = new Set(readKeys || []);
    for (const block of blocks || []) {
      const key = blockKey(block);
      if (!key || out.has(key)) continue;
      const legacy = legacyParagraphFingerprint(block.el);
      if (legacy && out.has(legacy)) {
        out.delete(legacy);
        out.add(key);
      }
    }
    return [...out].sort((a, b) => a.localeCompare(b));
  }

  /** Drop saved keys that no longer match any block in the list (e.g. after fingerprint change). */
  function pruneReadKeysToBlocks(blocks, readKeys) {
    const list = blocks || [];
    const normalized = normalizeReadKeysForBlocks(list, readKeys);
    return normalized.filter((key) => {
      const set = new Set([key]);
      return list.some((block) => blockMatchesReadKey(block, set));
    });
  }

  function countReadBlocks(blocks, readKeys) {
    const list = blocks || [];
    const keys = pruneReadKeysToBlocks(list, readKeys);
    const set = new Set(keys);
    return list.filter((block) => blockMatchesReadKey(block, set)).length;
  }

  function syncReadStateForMethodsBlocks(blocks, readKeys) {
    const list = blocks || [];
    const keys = pruneReadKeysToBlocks(list, readKeys);
    return {
      keys,
      read: countReadBlocks(list, keys),
      total: list.length,
    };
  }

  /** @type {WeakMap<HTMLElement, { start: number, end: number, el: HTMLElement }[]>} */
  const blockCache = new WeakMap();

  function blockOverlapsScope(block, scope) {
    if (!scope) return true;
    return block.start < scope.end && block.end > scope.start;
  }

  function collectParagraphBlocksUncached(body) {
    const BM = typeof LitLensBookmarks !== "undefined" ? LitLensBookmarks : null;
    if (!body || !BM?.buildTextOffsetMap) return [];

    // Single TreeWalker pass: node → cumulative start offset  O(n)
    const offsetMap = BM.buildTextOffsetMap(body);

    function blockOffsets(el) {
      // Walk text nodes inside el; look up each in offsetMap (already filtered).
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let first = null;
      let last = null;
      while (w.nextNode()) {
        const node = w.currentNode;
        if (!offsetMap.has(node)) continue;
        if (first === null) first = node;
        last = node;
      }
      if (first === null) return null;
      return {
        start: offsetMap.get(first),
        end: offsetMap.get(last) + last.nodeValue.length,
      };
    }

    const seen = new Set();
    const blocks = [];

    for (const el of body.querySelectorAll(BLOCK_SELECTORS)) {
      if (seen.has(el)) continue;
      if (el.closest?.(".litlens-article-header")) continue;
      if (el.closest?.(SKIP_INSET_SELECTOR)) continue;
      if (el.matches?.(SKIP_INSET_SELECTOR)) continue;
      const text = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (countWords(text) < MIN_WORDS) continue;
      seen.add(el);

      const offsets = blockOffsets(el);
      if (!offsets) continue;
      const key = paragraphFingerprint(el);
      if (!key) continue;
      blocks.push({
        el,
        start: offsets.start,
        end: Math.max(offsets.end, offsets.start + 1),
        key,
      });
    }

    blocks.sort((a, b) => a.start - b.start);
    return blocks;
  }

  function getBlocksForBody(body, { force = false } = {}) {
    if (!body) return [];
    if (!force && blockCache.has(body)) return blockCache.get(body);
    const blocks = collectParagraphBlocksUncached(body);
    blockCache.set(body, blocks);
    return blocks;
  }

  function invalidateBlocksForBody(body) {
    if (body) blockCache.delete(body);
  }

  /** @deprecated use getBlocksForBody */
  function collectParagraphBlocks(body) {
    return getBlocksForBody(body);
  }

  function findBlockInBlocks(blocks, offset) {
    if (!blocks?.length || offset == null) return null;
    for (const block of blocks) {
      if (offset >= block.start && offset < block.end) return block;
    }
    return null;
  }

  function findBlockForOffset(body, offset) {
    if (!body || offset == null) return null;
    return findBlockInBlocks(getBlocksForBody(body), offset);
  }

  function filterBlocksToMethodsSection(blocks, body, bookmarks) {
    const MP = typeof LitLensMethodProfiles !== "undefined" ? LitLensMethodProfiles : null;
    if (!MP?.getMethodsSectionScope || !MP.extractPlainText) return blocks;
    const plain = MP.extractPlainText(body);
    const scope = MP.getMethodsSectionScope(plain, bookmarks || []);
    if (!scope) return [];
    return blocks.filter((b) => blockOverlapsScope(b, scope));
  }

  function getMethodsSectionBlocks(body, bookmarks, { force = false } = {}) {
    return filterBlocksToMethodsSection(
      getBlocksForBody(body, { force }),
      body,
      bookmarks
    );
  }

  function isOffsetInReadKeys(offset, readKeys, body) {
    if (offset == null || !readKeys?.length || !body) return false;
    const readSet = new Set(readKeys);
    const block = findBlockInBlocks(getBlocksForBody(body), offset);
    return Boolean(block && blockMatchesReadKey(block, readSet));
  }

  return {
    MIN_WORDS,
    countWords,
    paragraphFingerprint,
    blockKey,
    blockMatchesReadKey,
    normalizeReadKeysForBlocks,
    pruneReadKeysToBlocks,
    countReadBlocks,
    syncReadStateForMethodsBlocks,
    legacyParagraphFingerprint,
    BLOCK_SELECTORS,
    blockOverlapsScope,
    collectParagraphBlocks,
    getBlocksForBody,
    invalidateBlocksForBody,
    findBlockInBlocks,
    filterBlocksToMethodsSection,
    getMethodsSectionBlocks,
    findBlockForOffset,
    isOffsetInReadKeys,
  };
});
