/**
 * Term catalogs for Info fields (species, brain region, …): label + trigger words.
 * Same matching rules as method catalog; stored in vocab.profiles[vocabKey].
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof root !== "undefined") {
    root.LitLensVocabTermProfiles = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const TERM_VOCAB_KEYS = [
    "species",
    "brainRegions",
    "behavioralParadigms",
    "recordingMethods",
    "cellTypes",
    "software",
  ];

  const FIELD_LABELS = {
    species: "Species",
    brainRegions: "Brain region",
    behavioralParadigms: "Behavioral paradigm",
    recordingMethods: "Recording methods",
    cellTypes: "Cell type",
    software: "Software",
  };

  function escapeRegex(s) {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

  function normalizeTriggers(raw, label, legacyAliases) {
    const triggers = emptyTriggers();
    if (raw && typeof raw === "object") {
      triggers.direct = (raw.direct || [])
        .map((t) => String(t).trim())
        .filter(Boolean);
      triggers.indirect = (raw.indirect || [])
        .map((t) => String(t).trim())
        .filter(Boolean);
    }
    if (Array.isArray(legacyAliases) && legacyAliases.length && !triggers.direct.length) {
      triggers.direct = legacyAliases.map((t) => String(t).trim()).filter(Boolean);
    }
    const lab = String(label || "").trim();
    if (lab && !triggers.direct.includes(lab)) {
      triggers.direct.unshift(lab);
    }
    return triggers;
  }

  function normalizeTermProfile(entry) {
    if (typeof entry === "string") {
      const label = entry.trim();
      if (!label) return null;
      return {
        id: slugify(label),
        label,
        triggers: normalizeTriggers(null, label, []),
      };
    }
    if (!entry || typeof entry !== "object") return null;
    const label = String(entry.label || "").trim();
    if (!label) return null;
    return {
      id: entry.id || slugify(label),
      label,
      triggers: normalizeTriggers(
        entry.triggers,
        label,
        entry.aliases || []
      ),
    };
  }

  function getCatalog(vocab, vocabKey) {
    if (!vocab || !vocabKey) return [];
    ensureTermCatalog(vocab, vocabKey);
    return vocab.profiles?.[vocabKey] || [];
  }

  /** Build profiles from legacy string[] and keep vocab[key] labels in sync. */
  function ensureTermCatalog(vocab, vocabKey) {
    if (!vocab || !vocabKey) return vocab;
    if (!vocab.profiles) vocab.profiles = {};

    if (!Array.isArray(vocab.profiles[vocabKey])) {
      const legacy = vocab[vocabKey] || [];
      vocab.profiles[vocabKey] = legacy
        .map((x) =>
          typeof x === "string"
            ? normalizeTermProfile(x)
            : normalizeTermProfile(x)
        )
        .filter(Boolean);
    } else {
      vocab.profiles[vocabKey] = vocab.profiles[vocabKey]
        .map(normalizeTermProfile)
        .filter(Boolean);
    }

    vocab[vocabKey] = vocab.profiles[vocabKey]
      .map((p) => p.label)
      .sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" })
      );
    return vocab;
  }

  function ensureAllTermCatalogs(vocab) {
    if (!vocab) return vocab;
    for (const key of TERM_VOCAB_KEYS) {
      ensureTermCatalog(vocab, key);
    }
    return vocab;
  }

  function profileByLabel(vocab, vocabKey, label) {
    const q = String(label || "").trim().toLowerCase();
    return getCatalog(vocab, vocabKey).find(
      (p) => p.label.toLowerCase() === q
    );
  }

  function termMatches(text, term) {
    if (!term) return false;
    return new RegExp(`\\b${escapeRegex(term)}\\b`, "i").test(text);
  }

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
   * @returns {{ label: string, vocabKey: string, matchType: string, matchedTerm: string }[]}
   */
  function suggestFromCatalog(text, vocab, vocabKey, options = {}) {
    const hay = String(text || "");
    if (!hay.trim() || !vocabKey) return [];
    const selected = new Set(
      (options.alreadySelected || []).map((s) => String(s).toLowerCase())
    );
    const out = [];
    for (const profile of getCatalog(vocab, vocabKey)) {
      if (selected.has(profile.label.toLowerCase())) continue;
      const hit = matchProfile(hay, profile);
      if (hit) {
        out.push({
          label: profile.label,
          vocabKey,
          matchType: hit.matchType,
          matchedTerm: hit.matchedTerm,
        });
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }

  function getCatalogLabels(vocab, vocabKey) {
    return getCatalog(vocab, vocabKey).map((p) => p.label);
  }

  return {
    TERM_VOCAB_KEYS,
    FIELD_LABELS,
    normalizeTermProfile,
    ensureTermCatalog,
    ensureAllTermCatalogs,
    getCatalog,
    profileByLabel,
    suggestFromCatalog,
    getCatalogLabels,
    termMatches,
  };
});
