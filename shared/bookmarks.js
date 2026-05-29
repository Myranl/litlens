/**
 * Text bookmarks: character offsets in article body + inline markers.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof root !== "undefined") {
    root.LitLensBookmarks = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const MARKER_CLASS = "litlens-bookmark-marker";
  const METHOD_PIN_MARK_CLASS = "litlens-method-evidence-pin";
  const METHOD_PIN_BLOCK_CLASS = "litlens-method-evidence-pin-block";
  const METHOD_LINKED_CLASS = "litlens-method-linked";

  const IGNORE_TEXT_ANCESTOR =
    ".litlens-bookmark-marker,[data-litlens-ignore],.article-tools,.dropBlock,.info-panel,.meta-panel,.article-paragraph-read-mark,.article-method-rail-inset";
  const CITATION_IGNORE = ".litlens-article-header";

  function acceptTextNode(node) {
    const p = node.parentElement;
    if (!p || !node.nodeValue) return NodeFilter.FILTER_REJECT;
    if (/^(SCRIPT|STYLE|NOSCRIPT|BUTTON)$/i.test(p.tagName)) {
      return NodeFilter.FILTER_REJECT;
    }
    if (p.closest?.(`.${MARKER_CLASS}`)) return NodeFilter.FILTER_REJECT;
    if (p.closest?.(IGNORE_TEXT_ANCESTOR)) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  }

  function acceptCitationTextNode(node) {
    if (node.parentElement?.closest?.(CITATION_IGNORE)) {
      return NodeFilter.FILTER_REJECT;
    }
    return acceptTextNode(node);
  }

  /**
   * Build a Map<TextNode, cumulativeOffset> in a single TreeWalker pass.
   * Use this when you need offsets for many elements — O(n) instead of O(n²).
   */
  function buildTextOffsetMap(root, acceptFn = acceptTextNode) {
    const map = new Map();
    let offset = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: acceptFn,
    });
    while (walker.nextNode()) {
      map.set(walker.currentNode, offset);
      offset += walker.currentNode.nodeValue.length;
    }
    return map;
  }

  /** Character offset in article text, ignoring bookmark marker glyphs. */
  function textOffsetFromRange(root, range, acceptNode = acceptTextNode) {
    const pos = range.cloneRange();
    pos.collapse(true);
    let offset = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode,
    });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const nodeRange = document.createRange();
      nodeRange.selectNode(node);
      if (pos.compareBoundaryPoints(Range.START_TO_START, nodeRange) > 0) {
        offset += node.nodeValue.length;
        continue;
      }
      if (pos.compareBoundaryPoints(Range.START_TO_END, nodeRange) < 0) {
        return offset;
      }
      if (pos.startContainer === node) return offset + pos.startOffset;
      return offset;
    }
    return offset;
  }

  function rangeFromTextOffset(root, offset, acceptNode = acceptTextNode) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode,
    });
    let count = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const len = node.nodeValue.length;
      if (count + len >= offset) {
        const r = document.createRange();
        r.setStart(node, Math.max(0, offset - count));
        r.collapse(true);
        return r;
      }
      count += len;
    }
    return null;
  }

  /** Plain text with offsets compatible with rangeFromTextOffset / scrollToTextSpan. */
  function extractPlainText(root, acceptNode = acceptTextNode) {
    if (!root) return "";
    const parts = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode,
    });
    while (walker.nextNode()) {
      parts.push(walker.currentNode.nodeValue);
    }
    return parts.join("");
  }

  function extractCitationPlainText(root) {
    return extractPlainText(root, acceptCitationTextNode);
  }

  const MIN_CITATION_QUOTE_LEN = 4;

  /** Align walker offsets with the actual selection string from the browser. */
  function reconcileCitationSpan(plain, offset, endOffset, selectedText) {
    const hay = String(plain || "");
    let off = Math.max(0, offset || 0);
    let length = Math.max(0, (endOffset || 0) - off);
    const sel = String(selectedText || "")
      .replace(/[\u200B-\u200D\u2060]/g, "")
      .replace(/◆/g, "");

    if (!sel.length) {
      const len = Math.max(1, length);
      return {
        offset: off,
        length: len,
        quote: hay.slice(off, off + len),
      };
    }

    if (sel.length > length) {
      const pad = 400;
      const start = Math.max(0, off - pad);
      const end = Math.min(hay.length, off + pad + sel.length + 300);
      let idx = hay.indexOf(sel, start);
      if (idx < 0 || idx > end) idx = hay.indexOf(sel);
      if (idx >= 0) {
        return {
          offset: idx,
          length: sel.length,
          quote: hay.slice(idx, idx + sel.length) || sel,
        };
      }
      const head = sel.slice(0, Math.min(32, sel.length));
      if (head.length >= MIN_CITATION_QUOTE_LEN) {
        idx = hay.indexOf(head, start);
        if (idx >= 0) {
          return {
            offset: idx,
            length: sel.length,
            quote: hay.slice(idx, idx + sel.length) || sel,
          };
        }
      }
      return { offset: off, length: sel.length, quote: sel };
    }

    const len = Math.max(1, length);
    return {
      offset: off,
      length: len,
      quote: hay.slice(off, off + len) || sel,
    };
  }

  /** Non-collapsed selection in article body → offset, length, excerpt. */
  function selectionSpan(root) {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer) || range.collapsed) {
      return null;
    }
    const startRange = range.cloneRange();
    startRange.collapse(true);
    const endRange = range.cloneRange();
    endRange.collapse(false);
    const offset = textOffsetFromRange(root, startRange);
    const endOffset = textOffsetFromRange(root, endRange);
    const length = Math.max(0, endOffset - offset);
    const selected = range
      .cloneContents()
      .textContent.replace(/\s+/g, " ")
      .replace(/◆/g, "")
      .trim();
    const excerpt =
      selected || excerptAtOffset(root, offset, 200) || `Position ${offset}`;
    return { offset, length, excerpt };
  }

  /** Selection offsets in article body, excluding injected title/header block. */
  function citationSelectionSpan(root) {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer) || range.collapsed) {
      return null;
    }
    if (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE) {
      const el = range.commonAncestorContainer;
      if (el.closest?.(CITATION_IGNORE)) return null;
    } else if (
      range.commonAncestorContainer.parentElement?.closest?.(CITATION_IGNORE)
    ) {
      return null;
    }
    const startRange = range.cloneRange();
    startRange.collapse(true);
    const endRange = range.cloneRange();
    endRange.collapse(false);
    const offset = textOffsetFromRange(root, startRange, acceptCitationTextNode);
    const endOffset = textOffsetFromRange(root, endRange, acceptCitationTextNode);
    const selectedText = range.toString();
    const plain = extractCitationPlainText(root);
    const reconciled = reconcileCitationSpan(
      plain,
      offset,
      endOffset,
      selectedText
    );
    const excerpt =
      reconciled.quote.replace(/\s+/g, " ").trim() ||
      `Position ${reconciled.offset}`;
    return {
      offset: reconciled.offset,
      length: reconciled.length,
      excerpt,
      quote: reconciled.quote,
    };
  }

  function excerptAtOffset(root, offset, maxLen = 72) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: acceptTextNode,
    });
    let count = 0;
    let text = "";
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const len = node.nodeValue.length;
      if (count + len > offset) {
        const start = offset - count;
        text = node.nodeValue.slice(start);
        while (text.length < maxLen && walker.nextNode()) {
          const n = walker.currentNode;
          if (n.parentElement?.closest?.(`.${MARKER_CLASS}`)) continue;
          text += n.nodeValue;
        }
        break;
      }
      count += len;
    }
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length <= maxLen) return clean;
    return `${clean.slice(0, maxLen - 1)}…`;
  }

  function selectionAnchor(root) {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return null;
    const anchor = range.cloneRange();
    if (!range.collapsed) anchor.collapse(true);
    const offset = textOffsetFromRange(root, anchor);
    const selected = range
      .cloneContents()
      .textContent.replace(/\s+/g, " ")
      .replace(/◆/g, "")
      .trim();
    const excerpt =
      selected ||
      excerptAtOffset(root, offset) ||
      `Position ${offset}`;
    return { offset, excerpt };
  }

  function removeMarkers(root) {
    root.querySelectorAll(`.${MARKER_CLASS}`).forEach((el) => el.remove());
  }

  function insertMarker(root, offset, bookmark) {
    const range = rangeFromTextOffset(root, offset);
    if (!range) return false;
    const marker = document.createElement("span");
    marker.className = MARKER_CLASS;
    marker.dataset.bookmarkId = bookmark.id;
    marker.title = bookmark.label || "Bookmark";
    marker.setAttribute("contenteditable", "false");
    marker.setAttribute("aria-label", bookmark.label || "Bookmark");
    marker.textContent = "◆";
    range.insertNode(marker);
    return true;
  }

  function applyMarkers(root, bookmarks) {
    if (!root) return;
    removeMarkers(root);
    const list = [...(bookmarks || [])].sort((a, b) => b.offset - a.offset);
    for (const bm of list) {
      if (typeof bm.offset !== "number" || bm.offset < 0) continue;
      insertMarker(root, bm.offset, bm);
    }
  }

  function scrollToBookmark(root, id) {
    const safeId = String(id).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const el = root.querySelector(`[data-bookmark-id="${safeId}"]`);
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("litlens-bookmark-flash");
    window.setTimeout(() => el.classList.remove("litlens-bookmark-flash"), 1400);
    return true;
  }

  function rangeFromTextSpan(root, startOffset, length, acceptNode = acceptTextNode) {
    const start = rangeFromTextOffset(root, startOffset, acceptNode);
    if (!start) return null;
    const end = rangeFromTextOffset(
      root,
      startOffset + Math.max(0, length),
      acceptNode
    );
    if (!end) return null;
    const range = document.createRange();
    range.setStart(start.startContainer, start.startOffset);
    range.setEnd(end.startContainer, end.startOffset);
    return range;
  }

  function unwrapMark(mark) {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }

  function clearSuggestFlash(root) {
    if (!root) return;
    root.querySelectorAll("mark.litlens-suggest-flash").forEach(unwrapMark);
  }

  function clearMethodEvidencePin(root) {
    if (!root) return;
    root.querySelectorAll(`mark.${METHOD_PIN_MARK_CLASS}`).forEach(unwrapMark);
    root.querySelectorAll(`.${METHOD_PIN_BLOCK_CLASS}`).forEach((el) => {
      el.classList.remove(METHOD_PIN_BLOCK_CLASS);
      delete el.dataset.methodLabel;
    });
  }

  function clearMethodEvidenceLinks(root) {
    if (!root) return;
    root.querySelectorAll(`mark.${METHOD_LINKED_CLASS}`).forEach(unwrapMark);
  }

  /** Align stored offsets with live body text (excerpt quote + optional sentence span). */
  function resolveMethodEvidenceSpan(root, link) {
    const plain = extractPlainText(root);
    let offset = link.offset;
    let length = Math.max(1, link.length || 1);
    const quote = String(link.quote || link.excerpt || "").trim();
    const PL =
      typeof LitLensPassageLinks !== "undefined" ? LitLensPassageLinks : null;
    if (PL?.findPassageInPlain && quote.length >= 4) {
      const found = PL.findPassageInPlain(plain, { offset, length, quote });
      offset = found.offset;
      length = found.length;
    } else if (link.sentenceBounds === true) {
      const expanded = expandToSentenceBounds(plain, offset, length);
      offset = expanded.offset;
      length = expanded.length;
    }
    return { offset, length };
  }

  /**
   * Wrap saved method-evidence passages (persistent while reading).
   * @param {HTMLElement} root
   * @param {{ offset: number, length?: number, methodLabel: string, quote?: string, excerpt?: string, sentenceBounds?: boolean }[]} links
   */
  function applyMethodEvidenceLinks(root, links) {
    if (!root) return;
    clearMethodEvidenceLinks(root);
    const sorted = [...(links || [])]
      .filter((l) => typeof l.offset === "number" && l.offset >= 0)
      .sort((a, b) => b.offset - a.offset);
    for (const link of sorted) {
      appendMethodEvidenceLink(root, link);
    }
  }

  /** Add one linked mark without clearing existing evidence wraps. */
  function appendMethodEvidenceLink(root, link) {
    if (!root || !link || typeof link.offset !== "number" || link.offset < 0) {
      return false;
    }
    const label = String(link.methodLabel || "").trim();
    if (!label) return false;
    const { offset, length } = resolveMethodEvidenceSpan(root, link);
    const range = rangeFromTextSpan(root, offset, length);
    if (!range) return false;
    try {
      wrapRangeWithLinkedMark(range, { methodLabel: label });
      return true;
    } catch {
      return false;
    }
  }

  /** Periods in Ext., Fig. 1a, etc. are not sentence ends. */
  function isRealSentenceBoundary(hay, i) {
    const ch = hay[i];
    if (ch === "\n") return true;
    if (ch === "!" || ch === "?") return true;
    if (ch !== ".") return false;

    if (i > 0 && hay[i - 1] === "." && i + 1 < hay.length && hay[i + 1] === ".") {
      return false;
    }
    if (i > 0 && /\d/.test(hay[i - 1]) && i + 1 < hay.length && /\d/.test(hay[i + 1])) {
      return false;
    }

    let j = i - 1;
    while (j >= 0 && /[^A-Za-z]/.test(hay[j])) j--;
    let word = "";
    while (j >= 0 && /[A-Za-z]/.test(hay[j])) {
      word = hay[j] + word;
      j--;
    }
    if (!word) return true;

    const w = word.toLowerCase();
    if (word.length <= 2) return false;
    const abbrevs = new Set([
      "ext",
      "fig",
      "data",
      "vs",
      "eg",
      "ie",
      "etal",
      "dr",
      "mr",
      "ms",
      "st",
      "no",
      "eq",
      "ref",
      "suppl",
      "dept",
      "inc",
      "ltd",
      "vol",
      "pp",
      "ed",
      "eds",
      "approx",
      "max",
      "min",
      "std",
      "dev",
      "avg",
      "eeg",
      "lfp",
      "resp",
    ]);
    if (abbrevs.has(w)) return false;
    if (word.length <= 4 && word === word.toUpperCase()) return false;
    let k = i + 1;
    while (k < hay.length && /\s/.test(hay[k])) k++;
    if (k < hay.length && /\d/.test(hay[k])) return false;
    return true;
  }

  function expandToSentenceBounds(plain, offset, length) {
    const hay = String(plain || "");
    if (!hay.length) return { offset: 0, length: 0 };
    let start = Math.max(0, Math.min(offset, hay.length - 1));
    let end = Math.min(hay.length, start + Math.max(1, length));

    const sentenceStart = (pos) => {
      for (let i = pos - 1; i >= 0; i--) {
        if (hay[i] === "\n" && i < pos - 1) {
          let j = i + 1;
          while (j < hay.length && /\s/.test(hay[j])) j++;
          return j;
        }
        if (/[.!?]/.test(hay[i]) && isRealSentenceBoundary(hay, i)) {
          let j = i + 1;
          while (j < hay.length && /\s/.test(hay[j])) j++;
          return j;
        }
      }
      return 0;
    };

    const sentenceEnd = (pos) => {
      for (let i = pos; i < hay.length; i++) {
        if (hay[i] === "\n") return i;
        if (/[.!?]/.test(hay[i]) && isRealSentenceBoundary(hay, i)) {
          let j = i + 1;
          while (j < hay.length && /["')\]]/.test(hay[j])) j++;
          return j;
        }
      }
      return hay.length;
    };

    start = sentenceStart(start);
    end = sentenceEnd(end);
    if (end <= start) end = Math.min(hay.length, start + Math.max(length, 48));
    return { offset: start, length: end - start };
  }

  function blockElementForRange(range, root) {
    let node = range.startContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const blockTags =
      /^(P|DIV|LI|TD|TH|BLOCKQUOTE|H[1-6]|SECTION|ARTICLE|FIGCAPTION)$/i;
    while (node && node !== root) {
      if (blockTags.test(node.tagName)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function wrapRangeWithMark(range, className, options = {}) {
    const mark = document.createElement("mark");
    mark.className = className;
    if (options.methodLabel) {
      mark.dataset.methodLabel = options.methodLabel;
    }
    try {
      range.surroundContents(mark);
      return mark;
    } catch {
      const contents = range.extractContents();
      mark.appendChild(contents);
      range.insertNode(mark);
      return mark;
    }
  }

  function wrapRangeWithPinMark(range, options = {}) {
    return wrapRangeWithMark(range, METHOD_PIN_MARK_CLASS, options);
  }

  function wrapRangeWithLinkedMark(range, options = {}) {
    const mark = wrapRangeWithMark(range, METHOD_LINKED_CLASS, options);
    const label = String(options.methodLabel || "").trim();
    if (mark && label) {
      mark.title = `${label} — click to open method card`;
    }
    return mark;
  }

  function pinTextSpan(root, startOffset, length, options = {}) {
    if (!root) return false;
    clearMethodEvidencePin(root);

    let offset = startOffset;
    let len = Math.max(1, length || 1);
    if (options.expandToSentence === true) {
      const plain = options.citationOffsets
        ? extractCitationPlainText(root)
        : extractPlainText(root);
      const expanded = expandToSentenceBounds(plain, offset, len);
      offset = expanded.offset;
      len = expanded.length;
    }

    const acceptNode = options.citationOffsets
      ? acceptCitationTextNode
      : acceptTextNode;
    const range = rangeFromTextSpan(root, offset, len, acceptNode);
    if (!range) return false;

    let pinEl = null;
    try {
      pinEl = wrapRangeWithPinMark(range, options);
    } catch {
      /* range may be invalid after DOM changes */
    }

    if (pinEl && options.scroll !== false) {
      pinEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return Boolean(pinEl);
  }

  function scrollToTextSpan(root, startOffset, length, options = {}) {
    if (!root) return false;
    if (options.persistent) {
      return pinTextSpan(root, startOffset, length, options);
    }

    clearSuggestFlash(root);
    const acceptNode = options.citationOffsets
      ? acceptCitationTextNode
      : acceptTextNode;
    const range = rangeFromTextSpan(root, startOffset, length, acceptNode);
    if (!range) return false;

    let flashEl = null;
    try {
      const mark = document.createElement("mark");
      mark.className = "litlens-suggest-flash";
      range.surroundContents(mark);
      flashEl = mark;
    } catch {
      const node =
        range.startContainer.nodeType === Node.TEXT_NODE
          ? range.startContainer.parentElement
          : range.startContainer;
      if (node) {
        flashEl = node;
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }

    if (flashEl) {
      flashEl.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => {
        if (flashEl?.classList?.contains("litlens-suggest-flash")) {
          unwrapMark(flashEl);
        } else {
          clearSuggestFlash(root);
          window.getSelection()?.removeAllRanges();
        }
      }, 2200);
      return true;
    }
    return false;
  }

  return {
    selectionAnchor,
    selectionSpan,
    citationSelectionSpan,
    extractPlainText,
    extractCitationPlainText,
    buildTextOffsetMap,
    textOffsetFromRange,
    excerptAtOffset,
    applyMarkers,
    removeMarkers,
    scrollToBookmark,
    rangeFromTextOffset,
    rangeFromTextSpan,
    scrollToTextSpan,
    pinTextSpan,
    clearSuggestFlash,
    clearMethodEvidencePin,
    applyMethodEvidenceLinks,
    appendMethodEvidenceLink,
    clearMethodEvidenceLinks,
  };
});
