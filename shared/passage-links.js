/**
 * Inline passage citations for method cards.
 * Short token in text: [[cite:Ab3x9|(Author, 2024)]]
 * Full data in ~/LiteratureReview/passage-citations.json
 * Legacy (still supported): [[litlens:articleId:offset:length|label#quote]]
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof root !== "undefined") {
    root.LitLensPassageLinks = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const LEGACY_CITE_RE =
    /\[\[litlens:([^:\|\]#]+):(\d+):(\d+)(?:\|([^#\]]*))?(?:#([^\]]+))?\]\]/gi;
  const CITE_REF_RE =
    /\[\[cite:([a-z0-9]{4,12})(?:\|([^\]]*))?\]\]/gi;

  function normalizeCiteSourceText(text) {
    return String(text || "")
      .replace(/\uFEFF/g, "")
      .replace(/[\u200B-\u200D\u2060]/g, "")
      .replace(/\uFF3B\uFF3B/g, "[[")
      .replace(/\uFF3D\uFF3D/g, "]]")
      .replace(/\r\n/g, "\n");
  }

  function hasCiteMarkup(text) {
    const hay = normalizeCiteSourceText(text);
    return /\[\[(?:cite:[a-z0-9]{4,12}|litlens:)/i.test(hay);
  }

  function parseYear(article) {
    const raw = article?.year || article?.structured?.year || "";
    const m = String(raw).match(/\b(19|20)\d{2}\b/);
    return m ? m[0] : "";
  }

  function formatArticleCite(article) {
    if (!article) return "(article)";
    const year = parseYear(article);
    const authors = String(article.authors || "").trim();
    if (authors && year) {
      const first = authors.split(/[,;]|\s+and\s+/i)[0].trim();
      const name = first.length > 48 ? `${first.slice(0, 47)}…` : first;
      return `(${name}, ${year})`;
    }
    if (year) return `(${year})`;
    const title = String(article.title || "Article").trim();
    const short = title.length > 40 ? `${title.slice(0, 39)}…` : title;
    return `(${short})`;
  }

  /** Citation label for mention rows; placeholders when metadata missing. */
  function formatCiteLabel(article) {
    const year = parseYear(article);
    const authors = String(article?.authors || "").trim();
    const yearPart = year || "[Year?]";
    if (authors) {
      const first = authors.split(/[,;]|\s+and\s+/i)[0].trim();
      const name = first.length > 42 ? `${first.slice(0, 41)}…` : first;
      return `(${name}, ${yearPart})`;
    }
    return `([Author?], ${yearPart})`;
  }

  function citeLabelNeedsMetadata(label) {
    return /\[Author\?\]|\[Year\?\]/.test(String(label || ""));
  }

  /** Surname (or last token) of the first author for stable bibliography sort. */
  function firstAuthorSortKey(authors) {
    const raw = String(authors || "").trim();
    if (!raw) return "";
    const first = raw.split(/[,;]|\s+and\s+/i)[0].trim();
    if (!first) return "";
    if (first.includes(",")) {
      return first.split(",")[0].trim().toLowerCase();
    }
    const parts = first.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 1].toLowerCase();
    return first.toLowerCase();
  }

  /**
   * Stable article order: first author A→Z, then year (newer first), then title.
   * @param {{ authors?: string, year?: string, title?: string, structured?: object }} a
   * @param {{ authors?: string, year?: string, title?: string, structured?: object }} b
   */
  function compareArticlesBibliographic(a, b) {
    const authorCmp = firstAuthorSortKey(a?.authors).localeCompare(
      firstAuthorSortKey(b?.authors),
      undefined,
      { sensitivity: "base", numeric: true }
    );
    if (authorCmp !== 0) return authorCmp;

    const yearA = parseInt(parseYear(a) || "0", 10) || 0;
    const yearB = parseInt(parseYear(b) || "0", 10) || 0;
    if (yearA !== yearB) return yearB - yearA;

    return String(a?.title || "").localeCompare(String(b?.title || ""), undefined, {
      sensitivity: "base",
      numeric: true,
    });
  }

  /** Year descending (newest first); articles without year last; then title. */
  function compareArticlesByYear(a, b) {
    const yearA = parseInt(parseYear(a) || "0", 10) || 0;
    const yearB = parseInt(parseYear(b) || "0", 10) || 0;
    const hasA = yearA > 0;
    const hasB = yearB > 0;
    if (!hasA && !hasB) {
      return String(a?.title || "").localeCompare(String(b?.title || ""), undefined, {
        sensitivity: "base",
        numeric: true,
      });
    }
    if (!hasA) return 1;
    if (!hasB) return -1;
    if (yearA !== yearB) return yearB - yearA;
    return String(a?.title || "").localeCompare(String(b?.title || ""), undefined, {
      sensitivity: "base",
      numeric: true,
    });
  }

  function buildShortToken(citeId, label) {
    const id = String(citeId || "").trim();
    if (!id) return "";
    let token = `[[cite:${id}`;
    if (label) token += `|${String(label).replace(/[|]/g, " ")}`;
    return `${token}]]`;
  }

  /** @deprecated inline legacy token — prefer register + buildShortToken */
  function buildToken(articleId, offset, length, label, quote) {
    const id = String(articleId || "").trim();
    const off = Math.max(0, parseInt(offset, 10) || 0);
    const len = Math.max(1, parseInt(length, 10) || 1);
    let token = `[[litlens:${id}:${off}:${len}`;
    if (label) token += `|${String(label).replace(/[|#]/g, " ")}`;
    const q = String(quote || "").trim();
    if (q.length >= 4) {
      token += `#${encodeURIComponent(q.slice(0, 500))}`;
    }
    return `${token}]]`;
  }

  function decodeQuote(encoded) {
    if (!encoded) return "";
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }

  function parseLegacyToken(token) {
    const m = String(token || "").match(
      /^\[\[litlens:([^:\|\]#]+):(\d+):(\d+)(?:\|([^#\]]*))?(?:#([^\]]+))?\]\]$/i
    );
    if (!m) return null;
    return {
      articleId: m[1],
      offset: parseInt(m[2], 10),
      length: parseInt(m[3], 10),
      label: m[4] || "",
      quote: decodeQuote(m[5]),
    };
  }

  function parseToken(token) {
    const short = String(token || "").match(
      /^\[\[cite:([a-z0-9]{4,12})(?:\|([^\]]*))?\]\]$/i
    );
    if (short) {
      return { citeId: short[1], label: short[2] || "", kind: "ref" };
    }
    const legacy = parseLegacyToken(token);
    if (legacy) return { ...legacy, kind: "legacy" };
    return null;
  }

  function indexNearest(hay, needle, hint, winStart, winEnd) {
    if (!needle) return -1;
    const indices = [];
    let pos = winStart;
    while (pos <= winEnd) {
      const i = hay.indexOf(needle, pos);
      if (i < 0 || i > winEnd) break;
      indices.push(i);
      pos = i + 1;
    }
    if (!indices.length) return -1;
    return indices.reduce((best, i) =>
      Math.abs(i - hint) < Math.abs(best - hint) ? i : best
    );
  }

  function sliceMatchesQuote(hay, offset, length, quote) {
    if (!quote) return false;
    const slice = hay.slice(offset, offset + length);
    return slice === quote || slice.includes(quote) || quote.includes(slice);
  }

  function findPassageInPlain(plain, cite) {
    const hay = String(plain || "");
    const hint = Math.max(0, cite?.offset || 0);
    const fallbackLen = Math.max(1, cite?.length || 1);
    const quote = String(cite?.quote ?? "");
    if (!quote || quote.length < 4) {
      return { offset: hint, length: fallbackLen };
    }

    const pad = 5000;
    const winStart = Math.max(0, hint - pad);
    const winEnd = Math.min(hay.length, hint + pad + quote.length + 400);

    const tryNeedles = [quote];
    const trimmed = quote.trim();
    if (trimmed && trimmed !== quote) tryNeedles.push(trimmed);

    for (const needle of tryNeedles) {
      const idx = indexNearest(hay, needle, hint, winStart, winEnd);
      if (idx >= 0) {
        return { offset: idx, length: needle.length };
      }
    }

    const collapsed = quote.replace(/\s+/g, " ");
    if (collapsed.length >= 8 && collapsed !== quote) {
      const idx = indexNearest(hay, collapsed, hint, winStart, winEnd);
      if (idx >= 0) {
        return { offset: idx, length: collapsed.length };
      }
    }

    return { offset: hint, length: fallbackLen };
  }

  function resolveCiteStore(store, citeId) {
    if (!store || !citeId) return null;
    if (typeof store.get === "function") return store.get(citeId);
    return store[citeId] || null;
  }

  function findAllCiteMatches(hay) {
    const matches = [];
    CITE_REF_RE.lastIndex = 0;
    let m;
    while ((m = CITE_REF_RE.exec(hay))) {
      matches.push({
        index: m.index,
        lastIndex: CITE_REF_RE.lastIndex,
        raw: m[0],
        kind: "ref",
        citeId: m[1],
        label: m[2] || "",
      });
    }
    LEGACY_CITE_RE.lastIndex = 0;
    while ((m = LEGACY_CITE_RE.exec(hay))) {
      matches.push({
        index: m.index,
        lastIndex: LEGACY_CITE_RE.lastIndex,
        raw: m[0],
        kind: "legacy",
        articleId: m[1],
        offset: parseInt(m[2], 10),
        length: parseInt(m[3], 10),
        label: m[4] || "",
        quote: decodeQuote(m[5]),
      });
    }
    matches.sort((a, b) => a.index - b.index);
    return matches;
  }

  function legacyToEntry(match) {
    return {
      articleId: match.articleId,
      offset: match.offset,
      length: match.length,
      label: match.label,
      quote: match.quote,
    };
  }

  function splitDocText(text, citeStore) {
    const hay = normalizeCiteSourceText(text);
    const matches = findAllCiteMatches(hay);
    const parts = [];
    let last = 0;
    for (const match of matches) {
      if (match.index > last) {
        parts.push({ type: "text", value: hay.slice(last, match.index) });
      }
      if (match.kind === "ref") {
        const stored = resolveCiteStore(citeStore, match.citeId);
        parts.push({
          type: "cite",
          citeId: match.citeId,
          articleId: stored?.articleId,
          offset: stored?.offset,
          length: stored?.length,
          quote: stored?.quote || "",
          label: match.label || stored?.label || "",
          raw: match.raw,
          missing: !stored?.articleId,
        });
      } else {
        parts.push({
          type: "cite",
          articleId: match.articleId,
          offset: match.offset,
          length: match.length,
          label: match.label,
          quote: match.quote,
          raw: match.raw,
        });
      }
      last = match.lastIndex;
    }
    if (last < hay.length) parts.push({ type: "text", value: hay.slice(last) });
    return parts;
  }

  async function migrateDocText(text, registerFn) {
    const hay = normalizeCiteSourceText(text);
    const matches = findAllCiteMatches(hay).filter((m) => m.kind === "legacy");
    if (!matches.length || !registerFn) return hay;

    let out = hay;
    for (const match of [...matches].reverse()) {
      const { token } = await registerFn(legacyToEntry(match));
      if (token) {
        out = out.slice(0, match.index) + token + out.slice(match.lastIndex);
      }
    }
    return out;
  }

  async function migrateDocFields(doc, fieldKeys, registerFn) {
    const next = { ...doc };
    for (const key of fieldKeys || []) {
      if (!next[key]) continue;
      next[key] = await migrateDocText(String(next[key]), registerFn);
    }
    return next;
  }

  function buildFromSelection(article, span, root) {
    if (!article?.id || !span || span.offset == null) return null;
    const label = formatArticleCite(article);
    const g = typeof globalThis !== "undefined" ? globalThis : this;
    const BM =
      root?.nodeType === 1 && g.LitLensBookmarks ? g.LitLensBookmarks : null;
    let quote = span.quote ? String(span.quote) : "";
    if (!quote && BM?.extractCitationPlainText && root) {
      const plain = BM.extractCitationPlainText(root);
      quote = plain.slice(
        span.offset,
        span.offset + Math.max(1, span.length || 1)
      );
    }
    if (!quote && span.excerpt) {
      quote = String(span.excerpt).replace(/\s+/g, " ").trim();
    }
    return {
      articleId: article.id,
      offset: span.offset,
      length: span.length || 1,
      label,
      quote,
      legacyToken: buildToken(
        article.id,
        span.offset,
        span.length || 1,
        label,
        quote
      ),
    };
  }

  function renderDocFragment(text, articlesById, onCiteClick, citeStore) {
    const ML =
      typeof globalThis !== "undefined"
        ? globalThis.LitLensMethodLinks
        : null;
    if (ML?.renderMethodDocFragment) {
      return ML.renderMethodDocFragment(text, {
        articlesById,
        onCiteClick,
        citeStore,
        vocab: null,
        onMethodClick: null,
      });
    }

    const frag = document.createDocumentFragment();
    const parts = splitDocText(text, citeStore);
    if (!parts.length && !text) return frag;

    const IF =
      typeof globalThis !== "undefined"
        ? globalThis.LitLensInlineFormat
        : null;

    for (const part of parts) {
      if (part.type === "text") {
        if (IF?.appendFormattedText) {
          IF.appendFormattedText(frag, part.value);
        } else {
          const lines = part.value.split("\n");
          lines.forEach((line, i) => {
            if (i > 0) frag.appendChild(document.createElement("br"));
            if (line) frag.appendChild(document.createTextNode(line));
          });
        }
        continue;
      }
      const article =
        part.articleId &&
        (articlesById instanceof Map
          ? articlesById.get(part.articleId)
          : articlesById?.[part.articleId]);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "method-cite-link";
      if (part.missing) btn.classList.add("method-cite-link--missing");
      btn.textContent =
        part.label?.trim() || formatArticleCite(article) || part.citeId || "cite";
      btn.title = part.missing
        ? "Citation data missing — re-copy from article"
        : article?.title
          ? `Open: ${article.title}`
          : "Open passage in article";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        if (part.missing || part.articleId == null || part.offset == null) return;
        onCiteClick?.({
          articleId: part.articleId,
          offset: part.offset,
          length: part.length,
          quote: part.quote || "",
        });
      });
      frag.appendChild(btn);
    }
    return frag;
  }

  return {
    LEGACY_CITE_RE,
    CITE_REF_RE,
    formatArticleCite,
    formatCiteLabel,
    citeLabelNeedsMetadata,
    firstAuthorSortKey,
    compareArticlesBibliographic,
    compareArticlesByYear,
    buildToken,
    buildShortToken,
    parseToken,
    parseLegacyToken,
    buildFromSelection,
    findPassageInPlain,
    sliceMatchesQuote,
    normalizeCiteSourceText,
    hasCiteMarkup,
    splitDocText,
    findAllCiteMatches,
    migrateDocText,
    migrateDocFields,
    renderDocFragment,
  };
});
