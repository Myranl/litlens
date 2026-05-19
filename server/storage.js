const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const {
  ARTICLES_DIR,
  TERMS_FILE,
  TAGS_FILE,
  VOCAB_FILE,
  DEFAULT_TERMS,
  DEFAULT_TAGS,
  VOCAB_DEFAULTS,
} = require("./paths");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function articleDir(id) {
  return path.join(ARTICLES_DIR, id);
}

const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "ref",
  "source",
  "fbclid",
  "gclid",
];

/** Normalize URL for duplicate detection */
function normalizeUrl(url) {
  if (!url || typeof url !== "string") return "";
  try {
    const u = new URL(url.trim());
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.includes(key) || key.startsWith("utm_")) {
        u.searchParams.delete(key);
      }
    }
    const path = u.pathname.replace(/\/+$/, "") || "/";
    const search = u.searchParams.toString();
    return `${u.protocol}//${u.hostname.toLowerCase()}${path}${search ? `?${search}` : ""}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

function findArticleByUrl(url) {
  const norm = normalizeUrl(url);
  if (!norm) return null;
  for (const meta of listArticles()) {
    if (meta.url && normalizeUrl(meta.url) === norm) {
      return { ...meta, id: meta.id };
    }
  }
  return null;
}

function listArticles() {
  if (!fs.existsSync(ARTICLES_DIR)) return [];
  return fs
    .readdirSync(ARTICLES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const metaPath = path.join(ARTICLES_DIR, d.name, "meta.json");
      if (!fs.existsSync(metaPath)) return null;
      const meta = readJson(metaPath, null);
      return meta ? { ...meta, id: d.name } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}

function getArticle(id) {
  const dir = articleDir(id);
  if (!fs.existsSync(dir)) return null;
  const meta = readJson(path.join(dir, "meta.json"), null);
  if (!meta) return null;
  const textPath = path.join(dir, "text.txt");
  const htmlPath = path.join(dir, "page.html");
  const normalized = normalizeArticleMeta({ ...meta, id });
  return {
    ...normalized,
    text: fs.existsSync(textPath) ? fs.readFileSync(textPath, "utf8") : "",
    html: fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, "utf8") : "",
  };
}

const EMPTY_STRUCTURED = () => ({
  species: [],
  brainRegions: [],
  behavioralParadigms: [],
  recordingMethods: [],
  cellTypes: [],
  methods: [],
  nAnimals: "",
});

function normalizeArticleMeta(meta) {
  const structured = { ...EMPTY_STRUCTURED(), ...(meta.structured || {}) };
  if (meta.species) structured.species = meta.species;
  if (meta.brainRegions) structured.brainRegions = meta.brainRegions;
  if (meta.behavioralParadigms) structured.behavioralParadigms = meta.behavioralParadigms;
  if (meta.recordingMethods) structured.recordingMethods = meta.recordingMethods;
  if (meta.cellTypes) structured.cellTypes = meta.cellTypes;
  if (meta.methods) structured.methods = meta.methods;
  if (meta.nAnimals != null) structured.nAnimals = meta.nAnimals;
  if (meta.cellFilterCriterion != null) {
    structured.cellFilterCriterion = meta.cellFilterCriterion;
  }

  return {
    authors: "",
    year: "",
    journal: "",
    tagIds: [],
    ...meta,
    title: meta.title || "Untitled",
    url: meta.url || "",
    structured,
    nAnimals: structured.nAnimals || meta.nAnimals || "",
    cellFilterCriterion:
      meta.cellFilterCriterion || structured.cellFilterCriterion || "",
    bookmarks: Array.isArray(meta.bookmarks) ? meta.bookmarks : [],
    highlightSuppressed: Array.isArray(meta.highlightSuppressed)
      ? meta.highlightSuppressed
      : [],
    highlightForceShown: Array.isArray(meta.highlightForceShown)
      ? meta.highlightForceShown
      : [],
  };
}

function formatBrainRegionForCsv(entry) {
  if (typeof entry === "string") return entry;
  const label = (entry?.label || "").trim();
  const parts = [];
  if (entry?.ap) parts.push(`AP = ${entry.ap}`);
  if (entry?.ml) parts.push(`ML = ${entry.ml}`);
  if (entry?.dv) parts.push(`DV = ${entry.dv}`);
  if (!parts.length) return label;
  const prefix = parts.join("; ");
  return label ? `${prefix}, ${label}` : prefix;
}

function joinList(arr) {
  if (!arr?.length) return "";
  return arr.map((x) => String(x).trim()).filter(Boolean).join(", ");
}

function articleToCsvRow(meta) {
  const s = meta.structured || EMPTY_STRUCTURED();
  const brainStr = (s.brainRegions || [])
    .map(formatBrainRegionForCsv)
    .filter(Boolean)
    .join(", ");

  return {
    Name: meta.title || "",
    "N animals": meta.nAnimals || s.nAnimals || "",
    URL: meta.url || "",
    authors: meta.authors || "",
    "behavioral paradigm": joinList(s.behavioralParadigms),
    "brain region": brainStr,
    "cell sorting methods": "",
    cell_filter_criterion:
      meta.cellFilterCriterion || s.cellFilterCriterion || "",
    cell_type: joinList(s.cellTypes),
    journal: meta.journal || "",
    main_question_tag: "",
    method_category: "",
    methods_firing: joinList(s.methods),
    paper_id: meta.id || "",
    "recording modality": joinList(s.recordingMethods),
    software: "",
    species: joinList(s.species),
    year: meta.year || "",
  };
}

function escapeCsvCell(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportMetaCsv() {
  const headers = [
    "Name",
    "N animals",
    "URL",
    "authors",
    "behavioral paradigm",
    "brain region",
    "cell sorting methods",
    "cell_filter_criterion",
    "cell_type",
    "journal",
    "main_question_tag",
    "method_category",
    "methods_firing",
    "paper_id",
    "recording modality",
    "software",
    "species",
    "year",
  ];
  const rows = listArticles().map((m) => articleToCsvRow(normalizeArticleMeta(m)));
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escapeCsvCell(row[h])).join(",")),
  ];
  return lines.join("\n");
}

function saveArticle({
  title,
  url,
  html,
  text,
  status,
  authors,
  year,
  journal,
  bookmarks,
}) {
  if (url) {
    const existing = findArticleByUrl(url);
    if (existing) {
      const err = new Error("Article with this URL already exists");
      err.code = "DUPLICATE";
      err.existing = existing;
      throw err;
    }
  }

  const id = uuidv4().slice(0, 8);
  const dir = articleDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const addedAt = Date.now();
  const meta = normalizeArticleMeta({
    id,
    title: title || "Untitled",
    url: url || "",
    authors: authors || "",
    year: year || "",
    journal: journal || "",
    addedAt,
    status: status || "new",
    tagIds: [],
    bookmarks: Array.isArray(bookmarks) ? bookmarks : [],
  });
  writeJson(path.join(dir, "meta.json"), meta);
  if (html) fs.writeFileSync(path.join(dir, "page.html"), html, "utf8");
  if (text) fs.writeFileSync(path.join(dir, "text.txt"), text, "utf8");
  return getArticle(id);
}

function updateArticleMeta(id, patch) {
  const dir = articleDir(id);
  const metaPath = path.join(dir, "meta.json");
  if (!fs.existsSync(metaPath)) return null;
  const meta = readJson(metaPath, {});
  const next = normalizeArticleMeta({ ...meta, ...patch, id });
  writeJson(metaPath, next);
  return next;
}

function saveArticleNotes(id, notes) {
  return updateArticleMeta(id, { notes });
}

function deleteArticle(id) {
  const dir = articleDir(id);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

function getTerms() {
  return readJson(TERMS_FILE, DEFAULT_TERMS);
}

function saveTerms(terms) {
  writeJson(TERMS_FILE, terms);
  return terms;
}

function getTags() {
  const data = readJson(TAGS_FILE, DEFAULT_TAGS);
  if (!data.tags) data.tags = [];
  return data;
}

function saveTags(tagsDoc) {
  writeJson(TAGS_FILE, tagsDoc);
  return tagsDoc;
}

function getVocab() {
  return readJson(VOCAB_FILE, VOCAB_DEFAULTS);
}

function saveVocab(vocab) {
  writeJson(VOCAB_FILE, vocab);
  return vocab;
}

function searchArticles(query, limit = 50) {
  const q = query.toLowerCase();
  const hits = [];
  for (const meta of listArticles()) {
    const full = getArticle(meta.id);
    const text = (full.text || "").toLowerCase();
    let idx = text.indexOf(q);
    let count = 0;
    while (idx !== -1 && count < 3) {
      const start = Math.max(0, idx - 80);
      const end = Math.min(text.length, idx + q.length + 80);
      hits.push({
        articleId: meta.id,
        title: meta.title,
        snippet: text.slice(start, end),
        index: idx,
      });
      count++;
      idx = text.indexOf(q, idx + 1);
    }
    if (hits.length >= limit) break;
  }
  return hits.slice(0, limit);
}

module.exports = {
  listArticles,
  getArticle,
  saveArticle,
  findArticleByUrl,
  normalizeUrl,
  updateArticleMeta,
  saveArticleNotes,
  deleteArticle,
  getTerms,
  saveTerms,
  getTags,
  saveTags,
  getVocab,
  saveVocab,
  exportMetaCsv,
  searchArticles,
};
