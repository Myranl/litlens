/**
 * Method catalog: separate from Terms/highlight lemmas.
 * Each entry: label, modalities (SPIKE|BEH|LFP|FRAMEWORK|DERIVED), category tag, trigger rules.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof root !== "undefined") {
    root.LitLensMethodProfiles = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  let matchSectionHeading = null;
  try {
    matchSectionHeading = require("./section-detect").matchSectionLabel;
  } catch (_) {
    /* browser bundle */
  }

  const METHODS_SECTION_END_LABELS = new Set([
    "results",
    "discussion",
    "conclusion",
    "references",
    "acknowledgments",
    "supplementary",
  ]);

  const MODALITIES = ["SPIKE", "BEH", "LFP", "FRAMEWORK", "DERIVED"];
  /** Modalities on the methods-map grid axes (SPIKE/BEH/LFP only). */
  const MAP_GRID_MODALITIES = ["SPIKE", "BEH", "LFP"];
  /** Color-only tags: no grid columns; alone → —×— cell. */
  const MODALITIES_COLOR_ONLY = ["FRAMEWORK", "DERIVED"];
  /** @deprecated use MODALITIES_COLOR_ONLY */
  const MODALITIES_WITHOUT_CATEGORY = MODALITIES_COLOR_ONLY;
  const DOC_FIELDS = [
    "definition",
    "purpose",
    "naming",
    "input",
    "output",
    "inputRequirements",
    "parameters",
    "comments",
  ];
  const CATEGORIES = [
    "RAW",
    "STATE / RATE",
    "TEMPORAL",
    "EVENT",
    "RELATIONAL",
    "SPATIAL",
    "TASK",
  ];

  /** @deprecated use methodCatalog */
  const PROFILE_KEYS = ["methods", "recordingMethods"];

  /** Combination rules: max terms and proximity window (chars after first hit). */
  const MAX_COMBO_TERMS = 4;
  const MIN_COMBO_TERM_LEN = 2;
  const COMBO_WINDOW_CHARS = 800;
  const COMBO_FIRST_TERM_MAX_SCAN = 80;

  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /** Spaces and hyphen-like chars common in PDF/HTML (multi-taper vs multitaper). */
  const HYPHEN_CLASS = "\\s\\-–—‐\\u00AD\\u2010-\\u2015\\u2212";
  const HYPHEN_SPLIT = new RegExp(`[${HYPHEN_CLASS}]+`);

  function compactTerm(text) {
    return String(text || "")
      .toLowerCase()
      .replace(new RegExp(`[${HYPHEN_CLASS}]+`, "g"), "");
  }

  /** @returns {RegExp | null} */
  function buildTermRegExp(term, flags = "i") {
    const t = String(term || "").trim();
    if (!t) return null;
    if (HYPHEN_SPLIT.test(t)) {
      const parts = t.split(HYPHEN_SPLIT).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        return new RegExp(
          `\\b${parts.map(escapeRegex).join(`[${HYPHEN_CLASS}]+`)}\\b`,
          flags
        );
      }
    }
    return new RegExp(`\\b${escapeRegex(t)}\\b`, flags);
  }

  function iterCompactTermMatches(text, term) {
    const t = String(term || "").trim();
    if (!t || HYPHEN_SPLIT.test(t)) return [];
    const target = compactTerm(t);
    if (target.length < 4) return [];
    const wordRe = new RegExp(
      `[a-z0-9]+(?:[${HYPHEN_CLASS}]+[a-z0-9]+)*`,
      "gi"
    );
    const out = [];
    let m;
    while ((m = wordRe.exec(String(text || ""))) !== null) {
      if (compactTerm(m[0]) === target) {
        out.push({ index: m.index, length: m[0].length });
      }
    }
    return out;
  }

  function termMatches(text, term) {
    if (!term) return false;
    const re = buildTermRegExp(term);
    if (re?.test(String(text || ""))) return true;
    return iterCompactTermMatches(text, term).length > 0;
  }

  function findTermOffsetsInText(hay, term, maxIter = 500) {
    const text = String(hay || "");
    const t = String(term || "").trim();
    if (!t || !text) return [];
    const offsets = [];
    const re = buildTermRegExp(t, "gi");
    if (re) {
      let m;
      let n = 0;
      re.lastIndex = 0;
      while ((m = re.exec(text)) !== null && n++ < maxIter) {
        offsets.push(m.index);
      }
      if (offsets.length) return offsets;
    }
    let n = 0;
    for (const hit of iterCompactTermMatches(text, t)) {
      if (n++ >= maxIter) break;
      offsets.push(hit.index);
    }
    return offsets;
  }

  function firstTermMatchLength(hay, term) {
    const text = String(hay || "");
    const t = String(term || "").trim();
    if (!t) return 0;
    const re = buildTermRegExp(t);
    const m = re?.exec(text);
    if (m) return m[0].length;
    const compact = iterCompactTermMatches(text, t);
    return compact[0]?.length || t.length;
  }

  function slugify(label) {
    return String(label || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48);
  }

  function emptyTriggers() {
    return { direct: [], indirect: [], combination: [] };
  }

  function parseCombinationTerms(text) {
    const s = String(text || "").trim();
    if (!s) return [];
    const parts = s.includes("+")
      ? s.split(/\s*\+\s*/)
      : s.split(",");
    return sanitizeComboTerms(parts);
  }

  function sanitizeComboTerms(terms) {
    return (terms || [])
      .map((t) => String(t).trim())
      .filter((t) => t.length >= MIN_COMBO_TERM_LEN)
      .slice(0, MAX_COMBO_TERMS);
  }

  function normalizeCombination(entry) {
    let terms = [];
    if (Array.isArray(entry)) {
      terms = entry.map((t) => String(t).trim()).filter(Boolean);
    } else if (entry && typeof entry === "object" && Array.isArray(entry.terms)) {
      terms = entry.terms.map((t) => String(t).trim()).filter(Boolean);
    } else if (typeof entry === "string" && entry.trim()) {
      terms = parseCombinationTerms(entry);
    }
    terms = sanitizeComboTerms(terms);
    return terms.length >= 2 ? terms : null;
  }

  /** Category axis applies when the method has a grid modality (SPIKE/BEH/LFP). FRAMEWORK alone does not. */
  function usesMethodCategory(modalities) {
    return mapGridModalities(modalities).length > 0;
  }

  function mapGridModalities(modalities) {
    return (modalities || []).filter((m) => MAP_GRID_MODALITIES.includes(m));
  }

  function hasFrameworkModality(modalities) {
    return (modalities || []).includes("FRAMEWORK");
  }

  function hasDerivedModality(modalities) {
    return (modalities || []).includes("DERIVED");
  }

  function hasColorOnlyModality(modalities) {
    return (modalities || []).some((m) => MODALITIES_COLOR_ONLY.includes(m));
  }

  function normalizeTriggers(raw, label, legacyAliases) {
    const triggers = emptyTriggers();
    if (raw && typeof raw === "object") {
      triggers.direct = (raw.direct || []).map((t) => String(t).trim()).filter(Boolean);
      triggers.indirect = (raw.indirect || []).map((t) => String(t).trim()).filter(Boolean);
    }
    if (legacyAliases?.length && !triggers.direct.length) {
      triggers.direct = [label, ...legacyAliases];
    }
    if (!triggers.direct.includes(label)) {
      triggers.direct.unshift(label);
    }
    return triggers;
  }

  function emptyDoc() {
    return {
      definition: "",
      purpose: "",
      naming: "",
      input: "",
      output: "",
      inputRequirements: "",
      parameters: "",
      comments: "",
    };
  }

  function normalizeDoc(entry) {
    const doc = emptyDoc();
    if (!entry || typeof entry !== "object") return doc;
    const raw = entry.doc && typeof entry.doc === "object" ? entry.doc : entry;
    for (const key of DOC_FIELDS) {
      if (raw[key] != null) doc[key] = String(raw[key]).trim();
    }
    return doc;
  }

  function normalizeVariants(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map((v) => String(v).trim()).filter(Boolean);
  }

  /** One “first in…” record (metric or variant first reported elsewhere). */
  function normalizeFirstInEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const name = String(raw.name || "").trim();
    const year = String(raw.year || "").trim();
    let url = String(raw.url || raw.link || "").trim();
    const comment = String(raw.comment || "").trim();
    if (!name && !year && !url && !comment) return null;
    if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
    return { name, year, url, comment };
  }

  function normalizeFirstIn(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const entry of raw) {
      const norm = normalizeFirstInEntry(entry);
      if (norm) out.push(norm);
    }
    return out;
  }

  function parseArticleYear(article) {
    const raw =
      article?.year ||
      article?.structured?.year ||
      article?.meta?.year ||
      "";
    const m = String(raw).match(/\b(19|20)\d{2}\b/);
    return m ? parseInt(m[0], 10) : null;
  }

  function articleUsesMethod(article, methodLabel) {
    const q = String(methodLabel || "").trim().toLowerCase();
    if (!q) return false;
    const methods = article?.structured?.methods || article?.methods || [];
    return methods.some((m) => String(m).trim().toLowerCase() === q);
  }

  function normalizeMethodAbsentLabels(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const entry of raw) {
      const label = String(entry || "").trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(label);
    }
    return out;
  }

  /** User marked: this method is not in this article (library scan never shows it). */
  function isMethodAbsentFromArticle(article, methodLabel) {
    const q = String(methodLabel || "").trim().toLowerCase();
    if (!q) return false;
    return normalizeMethodAbsentLabels(article?.methodAbsentLabels).some(
      (l) => l.toLowerCase() === q
    );
  }

  function methodEvidenceEntries(article, methodLabel) {
    const me = article?.methodEvidence;
    if (!me || typeof me !== "object") return [];
    const q = String(methodLabel || "").trim().toLowerCase();
    if (Array.isArray(me[methodLabel])) return me[methodLabel];
    const key = Object.keys(me).find((k) => k.toLowerCase() === q);
    return key && Array.isArray(me[key]) ? me[key] : [];
  }

  /**
   * Library scan skips this article: method linked and/or passage saved on Info.
   * (Distinct from isMethodAbsentFromArticle — user said “not in article”.)
   */
  function articleSkipsMethodLibraryScan(article, methodLabel) {
    if (!article) return false;
    if (isMethodAbsentFromArticle(article, methodLabel)) return true;
    if (methodEvidenceEntries(article, methodLabel).length > 0) return true;
    return articleUsesMethod(article, methodLabel);
  }

  /** @returns {Map<number, number>} year → article count */
  function countMethodUsageByYear(articles, methodLabel) {
    const counts = new Map();
    for (const article of articles || []) {
      if (!articleUsesMethod(article, methodLabel)) continue;
      const year = parseArticleYear(article);
      if (!year) continue;
      counts.set(year, (counts.get(year) || 0) + 1);
    }
    return counts;
  }

  /** Articles in library that list this method on Info (structured.methods). */
  function countMethodArticles(articles, methodLabel) {
    let used = 0;
    for (const article of articles || []) {
      if (articleUsesMethod(article, methodLabel)) used++;
    }
    return used;
  }

  function formatMethodLibraryShare(used, total) {
    const n = Math.max(0, parseInt(used, 10) || 0);
    const m = Math.max(0, parseInt(total, 10) || 0);
    if (!m) return { used: n, total: 0, percent: 0, percentLabel: "0" };
    const percent = (100 * n) / m;
    const percentLabel =
      percent >= 10 ? String(Math.round(percent)) : percent.toFixed(1);
    return { used: n, total: m, percent, percentLabel };
  }

  function normalizeProfile(entry) {
    if (typeof entry === "string") {
      const label = entry.trim();
      if (!label) return null;
      return {
        id: slugify(label),
        label,
        modalities: [],
        category: "",
        doc: emptyDoc(),
        triggers: normalizeTriggers(null, label, []),
        relations: [],
        variants: [],
        firstIn: [],
      };
    }
    if (!entry || typeof entry !== "object") return null;
    const label = String(entry.label || "").trim();
    if (!label) return null;
    const modalities = Array.isArray(entry.modalities)
      ? entry.modalities
          .map((m) => String(m).trim().toUpperCase())
          .filter((m) => MODALITIES.includes(m))
      : [];
    let category = CATEGORIES.includes(entry.category) ? entry.category : "";
    const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
    const ML =
      typeof LitLensMethodLinks !== "undefined" ? LitLensMethodLinks : null;
    const relations = ML?.normalizeRelations
      ? ML.normalizeRelations(entry.relations, null)
      : Array.isArray(entry.relations) ? entry.relations.slice() : [];
    if (!usesMethodCategory(modalities)) category = "";
    return {
      id: entry.id || slugify(label),
      label,
      modalities: [...new Set(modalities)],
      category,
      doc: normalizeDoc(entry),
      triggers: normalizeTriggers(entry.triggers, label, aliases),
      relations,
      variants: normalizeVariants(entry.variants),
      firstIn: normalizeFirstIn(entry.firstIn),
    };
  }

  function getCatalog(vocab) {
    if (!vocab) return [];
    ensureCatalog(vocab);
    return vocab.methodCatalog || [];
  }

  /** Build methodCatalog from legacy profiles; keep recordingMethods for Info combobox only. */
  function ensureCatalog(vocab) {
    if (!vocab || typeof vocab !== "object") return vocab;
    if (!Array.isArray(vocab.methodCatalog)) {
      const fromMethods = (vocab.profiles?.methods || vocab.methods || [])
        .map(normalizeProfile)
        .filter(Boolean);
      vocab.methodCatalog = fromMethods;
    } else {
      vocab.methodCatalog = vocab.methodCatalog
        .map(normalizeProfile)
        .filter(Boolean);
    }
    for (const p of vocab.methodCatalog) {
      if (p.triggers) p.triggers.combination = [];
    }
    const ML =
      typeof LitLensMethodLinks !== "undefined" ? LitLensMethodLinks : null;
    if (ML) {
      for (const p of vocab.methodCatalog) {
        p.relations = ML.normalizeRelations(p.relations, vocab);
      }
    }
    vocab.methods = vocab.methodCatalog.map((p) => p.label);
    if (!vocab.profiles) vocab.profiles = {};
    vocab.profiles.methods = vocab.methodCatalog;
    if (!Array.isArray(vocab.profiles.recordingMethods)) {
      vocab.profiles.recordingMethods = (vocab.recordingMethods || [])
        .map((x) => (typeof x === "string" ? normalizeProfile(x) : normalizeProfile(x)))
        .filter(Boolean);
    }
    vocab.recordingMethods = vocab.profiles.recordingMethods.map((p) => p.label);

    return vocab;
  }

  /** @deprecated */
  function ensureProfiles(vocab) {
    return ensureCatalog(vocab);
  }

  function formatProfileSummary(profile) {
    const mods = profile.modalities?.length
      ? profile.modalities.join(" · ")
      : "—";
    const cat = profile.category || "—";
    return { modalities: mods, category: cat };
  }

  /** @returns {{ matchType: string, matchedTerm: string } | null} */
  function matchProfile(text, profile) {
    const hay = String(text || "");
    for (const term of profile.triggers.direct || []) {
      if (termMatches(hay, term)) {
        return { matchType: "direct", matchedTerm: term };
      }
    }
    for (const term of profile.triggers.indirect || []) {
      if (termMatches(hay, term)) {
        return { matchType: "indirect", matchedTerm: term };
      }
    }
    return null;
  }

  /**
   * Suggest from method catalog only (not Terms / highlight lemmas).
   * @returns {{ label: string, vocabKey: 'methods', matchType: string, matchedTerm: string, category: string, modalities: string[] }[]}
   */
  function suggestFromCatalog(text, vocab, options = {}) {
    const hay = String(text || "");
    if (!hay.trim()) return [];
    const selected = new Set(
      (options.alreadySelected || []).map((s) => String(s).toLowerCase())
    );
    const out = [];
    for (const profile of getCatalog(vocab)) {
      if (selected.has(profile.label.toLowerCase())) continue;
      const hit = matchProfile(hay, profile);
      if (hit) {
        out.push({
          label: profile.label,
          vocabKey: "methods",
          matchType: hit.matchType,
          matchedTerm: hit.matchedTerm,
          category: profile.category,
          modalities: profile.modalities || [],
        });
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }

  /** @deprecated */
  function suggestFromText(text, vocab, options = {}) {
    const alreadySelected = {
      methods: options.alreadySelected?.methods || options.alreadySelected || [],
    };
    return suggestFromCatalog(text, vocab, {
      alreadySelected: alreadySelected.methods,
    });
  }

  function getCatalogLabels(vocab) {
    return getCatalog(vocab).map((p) => p.label);
  }

  function getOptionLabels(vocab, vocabKey) {
    if (vocabKey === "methods") return getCatalogLabels(vocab);
    ensureCatalog(vocab);
    return vocab.profiles?.[vocabKey]?.map((p) => p.label) || vocab[vocabKey] || [];
  }

  function profileByLabel(vocab, label) {
    const q = String(label || "").trim().toLowerCase();
    return getCatalog(vocab).find((p) => p.label.toLowerCase() === q);
  }

  function collectHighlightTerms(termsDoc) {
    const set = new Set();
    if (!termsDoc?.terms) return set;
    for (const t of termsDoc.terms) {
      if (t.lemma) set.add(t.lemma.toLowerCase());
      for (const a of t.aliases || []) {
        if (a) set.add(String(a).toLowerCase());
      }
    }
    return set;
  }

  function triggerConflictsWithHighlights(profile, highlightTerms) {
    if (!highlightTerms?.size) return [];
    const conflicts = [];
    const all = [
      ...(profile.triggers.direct || []),
      ...(profile.triggers.indirect || []),
    ];
    for (const term of all) {
      if (highlightTerms.has(term.toLowerCase())) conflicts.push(term);
    }
    return conflicts;
  }

  function sliceMethodsSection(text, bookmarks) {
    const scope = getMethodsSectionScope(text, bookmarks);
    return scope ? scope.text : null;
  }

  function isPlausibleMethodsStart(plain, start) {
    const hay = String(plain || "");
    const len = hay.length;
    if (!len || start < 0 || start >= len) return false;
    if (len < 300) return start === 0;
    if (start > len * 0.82) return false;
    const head = hay.slice(start, Math.min(len, start + 120)).replace(/\s+/g, " ").trim();
    const looksLikeHeading =
      /^(?:\d+(?:\.\d+)*[\.\):\-–—]?\s+)?(?:Materials?\s+(?:and|&)\s+)?Methods?\b/i.test(
        head
      ) ||
      /^Experimental\s+(?:Methods|Procedures)\b/i.test(head);
    if (start < len * 0.06 && !looksLikeHeading) return false;
    return true;
  }

  function methodsSectionEndOffset(plain, sorted, methodsIdx, start) {
    const hay = String(plain || "");
    for (let i = methodsIdx + 1; i < sorted.length; i++) {
      const lab = String(sorted[i].label || "")
        .trim()
        .toLowerCase();
      if (
        METHODS_SECTION_END_LABELS.has(lab) &&
        typeof sorted[i].offset === "number" &&
        sorted[i].offset > start
      ) {
        return sorted[i].offset;
      }
    }
    const refStart = findReferencesSectionStart(hay, sorted, null);
    if (refStart != null && refStart > start) return refStart;
    return hay.length;
  }

  /** @returns {{ text: string, start: number, end: number } | null} */
  function getMethodsSectionScope(text, bookmarks) {
    const plain = String(text || "");
    const sorted = [...(bookmarks || [])].sort((a, b) => a.offset - b.offset);
    let methodsIdx = -1;
    let start = -1;
    for (let i = 0; i < sorted.length; i++) {
      if (!/^methods$/i.test((sorted[i].label || "").trim())) continue;
      const off = sorted[i].offset;
      if (!isPlausibleMethodsStart(plain, off)) continue;
      if (methodsIdx < 0 || off < start) {
        methodsIdx = i;
        start = off;
      }
    }
    if (methodsIdx < 0) return null;
    const end = methodsSectionEndOffset(plain, sorted, methodsIdx, start);
    if (end <= start) return null;
    return { text: plain.slice(start, end), start, end };
  }

  /** Detect section headings from line breaks in plain text (batch / server). */
  function detectSectionBookmarksInPlain(plain) {
    const hay = String(plain || "");
    if (!hay.length || !matchSectionHeading) return [];
    const lines = hay.split("\n");
    let offset = 0;
    const seen = new Set();
    const out = [];
    for (const line of lines) {
      const raw = line.replace(/\s+/g, " ").trim();
      if (raw.length > 0 && raw.length <= 150) {
        const label = matchSectionHeading(raw);
        if (label && !seen.has(label)) {
          seen.add(label);
          out.push({ label, offset, kind: "section", auto: true });
        }
      }
      offset += line.length + 1;
    }
    return out.sort((a, b) => a.offset - b.offset);
  }

  function mergeSectionBookmarksForScan(saved, detected) {
    const haystack = [...(saved || []), ...(detected || [])].filter(
      (b) => typeof b.offset === "number" && b.offset >= 0
    );
    const byLabel = new Map();
    for (const b of haystack) {
      const lab = String(b.label || "").trim();
      if (!lab) continue;
      const prev = byLabel.get(lab);
      if (
        !prev ||
        (b.auto !== true && prev.auto === true) ||
        (b.auto === prev.auto && b.offset < prev.offset)
      ) {
        byLabel.set(lab, b);
      }
    }
    return [...byLabel.values()].sort((a, b) => a.offset - b.offset);
  }

  /** Plain-text fallback when no Methods bookmark (server / batch scan). */
  function findMethodsSectionStartInPlain(plain) {
    const hay = String(plain || "");
    if (!hay.length) return null;
    const minPos = Math.min(800, Math.floor(hay.length * 0.06));
    let best = null;

    if (matchSectionHeading) {
      const lines = hay.split("\n");
      let offset = 0;
      for (const line of lines) {
        const raw = line.replace(/\s+/g, " ").trim();
        if (raw.length > 0 && raw.length <= 150) {
          const label = matchSectionHeading(raw);
          if (label === "Methods" && offset >= minPos) {
            if (best == null || offset < best) best = offset;
          }
        }
        offset += line.length + 1;
      }
      if (best != null) return best;
    }

    const linePatterns = [
      /(?:^|\n)\s*(?:\d+(?:\.\d+)*[\.\):\-–—]?\s+)?(?:Materials?\s+(?:and|&)\s+)?Methods?\s*(?=\n|$)/gim,
      /(?:^|\n)\s*(?:\d+(?:\.\d+)*[\.\):\-–—]?\s+)?Experimental\s+(?:Methods|Procedures)\s*(?=\n|$)/gim,
    ];
    for (const re of linePatterns) {
      let m;
      while ((m = re.exec(hay))) {
        const offset = m.index;
        if (
          offset >= minPos &&
          isPlausibleMethodsStart(hay, offset) &&
          (best == null || offset < best)
        ) {
          best = offset;
        }
      }
    }
    return best;
  }

  function methodsScopeFromStart(plain, bookmarks, start, source) {
    const hay = String(plain || "");
    if (!isPlausibleMethodsStart(hay, start)) return null;
    const merged = mergeSectionBookmarksForScan(
      bookmarks,
      detectSectionBookmarksInPlain(hay)
    );
    const sorted = [...merged].sort((a, b) => a.offset - b.offset);
    const methodsIdx = sorted.findIndex(
      (b) => b.offset === start && /^methods$/i.test((b.label || "").trim())
    );
    let end = hay.length;
    if (methodsIdx >= 0) {
      end = methodsSectionEndOffset(hay, sorted, methodsIdx, start);
    } else {
      const refStart = findReferencesSectionStart(hay, merged, null);
      if (refStart != null && refStart > start) end = refStart;
      for (const b of sorted) {
        const lab = String(b.label || "")
          .trim()
          .toLowerCase();
        if (
          METHODS_SECTION_END_LABELS.has(lab) &&
          b.offset > start &&
          b.offset < end
        ) {
          end = b.offset;
          break;
        }
      }
    }
    if (end <= start) return null;
    return { text: hay.slice(start, end), start, end, source };
  }

  /**
   * Scope for library reverse-scan (Methods section when possible).
   * @returns {{ text: string, start: number, end: number, source: string } | null}
   */
  function resolveMethodsScanScope(plain, bookmarks, options = {}) {
    const hay = String(plain || "");
    if (!hay.trim()) return null;
    const methodsOnly = options.methodsOnly !== false;

    const detected = detectSectionBookmarksInPlain(hay);
    const merged = mergeSectionBookmarksForScan(bookmarks, detected);

    let scope = getMethodsSectionScope(hay, merged);
    let source = "bookmark";
    if (!scope) {
      const start = findMethodsSectionStartInPlain(hay);
      if (start != null) {
        scope = methodsScopeFromStart(hay, merged, start, "detected");
        source = "detected";
      }
    }
    if (!scope) {
      if (methodsOnly) return null;
      const refStart = findReferencesSectionStart(hay, merged, null);
      const end = refStart != null && refStart > 0 ? refStart : hay.length;
      return { text: hay.slice(0, end), start: 0, end, source: "full" };
    }
    return { ...scope, source };
  }

  function isReferencesSectionLabel(label) {
    return /^references$/i.test(String(label || "").trim());
  }

  /** @returns {number | null} plain-text offset where References/back-matter begins */
  function findReferencesSectionStart(plain, bookmarks, body) {
    const hay = String(plain || "");
    if (!hay.length) return null;
    const starts = [];

    for (const b of bookmarks || []) {
      if (
        isReferencesSectionLabel(b.label) &&
        typeof b.offset === "number" &&
        b.offset >= 0 &&
        b.offset < hay.length
      ) {
        starts.push(b.offset);
      }
    }

    if (body && typeof LitLensSectionDetect !== "undefined") {
      for (const b of LitLensSectionDetect.detectSectionBookmarks(body)) {
        if (
          b.label === "References" &&
          typeof b.offset === "number" &&
          b.offset >= 0 &&
          b.offset < hay.length
        ) {
          starts.push(b.offset);
        }
      }
    }

    return starts.length ? Math.min(...starts) : null;
  }

  /**
   * Full-article suggest scope with References / bibliography sections removed.
   * @returns {{ text: string, start: number, excludedReferences: boolean }}
   */
  function scopeExcludingReferences(plain, bookmarks, body) {
    const hay = String(plain || "");
    const refStart = findReferencesSectionStart(hay, bookmarks, body);
    if (refStart == null || refStart <= 0) {
      return { text: hay, start: 0, excludedReferences: false };
    }
    return {
      text: hay.slice(0, refStart),
      start: 0,
      excludedReferences: true,
    };
  }

  /**
   * Text window used for method suggest (full article or Methods section).
   * @returns {{ text: string, start: number, excludedReferences?: boolean }}
   */
  function getSuggestTextScope(plain, bookmarks, useFullArticle, body) {
    const hay = String(plain || "");
    if (useFullArticle) return scopeExcludingReferences(hay, bookmarks, body);
    const section = getMethodsSectionScope(hay, bookmarks);
    if (section) {
      return { text: section.text, start: section.start, excludedReferences: false };
    }
    return scopeExcludingReferences(hay, bookmarks, body);
  }

  /**
   * Character offsets of phrase matches within scope text (for scroll-to).
   * @returns {number[]}
   */
  function findMatchOffsetsInText(scopeText, item) {
    const hay = String(scopeText || "");
    if (!hay.trim() || !item) return [];
    const offsets = [];
    const maxIter = 500;

    if (item.matchType === "combination") {
      const parts = sanitizeComboTerms(
        String(item.matchedTerm || "")
          .split(/\s*\+\s*/)
          .map((t) => t.trim())
          .filter(Boolean)
      );
      if (parts.length < 2) return offsets;
      const re0 = buildTermRegExp(parts[0], "gi");
      if (!re0) return offsets;
      let m;
      let n = 0;
      while ((m = re0.exec(hay)) !== null && n++ < COMBO_FIRST_TERM_MAX_SCAN) {
        const start = m.index;
        const window = hay.slice(
          start,
          start + Math.min(hay.length - start, COMBO_WINDOW_CHARS)
        );
        const ok = parts.slice(1).every((p) => termMatches(window, p));
        if (ok) offsets.push(start);
      }
      return offsets;
    }

    const term = String(item.matchedTerm || "").trim();
    if (!term) return offsets;
    return findTermOffsetsInText(hay, term, maxIter);
  }

  /**
   * All direct/indirect trigger hits in scope (for method suggest + evidence).
   * @returns {{ offset: number, matchedTerm: string, matchType: string }[]}
   */
  function findAllProfileMatchOffsetsInText(scopeText, profile, maxIter = 500) {
    const hay = String(scopeText || "");
    if (!hay.trim() || !profile) return [];
    const seen = new Set();
    const out = [];
    for (const matchType of ["direct", "indirect"]) {
      for (const term of profile.triggers?.[matchType] || []) {
        for (const offset of findTermOffsetsInText(hay, term, maxIter)) {
          if (seen.has(offset)) continue;
          seen.add(offset);
          out.push({ offset, matchedTerm: term, matchType });
        }
      }
    }
    return out.sort((a, b) => a.offset - b.offset);
  }

  function isRealSentenceBoundary(hay, i) {
    const ch = hay[i];
    if (ch === "\n") return true;
    if (ch === "!" || ch === "?") return true;
    if (ch !== ".") return false;
    if (i > 0 && hay[i - 1] === "." && i + 1 < hay.length && hay[i + 1] === ".") {
      return false;
    }
    if (i > 0 && /\d/.test(hay[i - 1]) && i + 1 < hay.length && /\d/.test(hay[i + 1])) {
      return false;
    }
    let j = i - 1;
    while (j >= 0 && /[^A-Za-z]/.test(hay[j])) j--;
    let word = "";
    while (j >= 0 && /[A-Za-z]/.test(hay[j])) {
      word = hay[j] + word;
      j--;
    }
    if (!word) return true;
    const w = word.toLowerCase();
    if (word.length <= 2) return false;
    const abbrevs = new Set([
      "ext", "fig", "data", "vs", "eg", "ie", "etal", "dr", "mr", "ms", "st",
      "no", "eq", "ref", "suppl", "dept", "inc", "ltd", "vol", "pp", "ed", "eds",
      "approx", "max", "min", "std", "dev", "avg", "eeg", "lfp", "resp",
    ]);
    if (abbrevs.has(w)) return false;
    if (word.length <= 4 && word === word.toUpperCase()) return false;
    let k = i + 1;
    while (k < hay.length && /\s/.test(hay[k])) k++;
    if (k < hay.length && /\d/.test(hay[k])) return false;
    return true;
  }

  function expandToSentenceBounds(plain, offset, length) {
    const hay = String(plain || "");
    if (!hay.length) return { offset: 0, length: 0 };
    let start = Math.max(0, Math.min(offset, hay.length - 1));
    let end = Math.min(hay.length, start + Math.max(1, length));

    const sentenceStart = (pos) => {
      for (let i = pos - 1; i >= 0; i--) {
        if (hay[i] === "\n" && i < pos - 1) {
          let j = i + 1;
          while (j < hay.length && /\s/.test(hay[j])) j++;
          return j;
        }
        if (/[.!?]/.test(hay[i]) && isRealSentenceBoundary(hay, i)) {
          let j = i + 1;
          while (j < hay.length && /\s/.test(hay[j])) j++;
          return j;
        }
      }
      return 0;
    };

    const sentenceEnd = (pos) => {
      for (let i = pos; i < hay.length; i++) {
        if (hay[i] === "\n") return i;
        if (/[.!?]/.test(hay[i]) && isRealSentenceBoundary(hay, i)) {
          let j = i + 1;
          while (j < hay.length && /["')\]]/.test(hay[j])) j++;
          return j;
        }
      }
      return hay.length;
    };

    start = sentenceStart(start);
    end = sentenceEnd(end);
    if (end <= start) end = Math.min(hay.length, start + Math.max(length, 48));
    return { offset: start, length: end - start };
  }

  function hitKeywordLengthInPlain(hay, hit) {
    const local = hay.slice(hit.offset);
    return (
      firstTermMatchLength(local, hit.matchedTerm) ||
      String(hit.matchedTerm || "").length ||
      1
    );
  }

  /**
   * One passage per sentence (period → period; decimals like 6.7 are not breaks).
   * @param {string} plain
   * @param {{ offset: number, matchedTerm?: string, matchType?: string }[]} hits
   */
  function groupHitsIntoSentencePassages(plain, hits) {
    const hay = String(plain || "");
    const groups = new Map();
    for (const hit of hits) {
      if (hit?.offset == null || hit.offset < 0) continue;
      const kwLen = hitKeywordLengthInPlain(hay, hit);
      const bounds = expandToSentenceBounds(hay, hit.offset, kwLen);
      const key = `${bounds.offset}:${bounds.offset + bounds.length}`;
      if (!groups.has(key)) {
        groups.set(key, {
          offset: bounds.offset,
          length: bounds.length,
          hits: [],
        });
      }
      const bucket = groups.get(key).hits;
      const dup = bucket.some(
        (h) =>
          h.offset === hit.offset &&
          String(h.matchedTerm || "").toLowerCase() ===
            String(hit.matchedTerm || "").toLowerCase()
      );
      if (!dup) bucket.push(hit);
    }
    let passages = [...groups.values()].sort((a, b) => a.offset - b.offset);
    passages = mergePassagesWithNearDuplicateSpans(passages, hay);
    passages = mergeAdjacentSentencePassages(passages, hay);
    return passages;
  }

  function appendHitToPassage(passage, hit) {
    const dup = passage.hits.some(
      (x) =>
        x.offset === hit.offset &&
        String(x.matchedTerm || "").toLowerCase() ===
          String(hit.matchedTerm || "").toLowerCase()
    );
    if (!dup) passage.hits.push(hit);
  }

  function mergePassageInto(target, source) {
    const end = Math.max(
      target.offset + target.length,
      source.offset + source.length
    );
    target.offset = Math.min(target.offset, source.offset);
    target.length = end - target.offset;
    for (const h of source.hits) appendHitToPassage(target, h);
  }

  function contextualWindowForPassage(passage, hay, pad = 130) {
    const start = Math.max(0, passage.offset - pad);
    const end = Math.min(
      hay.length,
      passage.offset + Math.max(1, passage.length) + pad
    );
    return { start, end };
  }

  function contextualWindowsOverlap(a, b, hay, pad = 130) {
    const wa = contextualWindowForPassage(a, hay, pad);
    const wb = contextualWindowForPassage(b, hay, pad);
    return wa.start < wb.end && wb.start < wa.end;
  }

  function passageGapIsWhitespaceOnly(hay, end, start) {
    if (start < end) return false;
    const gap = hay.slice(end, start);
    return !gap.length || /^\s*$/.test(gap);
  }

  /** Same sentence sometimes gets a span off by a few chars — merge, keep one row. */
  function mergePassagesWithNearDuplicateSpans(passages, hay = "") {
    const sorted = [...passages].sort((a, b) => a.offset - b.offset);
    const out = [];
    for (const p of sorted) {
      const last = out[out.length - 1];
      if (!last) {
        out.push({ ...p, hits: [...p.hits] });
        continue;
      }
      const overlap =
        Math.min(last.offset + last.length, p.offset + p.length) -
        Math.max(last.offset, p.offset);
      const minLen = Math.min(last.length, p.length);
      if (minLen > 0 && overlap >= minLen * 0.85) {
        mergePassageInto(last, p);
        continue;
      }
      out.push({ ...p, hits: [...p.hits] });
    }
    return out;
  }

  /**
   * Merge consecutive sentences when their context windows overlap
   * (avoids duplicate-looking excerpts for back-to-back hits).
   */
  function mergeAdjacentSentencePassages(passages, hay, options = {}) {
    const text = String(hay || "");
    const pad = options.contextPad ?? 130;
    const maxGap = options.maxGapBetween ?? 12;
    const sorted = [...passages].sort((a, b) => a.offset - b.offset);
    const out = [];
    for (const p of sorted) {
      const last = out[out.length - 1];
      if (!last) {
        out.push({ ...p, hits: [...p.hits] });
        continue;
      }
      const lastEnd = last.offset + last.length;
      const gap = p.offset - lastEnd;
      const adjacent =
        gap >= 0 &&
        gap <= maxGap &&
        (!text.length || passageGapIsWhitespaceOnly(text, lastEnd, p.offset));
      if (adjacent && contextualWindowsOverlap(last, p, text, pad)) {
        mergePassageInto(last, p);
        continue;
      }
      out.push({ ...p, hits: [...p.hits] });
    }
    return out;
  }

  /**
   * Group trigger hits that fall in the same sentence (period → period).
   * @returns {{ offset: number, length: number, hits: { offset: number, matchedTerm: string, matchType: string }[] }[]}
   */
  function groupProfileHitsIntoPassages(plain, profile, maxIter = 200) {
    const hay = String(plain || "");
    const hits = findAllProfileMatchOffsetsInText(hay, profile, maxIter);
    return groupHitsIntoSentencePassages(hay, hits);
  }

  /** Full sentence text for display (Methods suggest + library scan). */
  function sentenceExcerptFromPlain(plain, offset, length, maxLen = 420) {
    const hay = String(plain || "");
    if (!hay.length) return "";
    let excerpt = hay
      .slice(offset, offset + Math.max(1, length))
      .replace(/\s+/g, " ")
      .trim();
    if (excerpt.length > maxLen) {
      excerpt = `${excerpt.slice(0, maxLen - 1)}…`;
    }
    return excerpt;
  }

  /** Context excerpt with padding (non-sentence UI). */
  function excerptFromPlainText(plain, offset, length, maxLen = 220) {
    const hay = String(plain || "");
    if (!hay.length) return "";
    const pad = Math.max(40, Math.floor((maxLen - Math.max(1, length)) / 2));
    const start = Math.max(0, offset - pad);
    const end = Math.min(hay.length, offset + Math.max(1, length) + pad);
    let excerpt = hay.slice(start, end).replace(/\s+/g, " ").trim();
    if (excerpt.length > maxLen) {
      excerpt = `${excerpt.slice(0, maxLen - 1)}…`;
    }
    return excerpt;
  }

  function matchLengthInText(scopeText, item) {
    if (item.matchType === "combination") {
      const parts = sanitizeComboTerms(
        String(item.matchedTerm || "")
          .split(/\s*\+\s*/)
          .map((t) => t.trim())
          .filter(Boolean)
      );
      if (!parts.length) return 0;
      return firstTermMatchLength(scopeText, parts[0]);
    }
    return firstTermMatchLength(scopeText, item.matchedTerm);
  }

  function extractPlainText(root) {
    if (!root) return "";
    if (
      typeof LitLensBookmarks !== "undefined" &&
      LitLensBookmarks.extractPlainText
    ) {
      return LitLensBookmarks.extractPlainText(root);
    }
    if (
      typeof LitLensHighlight !== "undefined" &&
      LitLensHighlight.extractReadableText
    ) {
      return LitLensHighlight.extractReadableText(root);
    }
    return (root.innerText || root.textContent || "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /** phrase (lowercase) → { pattern, methods: Set<label> } */
  function buildAssociationTermIndex(vocab) {
    const index = new Map();
    const addPhrase = (phrase, methodLabel) => {
      const p = String(phrase || "").trim();
      if (!p || p.length < 2) return;
      const key = p.toLowerCase();
      if (!index.has(key)) {
        index.set(key, { pattern: p, methods: new Set() });
      }
      const entry = index.get(key);
      entry.methods.add(methodLabel);
      if (p.length > entry.pattern.length) entry.pattern = p;
    };

    for (const profile of getCatalog(vocab)) {
      const label = profile.label;
      for (const t of profile.triggers.direct || []) addPhrase(t, label);
      for (const t of profile.triggers.indirect || []) addPhrase(t, label);
    }
    return index;
  }

  /**
   * Gray in-article highlights: phrases linked to methods not yet in Info.
   * Shared phrase → gray until every linked method is marked.
   */
  function modalityColumnKey(modalities) {
    const mods = mapGridModalities(modalities).sort(
      (a, b) => MAP_GRID_MODALITIES.indexOf(a) - MAP_GRID_MODALITIES.indexOf(b)
    );
    return mods.join("+");
  }

  function modalityColumnLabel(modalities) {
    const mods = mapGridModalities(modalities).sort(
      (a, b) => MAP_GRID_MODALITIES.indexOf(a) - MAP_GRID_MODALITIES.indexOf(b)
    );
    if (!mods.length) return "—";
    return mods.join(" + ");
  }

  /** X axis: SPIKE / BEH / LFP subsets only (no FRAMEWORK columns). */
  function getModalityColumns() {
    const cols = [];
    for (let mask = 1; mask < 1 << MAP_GRID_MODALITIES.length; mask++) {
      const mods = MAP_GRID_MODALITIES.filter((_, i) => mask & (1 << i));
      cols.push({
        key: modalityColumnKey(mods),
        label: modalityColumnLabel(mods),
        modalities: mods,
      });
    }
    cols.push({ key: "", label: "—", modalities: [] });
    return cols;
  }

  /** Y axis: category tags plus empty. */
  function getCategoryRows() {
    return [
      ...CATEGORIES.map((c) => ({ key: c, label: c })),
      { key: "", label: "—" },
    ];
  }

  function buildMethodsMapGrid(vocab) {
    const xCols = getModalityColumns();
    const yRows = getCategoryRows();
    const cells = new Map();
    for (const row of yRows) {
      for (const col of xCols) {
        cells.set(`${row.key}|${col.key}`, []);
      }
    }
    for (const profile of getCatalog(vocab)) {
      const gridMods = mapGridModalities(profile.modalities);
      let colKey;
      let rowKey;
      if (gridMods.length) {
        colKey = modalityColumnKey(gridMods);
        rowKey = profile.category || "";
      } else if (hasColorOnlyModality(profile.modalities)) {
        colKey = "";
        rowKey = "";
      } else {
        continue;
      }
      const cellKey = `${rowKey}|${colKey}`;
      if (!cells.has(cellKey)) cells.set(cellKey, []);
      cells.get(cellKey).push(profile.label);
    }
    for (const list of cells.values()) {
      list.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    }
    return { xCols, yRows, cells };
  }

  function getAssociationHighlightPatterns(vocab, selectedMethods) {
    const marked = new Set(
      (selectedMethods || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean)
    );
    const index = buildAssociationTermIndex(vocab);
    const out = [];
    for (const entry of index.values()) {
      const methods = [...entry.methods];
      const pending = methods.filter((m) => !marked.has(m.toLowerCase()));
      if (!pending.length) continue;
      out.push({
        pattern: entry.pattern,
        methods,
        pendingMethods: pending,
      });
    }
    out.sort((a, b) => b.pattern.length - a.pattern.length);
    return out;
  }

  return {
    MODALITIES,
    MAP_GRID_MODALITIES,
    MODALITIES_COLOR_ONLY,
    MODALITIES_WITHOUT_CATEGORY,
    mapGridModalities,
    hasFrameworkModality,
    hasDerivedModality,
    hasColorOnlyModality,
    CATEGORIES,
    parseCombinationTerms,
    sanitizeComboTerms,
    MAX_COMBO_TERMS,
    usesMethodCategory,
    DOC_FIELDS,
    emptyDoc,
    normalizeDoc,
    normalizeVariants,
    normalizeFirstIn,
    normalizeFirstInEntry,
    parseArticleYear,
    articleUsesMethod,
    countMethodUsageByYear,
    countMethodArticles,
    methodEvidenceEntries,
    articleSkipsMethodLibraryScan,
    normalizeMethodAbsentLabels,
    isMethodAbsentFromArticle,
    formatMethodLibraryShare,
    PROFILE_KEYS,
    ensureCatalog,
    ensureProfiles,
    getCatalog,
    getCatalogLabels,
    getProfiles: getCatalog,
    getOptionLabels,
    profileByLabel,
    formatProfileSummary,
    suggestFromCatalog,
    suggestFromText,
    sliceMethodsSection,
    getMethodsSectionScope,
    detectSectionBookmarksInPlain,
    mergeSectionBookmarksForScan,
    findMethodsSectionStartInPlain,
    resolveMethodsScanScope,
    isPlausibleMethodsStart,
    findReferencesSectionStart,
    scopeExcludingReferences,
    getSuggestTextScope,
    findMatchOffsetsInText,
    findAllProfileMatchOffsetsInText,
    groupProfileHitsIntoPassages,
    groupHitsIntoSentencePassages,
    mergePassagesWithNearDuplicateSpans,
    mergeAdjacentSentencePassages,
    expandToSentenceBounds,
    sentenceExcerptFromPlain,
    excerptFromPlainText,
    matchLengthInText,
    extractPlainText,
    normalizeProfile,
    normalizeTriggers,
    collectHighlightTerms,
    triggerConflictsWithHighlights,
    termMatches,
    buildTermRegExp,
    slugify,
    buildAssociationTermIndex,
    getAssociationHighlightPatterns,
    modalityColumnKey,
    modalityColumnLabel,
    getModalityColumns,
    getCategoryRows,
    buildMethodsMapGrid,
  };
});
