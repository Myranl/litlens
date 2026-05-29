/**
 * Shared highlight engine (reader + extension content script).
 * Walks text nodes; avoids breaking existing <mark> tags.
 */

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Flatten terms from LitLens terms.json shape */
function flattenTerms(termsDoc) {
  const byId = new Map(
    (termsDoc.categories || []).map((c) => [c.id, c])
  );
  const out = [];
  for (const t of termsDoc.terms || []) {
    const cat = byId.get(t.categoryId);
    const color = cat?.color || "#4f98a3";
    const label = cat?.label || "";
    const strings = [t.lemma, ...(t.aliases || [])].filter(Boolean);
    for (const s of strings) {
      out.push({
        termId: t.id,
        categoryId: t.categoryId,
        label,
        color,
        pattern: s,
      });
    }
  }
  out.sort((a, b) => b.pattern.length - a.pattern.length);
  return out;
}

function hexToRgba(hex, alpha) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return `rgba(79,152,163,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const SKIP_PARENT = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|CODE|PRE)$/i;

function collectTextNodes(root, forCategoryId) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p || !node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      if (SKIP_PARENT.test(p.tagName)) return NodeFilter.FILTER_REJECT;
      if (p.closest?.("[data-litlens-ignore]")) return NodeFilter.FILTER_REJECT;
      const existingMark = p.closest?.("mark.kw-highlight");
      if (existingMark && existingMark.dataset.categoryId === forCategoryId) {
        return NodeFilter.FILTER_REJECT;
      }
      if (
        p.closest?.(
          "mark.litlens-method-evidence-pin, .litlens-method-evidence-pin-block, mark.litlens-method-linked"
        )
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

function wrapMatch(textNode, start, end, meta) {
  const text = textNode.nodeValue;
  const before = text.slice(0, start);
  const match = text.slice(start, end);
  const after = text.slice(end);
  const mark = document.createElement("mark");
  mark.className = "kw-highlight";
  mark.dataset.termId = meta.termId;
  mark.dataset.categoryId = meta.categoryId;
  mark.title = meta.label;
  const bg = hexToRgba(meta.color, 0.28);
  const border = hexToRgba(meta.color, 0.65);
  mark.style.background = bg;
  mark.style.borderBottom = `1.5px solid ${border}`;
  mark.style.borderRadius = "3px";
  mark.style.padding = "0 2px";
  mark.style.cursor = "pointer";
  mark.style.color = "inherit";
  mark.textContent = match;

  const frag = document.createDocumentFragment();
  if (before) frag.appendChild(document.createTextNode(before));
  frag.appendChild(mark);
  if (after) frag.appendChild(document.createTextNode(after));
  textNode.parentNode.replaceChild(frag, textNode);
  return mark;
}

function applyHighlights(root, termsDoc) {
  if (!root || !termsDoc) return;
  const flat = flattenTerms(termsDoc);
  if (!flat.length) return;

  removeHighlights(root);

  for (const meta of flat) {
    const re = new RegExp(escapeRegex(meta.pattern), "gi");
    let iterations = 0;
    const maxIter = 2000;
    while (iterations++ < maxIter) {
      const nodes = collectTextNodes(root, meta.categoryId);
      let matched = false;
      for (const textNode of nodes) {
        const text = textNode.nodeValue;
        re.lastIndex = 0;
        const m = re.exec(text);
        if (!m) continue;
        wrapMatch(textNode, m.index, m.index + m[0].length, meta);
        matched = true;
        break;
      }
      if (!matched) break;
    }
  }
}

function removeHighlights(root) {
  root.querySelectorAll("mark.kw-highlight").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });
}

function collectTextNodesForMethodAssoc(root) {
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p || !node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      if (SKIP_PARENT.test(p.tagName)) return NodeFilter.FILTER_REJECT;
      if (p.closest?.("[data-litlens-ignore]")) return NodeFilter.FILTER_REJECT;
      if (
        p.closest?.(
          "mark.method-assoc-highlight, mark.litlens-method-evidence-pin, .litlens-method-evidence-pin-block, mark.litlens-method-linked"
        )
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

function wrapMethodAssocMatch(textNode, start, end, meta) {
  const text = textNode.nodeValue;
  const before = text.slice(0, start);
  const match = text.slice(start, end);
  const after = text.slice(end);
  const mark = document.createElement("mark");
  mark.className = "method-assoc-highlight";
  mark.dataset.methodLabels = meta.methods.join("|");
  mark.dataset.pendingMethods = meta.pendingMethods.join("|");
  const pending = meta.pendingMethods.join(", ");
  const all = meta.methods.join(", ");
  mark.title =
    pending.length < all.length
      ? `Methods: ${all}\nNot marked yet: ${pending}`
      : `Methods: ${all}`;
  mark.textContent = match;

  const frag = document.createDocumentFragment();
  if (before) frag.appendChild(document.createTextNode(before));
  frag.appendChild(mark);
  if (after) frag.appendChild(document.createTextNode(after));
  textNode.parentNode.replaceChild(frag, textNode);
  return mark;
}

function removeMethodAssociationHighlights(root) {
  if (!root) return;
  root.querySelectorAll("mark.method-assoc-highlight").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });
}

function applyMethodAssociationHighlights(root, patterns) {
  if (!root) return;
  removeMethodAssociationHighlights(root);
  if (!patterns?.length) return;

  for (const meta of patterns) {
    const buildRe = window.LitLensMethodProfiles?.buildTermRegExp;
    const re = buildRe
      ? buildRe(meta.pattern, "gi")
      : new RegExp(`\\b${escapeRegex(meta.pattern)}\\b`, "gi");
    if (!re) continue;
    let iterations = 0;
    const maxIter = 2000;
    while (iterations++ < maxIter) {
      const nodes = collectTextNodesForMethodAssoc(root);
      let matched = false;
      for (const textNode of nodes) {
        const text = textNode.nodeValue;
        re.lastIndex = 0;
        const m = re.exec(text);
        if (!m) continue;
        wrapMethodAssocMatch(textNode, m.index, m.index + m[0].length, meta);
        matched = true;
        break;
      }
      if (!matched) break;
    }
  }
}

function extractReadableText(root) {
  const clone = root.cloneNode(true);
  clone.querySelectorAll("script,style,nav,header,footer,aside").forEach((el) => el.remove());
  return (clone.innerText || clone.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    flattenTerms,
    applyHighlights,
    removeHighlights,
    applyMethodAssociationHighlights,
    removeMethodAssociationHighlights,
    extractReadableText,
    escapeRegex,
  };
}

if (typeof window !== "undefined") {
  window.LitLensHighlight = {
    flattenTerms,
    applyHighlights,
    removeHighlights,
    applyMethodAssociationHighlights,
    removeMethodAssociationHighlights,
    extractReadableText,
    escapeRegex,
  };
}
