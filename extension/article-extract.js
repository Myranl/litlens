/**
 * Find the main article content node(s) on publisher pages (Elsevier/Cell, generic).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof root !== "undefined") {
    root.LitLensArticleExtract = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const ELSEVIER_SECTION_SELECTORS = [
    "#author-highlights-abstract",
    "#author-abstract",
    "#graphical-abstract",
    "#bodymatter",
    'section[data-extent="bodymatter"]',
    "#backmatter",
    'section[data-extent="backmatter"]',
  ];

  const ROOT_CANDIDATE_SELECTORS = [
    "#bodymatter",
    'section[data-extent="bodymatter"]',
    '[property="articleBody"]',
    "article.nlm-article",
    "article[data-article-id]",
    "article",
    ".article-body",
    ".article-content",
    "#article-body",
    "#main-content .article",
    "#content-main",
    ".c-article-body",
    "#enc-article",
    "#article",
    "main",
    '[role="main"]',
  ];

  const REMOVE_SELECTOR = [
    "script",
    "style",
    "noscript",
    'link[rel="stylesheet"]',
    'link[rel="preload"][as="font"]',
    "nav",
    "header",
    "footer",
    "aside",
    ".article-tools",
    ".core-collateral-aside",
    ".core-nav-wrapper",
    '[data-core-nav]',
    ".share__block",
    ".dropBlock__holder",
    ".info-panel",
    ".meta-panel",
    ".article-header__download-full-issue",
    "#article_more_menu",
    ".sr-only",
  ].join(",");

  function textLen(el) {
    return (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim().length;
  }

  function hostDoc(el) {
    return el?.ownerDocument || (typeof document !== "undefined" ? document : null);
  }

  function elsevierTitleBlock(doc) {
    const header =
      doc.querySelector("header[data-extent='frontmatter']") ||
      doc.querySelector('[data-core-wrapper="header"] header');
    if (!header) return null;
    const wrap = doc.createElement("div");
    wrap.className = "litlens-article-header";
    const h1 = header.querySelector("h1");
    const contributors = header.querySelector(".contributors");
    if (h1) wrap.appendChild(h1.cloneNode(true));
    if (contributors) wrap.appendChild(contributors.cloneNode(true));
    return wrap.childNodes.length ? wrap : null;
  }

  function findElsevierSections(doc) {
    const seen = new Set();
    const parts = [];
    const title = elsevierTitleBlock(doc);
    if (title) parts.push(title);
    for (const sel of ELSEVIER_SECTION_SELECTORS) {
      const el = doc.querySelector(sel);
      if (!el || seen.has(el)) continue;
      seen.add(el);
      parts.push(el);
    }
    return parts.length ? parts : null;
  }

  function buildCombinedRoot(doc, elements) {
    const wrap = doc.createElement("div");
    wrap.className = "litlens-article-extract";
    for (const el of elements) {
      wrap.appendChild(el.cloneNode(true));
    }
    return wrap;
  }

  function findArticleRoot(doc) {
    if (!doc) return null;

    const elsevier = findElsevierSections(doc);
    if (elsevier) return buildCombinedRoot(doc, elsevier);

    for (const sel of ROOT_CANDIDATE_SELECTORS) {
      const el = doc.querySelector(sel);
      if (el && textLen(el) > 400) return el;
    }

    let best = null;
    let bestLen = 0;
    for (const el of doc.querySelectorAll("article, main, [role=main]")) {
      const len = textLen(el);
      if (len > bestLen) {
        bestLen = len;
        best = el;
      }
    }
    return best || doc.body;
  }

  function cleanExtractedRoot(root) {
    if (!root) return root;
    root.querySelectorAll(REMOVE_SELECTOR).forEach((el) => el.remove());
    root.querySelectorAll("[hidden]").forEach((el) => {
      if (!el.closest("figure, img")) el.remove();
    });
    root.querySelectorAll("[aria-hidden='true']").forEach((el) => {
      if (!el.closest("figure, img, .figure-wrap")) el.removeAttribute("aria-hidden");
    });
    root
      .querySelectorAll(
        '.accordion__content[style*="display: none"], .accordion__content[style*="display:none"]'
      )
      .forEach((el) => {
        el.style.display = "block";
      });
    root.querySelectorAll("button").forEach((el) => el.remove());
    return root;
  }

  function isCleanExtractedHtml(html) {
    if (!html) return false;
    return (
      html.includes("litlens-article-extract") ||
      (html.includes('id="bodymatter"') &&
        !html.includes('data-core-wrapper="header"'))
    );
  }

  function extractArticleContent(doc) {
    const root = cleanExtractedRoot(findArticleRoot(doc));
    const html = root.innerHTML;
    const text = (root.innerText || "").replace(/\n{3,}/g, "\n\n").trim();
    return { root, html, text };
  }

  return {
    findArticleRoot,
    extractArticleContent,
    cleanExtractedRoot,
    isCleanExtractedHtml,
    elsevierTitleBlock,
  };
});
