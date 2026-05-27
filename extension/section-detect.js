/**
 * Detect standard paper sections from h1–h6 headings → bookmark payloads.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof root !== "undefined") {
    root.LitLensSectionDetect = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SECTION_RULES = [
    { label: "Abstract", keys: ["abstract", "summary", "synopsis"] },
    {
      label: "Introduction",
      keys: ["introduction", "intro", "background", "overview"],
    },
    {
      label: "Methods",
      keys: [
        "methods",
        "method",
        "materials and methods",
        "materials & methods",
        "materials methods",
        "material and methods",
        "experimental procedures",
        "experimental methods",
        "materials methods",
        "statistical analysis",
      ],
    },
    { label: "Results", keys: ["results", "findings", "outcomes"] },
    { label: "Discussion", keys: ["discussion", "interpretation"] },
    {
      label: "Conclusion",
      keys: ["conclusion", "conclusions", "concluding remarks", "summary and conclusions"],
    },
    {
      label: "References",
      keys: [
        "references",
        "reference list",
        "bibliography",
        "literature cited",
        "works cited",
      ],
    },
    {
      label: "Acknowledgments",
      keys: ["acknowledgments", "acknowledgements", "acknowledgment", "funding"],
    },
    {
      label: "Supplementary",
      keys: [
        "supplementary",
        "supplemental",
        "supporting information",
        "supplementary information",
        "supplementary material",
      ],
    },
  ];

  function normalizeHeading(text) {
    let s = String(text || "")
      .replace(/\s+/g, " ")
      .trim();
    s = s.replace(/^[\dIVXLC]+(?:[\.\):\-–—]\s*|\s+[\.\):\-–—]\s*)/i, "");
    s = s.replace(/^((?:\d+\.)+\d*)\s*[\.\):\-–—]\s*/, "");
    s = s.replace(/^section\s+/i, "");
    return s.toLowerCase();
  }

  function matchSectionLabel(raw) {
    const n = normalizeHeading(raw);
    if (!n || n.length > 120) return null;

    for (const rule of SECTION_RULES) {
      for (const key of rule.keys) {
        if (n === key) return rule.label;
      }
    }

    if (/\bmaterials?\s+(and|&)\s+methods?\b/.test(n)) return "Methods";
    if (n.endsWith(" methods") && n.length < 40) return "Methods";

    return null;
  }

  function textOffsetAtElement(root, element) {
    if (!root || !element || !root.contains(element)) return null;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(true);
    if (typeof LitLensBookmarks !== "undefined" && LitLensBookmarks.textOffsetFromRange) {
      return LitLensBookmarks.textOffsetFromRange(root, range);
    }
    const pre = document.createRange();
    pre.selectNodeContents(root);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function resolveRoot(htmlOrRoot) {
    if (!htmlOrRoot) return { root: null, doc: null };
    if (typeof htmlOrRoot === "string") {
      const wrap = htmlOrRoot.includes("<html")
        ? htmlOrRoot
        : `<html><head></head><body>${htmlOrRoot}</body></html>`;
      const doc = new DOMParser().parseFromString(wrap, "text/html");
      return { root: doc.body, doc };
    }
    const root = htmlOrRoot;
    return { root, doc: root.ownerDocument || null };
  }

  function detectSectionBookmarks(htmlOrRoot) {
    const { root } = resolveRoot(htmlOrRoot);
    if (!root) return [];

    const headings = root.querySelectorAll("h1, h2, h3, h4, h5, h6");
    const seen = new Set();
    const out = [];

    for (const el of headings) {
      const raw = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!raw || raw.length > 150) continue;

      const label = matchSectionLabel(raw);
      if (!label || seen.has(label)) continue;

      const offset = textOffsetAtElement(root, el);
      if (offset == null || offset < 0) continue;

      seen.add(label);
      out.push({
        id: uid(),
        label,
        offset,
        excerpt: raw.length > 72 ? `${raw.slice(0, 71)}…` : raw,
        createdAt: Date.now(),
        auto: true,
        kind: "section",
      });
    }

    return out.sort((a, b) => a.offset - b.offset);
  }

  return {
    SECTION_RULES,
    matchSectionLabel,
    detectSectionBookmarks,
  };
});
