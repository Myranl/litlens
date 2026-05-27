/**
 * Link highlight categories to Info fields; auto-hide when filled unless forced on.
 */
const INFO_COLUMNS = [
  { key: "", label: "— Not linked —" },
  { key: "title", label: "Title", group: "bibliographic" },
  { key: "authors", label: "Authors", group: "bibliographic" },
  { key: "year", label: "Year", group: "bibliographic" },
  { key: "journal", label: "Journal", group: "bibliographic" },
  { key: "url", label: "Source URL", group: "bibliographic" },
  { key: "nAnimals", label: "N animals", group: "study" },
  { key: "species", label: "Species", group: "study" },
  { key: "brainRegions", label: "Brain region", group: "study" },
  { key: "behavioralParadigms", label: "Behavioral paradigm", group: "study" },
  { key: "recordingMethods", label: "Recording methods", group: "study" },
  { key: "cellTypes", label: "Cell type", group: "study" },
  { key: "software", label: "Software", group: "study" },
  { key: "cellFilterCriterion", label: "Cell filter criterion", group: "study" },
  { key: "methods", label: "Methods (analysis)", group: "study" },
];

function columnLabel(key) {
  return INFO_COLUMNS.find((c) => c.key === key)?.label || key;
}

function isInfoColumnFilled(article, columnKey) {
  if (!article || !columnKey) return false;
  const s = article.structured || {};
  if (columnKey === "nAnimals") {
    return Boolean(String(article.nAnimals || s.nAnimals || "").trim());
  }
  if (columnKey === "title") return Boolean(String(article.title || "").trim());
  if (columnKey === "authors") return Boolean(String(article.authors || "").trim());
  if (columnKey === "year") return Boolean(String(article.year || "").trim());
  if (columnKey === "journal") return Boolean(String(article.journal || "").trim());
  if (columnKey === "url") return Boolean(String(article.url || "").trim());
  if (columnKey === "cellFilterCriterion") {
    return Boolean(
      String(article.cellFilterCriterion || s.cellFilterCriterion || "").trim()
    );
  }
  const val = s[columnKey];
  if (Array.isArray(val)) return val.length > 0;
  return Boolean(String(val || "").trim());
}

function getCategoryColumnLink(termsDoc, categoryId) {
  const links = termsDoc?.categoryColumnLinks || {};
  const key = links[categoryId];
  return key && String(key).trim() ? key : "";
}

/** Hide highlights when linked Info field is filled, unless user forced them on. */
function shouldSuppressCategory(article, termsDoc, categoryId) {
  const col = getCategoryColumnLink(termsDoc, categoryId);
  if (!col || !isInfoColumnFilled(article, col)) return false;
  const forceShown = new Set(article.highlightForceShown || []);
  return !forceShown.has(categoryId);
}

function isCategoryHighlightsHidden(article, termsDoc, categoryId) {
  return shouldSuppressCategory(article, termsDoc, categoryId);
}

/** Drop force-shown entries when the linked column is no longer filled. */
function reconcileHighlightForceShown(article, termsDoc) {
  const links = termsDoc?.categoryColumnLinks || {};
  return (article.highlightForceShown || []).filter((catId) => {
    const col = links[catId];
    return col && isInfoColumnFilled(article, col);
  });
}

function filterTermsForArticle(termsDoc, article) {
  if (!termsDoc) return { categories: [], terms: [] };
  return {
    ...termsDoc,
    terms: (termsDoc.terms || []).filter(
      (t) => !shouldSuppressCategory(article, termsDoc, t.categoryId)
    ),
  };
}

/** True when study metadata, bookmarks, or a prior scan was saved for this article. */
function articleHasSavedStudyMetadata(article) {
  if (!article) return false;
  const s = article.structured || {};
  const arrayKeys = [
    "species",
    "behavioralParadigms",
    "recordingMethods",
    "cellTypes",
    "software",
    "methods",
  ];
  for (const key of arrayKeys) {
    if (Array.isArray(s[key]) && s[key].length) return true;
  }
  if (
    Array.isArray(s.brainRegions) &&
    s.brainRegions.some((r) => String(r?.label || "").trim())
  ) {
    return true;
  }
  if (String(article.nAnimals || s.nAnimals || "").trim()) return true;
  if (String(article.cellFilterCriterion || s.cellFilterCriterion || "").trim()) {
    return true;
  }
  const evidence = article.methodEvidence;
  if (evidence && typeof evidence === "object") {
    for (const entries of Object.values(evidence)) {
      if (Array.isArray(entries) && entries.length) return true;
    }
  }
  if (Array.isArray(article.readParagraphKeys) && article.readParagraphKeys.length) {
    return true;
  }
  if ((article.methodsParagraphTotal || 0) > 0) return true;
  if (
    Array.isArray(article.methodSuggestionsDismissed) &&
    article.methodSuggestionsDismissed.length
  ) {
    return true;
  }
  if (
    Array.isArray(article.methodSuggestionsDismissedHits) &&
    article.methodSuggestionsDismissedHits.length
  ) {
    return true;
  }
  const aliases = article.foundTermAliases;
  if (aliases && typeof aliases === "object" && Object.keys(aliases).length) {
    return true;
  }
  if (Array.isArray(article.bookmarks) && article.bookmarks.length) return true;
  return false;
}

/** Methods workflow not started — skip Methods scan, rail, and Read marks on open. */
function articleMethodsAreUnset(article) {
  if (!article) return true;
  if (Array.isArray(article.structured?.methods) && article.structured.methods.length) {
    return false;
  }
  const evidence = article.methodEvidence;
  if (evidence && typeof evidence === "object") {
    for (const entries of Object.values(evidence)) {
      if (Array.isArray(entries) && entries.length) return false;
    }
  }
  if (Array.isArray(article.readParagraphKeys) && article.readParagraphKeys.length) {
    return false;
  }
  return true;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    INFO_COLUMNS,
    columnLabel,
    isInfoColumnFilled,
    getCategoryColumnLink,
    shouldSuppressCategory,
    isCategoryHighlightsHidden,
    reconcileHighlightForceShown,
    filterTermsForArticle,
    articleHasSavedStudyMetadata,
    articleMethodsAreUnset,
  };
}

if (typeof window !== "undefined") {
  window.LitLensColumnLinks = {
    INFO_COLUMNS,
    columnLabel,
    isInfoColumnFilled,
    getCategoryColumnLink,
    shouldSuppressCategory,
    isCategoryHighlightsHidden,
    reconcileHighlightForceShown,
    filterTermsForArticle,
    articleHasSavedStudyMetadata,
    articleMethodsAreUnset,
  };
}
