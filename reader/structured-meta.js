/** Multi-select study metadata (Info tab) — Notion-style comboboxes. */
(function () {
  const API = `${location.origin}/api`;

  const FIELDS = [
    { key: "species", label: "Species", vocabKey: "species" },
    { key: "brainRegions", label: "Brain region", vocabKey: "brainRegions", coords: true },
    { key: "behavioralParadigms", label: "Behavioral paradigm", vocabKey: "behavioralParadigms" },
    { key: "recordingMethods", label: "Recording methods", vocabKey: "recordingMethods" },
    { key: "cellTypes", label: "Cell type", vocabKey: "cellTypes" },
    { key: "software", label: "Software", vocabKey: "software" },
    { key: "methods", label: "Methods", vocabKey: "methods" },
  ];

  let vocab = {};
  let structured = emptyStructured();
  let openDropdown = null;
  let pendingSuggestions = [];
  let suggestUseFullArticle = false;
  let dismissedSuggestions = [];
  /** Per-occurrence dismiss: "methods:label@offset" */
  let dismissedSuggestionHits = [];
  let suggestScope = { text: "", start: 0, scopeLabel: "" };
  /** Methods suggest + passage offsets — same scope as term suggest (Methods section unless Full article). */
  let methodsSuggestScope = { text: "", start: 0, scopeLabel: "" };
  let suggestNav = { key: "", index: 0 };
  /** @type {Record<string, { id: string, excerpt: string, offset: number, length: number, matchedTerm?: string, matchType?: string }[]>} */
  let methodEvidence = {};
  /** @type {number[]} @deprecated legacy offset ids — migrated to keys on load */
  let readParagraphOffsets = [];
  /** @type {string[]} stable paragraph fingerprints */
  let readParagraphKeys = [];
  /** Cached { start, end } ranges for O(1)-ish suggest filtering */
  let readParagraphRanges = [];
  /** Saved word forms found in text: vocabKey → canonical label → matched phrases */
  let foundTermAliases = {};
  /** @type {Map<string, () => void>} field.key → renderChips */
  const chipRenderers = new Map();
  const VOCAB_TO_FIELD = Object.fromEntries(
    FIELDS.map((f) => [f.vocabKey, f.key])
  );
  let suggestUiRaf = 0;
  /** @type {Set<string> | null} null = refresh all suggest panels */
  let suggestUiVocabKeys = null;
  let suggestScanTimer = 0;
  let suggestScanGen = 0;

  function suggestionKey(vocabKey, label) {
    return `${vocabKey}:${String(label || "").trim().toLowerCase()}`;
  }

  function isSuggestionDismissed(item) {
    return dismissedSuggestions.includes(suggestionKey(item.vocabKey, item.label));
  }

  function hitDismissKey(item, offset) {
    return `${suggestionKey(item.vocabKey, item.label)}@${offset}`;
  }

  function isHitDismissed(item, offset) {
    return dismissedSuggestionHits.includes(hitDismissKey(item, offset));
  }

  function evidenceHasOffset(methodLabel, offset) {
    const entries = methodEvidence[methodLabel];
    return Array.isArray(entries) && entries.some((e) => e.offset === offset);
  }

  function rebuildReadParagraphRanges(blocks) {
    readParagraphRanges = [];
    const PB = window.LitLensParagraphBlocks;
    const list =
      blocks ||
      (() => {
        const body = window.litlensGetArticleContext?.()?.body;
        if (!body || !PB?.getMethodsSectionBlocks) return [];
        const ctx =
          typeof window.litlensGetArticleContext === "function"
            ? window.litlensGetArticleContext()
            : null;
        return PB.getMethodsSectionBlocks(body, ctx?.bookmarks || []);
      })();

    if (!list.length) {
      readParagraphRanges = [];
      if (typeof window.litlensSetMethodsParagraphTotal === "function") {
        window.litlensSetMethodsParagraphTotal(0);
      }
      return;
    }

    if (PB?.syncReadStateForMethodsBlocks) {
      const synced = PB.syncReadStateForMethodsBlocks(list, readParagraphKeys);
      const prev = readParagraphKeys.join("\0");
      const next = synced.keys.join("\0");
      readParagraphKeys = synced.keys;
      if (prev !== next) {
        if (typeof window.litlensApplyReadParagraphKeysLocal === "function") {
          window.litlensApplyReadParagraphKeysLocal(readParagraphKeys);
        }
        if (typeof window.litlensSaveReadParagraphs === "function") {
          window.litlensSaveReadParagraphs();
        }
      }
      if (
        typeof window.litlensSetMethodsParagraphTotal === "function" &&
        synced.total >= 0
      ) {
        window.litlensSetMethodsParagraphTotal(synced.total);
      }
    } else if (PB?.normalizeReadKeysForBlocks) {
      const normalized = PB.normalizeReadKeysForBlocks(list, readParagraphKeys);
      const prev = readParagraphKeys.join("\0");
      const next = normalized.join("\0");
      if (prev !== next) {
        readParagraphKeys = normalized;
        if (typeof window.litlensSaveReadParagraphs === "function") {
          window.litlensSaveReadParagraphs();
        }
      }
    }

    const keySet = new Set(readParagraphKeys);
    for (const block of list) {
      const matches = PB?.blockMatchesReadKey
        ? PB.blockMatchesReadKey(block, keySet)
        : keySet.has(PB?.blockKey ? PB.blockKey(block) : block.key);
      if (matches) {
        readParagraphRanges.push({ start: block.start, end: block.end });
      }
    }

    if (!readParagraphOffsets.length) {
      readParagraphKeys.sort((a, b) => a.localeCompare(b));
      return;
    }

    let migrated = false;
    for (const off of readParagraphOffsets) {
      const block = list.find((b) => b.start === off);
      const key = block && PB?.blockKey ? PB.blockKey(block) : block?.key;
      if (key && !keySet.has(key)) {
        readParagraphKeys.push(key);
        keySet.add(key);
        migrated = true;
      }
      if (
        block &&
        !readParagraphRanges.some((r) => r.start === block.start)
      ) {
        readParagraphRanges.push({ start: block.start, end: block.end });
      }
    }
    readParagraphOffsets = [];
    readParagraphKeys.sort((a, b) => a.localeCompare(b));
    if (migrated && typeof window.litlensSaveReadParagraphs === "function") {
      window.litlensSaveReadParagraphs();
    }
  }

  function isOffsetInReadParagraph(offset) {
    if (offset == null || !readParagraphRanges.length) return false;
    for (const range of readParagraphRanges) {
      if (offset >= range.start && offset < range.end) return true;
    }
    return false;
  }

  function getActiveSuggestionOffsets(item) {
    // Term fields: hide whole suggestion once tag is added. Methods: per-passage via evidence.
    if (
      item.vocabKey !== "methods" &&
      isStructuredValueSelected(item.vocabKey, item.label)
    ) {
      return [];
    }
    return getSuggestionMatchOffsets(item).filter((off) => {
      if (isHitDismissed(item, off)) return false;
      if (isOffsetInReadParagraph(off)) return false;
      if (item.vocabKey === "methods" && evidenceHasOffset(item.label, off)) {
        return false;
      }
      return true;
    });
  }

  function getSentenceBoundsFromPlain(plain, globalOffset, keywordLength = 1) {
    if (window.LitLensBookmarks?.expandToSentenceBounds) {
      return LitLensBookmarks.expandToSentenceBounds(
        plain,
        globalOffset,
        Math.max(1, keywordLength || 1)
      );
    }
    return { offset: globalOffset, length: Math.max(1, keywordLength || 1) };
  }

  function getSentenceBounds(globalOffset, keywordLength = 1) {
    return getSentenceBoundsFromPlain(
      getArticlePlainText(),
      globalOffset,
      keywordLength
    );
  }

  function evidenceOverlapsRange(methodLabel, start, end) {
    const entries = methodEvidence[methodLabel];
    if (!Array.isArray(entries)) return false;
    return entries.some((e) => {
      if (e.offset == null) return false;
      const eEnd = e.offset + Math.max(1, e.length || 1);
      return e.offset < end && eEnd > start;
    });
  }

  function hitKeywordLength(item, hit) {
    const MP = window.LitLensMethodProfiles;
    const scope = getScopeForItem(item);
    const localStart = hit.globalOffset - scope.start;
    return (
      MP?.matchLengthInText(
        scope.text.slice(Math.max(0, localStart)),
        { matchedTerm: hit.matchedTerm, matchType: hit.matchType }
      ) || 1
    );
  }

  function sentenceSpanForHit(item, hit, plain) {
    return getSentenceBoundsFromPlain(
      plain ?? getArticlePlainText(),
      hit.globalOffset,
      hitKeywordLength(item, hit)
    );
  }

  /** Merge hits that share the same sentence span (period → period), not a wide min–max range. */
  function groupMethodHitsIntoPassages(item, hits) {
    const plain = getArticlePlainText();
    const MP = window.LitLensMethodProfiles;
    if (MP?.groupHitsIntoSentencePassages) {
      const normalized = hits.map((hit) => ({
        offset: hit.globalOffset,
        matchedTerm: hit.matchedTerm,
        matchType: hit.matchType,
      }));
      return MP.groupHitsIntoSentencePassages(plain, normalized).map((p) => ({
        offset: p.offset,
        length: p.length,
        hits: p.hits.map((h) => ({
          globalOffset: h.offset,
          matchedTerm: h.matchedTerm,
          matchType: h.matchType,
        })),
      }));
    }
    const groups = new Map();
    for (const hit of hits) {
      const bounds = sentenceSpanForHit(item, hit, plain);
      const key = `${bounds.offset}:${bounds.offset + bounds.length}`;
      if (!groups.has(key)) {
        groups.set(key, {
          offset: bounds.offset,
          length: bounds.length,
          hits: [],
        });
      }
      groups.get(key).hits.push(hit);
    }
    return [...groups.values()].sort((a, b) => a.offset - b.offset);
  }

  /** Methods: one row per sentence even when several triggers match inside it. */
  function getActiveSuggestionPassages(item) {
    if (item.vocabKey !== "methods") {
      return getActiveSuggestionOffsets(item).map((globalOffset) => {
        const hit = suggestionHitAtOffset(item, globalOffset);
        const scope = getScopeForItem(item);
        const localStart = globalOffset - scope.start;
        const len =
          window.LitLensMethodProfiles?.matchLengthInText(
            scope.text.slice(Math.max(0, localStart)),
            hit || item
          ) || 1;
        return {
          offset: globalOffset,
          length: len,
          hits: hit ? [hit] : [],
        };
      });
    }
    const activeHits = getSuggestionMatchHits(item).filter((hit) => {
      if (isHitDismissed(item, hit.globalOffset)) return false;
      if (isOffsetInReadParagraph(hit.globalOffset)) return false;
      return true;
    });
    return groupMethodHitsIntoPassages(item, activeHits).filter(
      (passage) =>
        !evidenceOverlapsRange(
          item.label,
          passage.offset,
          passage.offset + passage.length
        )
    );
  }

  function buildSentenceEvidenceCandidate(item, passage) {
    const plain = getArticlePlainText();
    const MP = window.LitLensMethodProfiles;
    const terms = [
      ...new Set(passage.hits.map((h) => h.matchedTerm).filter(Boolean)),
    ];
    const matchTypes = [
      ...new Set(passage.hits.map((h) => h.matchType).filter(Boolean)),
    ];
    let excerpt = "";
    if (MP?.sentenceExcerptFromPlain) {
      excerpt = MP.sentenceExcerptFromPlain(
        plain,
        passage.offset,
        passage.length,
        420
      );
    } else {
      excerpt = excerptFromPlain(plain, passage.offset, passage.length);
    }
    return {
      id: `ev-${passage.offset}`,
      excerpt,
      offset: passage.offset,
      length: passage.length,
      matchedTerm: terms.join(", "),
      matchType: matchTypes.length === 1 ? matchTypes[0] : "direct",
      sentenceBounds: true,
    };
  }

  function dismissSuggestionPassage(item, passage) {
    for (const hit of passage.hits) {
      const key = hitDismissKey(item, hit.globalOffset);
      if (!dismissedSuggestionHits.includes(key)) {
        dismissedSuggestionHits.push(key);
      }
    }
    scheduleSave();
    refreshPendingSuggestionsUi({ vocabKeys: [item.vocabKey] });
  }

  function acceptSuggestionPassage(item, passage) {
    if (item.vocabKey !== "methods") {
      const off = passage.hits[0]?.globalOffset ?? passage.offset;
      acceptSuggestionHit(item, off);
      return;
    }
    const label = item.label;
    addStructuredTag("methods", label);
    for (const hit of passage.hits) {
      recordFoundAlias("methods", label, hit.matchedTerm);
    }
    const candidate = buildSentenceEvidenceCandidate(item, passage);
    if (!methodEvidence[label]) methodEvidence[label] = [];
    const exists = methodEvidence[label].some(
      (e) =>
        e.offset === candidate.offset &&
        Math.max(1, e.length || 1) === candidate.length
    );
    if (!exists) {
      methodEvidence[label].push({ ...candidate });
    }
    cancelMethodMetaRefresh();
    scheduleSave();
    afterStructuredSuggestAction(item);
  }

  function isSuggestionVisible(item) {
    if (isSuggestionDismissed(item)) return false;
    if (item.vocabKey === "methods") {
      return getActiveSuggestionPassages(item).length > 0;
    }
    return getActiveSuggestionOffsets(item).length > 0;
  }

  function dismissSuggestionHit(item, offset) {
    const key = hitDismissKey(item, offset);
    if (!dismissedSuggestionHits.includes(key)) {
      dismissedSuggestionHits.push(key);
      scheduleSave();
    }
    refreshPendingSuggestionsUi({ vocabKeys: [item.vocabKey] });
  }

  function removePendingSuggestion(item) {
    const key = suggestionKey(item.vocabKey, item.label);
    if (!dismissedSuggestions.includes(key)) {
      dismissedSuggestions.push(key);
    }
    pendingSuggestions = pendingSuggestions.filter(
      (s) => suggestionKey(s.vocabKey, s.label) !== key
    );
    for (const off of getSuggestionMatchOffsets(item)) {
      const hk = hitDismissKey(item, off);
      if (!dismissedSuggestionHits.includes(hk)) {
        dismissedSuggestionHits.push(hk);
      }
    }
  }

  function refreshPendingSuggestionsUi({ vocabKeys } = {}) {
    if (vocabKeys?.length) {
      if (!suggestUiVocabKeys) suggestUiVocabKeys = new Set();
      for (const k of vocabKeys) suggestUiVocabKeys.add(k);
    } else {
      suggestUiVocabKeys = null;
    }
    if (suggestUiRaf) return;
    suggestUiRaf = requestAnimationFrame(() => {
      suggestUiRaf = 0;
      const keys = suggestUiVocabKeys;
      suggestUiVocabKeys = null;
      refreshPendingSuggestionsUiNow(keys ? [...keys] : null);
    });
  }

  function refreshPendingSuggestionsUiNow(vocabKeys) {
    const ctx =
      typeof window.litlensGetArticleContext === "function"
        ? window.litlensGetArticleContext()
        : null;
    if (ctx?.body && pendingSuggestions.length) {
      updateSuggestScope(ctx);
    }

    const status = $("meta-suggest-status");
    const visible = pendingSuggestions.filter((item) => isSuggestionVisible(item));
    if (status) {
      if (!visible.length) {
        const priorWork =
          ctx?.article &&
          window.LitLensColumnLinks?.articleHasSavedStudyMetadata?.(ctx.article);
        const methodsUnset =
          ctx?.article &&
          window.LitLensColumnLinks?.articleMethodsAreUnset?.(ctx.article) !== false;
        status.textContent = suggestScope.scopeLabel
          ? `No pending suggestions in ${suggestScope.scopeLabel}.`
          : priorWork
            ? methodsUnset
              ? "Scan species & tasks with the button. Enable Methods when ready."
              : "Metadata saved — use Suggest from text to scan again."
            : "Open an article, then scan.";
      } else {
        const parts = [];
        for (const field of FIELDS) {
          const n = visible.filter((i) => i.vocabKey === field.vocabKey).length;
          if (n) parts.push(`${n} ${field.label}`);
        }
        status.textContent = `Found: ${parts.join(" · ")}. See each field below.`;
      }
    }
    const dismissAllBtn = $("meta-suggest-dismiss-all");
    if (dismissAllBtn) {
      dismissAllBtn.style.display = visible.length ? "inline-flex" : "none";
    }
    const keysToRender = vocabKeys?.length
      ? vocabKeys
      : FIELDS.map((f) => f.vocabKey);
    for (const vk of keysToRender) {
      renderFieldSuggestChips(vk);
    }
  }

  function refreshStructuredField(fieldKey) {
    chipRenderers.get(fieldKey)?.();
  }

  function refreshStructuredFieldByVocab(vocabKey) {
    const fieldKey = VOCAB_TO_FIELD[vocabKey];
    if (fieldKey) refreshStructuredField(fieldKey);
  }

  function afterStructuredSuggestAction(item, { jump = false, jumpIndex = 0 } = {}) {
    const vk = item?.vocabKey;
    if (vk) {
      refreshStructuredFieldByVocab(vk);
      refreshPendingSuggestionsUi({ vocabKeys: [vk] });
    } else {
      refreshPendingSuggestionsUi();
    }
    if (jump && item) {
      requestAnimationFrame(() =>
        jumpToSuggestionMatch(item, jumpIndex, { refreshSuggestUi: false })
      );
    }
  }

  function createFieldSuggestBlock(vocabKey) {
    const block = document.createElement("div");
    block.className = "meta-field-suggest";
    block.dataset.vocabKey = vocabKey;
    block.hidden = true;
    const chips = document.createElement("div");
    chips.className = "meta-field-suggest-chips";
    block.appendChild(chips);
    return block;
  }

  function getVocabOptions(vocabKey) {
    const MPapi = window.LitLensMethodProfiles;
    const VTPapi = window.LitLensVocabTermProfiles;
    if (vocabKey === "methods" && MPapi) {
      return MPapi.getCatalogLabels(vocab);
    }
    if (VTPapi?.TERM_VOCAB_KEYS?.includes(vocabKey)) {
      VTPapi.ensureTermCatalog(vocab, vocabKey);
      return VTPapi.getCatalogLabels(vocab, vocabKey);
    }
    return vocab[vocabKey] || [];
  }

  function vocabHasOption(vocabKey, value) {
    const q = value.trim().toLowerCase();
    return getVocabOptions(vocabKey).some((o) => o.toLowerCase() === q);
  }

  function emptyStructured() {
    return {
      species: [],
      brainRegions: [],
      behavioralParadigms: [],
      recordingMethods: [],
      cellTypes: [],
      software: [],
      methods: [],
    };
  }

  function $(id) {
    return document.getElementById(id);
  }

  function normalizeBrainRegion(entry) {
    if (typeof entry === "string") {
      return { label: entry, ap: "", ml: "", dv: "" };
    }
    return {
      label: entry?.label || "",
      ap: entry?.ap || "",
      ml: entry?.ml || "",
      dv: entry?.dv || "",
    };
  }

  function regionChipLabel(r) {
    const parts = [];
    if (r.ap) parts.push(`AP=${r.ap}`);
    if (r.ml) parts.push(`ML=${r.ml}`);
    if (r.dv) parts.push(`DV=${r.dv}`);
    if (parts.length) return `${r.label || "?"} (${parts.join(", ")})`;
    return r.label || "?";
  }

  async function loadVocab() {
    const res = await fetch(`${API}/vocab`);
    if (!res.ok) throw new Error("Failed to load vocab");
    vocab = await res.json();
    if (window.LitLensVocabTermProfiles) {
      LitLensVocabTermProfiles.ensureAllTermCatalogs(vocab);
    }
    if (window.LitLensMethodProfiles) {
      LitLensMethodProfiles.ensureCatalog(vocab);
    }
    return vocab;
  }

  async function reloadVocab() {
    await loadVocab();
    applyStructuredFieldsUi();
    notifyMethodsChanged();
  }

  function suggestIncludeMethods() {
    const cb = $("meta-suggest-methods");
    return cb ? cb.checked : true;
  }

  function syncSuggestMethodsCheckbox(article) {
    const cb = $("meta-suggest-methods");
    if (!cb) return;
    const unset =
      article &&
      window.LitLensColumnLinks?.articleMethodsAreUnset?.(article) !== false;
    cb.checked = !unset;
  }

  async function saveVocab() {
    await fetch(`${API}/vocab`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(vocab),
    });
  }

  async function addVocabOption(vocabKey, value) {
    const v = value.trim();
    if (!v) return;
    const MPapi = window.LitLensMethodProfiles;
    if (vocabKey === "methods" && MPapi) {
      MPapi.ensureCatalog(vocab);
      if (
        vocab.methodCatalog.some(
          (p) => p.label.toLowerCase() === v.toLowerCase()
        )
      ) {
        return;
      }
      vocab.methodCatalog.push(MPapi.normalizeProfile({ label: v }));
      vocab.methodCatalog.sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
      );
      vocab.methods = vocab.methodCatalog.map((p) => p.label);
      await saveVocab();
      return;
    }
    const VTPapi = window.LitLensVocabTermProfiles;
    if (VTPapi?.TERM_VOCAB_KEYS?.includes(vocabKey)) {
      VTPapi.ensureTermCatalog(vocab, vocabKey);
      const profiles = vocab.profiles[vocabKey];
      if (profiles.some((p) => p.label.toLowerCase() === v.toLowerCase())) return;
      profiles.push(VTPapi.normalizeTermProfile({ label: v }));
      VTPapi.ensureTermCatalog(vocab, vocabKey);
      await saveVocab();
      return;
    }
    if (!vocab[vocabKey]) vocab[vocabKey] = [];
    if (vocab[vocabKey].includes(v)) return;
    vocab[vocabKey] = [...vocab[vocabKey], v].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
    await saveVocab();
  }

  function scheduleSave() {
    if (typeof window.litlensScheduleSaveMetadata === "function") {
      window.litlensScheduleSaveMetadata({ structured: true });
    }
  }

  function scheduleScalarSave() {
    if (typeof window.litlensScheduleSaveMetadata === "function") {
      window.litlensScheduleSaveMetadata({ structured: false });
    }
  }

  let methodMetaRefreshTimer = 0;
  let pendingMethodMetaKind = "both";

  function cancelMethodMetaRefresh() {
    clearTimeout(methodMetaRefreshTimer);
    methodMetaRefreshTimer = 0;
    pendingMethodMetaKind = "both";
  }

  function notifyMethodsChanged(kind = "both") {
    if (kind === "both") pendingMethodMetaKind = "both";
    else if (pendingMethodMetaKind !== "both") pendingMethodMetaKind = kind;
    clearTimeout(methodMetaRefreshTimer);
    const delay = pendingMethodMetaKind === "evidence" ? 280 : 200;
    methodMetaRefreshTimer = window.setTimeout(() => {
      methodMetaRefreshTimer = 0;
      const k = pendingMethodMetaKind;
      pendingMethodMetaKind = "both";
      if (typeof window.litlensRefreshMethodMetaHighlights === "function") {
        window.litlensRefreshMethodMetaHighlights(k, {
          reapplyPin: k !== "association",
        });
        return;
      }
      if (typeof window.litlensRefreshHighlights === "function") {
        window.litlensRefreshHighlights();
      }
    }, delay);
  }

  function applyMethodEvidenceLinkIncremental(methodLabel, entry) {
    if (!entry || entry.offset == null) return false;
    const append = window.litlensAppendMethodEvidenceLink;
    if (typeof append !== "function") return false;
    const quote = String(entry.excerpt || entry.quote || "").trim();
    return append({
      offset: entry.offset,
      length: entry.length || 20,
      methodLabel,
      quote: quote.length >= 4 ? quote : "",
      sentenceBounds: entry.sentenceBounds === true,
    });
  }

  function getVocab() {
    return vocab;
  }

  function getSelectedMethods() {
    return [...(structured.methods || [])];
  }

  function cloneFoundTermAliases() {
    const out = {};
    for (const [vk, byLabel] of Object.entries(foundTermAliases)) {
      out[vk] = {};
      for (const [label, terms] of Object.entries(byLabel || {})) {
        out[vk][label] = [...terms];
      }
    }
    return out;
  }

  function cloneMethodEvidence() {
    const out = {};
    for (const [label, entries] of Object.entries(methodEvidence)) {
      out[label] = (entries || []).map((e) => ({ ...e }));
    }
    return out;
  }

  function getArticleBody() {
    const ctx =
      typeof window.litlensGetArticleContext === "function"
        ? window.litlensGetArticleContext()
        : null;
    const body = ctx?.body;
    return body && body.style.display !== "none" ? body : null;
  }

  let _plainTextCache = null;
  let _plainTextBodyRef = null;

  function getArticlePlainText() {
    const body = getArticleBody();
    if (!body) return "";
    if (_plainTextBodyRef === body && _plainTextCache !== null) {
      return _plainTextCache;
    }
    const MP = window.LitLensMethodProfiles;
    _plainTextCache = MP ? MP.extractPlainText(body) : body.innerText || "";
    _plainTextBodyRef = body;
    return _plainTextCache;
  }

  function invalidatePlainTextCache() {
    _plainTextCache = null;
    _plainTextBodyRef = null;
  }

  function getSelectionEvidenceCandidate() {
    const body = getArticleBody();
    const BM = window.LitLensBookmarks;
    if (!body || !BM?.selectionSpan) return null;
    const span = BM.selectionSpan(body);
    if (!span || span.offset == null) return null;
    return {
      id: `ev-sel-${span.offset}`,
      excerpt: span.excerpt,
      offset: span.offset,
      length: span.length || 1,
      matchedTerm: "",
      matchType: "selection",
    };
  }

  function excerptFromPlain(plain, offset, length) {
    const hay = String(plain || "");
    if (!hay.length) return "";
    let pos = 0;
    for (const line of hay.split("\n")) {
      const lineStart = pos;
      const lineEnd = pos + line.length;
      if (offset >= lineStart && offset <= lineEnd) {
        const trimmed = line.trim();
        if (trimmed) return trimmed;
      }
      pos = lineEnd + 1;
    }
    const pad = 100;
    const start = Math.max(0, offset - pad);
    const end = Math.min(hay.length, offset + length + pad);
    return hay.slice(start, end).replace(/\s+/g, " ").trim();
  }

  function getScopeForItem(item) {
    return item?.vocabKey === "methods" ? methodsSuggestScope : suggestScope;
  }

  function buildEvidenceCandidate(item, globalOffset, hitOverride) {
    const MP = window.LitLensMethodProfiles;
    const body = getArticleBody();
    const scope = getScopeForItem(item);
    const hit = hitOverride || suggestionHitAtOffset(item, globalOffset);
    const termItem = hit
      ? { matchedTerm: hit.matchedTerm, matchType: hit.matchType }
      : item;
    const localStart = globalOffset - scope.start;
    const len = MP.matchLengthInText(
      scope.text.slice(Math.max(0, localStart)),
      termItem
    );
    const safeLen = Math.max(1, len || 1);
    let excerpt = "";
    if (body && window.LitLensBookmarks?.excerptAtOffset) {
      excerpt = LitLensBookmarks.excerptAtOffset(body, globalOffset, 200);
    } else {
      excerpt = excerptFromPlain(getArticlePlainText(), globalOffset, safeLen);
    }
    return {
      id: `ev-${globalOffset}`,
      excerpt,
      offset: globalOffset,
      length: safeLen,
      matchedTerm: termItem.matchedTerm,
      matchType: termItem.matchType,
    };
  }

  function buildEvidenceCandidatesForItem(item) {
    if (item.vocabKey === "methods") {
      return groupMethodHitsIntoPassages(item, getSuggestionMatchHits(item)).map(
        (passage) => buildSentenceEvidenceCandidate(item, passage)
      );
    }
    return getSuggestionMatchHits(item).map((hit) =>
      buildEvidenceCandidate(item, hit.globalOffset, hit)
    );
  }

  function buildEvidenceCandidatesForLabel(methodLabel) {
    const MP = window.LitLensMethodProfiles;
    if (!MP) return [];
    const profile = MP.profileByLabel(vocab, methodLabel);
    if (!profile) return [];
    const ctx =
      typeof window.litlensGetArticleContext === "function"
        ? window.litlensGetArticleContext()
        : null;
    if (ctx?.body) updateSuggestScope(ctx);
    const scope = getScopeForItem({ vocabKey: "methods", label: methodLabel });
    if (!scope.text) return [];
    const item = { label: methodLabel, vocabKey: "methods" };
    const hits = MP.findAllProfileMatchOffsetsInText(scope.text, profile).map(
      (hit) => ({
        globalOffset: hit.offset + scope.start,
        matchedTerm: hit.matchedTerm,
        matchType: hit.matchType,
      })
    );
    return groupMethodHitsIntoPassages(item, hits).map((passage) =>
      buildSentenceEvidenceCandidate(item, passage)
    );
  }

  function showMethodEvidencePicker(methodLabel, candidates, onDone) {
    const overlay = $("method-evidence-overlay");
    const listEl = $("method-evidence-list");
    const titleEl = $("method-evidence-title");
    if (!overlay || !listEl) {
      onDone(candidates.length === 1 ? [candidates[0]] : []);
      return;
    }
    if (titleEl) {
      titleEl.textContent = `Link “${methodLabel}” — select text passage(s)`;
    }
    listEl.replaceChildren();
    const checks = [];
    for (const c of candidates) {
      const row = document.createElement("label");
      row.className = "method-evidence-option";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = c.id;
      cb.checked = candidates.length === 1;
      cb.dataset.id = c.id;
      const text = document.createElement("span");
      text.className = "method-evidence-option-text";
      text.textContent = c.excerpt;
      row.append(cb, text);
      listEl.appendChild(row);
      checks.push({ cb, candidate: c });
    }
    overlay.classList.add("show");
    overlay.dataset.methodLabel = methodLabel;

    const finish = (selected) => {
      overlay.classList.remove("show");
      delete overlay.dataset.methodLabel;
      onDone(selected);
    };

    const confirmBtn = $("method-evidence-confirm");
    const cancelBtn = $("method-evidence-cancel");
    const skipBtn = $("method-evidence-skip");

    const onConfirm = () => {
      const selected = checks.filter((x) => x.cb.checked).map((x) => x.candidate);
      if (!selected.length) {
        alert("Select at least one passage, or Skip.");
        return;
      }
      finish(selected);
    };
    const onCancel = () => finish(null);
    const onSkip = () => finish([]);

    confirmBtn.onclick = onConfirm;
    cancelBtn.onclick = onCancel;
    skipBtn.onclick = onSkip;
    overlay.onclick = (e) => {
      if (e.target === overlay) onCancel();
    };
  }

  function attachMethodWithEvidence(methodLabel, entries) {
    const wasSelected = structured.methods.includes(methodLabel);
    if (!wasSelected) {
      structured.methods.push(methodLabel);
    }
    if (entries?.length) {
      methodEvidence[methodLabel] = entries.map((e) => ({ ...e }));
    } else {
      delete methodEvidence[methodLabel];
    }
    cancelMethodMetaRefresh();
    scheduleSave();
  }

  function jumpToMethodEvidence(methodLabel, entryIndex = 0) {
    const entries = methodEvidence[methodLabel];
    if (!entries?.length) return false;
    const entry = entries[entryIndex] ?? entries[0];
    if (entry.offset == null) return false;
    if (window.LitLensMethodsMap?.isOpen?.()) {
      window.LitLensMethodsMap.hide();
    }
    if (typeof window.litlensPinMethodEvidence === "function") {
      return window.litlensPinMethodEvidence(
        {
          offset: entry.offset,
          length: entry.length || 20,
          methodLabel,
          sentenceBounds: entry.sentenceBounds === true,
        },
        { scroll: true }
      );
    }
    const body = getArticleBody();
    const BM = window.LitLensBookmarks;
    if (!body || !BM?.scrollToTextSpan) return false;
    return BM.scrollToTextSpan(body, entry.offset, entry.length || 20, {
      persistent: true,
      methodLabel,
      expandToSentence:
        entry.sentenceBounds !== true && entry.expandToSentence !== false,
    });
  }

  function promptMethodEvidenceThenAttach(methodLabel, item, afterAttach) {
    let candidates = item
      ? buildEvidenceCandidatesForItem(item)
      : buildEvidenceCandidatesForLabel(methodLabel);
    if (!candidates.length) {
      const fromSelection = getSelectionEvidenceCandidate();
      if (fromSelection) candidates = [fromSelection];
    }
    const done = (selected) => {
      if (selected === null) return;
      attachMethodWithEvidence(methodLabel, selected);
      if (afterAttach) afterAttach();
    };
    if (!candidates.length) {
      done([]);
      return;
    }
    if (candidates.length === 1) {
      done([candidates[0]]);
      return;
    }
    showMethodEvidencePicker(methodLabel, candidates, done);
  }

  function closeDropdown(dd) {
    if (dd) dd.classList.remove("open");
    if (openDropdown === dd) openDropdown = null;
  }

  function openDropdownEl(dd) {
    if (openDropdown && openDropdown !== dd) closeDropdown(openDropdown);
    dd.classList.add("open");
    openDropdown = dd;
  }

  /** Close when clicking outside the whole combobox (wrap), not only the dropdown node. */
  document.addEventListener("mousedown", (e) => {
    if (!openDropdown) return;
    const wrap = openDropdown.parentElement;
    if (wrap?.contains(e.target)) return;
    closeDropdown(openDropdown);
  });

  function createNotionMultiSelect(field) {
    const section = document.createElement("div");
    section.className = "meta-section";
    section.dataset.field = field.key;

    const label = document.createElement("label");
    label.className = "meta-section-label";
    label.textContent = field.label;

    const labelWrap = document.createElement("div");
    labelWrap.className = "meta-section-label-row";
    labelWrap.appendChild(label);
    const suggestBlock = createFieldSuggestBlock(field.vocabKey);
    if (field.key === "methods") {
      const catalogBtn = document.createElement("button");
      catalogBtn.type = "button";
      catalogBtn.className = "btn-sm btn-ghost meta-methods-catalog-link";
      catalogBtn.textContent = "Catalog…";
      catalogBtn.title = "Open method catalog (add or edit methods)";
      catalogBtn.addEventListener("click", () => {
        if (window.LitLensMethodsMap?.showCatalog) {
          void window.LitLensMethodsMap.showCatalog();
        }
      });
      labelWrap.appendChild(catalogBtn);
    }

    const wrap = document.createElement("div");
    wrap.className = "notion-select";

    const inner = document.createElement("div");
    inner.className = "notion-select-inner";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "notion-select-input";
    input.placeholder = "Select or type…";
    input.autocomplete = "off";

    const dropdown = document.createElement("div");
    dropdown.className = "notion-select-dropdown";

    const hint = document.createElement("div");
    hint.className = "notion-select-hint";
    hint.textContent = "Select an option or create one";
    dropdown.appendChild(hint);

    const list = document.createElement("div");
    list.className = "notion-select-list";
    dropdown.appendChild(list);

    function renderChips() {
      inner.querySelectorAll(".notion-chip").forEach((c) => c.remove());
      const values = structured[field.key];
      values.forEach((val, idx) => {
        const chip = document.createElement("span");
        chip.className = "notion-chip";
        if (field.key === "methods") {
          const ev = methodEvidence[val];
          if (ev?.length) {
            chip.classList.add("notion-chip--has-evidence");
            chip.title =
              (ev.map((e, i) => `${i + 1}. ${e.excerpt}`).join("\n\n") ||
                "") + "\n\nClick to jump to passage in article";
            chip.style.cursor = "pointer";
            chip.addEventListener("click", (e) => {
              if (e.target.closest(".notion-chip-x")) return;
              jumpToMethodEvidence(val, 0);
            });
          }
        }
        const aliasHint = aliasHintForChip(field.vocabKey, val);
        chip.appendChild(document.createTextNode(val));
        if (aliasHint) chip.title = aliasHint;
        if (field.key === "methods" && methodEvidence[val]?.length) {
          const cnt = document.createElement("span");
          cnt.className = "notion-chip-ev-count";
          cnt.textContent = ` (${methodEvidence[val].length})`;
          chip.appendChild(cnt);
        }
        const x = document.createElement("button");
        x.type = "button";
        x.className = "notion-chip-x";
        x.textContent = "×";
        x.addEventListener("click", (e) => {
          e.stopPropagation();
          const removed = structured[field.key][idx];
          structured[field.key].splice(idx, 1);
          if (field.key === "methods" && removed) {
            delete methodEvidence[removed];
            cancelMethodMetaRefresh();
          }
          renderChips();
          scheduleSave();
        });
        chip.appendChild(x);
        inner.insertBefore(chip, input);
      });
    }

    function filteredOptions(query) {
      const q = query.trim().toLowerCase();
      const opts = getVocabOptions(field.vocabKey);
      const selected = new Set(structured[field.key]);
      return opts.filter((o) => {
        if (selected.has(o)) return false;
        if (!q) return true;
        return o.toLowerCase().includes(q);
      });
    }

    function renderList() {
      list.replaceChildren();
      const q = input.value;
      const options = filteredOptions(q);

      for (const opt of options.slice(0, 40)) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "notion-option";
        const pill = document.createElement("span");
        pill.className = "notion-option-pill";
        pill.textContent = opt;
        row.appendChild(pill);
        row.addEventListener("mousedown", (e) => {
          e.preventDefault();
          void pickValue(opt);
        });
        list.appendChild(row);
      }

      const exact = q.trim();
      if (
        exact &&
        !structured[field.key].includes(exact) &&
        !vocabHasOption(field.vocabKey, exact)
      ) {
        const create = document.createElement("button");
        create.type = "button";
        create.className = "notion-option notion-option-create";
        create.textContent = `Create "${exact}"`;
        create.addEventListener("mousedown", (e) => {
          e.preventDefault();
          void pickValue(exact);
        });
        list.appendChild(create);
      }

      if (!list.childElementCount) {
        const empty = document.createElement("div");
        empty.className = "notion-select-empty";
        empty.textContent = q.trim() ? "No matches" : "No options yet — type to create";
        list.appendChild(empty);
      }
    }

    async function pickValue(val) {
      const v = val.trim();
      if (!v || structured[field.key].includes(v)) return;
      if (field.key === "methods") {
        input.value = "";
        renderList();
        promptMethodEvidenceThenAttach(v, null, () => {
          pendingSuggestions = pendingSuggestions.filter(
            (s) => !(s.label === v && s.vocabKey === "methods")
          );
          renderChips();
          renderList();
          pendingSuggestions = pendingSuggestions.filter(
            (s) => !(s.vocabKey === "methods" && s.label === v)
          );
          refreshPendingSuggestionsUi({ vocabKeys: ["methods"] });
        });
        input.focus();
        if (!vocabHasOption(field.vocabKey, v)) {
          await addVocabOption(field.vocabKey, v);
        }
        return;
      }
      structured[field.key].push(v);
      if (!vocabHasOption(field.vocabKey, v)) {
        await addVocabOption(field.vocabKey, v);
      }
      input.value = "";
      renderChips();
      renderList();
      scheduleSave();
      pendingSuggestions = pendingSuggestions.filter(
        (s) =>
          !(
            s.vocabKey === field.vocabKey &&
            s.label.toLowerCase() === v.toLowerCase()
          )
      );
      refreshPendingSuggestionsUi({ vocabKeys: [field.vocabKey] });
      input.focus();
    }

    inner.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      if (document.activeElement !== input) input.focus();
      openDropdownEl(dropdown);
      renderList();
    });

    dropdown.addEventListener("mousedown", (e) => e.stopPropagation());

    input.addEventListener("focus", () => {
      openDropdownEl(dropdown);
      renderList();
    });

    let listFilterTimer = 0;
    input.addEventListener("input", () => {
      openDropdownEl(dropdown);
      clearTimeout(listFilterTimer);
      listFilterTimer = window.setTimeout(() => renderList(), 80);
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const v = input.value.trim();
        if (v) void pickValue(v);
      } else if (e.key === "Backspace" && !input.value && structured[field.key].length) {
        const removed = structured[field.key].pop();
        if (field.key === "methods" && removed) {
          delete methodEvidence[removed];
          cancelMethodMetaRefresh();
        }
        renderChips();
        scheduleSave();
      } else if (e.key === "Escape") {
        closeDropdown(dropdown);
        input.blur();
      }
    });

    inner.appendChild(input);
    wrap.append(inner, dropdown);
    section.append(labelWrap, suggestBlock, wrap);

    renderChips();
    chipRenderers.set(field.key, renderChips);
    return section;
  }

  function renderBrainField(field) {
    const section = document.createElement("div");
    section.className = "meta-section";
    section.dataset.field = field.key;

    const label = document.createElement("label");
    label.className = "meta-section-label";
    label.textContent = field.label;

    const suggestBlock = createFieldSuggestBlock(field.vocabKey);

    const wrap = document.createElement("div");
    wrap.className = "notion-select";

    const inner = document.createElement("div");
    inner.className = "notion-select-inner";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "notion-select-input";
    input.placeholder = "Region…";
    input.autocomplete = "off";

    const dropdown = document.createElement("div");
    dropdown.className = "notion-select-dropdown";
    const hint = document.createElement("div");
    hint.className = "notion-select-hint";
    hint.textContent = "Select a region or create one";
    dropdown.append(hint);
    const list = document.createElement("div");
    list.className = "notion-select-list";
    dropdown.appendChild(list);

    const coords = document.createElement("div");
    coords.className = "meta-coords";
    const ap = document.createElement("input");
    ap.placeholder = "AP";
    ap.title = "Anteroposterior (mm)";
    const ml = document.createElement("input");
    ml.placeholder = "ML";
    ml.title = "Mediolateral (mm)";
    const dv = document.createElement("input");
    dv.placeholder = "DV";
    dv.title = "Dorsoventral (mm)";
    coords.append(ap, ml, dv);

    function renderChips() {
      inner.querySelectorAll(".notion-chip").forEach((c) => c.remove());
      structured.brainRegions.forEach((r, idx) => {
        const chip = document.createElement("span");
        chip.className = "notion-chip";
        const rLabel = r.label || "?";
        chip.appendChild(document.createTextNode(regionChipLabel(r)));
        const hint = aliasHintForChip("brainRegions", rLabel);
        if (hint) chip.title = hint;
        const x = document.createElement("button");
        x.type = "button";
        x.className = "notion-chip-x";
        x.textContent = "×";
        x.addEventListener("click", (e) => {
          e.stopPropagation();
          structured.brainRegions.splice(idx, 1);
          renderChips();
          scheduleSave();
        });
        chip.appendChild(x);
        inner.insertBefore(chip, input);
      });
    }

    function renderList() {
      list.replaceChildren();
      const q = input.value.trim().toLowerCase();
      const opts = getVocabOptions("brainRegions").filter((o) =>
        q ? o.toLowerCase().includes(q) : true
      );
      for (const opt of opts.slice(0, 40)) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "notion-option";
        const pill = document.createElement("span");
        pill.className = "notion-option-pill";
        pill.textContent = opt;
        row.appendChild(pill);
        row.addEventListener("mousedown", (e) => {
          e.preventDefault();
          input.value = opt;
          void addRegion();
        });
        list.appendChild(row);
      }
      const exact = input.value.trim();
      if (
        exact &&
        !opts.some((o) => o.toLowerCase() === exact.toLowerCase())
      ) {
        const create = document.createElement("button");
        create.type = "button";
        create.className = "notion-option notion-option-create";
        create.textContent = `Create "${exact}"`;
        create.addEventListener("mousedown", (e) => {
          e.preventDefault();
          void addRegion();
        });
        list.appendChild(create);
      }
    }

    async function addRegion() {
      const labelVal = input.value.trim();
      if (!labelVal) return;
      structured.brainRegions.push({
        label: labelVal,
        ap: ap.value.trim(),
        ml: ml.value.trim(),
        dv: dv.value.trim(),
      });
      if (!(vocab.brainRegions || []).includes(labelVal)) {
        await addVocabOption("brainRegions", labelVal);
      }
      input.value = "";
      ap.value = "";
      ml.value = "";
      dv.value = "";
      renderChips();
      renderList();
      scheduleSave();
      pendingSuggestions = pendingSuggestions.filter(
        (s) =>
          !(
            s.vocabKey === "brainRegions" &&
            s.label.toLowerCase() === labelVal.toLowerCase()
          )
      );
      refreshPendingSuggestionsUi({ vocabKeys: ["brainRegions"] });
    }

    inner.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      if (document.activeElement !== input) input.focus();
      openDropdownEl(dropdown);
      renderList();
    });
    dropdown.addEventListener("mousedown", (e) => e.stopPropagation());
    input.addEventListener("focus", () => {
      openDropdownEl(dropdown);
      renderList();
    });
    let brainListFilterTimer = 0;
    input.addEventListener("input", () => {
      openDropdownEl(dropdown);
      clearTimeout(brainListFilterTimer);
      brainListFilterTimer = window.setTimeout(() => renderList(), 80);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void addRegion();
      } else if (e.key === "Escape") {
        closeDropdown(dropdown);
      }
    });

    [ap, ml, dv].forEach((el) => {
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void addRegion();
        }
      });
    });

    inner.appendChild(input);
    wrap.append(inner, dropdown);
    section.append(label, suggestBlock, wrap, coords);
    const hint2 = document.createElement("p");
    hint2.className = "meta-vocab-hint";
    hint2.textContent =
      "Optional AP / ML / DV (mm), then Enter. CSV: AP = -3.8; ML = 3, CA1";
    section.appendChild(hint2);

    renderChips();
    chipRenderers.set(field.key, renderChips);
    return section;
  }

  function setFromArticle(article) {
    const nEl = $("meta-n-animals");
    const cfEl = $("meta-cell-filter");
    if (!article) {
      structured = emptyStructured();
      dismissedSuggestions = [];
      dismissedSuggestionHits = [];
      methodEvidence = {};
      readParagraphOffsets = [];
      readParagraphKeys = [];
      readParagraphRanges = [];
      foundTermAliases = {};
      if (nEl) nEl.value = "";
      if (cfEl) cfEl.value = "";
      invalidatePlainTextCache();
      renderAll();
      return;
    }
    const s = article.structured || {};
    structured = {
      species: [...(s.species || [])],
      brainRegions: (s.brainRegions || []).map(normalizeBrainRegion),
      behavioralParadigms: [...(s.behavioralParadigms || [])],
      recordingMethods: [...(s.recordingMethods || [])],
      cellTypes: [...(s.cellTypes || [])],
      software: [...(s.software || [])],
      methods: [...(s.methods || [])],
    };
    if (nEl) nEl.value = article.nAnimals || s.nAnimals || "";
    if (cfEl) {
      cfEl.value =
        article.cellFilterCriterion || s.cellFilterCriterion || "";
    }
    dismissedSuggestions = [...(article.methodSuggestionsDismissed || [])];
    dismissedSuggestionHits = [
      ...(article.methodSuggestionsDismissedHits || []),
    ];
    methodEvidence = {};
    for (const [label, entries] of Object.entries(article.methodEvidence || {})) {
      if (Array.isArray(entries) && entries.length) {
        methodEvidence[label] = entries.map((e) => ({ ...e }));
      }
    }
    readParagraphKeys = [...(article.readParagraphKeys || [])].filter(
      (k) => typeof k === "string" && k.trim()
    );
    readParagraphOffsets = [...(article.readParagraphOffsets || [])]
      .filter((n) => typeof n === "number" && n >= 0)
      .sort((a, b) => a - b);
    readParagraphRanges = [];
    foundTermAliases = {};
    for (const [vk, byLabel] of Object.entries(article.foundTermAliases || {})) {
      if (!byLabel || typeof byLabel !== "object") continue;
      foundTermAliases[vk] = {};
      for (const [label, terms] of Object.entries(byLabel)) {
        if (Array.isArray(terms) && terms.length) {
          foundTermAliases[vk][label] = [...terms];
        }
      }
    }
    invalidatePlainTextCache();
    applyStructuredFieldsUi();
    pendingSuggestions = [];
    suggestNav = { key: "", index: 0 };
    syncSuggestMethodsCheckbox(article);
    refreshPendingSuggestionsUi();
  }

  function applyStructuredFieldsUi() {
    if (chipRenderers.size > 0) {
      for (const field of FIELDS) {
        refreshStructuredField(field.key);
      }
    } else {
      renderAll();
    }
  }

  function cancelScheduledSuggest() {
    clearTimeout(suggestScanTimer);
    suggestScanTimer = 0;
    suggestScanGen += 1;
  }

  function scheduleMethodSuggest() {
    clearTimeout(suggestScanTimer);
    const gen = suggestScanGen;
    suggestScanTimer = window.setTimeout(() => {
      suggestScanTimer = 0;
      if (gen !== suggestScanGen) return;
      runMethodSuggest({ includeMethods: suggestIncludeMethods() });
    }, 500);
  }

  function getReadParagraphKeys() {
    return [...readParagraphKeys];
  }

  function getReadParagraphOffsets() {
    return [...readParagraphOffsets];
  }

  function toggleReadParagraph(paragraphKey, read) {
    const key = String(paragraphKey || "").trim();
    if (!key) return;
    const idx = readParagraphKeys.indexOf(key);
    if (read) {
      if (idx < 0) readParagraphKeys.push(key);
    } else if (idx >= 0) {
      readParagraphKeys.splice(idx, 1);
    }
    readParagraphKeys.sort((a, b) => a.localeCompare(b));
    readParagraphKeys = [...new Set(readParagraphKeys)];

    const body = window.litlensGetArticleContext?.()?.body;
    const PB = window.LitLensParagraphBlocks;
    const block =
      body && PB?.getBlocksForBody
        ? PB.getBlocksForBody(body).find((b) => PB.blockKey(b) === key)
        : null;
    if (read && block) {
      if (!readParagraphRanges.some((r) => r.start === block.start)) {
        readParagraphRanges.push({ start: block.start, end: block.end });
      }
    } else if (block) {
      readParagraphRanges = readParagraphRanges.filter((r) => r.start !== block.start);
    } else if (!read) {
      readParagraphRanges = readParagraphRanges.filter((r) => {
        const b = body && PB?.findBlockInBlocks
          ? PB.findBlockInBlocks(PB.getBlocksForBody(body), r.start)
          : null;
        return !b || PB.blockKey(b) !== key;
      });
    }

    if (typeof window.litlensApplyReadParagraphKeysLocal === "function") {
      window.litlensApplyReadParagraphKeysLocal(readParagraphKeys);
    }

    if (typeof window.litlensSaveReadParagraphs === "function") {
      window.litlensSaveReadParagraphs();
    }
    refreshPendingSuggestionsUi();
    window.ArticleParagraphRead?.syncBlock?.(key, read);
  }

  function readPayload() {
    const nAnimals = ($("meta-n-animals")?.value || "").trim();
    const cellFilterCriterion = ($("meta-cell-filter")?.value || "").trim();
    return {
      nAnimals,
      cellFilterCriterion,
      methodSuggestionsDismissed: [...dismissedSuggestions],
      methodSuggestionsDismissedHits: [...dismissedSuggestionHits],
      methodEvidence: cloneMethodEvidence(),
      readParagraphKeys: [...readParagraphKeys],
      readParagraphOffsets: [],
      foundTermAliases: cloneFoundTermAliases(),
      structured: {
        ...structured,
        nAnimals,
        cellFilterCriterion,
      },
    };
  }

  function fieldLabelForVocabKey(vocabKey) {
    const f = FIELDS.find((x) => x.vocabKey === vocabKey);
    return f?.label || vocabKey;
  }

  function updateSuggestScope(ctx) {
    const body = ctx?.body;
    const MP = window.LitLensMethodProfiles;
    if (!body || !MP) {
      suggestScope = { text: "", start: 0, scopeLabel: "" };
      methodsSuggestScope = { text: "", start: 0, scopeLabel: "" };
      return suggestScope;
    }
    const plain = MP.extractPlainText(body);
    const bookmarks = ctx.bookmarks || [];

    function buildScope(useFullArticle) {
      const scoped = MP.getSuggestTextScope(plain, bookmarks, useFullArticle, body);
      if (useFullArticle) {
        return {
          text: scoped.text,
          start: scoped.start,
          scopeLabel: scoped.excludedReferences
            ? "full article (excluding References)"
            : "full article",
        };
      }
      if (MP.getMethodsSectionScope(plain, bookmarks)) {
        return {
          text: scoped.text,
          start: scoped.start,
          scopeLabel: "Methods section",
        };
      }
      return {
        text: scoped.text,
        start: scoped.start,
        scopeLabel: scoped.excludedReferences
          ? "full article (excluding References; no Methods bookmark — add one on Marks)"
          : "full article (no Methods bookmark — add one on Marks)",
      };
    }

    const scope = buildScope(suggestUseFullArticle);
    suggestScope = scope;
    methodsSuggestScope = scope;
    return suggestScope;
  }

  function getSuggestSourceText(ctx) {
    const scope = updateSuggestScope(ctx);
    return { text: scope.text, scopeLabel: scope.scopeLabel };
  }

  function getSuggestionMatchHits(item) {
    const MP = window.LitLensMethodProfiles;
    const scope = getScopeForItem(item);
    if (!MP || !scope.text) return [];
    if (item.vocabKey === "methods") {
      const profile = MP.profileByLabel(vocab, item.label);
      if (!profile) return [];
      return MP.findAllProfileMatchOffsetsInText(scope.text, profile).map(
        (hit) => ({
          globalOffset: hit.offset + scope.start,
          matchedTerm: hit.matchedTerm,
          matchType: hit.matchType,
        })
      );
    }
    return MP.findMatchOffsetsInText(scope.text, item).map((offset) => ({
      globalOffset: offset + scope.start,
      matchedTerm: item.matchedTerm,
      matchType: item.matchType,
    }));
  }

  function suggestionHitAtOffset(item, globalOffset) {
    return getSuggestionMatchHits(item).find(
      (h) => h.globalOffset === globalOffset
    );
  }

  function getSuggestionMatchOffsets(item) {
    return getSuggestionMatchHits(item).map((h) => h.globalOffset);
  }

  function jumpToSuggestionMatch(item, index, options = {}) {
    const ctx =
      typeof window.litlensGetArticleContext === "function"
        ? window.litlensGetArticleContext()
        : null;
    const body = ctx?.body;
    if (!body || body.style.display === "none") return false;
    if (window.LitLensMethodsMap?.isOpen?.()) {
      window.LitLensMethodsMap.hide();
    }
    const MP = window.LitLensMethodProfiles;
    if (!MP) return false;

    if (ctx) updateSuggestScope(ctx);

    const passages =
      item.vocabKey === "methods"
        ? getActiveSuggestionPassages(item)
        : null;
    const offsets = passages
      ? passages.map((p) => p.offset)
      : getActiveSuggestionOffsets(item);
    if (!offsets.length) {
      const status = $("meta-suggest-status");
      if (status) {
        status.textContent = "No location found in text for this match.";
      }
      return false;
    }

    const key = suggestionKey(item.vocabKey, item.label);
    let idx =
      typeof index === "number"
        ? index
        : suggestNav.key === key
          ? suggestNav.index
          : 0;
    idx = ((idx % offsets.length) + offsets.length) % offsets.length;
    suggestNav = { key, index: idx };

    if (passages) {
      const passage = passages[idx];
      const plain = getArticlePlainText();
      const quote =
        MP?.sentenceExcerptFromPlain?.(plain, passage.offset, passage.length, 420) ||
        "";
      let ok = false;
      if (typeof window.litlensPinMethodEvidence === "function") {
        ok = window.litlensPinMethodEvidence(
          {
            offset: passage.offset,
            length: passage.length,
            methodLabel: item.label,
            sentenceBounds: true,
            quote,
          },
          { scroll: true }
        );
      } else if (window.LitLensBookmarks?.scrollToTextSpan) {
        ok = LitLensBookmarks.scrollToTextSpan(
          body,
          passage.offset,
          passage.length,
          { expandToSentence: false }
        );
      }
      const status = $("meta-suggest-status");
      if (status && ok) {
        status.textContent = `Match ${idx + 1} of ${offsets.length} in ${
          getScopeForItem(item).scopeLabel || "text"
        }`;
      }
      return ok;
    }

    const globalStart = offsets[idx];
    const scope = getScopeForItem(item);
    const localStart = globalStart - scope.start;
    const hit = suggestionHitAtOffset(item, globalStart);
    const termItem = hit
      ? { matchedTerm: hit.matchedTerm, matchType: hit.matchType }
      : item;
    const len = Math.max(
      1,
      MP.matchLengthInText(
        scope.text.slice(Math.max(0, localStart)),
        termItem
      ) || 1
    );

    let ok = false;
    if (typeof window.litlensPinMethodEvidence === "function") {
      ok = window.litlensPinMethodEvidence(
        {
          offset: globalStart,
          length: len,
          methodLabel: item.label,
        },
        { scroll: true }
      );
    } else if (window.LitLensBookmarks?.scrollToTextSpan) {
      ok = LitLensBookmarks.scrollToTextSpan(body, globalStart, len, {
        expandToSentence: true,
      });
    }

    const status = $("meta-suggest-status");
    if (status) {
      status.textContent =
        offsets.length > 1
          ? `Passage ${idx + 1} of ${offsets.length} in ${scope.scopeLabel}.`
          : `Highlighted in ${scope.scopeLabel}.`;
    }
    if (options.refreshSuggestUi !== false) {
      refreshPendingSuggestionsUi({ vocabKeys: [item.vocabKey] });
    }
    return ok;
  }

  function getLinkedMethodLabels() {
    return [...(structured.methods || [])];
  }

  function isMethodLinkedToArticle(label) {
    const q = String(label || "").trim().toLowerCase();
    return getLinkedMethodLabels().some((m) => String(m).trim().toLowerCase() === q);
  }

  function getSelectedLabels(vocabKey) {
    if (vocabKey === "brainRegions") {
      return structured.brainRegions.map((r) => r.label);
    }
    return [...(structured[vocabKey] || [])];
  }

  function isStructuredValueSelected(vocabKey, label) {
    const q = String(label || "").trim().toLowerCase();
    return getSelectedLabels(vocabKey).some(
      (v) => String(v).trim().toLowerCase() === q
    );
  }

  function recordFoundAlias(vocabKey, label, matchedTerm) {
    const term = String(matchedTerm || "").trim();
    if (!term || !vocabKey || !label) return;
    if (!foundTermAliases[vocabKey]) foundTermAliases[vocabKey] = {};
    if (!foundTermAliases[vocabKey][label]) foundTermAliases[vocabKey][label] = [];
    if (!foundTermAliases[vocabKey][label].includes(term)) {
      foundTermAliases[vocabKey][label].push(term);
    }
  }

  function aliasHintForChip(vocabKey, label) {
    const list = foundTermAliases[vocabKey]?.[label];
    if (!list?.length) return "";
    return `Found as: ${list.join(", ")}`;
  }

  function addStructuredTag(vocabKey, label) {
    const lab = String(label || "").trim();
    if (!lab) return;
    if (vocabKey === "brainRegions") {
      if (
        !structured.brainRegions.some(
          (r) => r.label.toLowerCase() === lab.toLowerCase()
        )
      ) {
        structured.brainRegions.push({ label: lab, ap: "", ml: "", dv: "" });
      }
      return;
    }
    if (!structured[vocabKey]) structured[vocabKey] = [];
    if (!structured[vocabKey].includes(lab)) {
      structured[vocabKey].push(lab);
    }
  }

  function collectSuggestionsFromText(text, { includeMethods = true, methodsText } = {}) {
    const MP = window.LitLensMethodProfiles;
    const VTP = window.LitLensVocabTermProfiles;
    const out = [];
    if (includeMethods && MP) {
      out.push(
        ...MP.suggestFromCatalog(methodsText ?? text, vocab, {
          alreadySelected: getSelectedLabels("methods"),
        })
      );
    }
    if (VTP) {
      for (const vocabKey of VTP.TERM_VOCAB_KEYS) {
        out.push(
          ...VTP.suggestFromCatalog(text, vocab, vocabKey, {
            alreadySelected: getSelectedLabels(vocabKey),
          })
        );
      }
    }
    return out;
  }

  function runMethodSuggest({ rescan = false, includeMethods } = {}) {
    if (!window.LitLensMethodProfiles && !window.LitLensVocabTermProfiles) return;
    const scanMethods = includeMethods ?? suggestIncludeMethods();

    if (rescan) {
      if (scanMethods) {
        dismissedSuggestions = [];
        dismissedSuggestionHits = [];
      } else {
        dismissedSuggestions = dismissedSuggestions.filter((key) =>
          key.startsWith("methods:")
        );
        dismissedSuggestionHits = dismissedSuggestionHits.filter((key) =>
          key.startsWith("methods:")
        );
      }
      suggestNav = { key: "", index: 0 };
      scheduleSave();
    }

    const ctx =
      typeof window.litlensGetArticleContext === "function"
        ? window.litlensGetArticleContext()
        : null;
    if (!ctx?.body || ctx.body.style.display === "none") {
      pendingSuggestions = [];
      const status = $("meta-suggest-status");
      if (status) status.textContent = "Open an article to scan.";
      refreshPendingSuggestionsUi();
      return;
    }

    const { text, scopeLabel } = getSuggestSourceText(ctx);
    const found = collectSuggestionsFromText(text, {
      includeMethods: scanMethods,
      methodsText: scanMethods ? methodsSuggestScope.text : undefined,
    }).filter((item) => !isSuggestionDismissed(item));
    if (rescan && !scanMethods) {
      pendingSuggestions = [
        ...pendingSuggestions.filter((item) => item.vocabKey === "methods"),
        ...found,
      ];
    } else {
      pendingSuggestions = found;
    }
    refreshPendingSuggestionsUi();

    const status = $("meta-suggest-status");
    const methodFound = found.filter((item) => item.vocabKey === "methods");
    const termFound = found.filter((item) => item.vocabKey !== "methods");

    if (scanMethods) {
      const methodsScopeLabel = methodsSuggestScope.scopeLabel || scopeLabel;
      if (status) {
        if (methodFound.length) {
          status.textContent = `Found ${methodFound.length} method suggestion${
            methodFound.length === 1 ? "" : "s"
          } in ${methodsScopeLabel}. Read paragraphs stay marked — rescan skips them.`;
        } else {
          status.textContent = `No method matches in ${methodsScopeLabel}. Check Methods checkbox and catalog triggers.`;
        }
      }
    } else if (status && rescan) {
      status.textContent = termFound.length
        ? `Found ${termFound.length} term suggestion${
            termFound.length === 1 ? "" : "s"
          } in ${scopeLabel}. Enable Methods to scan analysis methods.`
        : `No term matches in ${scopeLabel}. Try Full article if the phrase is outside Methods.`;
    }
  }

  function dismissMethodSuggestion(item) {
    const key = suggestionKey(item.vocabKey, item.label);
    if (!dismissedSuggestions.includes(key)) {
      dismissedSuggestions.push(key);
    }
    for (const off of getSuggestionMatchOffsets(item)) {
      const hk = hitDismissKey(item, off);
      if (!dismissedSuggestionHits.includes(hk)) {
        dismissedSuggestionHits.push(hk);
      }
    }
    scheduleSave();
    refreshPendingSuggestionsUi({ vocabKeys: [item.vocabKey] });
  }

  function dismissAllMethodSuggestions() {
    for (const item of pendingSuggestions) {
      const key = suggestionKey(item.vocabKey, item.label);
      if (!dismissedSuggestions.includes(key)) dismissedSuggestions.push(key);
      for (const off of getSuggestionMatchOffsets(item)) {
        const hk = hitDismissKey(item, off);
        if (!dismissedSuggestionHits.includes(hk)) {
          dismissedSuggestionHits.push(hk);
        }
      }
    }
    scheduleSave();
    refreshPendingSuggestionsUi();
    const status = $("meta-suggest-status");
    if (status) status.textContent = "All suggestions dismissed for this article.";
  }

  function acceptSuggestionHit(item, globalOffset) {
    const label = item.label;
    addStructuredTag(item.vocabKey, label);
    recordFoundAlias(item.vocabKey, label, item.matchedTerm);

    if (item.vocabKey === "methods") {
      const candidate = buildEvidenceCandidate(
        item,
        globalOffset,
        suggestionHitAtOffset(item, globalOffset)
      );
      if (!methodEvidence[label]) methodEvidence[label] = [];
      const isNew =
        !methodEvidence[label].some((e) => e.offset === candidate.offset);
      if (isNew) {
        methodEvidence[label].push({ ...candidate });
      }
      cancelMethodMetaRefresh();
      scheduleSave();
      afterStructuredSuggestAction(item);
      return;
    }
    removePendingSuggestion(item);
    scheduleSave();
    afterStructuredSuggestAction(item, { jump: true, jumpIndex: 0 });
  }

  function acceptMethodSuggestion(item) {
    const passages = getActiveSuggestionPassages(item);
    if (!passages.length) return;
    if (passages.length === 1 || item.vocabKey !== "methods") {
      acceptSuggestionPassage(item, passages[0]);
      return;
    }
    const candidates = passages.map((passage) =>
      buildSentenceEvidenceCandidate(item, passage)
    );
    showMethodEvidencePicker(item.label, candidates, (selected) => {
      if (selected === null) return;
      addStructuredTag("methods", item.label);
      if (selected.length) {
        if (!methodEvidence[item.label]) methodEvidence[item.label] = [];
        for (const c of selected) {
          recordFoundAlias("methods", item.label, c.matchedTerm || item.matchedTerm);
          if (!methodEvidence[item.label].some((e) => e.offset === c.offset)) {
            methodEvidence[item.label].push({ ...c });
          }
        }
        cancelMethodMetaRefresh();
        scheduleSave();
        afterStructuredSuggestAction(item);
      } else {
        cancelMethodMetaRefresh();
        scheduleSave();
        afterStructuredSuggestAction(item);
      }
    });
  }

  function formatSuggestItemMeta(item, activeOffsets) {
    const hits = getSuggestionMatchHits(item).filter(
      (h) => !activeOffsets?.length || activeOffsets.includes(h.globalOffset)
    );
    const directTerms = [
      ...new Set(
        hits.filter((h) => h.matchType === "direct").map((h) => h.matchedTerm)
      ),
    ];
    const indirectTerms = [
      ...new Set(
        hits
          .filter((h) => h.matchType === "indirect")
          .map((h) => h.matchedTerm)
      ),
    ];
    const attrs = [];
    if (directTerms.length) {
      attrs.push(
        `direct · ${directTerms.map((t) => `«${t}»`).join(", ")}`
      );
    } else if (indirectTerms.length) {
      attrs.push(
        `indirect · ${indirectTerms.map((t) => `«${t}»`).join(", ")}`
      );
    } else {
      const typeLabel =
        item.matchType === "direct"
          ? "direct"
          : item.matchType === "indirect"
            ? "indirect"
            : "combo";
      attrs.push(typeLabel, `«${item.matchedTerm}»`);
    }
    if (indirectTerms.length && directTerms.length) {
      attrs.push(
        `indirect · ${indirectTerms.map((t) => `«${t}»`).join(", ")}`
      );
    }
    if (item.modalities?.length) attrs.push(item.modalities.join("/"));
    if (item.category) attrs.push(item.category);
    return attrs.join(" · ");
  }

  function renderFieldSuggestChips(vocabKey) {
    const block = document.querySelector(
      `.meta-field-suggest[data-vocab-key="${CSS.escape(vocabKey)}"]`
    );
    const wrap = block?.querySelector(".meta-field-suggest-chips");
    if (!wrap || !block) return;
    wrap.replaceChildren();

    for (const item of pendingSuggestions.filter((i) => i.vocabKey === vocabKey)) {
      const passages = getActiveSuggestionPassages(item);
      if (!passages.length) continue;

      const activeOffsets = passages.flatMap((p) =>
        p.hits.map((h) => h.globalOffset)
      );

      const key = suggestionKey(item.vocabKey, item.label);
      const isActiveNav = suggestNav.key === key;
      const navIndex = isActiveNav ? suggestNav.index : 0;

      const card = document.createElement("div");
      card.className = "method-suggest-card";
      if (isActiveNav) card.classList.add("method-suggest-card--active");

      const head = document.createElement("div");
      head.className = "method-suggest-card-head";

      const headText = document.createElement("div");
      headText.className = "method-suggest-card-head-text";

      const labelEl = document.createElement("span");
      labelEl.className = "method-suggest-chip-label";
      labelEl.textContent = item.label;

      const meta = document.createElement("span");
      meta.className = "method-suggest-chip-meta";
      meta.textContent = formatSuggestItemMeta(item, activeOffsets);

      headText.append(labelEl, meta);

      const headActions = document.createElement("div");
      headActions.className = "method-suggest-chip-actions";

      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "method-suggest-chip-dismiss";
      dismiss.title = "Dismiss for this article";
      dismiss.textContent = "×";
      dismiss.addEventListener("click", (e) => {
        e.stopPropagation();
        dismissMethodSuggestion(item);
      });

      const add = document.createElement("button");
      add.type = "button";
      add.className = "method-suggest-chip-add";
      add.title =
        passages.length > 1
          ? "Link passages (choose which)"
          : "Link this passage";
      add.textContent = "+";
      add.addEventListener("click", (e) => {
        e.stopPropagation();
        acceptMethodSuggestion(item);
      });

      headActions.append(dismiss, add);
      head.append(headText, headActions);

      const locs = document.createElement("div");
      locs.className = "method-suggest-locs";
      if (passages.length > 1) {
        locs.classList.add("method-suggest-locs--list");
      }

      passages.forEach((passage, idx) => {
        const candidate = buildSentenceEvidenceCandidate(item, passage);
        const excerpt =
          candidate.excerpt.length > 120
            ? `${candidate.excerpt.slice(0, 117)}…`
            : candidate.excerpt;

        const row = document.createElement("div");
        row.className = "method-suggest-loc-row";
        if (isActiveNav && navIndex === idx) {
          row.classList.add("method-suggest-loc-row--active");
        }

        const jump = document.createElement("button");
        jump.type = "button";
        jump.className = "method-suggest-loc-jump";
        jump.title = "Highlight in article";

        const num = document.createElement("span");
        num.className = "method-suggest-loc-num";
        num.textContent = String(idx + 1);

        const quote = document.createElement("span");
        quote.className = "method-suggest-loc-quote";
        const excerptText = excerpt || `…offset ${passage.offset}`;
        const MM = window.LitLensMethodsMap;
        const profile = window.LitLensMethodProfiles?.profileByLabel(
          vocab,
          item.label
        );
        if (
          item.vocabKey === "methods" &&
          MM?.fillQuoteWithHighlights &&
          MM?.termsToHighlightInExcerpt
        ) {
          MM.fillQuoteWithHighlights(
            quote,
            excerptText,
            MM.termsToHighlightInExcerpt(
              {
                matchedTerm: passage.hits
                  .map((h) => h.matchedTerm)
                  .filter(Boolean)
                  .join(", "),
                matchType: item.matchType,
              },
              profile
            )
          );
        } else {
          quote.textContent = excerptText;
        }

        jump.append(num, quote);
        jump.addEventListener("click", (e) => {
          e.stopPropagation();
          jumpToSuggestionMatch(item, idx);
        });

        const rowActions = document.createElement("div");
        rowActions.className = "method-suggest-loc-actions";

        const acceptHit = document.createElement("button");
        acceptHit.type = "button";
        acceptHit.className = "method-suggest-loc-accept";
        acceptHit.title = "Link this passage";
        acceptHit.textContent = "✓";
        acceptHit.addEventListener("click", (e) => {
          e.stopPropagation();
          acceptSuggestionPassage(item, passage);
        });

        const dismissHit = document.createElement("button");
        dismissHit.type = "button";
        dismissHit.className = "method-suggest-loc-dismiss";
        dismissHit.title = "Not this passage";
        dismissHit.textContent = "×";
        dismissHit.addEventListener("click", (e) => {
          e.stopPropagation();
          dismissSuggestionPassage(item, passage);
        });

        if (item.vocabKey === "methods") {
          const articleId = window.litlensCurrentId?.();
          const MM = window.LitLensMethodsMap;
          if (articleId && MM?.createPassageCiteCopyButton) {
            rowActions.append(
              acceptHit,
              MM.createPassageCiteCopyButton(
                articleId,
                {
                  offset: passage.offset,
                  length: passage.length,
                  excerpt: candidate.excerpt,
                  quote: candidate.excerpt,
                },
                { btnClass: "method-suggest-loc-copy" }
              ),
              dismissHit
            );
          } else {
            rowActions.append(acceptHit, dismissHit);
          }
        } else {
          rowActions.append(acceptHit, dismissHit);
        }
        row.append(jump, rowActions);
        locs.appendChild(row);
      });

      card.append(head, locs);
      wrap.appendChild(card);
    }

    block.hidden = wrap.childElementCount === 0;
  }

  function bindMethodSuggestPanel() {
    const panel = $("meta-suggest-toolbar");
    if (!panel || panel.dataset.bound) return;
    panel.dataset.bound = "1";

    const scanBtn = $("meta-suggest-scan-btn");
    const methodsCb = $("meta-suggest-methods");
    const fullCb = $("meta-suggest-full");
    const dismissAllBtn = $("meta-suggest-dismiss-all");
    if (scanBtn) {
      scanBtn.addEventListener("click", () =>
        runMethodSuggest({ rescan: true, includeMethods: suggestIncludeMethods() })
      );
    }
    if (methodsCb) {
      methodsCb.addEventListener("change", () => {
        if (pendingSuggestions.some((item) => item.vocabKey === "methods")) {
          runMethodSuggest({ rescan: false, includeMethods: methodsCb.checked });
        }
      });
    }
    if (fullCb) {
      fullCb.addEventListener("change", () => {
        suggestUseFullArticle = fullCb.checked;
        if (pendingSuggestions.length) {
          runMethodSuggest({
            rescan: false,
            includeMethods: suggestIncludeMethods(),
          });
        }
      });
    }
    if (dismissAllBtn) {
      dismissAllBtn.addEventListener("click", () => dismissAllMethodSuggestions());
    }
  }

  function renderAll() {
    const root = $("meta-structured-fields");
    if (!root) return;
    chipRenderers.clear();
    root.replaceChildren();
    for (const field of FIELDS) {
      root.appendChild(
        field.coords ? renderBrainField(field) : createNotionMultiSelect(field)
      );
    }
    refreshPendingSuggestionsUi();
  }

  function exportCsv() {
    window.location.href = `${API}/export/meta.csv`;
  }

  function bindExportButtons() {
    for (const id of ["export-meta-csv-btn", "export-meta-csv-sidebar"]) {
      const btn = $(id);
      if (btn && !btn.dataset.bound) {
        btn.dataset.bound = "1";
        btn.addEventListener("click", exportCsv);
      }
    }
  }

  function bindScalarFields() {
    for (const id of ["meta-n-animals", "meta-cell-filter"]) {
      const el = $(id);
      if (el && !el.dataset.bound) {
        el.dataset.bound = "1";
        el.addEventListener("input", scheduleScalarSave);
      }
    }
  }

  function init() {
    bindExportButtons();
    bindScalarFields();
    bindMethodSuggestPanel();
    renderAll();
  }

  window.StructuredMeta = {
    loadVocab,
    reloadVocab,
    getVocab,
    getSelectedMethods,
    getMethodEvidence: () => cloneMethodEvidence(),
    getReadParagraphKeys,
    getReadParagraphOffsets,
    toggleReadParagraph,
    isOffsetInReadParagraph,
    rebuildReadParagraphRanges,
    setFromArticle,
    readPayload,
    init,
    exportCsv,
    runMethodSuggest,
    scheduleMethodSuggest,
    cancelScheduledSuggest,
    refreshMethodSuggestions: scheduleMethodSuggest,
  };

  init();
})();
