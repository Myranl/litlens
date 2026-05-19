/* LitLens highlight engine — CSS Highlight API (React-safe) + DOM fallback */

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function flattenTerms(termsDoc) {
  const byId = new Map((termsDoc.categories || []).map((c) => [c.id, c]));
  const out = [];
  for (const t of termsDoc.terms || []) {
    const cat = byId.get(t.categoryId);
    const color = cat?.color || "#4f98a3";
    const label = cat?.label || "";
    const strings = [t.lemma, ...(t.aliases || [])].filter(Boolean);
    for (const s of strings) {
      out.push({ termId: t.id, categoryId: t.categoryId, label, color, pattern: s });
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

function acceptTextNode(node) {
  const p = node.parentElement;
  if (!p || !node.nodeValue?.trim()) return false;
  if (SKIP_PARENT.test(p.tagName)) return false;
  if (p.closest?.("[data-litlens-ignore]")) return false;
  if (p.closest?.("mark.kw-highlight")) return false;
  return true;
}

/** Walk text nodes including open shadow roots */
function* walkTextNodes(root) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return acceptTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  while (walker.nextNode()) yield walker.currentNode;

  if (root.querySelectorAll) {
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) yield* walkTextNodes(el.shadowRoot);
    }
  }
}

function highlightNameForColor(color) {
  return `litlens-${color.replace("#", "").toLowerCase()}`;
}

let styleSheet = null;

function ensureHighlightStyles(colors) {
  if (!styleSheet) {
    const el = document.createElement("style");
    el.id = "litlens-highlight-styles";
    el.textContent = "";
    (document.head || document.documentElement).appendChild(el);
    styleSheet = el;
  }
  const rules = colors.map((color) => {
    const name = highlightNameForColor(color);
    const bg = hexToRgba(color, 0.42);
    const underline = hexToRgba(color, 0.85);
    return `::highlight(${name}) { background-color: ${bg}; color: inherit; text-decoration: underline ${underline}; text-underline-offset: 2px; }`;
  });
  styleSheet.textContent = rules.join("\n");
}

function clearCssHighlights() {
  if (!CSS?.highlights) return;
  for (const key of CSS.highlights.keys()) {
    if (String(key).startsWith("litlens-")) CSS.highlights.delete(key);
  }
}

function applyHighlightsCss(root, flat) {
  if (!CSS?.highlights || typeof Highlight === "undefined") return 0;

  clearCssHighlights();

  const rangesByColor = new Map();
  let total = 0;

  for (const meta of flat) {
    const re = new RegExp(escapeRegex(meta.pattern), "gi");
    for (const textNode of walkTextNodes(root)) {
      const text = textNode.nodeValue;
      let m;
      while ((m = re.exec(text)) !== null) {
        try {
          const range = document.createRange();
          range.setStart(textNode, m.index);
          range.setEnd(textNode, m.index + m[0].length);
          if (!rangesByColor.has(meta.color)) rangesByColor.set(meta.color, []);
          rangesByColor.get(meta.color).push(range);
          total++;
        } catch {
          /* split text node */
        }
      }
    }
  }

  if (!total) return 0;

  ensureHighlightStyles([...rangesByColor.keys()]);

  for (const [color, ranges] of rangesByColor) {
    CSS.highlights.set(highlightNameForColor(color), new Highlight(...ranges));
  }

  return total;
}

function wrapMatchDom(textNode, start, end, meta) {
  const text = textNode.nodeValue;
  const mark = document.createElement("mark");
  mark.className = "kw-highlight";
  mark.dataset.termId = meta.termId;
  mark.title = meta.label;
  mark.setAttribute(
    "style",
    [
      `background:${hexToRgba(meta.color, 0.45)} !important`,
      `border-bottom:2px solid ${hexToRgba(meta.color, 0.9)} !important`,
      "border-radius:3px !important",
      "color:inherit !important",
      "padding:0 2px !important",
      "box-decoration-break:clone !important",
    ].join(";")
  );
  mark.textContent = text.slice(start, end);
  const frag = document.createDocumentFragment();
  if (start > 0) frag.appendChild(document.createTextNode(text.slice(0, start)));
  frag.appendChild(mark);
  if (end < text.length) frag.appendChild(document.createTextNode(text.slice(end)));
  textNode.parentNode.replaceChild(frag, textNode);
}

function applyHighlightsDom(root, flat) {
  let total = 0;
  for (const meta of flat) {
    const re = new RegExp(escapeRegex(meta.pattern), "gi");
    let iterations = 0;
    while (iterations++ < 2000) {
      let matched = false;
      for (const textNode of walkTextNodes(root)) {
        const text = textNode.nodeValue;
        re.lastIndex = 0;
        const m = re.exec(text);
        if (!m) continue;
        wrapMatchDom(textNode, m.index, m.index + m[0].length, meta);
        total++;
        matched = true;
        break;
      }
      if (!matched) break;
    }
  }
  return total;
}

function removeDomHighlights(root) {
  root.querySelectorAll?.("mark.kw-highlight").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent), mark);
    parent.normalize();
  });
}

/** Same root as “Save page” in popup */
function getArticleRoot() {
  if (typeof LitLensArticleExtract !== "undefined") {
    return LitLensArticleExtract.findArticleRoot(document) || document.body;
  }
  return (
    document.querySelector(
      "main, article, [role=main], .article-body, .article-content, #content"
    ) || document.body
  );
}

function applyHighlights(root, termsDoc) {
  if (!root || !termsDoc) return { count: 0, method: "none" };
  const flat = flattenTerms(termsDoc);
  if (!flat.length) return { count: 0, method: "none" };

  clearHighlights(root);

  let count = applyHighlightsCss(root, flat);
  if (count > 0) return { count, method: "css-highlight" };

  count = applyHighlightsDom(root, flat);
  return { count, method: count > 0 ? "dom" : "none" };
}

function clearHighlights(root) {
  clearCssHighlights();
  if (root) removeDomHighlights(root);
  if (document.body && root !== document.body) removeDomHighlights(document.body);
}
