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
  };
}
