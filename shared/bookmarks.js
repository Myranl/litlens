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

  function acceptTextNode(node) {
    const p = node.parentElement;
    if (!p || !node.nodeValue) return NodeFilter.FILTER_REJECT;
    if (/^(SCRIPT|STYLE|NOSCRIPT)$/i.test(p.tagName)) {
      return NodeFilter.FILTER_REJECT;
    }
    if (p.closest?.(`.${MARKER_CLASS}`)) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  }

  /** Character offset in article text, ignoring bookmark marker glyphs. */
  function textOffsetFromRange(root, range) {
    const pos = range.cloneRange();
    pos.collapse(true);
    let offset = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: acceptTextNode,
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

  function rangeFromTextOffset(root, offset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: acceptTextNode,
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

  return {
    selectionAnchor,
    excerptAtOffset,
    applyMarkers,
    removeMarkers,
    scrollToBookmark,
  };
});
