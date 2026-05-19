const express = require("express");
const path = require("path");
const {
  DATA_ROOT,
  ensureDataDirs,
} = require("./paths");
const storage = require("./storage");

const PORT = Number(process.env.LITLENS_PORT || 17321);

ensureDataDirs();

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.text({ type: "text/*", limit: "50mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // Chrome Private Network Access (HTTPS page → localhost)
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, dataRoot: DATA_ROOT });
});

app.get("/api/terms", (_req, res) => {
  res.json(storage.getTerms());
});

app.put("/api/terms", (req, res) => {
  storage.saveTerms(req.body);
  res.json(storage.getTerms());
});

app.get("/api/tags", (_req, res) => {
  res.json(storage.getTags());
});

app.put("/api/tags", (req, res) => {
  storage.saveTags(req.body);
  res.json(storage.getTags());
});

app.get("/api/articles", (_req, res) => {
  res.json(storage.listArticles());
});

app.get("/api/articles/lookup", (req, res) => {
  const url = (req.query.url || "").trim();
  if (!url) return res.status(400).json({ error: "url query required" });
  const existing = storage.findArticleByUrl(url);
  res.json({ found: !!existing, article: existing });
});

app.get("/api/articles/:id", (req, res) => {
  const article = storage.getArticle(req.params.id);
  if (!article) return res.status(404).json({ error: "not found" });
  res.json(article);
});

app.post("/api/articles", (req, res) => {
  const { title, url, html, text, status, authors, year, journal, bookmarks } =
    req.body || {};
  if (!text && !html) {
    return res.status(400).json({ error: "html or text required" });
  }
  try {
    const article = storage.saveArticle({
      title,
      url,
      html,
      text,
      status,
      authors,
      year,
      journal,
      bookmarks,
    });
    res.status(201).json(article);
  } catch (e) {
    if (e.code === "DUPLICATE") {
      return res.status(409).json({
        error: "duplicate",
        message: "This article URL is already in your library",
        existing: e.existing,
      });
    }
    throw e;
  }
});

app.patch("/api/articles/:id", (req, res) => {
  const {
    notes,
    title,
    status,
    tagIds,
    authors,
    year,
    journal,
    url,
    structured,
    nAnimals,
    cellFilterCriterion,
    bookmarks,
    highlightSuppressed,
    highlightForceShown,
  } = req.body || {};
  if (notes !== undefined) storage.saveArticleNotes(req.params.id, notes);
  const patch = {};
  if (title !== undefined) patch.title = title;
  if (status !== undefined) patch.status = status;
  if (tagIds !== undefined) patch.tagIds = tagIds;
  if (authors !== undefined) patch.authors = authors;
  if (year !== undefined) patch.year = year;
  if (journal !== undefined) patch.journal = journal;
  if (url !== undefined) patch.url = url;
  if (structured !== undefined) patch.structured = structured;
  if (nAnimals !== undefined) patch.nAnimals = nAnimals;
  if (cellFilterCriterion !== undefined) patch.cellFilterCriterion = cellFilterCriterion;
  if (bookmarks !== undefined) patch.bookmarks = bookmarks;
  if (highlightSuppressed !== undefined) patch.highlightSuppressed = highlightSuppressed;
  if (highlightForceShown !== undefined) patch.highlightForceShown = highlightForceShown;
  if (Object.keys(patch).length) storage.updateArticleMeta(req.params.id, patch);
  const article = storage.getArticle(req.params.id);
  if (!article) return res.status(404).json({ error: "not found" });
  res.json(article);
});

app.delete("/api/articles/:id", (req, res) => {
  if (!storage.deleteArticle(req.params.id)) {
    return res.status(404).json({ error: "not found" });
  }
  res.json({ ok: true });
});

app.get("/api/vocab", (_req, res) => {
  res.json(storage.getVocab());
});

app.put("/api/vocab", (req, res) => {
  storage.saveVocab(req.body);
  res.json(storage.getVocab());
});

app.get("/api/export/meta.csv", (_req, res) => {
  const csv = storage.exportMetaCsv();
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="litlens-meta-export.csv"'
  );
  res.send("\uFEFF" + csv);
});

app.get("/api/search", (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json([]);
  res.json(storage.searchArticles(q));
});

app.use("/shared", express.static(path.join(__dirname, "..", "shared")));
app.use("/", express.static(path.join(__dirname, "..", "reader")));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`LitLens server: http://127.0.0.1:${PORT}`);
  console.log(`Data folder: ${DATA_ROOT}`);
});
