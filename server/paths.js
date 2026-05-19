const path = require("path");
const os = require("os");
const fs = require("fs");

/** Default data root: ~/LiteratureReview */
const DATA_ROOT =
  process.env.LITLENS_DATA ||
  path.join(os.homedir(), "LiteratureReview");

const ARTICLES_DIR = path.join(DATA_ROOT, "articles");
const TERMS_FILE = path.join(DATA_ROOT, "terms.json");
const TAGS_FILE = path.join(DATA_ROOT, "tags.json");
const VOCAB_FILE = path.join(DATA_ROOT, "vocab.json");

const DEFAULT_TERMS = {
  categories: [
    { id: "method", label: "Method / instrument", color: "#4f98a3" },
    { id: "construct", label: "Construct", color: "#e8af34" },
    { id: "design", label: "Study design", color: "#6daa45" },
    { id: "theory", label: "Theory / author", color: "#d163a7" },
    { id: "critique", label: "Limitations / critique", color: "#fdab43" },
  ],
  terms: [],
};

const DEFAULT_TAGS = { tags: [] };

const VOCAB_DEFAULTS = require("./vocab-defaults");

const TAG_PALETTE = [
  "#4f98a3", "#e8af34", "#6daa45", "#d163a7", "#fdab43", "#5591c7",
  "#a06fdf", "#dd6974", "#7ec8c8", "#c8e87e",
];

function ensureDataDirs() {
  fs.mkdirSync(ARTICLES_DIR, { recursive: true });
  if (!fs.existsSync(TERMS_FILE)) {
    fs.writeFileSync(TERMS_FILE, JSON.stringify(DEFAULT_TERMS, null, 2), "utf8");
  }
  if (!fs.existsSync(TAGS_FILE)) {
    fs.writeFileSync(TAGS_FILE, JSON.stringify(DEFAULT_TAGS, null, 2), "utf8");
  }
  if (!fs.existsSync(VOCAB_FILE)) {
    fs.writeFileSync(VOCAB_FILE, JSON.stringify(VOCAB_DEFAULTS, null, 2), "utf8");
  }
}

module.exports = {
  DATA_ROOT,
  ARTICLES_DIR,
  TERMS_FILE,
  TAGS_FILE,
  VOCAB_FILE,
  DEFAULT_TERMS,
  DEFAULT_TAGS,
  VOCAB_DEFAULTS,
  TAG_PALETTE,
  ensureDataDirs,
};
