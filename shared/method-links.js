/**
 * Method relations: bidirectional links, markers UI, [[method:id|Label]] for doc text only.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof root !== "undefined") {
    root.LitLensMethodLinks = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const METHOD_LINK_RE =
    /^\[\[method:([^|\]\s]+)(?:\|([^\]]*))?\]\]$/i;
  const METHOD_LINK_INLINE_RE =
    /\[\[method:([^|\]\s]+)(?:\|([^\]]*))?\]\]/gi;

  /**
   * Relation types. Inverse rules:
   *   linked    → linked    (symmetric)
   *   requires  → linked    (A requires B → B gets A in "linked")
   *   analogous → analogous (symmetric)
   */
  const RELATION_SPECS = {
    linked: {
      id: "linked",
      label: "Linked",
      hint: "Used together",
      color: "#01696f",
      inverse: "linked",
      userPick: true,
    },
    requires: {
      id: "requires",
      label: "Requires",
      hint: "Needs this method first",
      color: "#b45309",
      inverse: "linked",
      userPick: true,
    },
    analogous: {
      id: "analogous",
      label: "Analogous",
      hint: "Similar or alternative approach",
      color: "#7c5cbf",
      inverse: "analogous",
      userPick: true,
    },
  };

  const DISPLAY_ORDER = ["linked", "requires", "analogous"];
  const PICK_TYPES = ["linked", "requires", "analogous"];

  function syncProfileRelations(profile, fromRef) {
    if (profile && fromRef && profile !== fromRef) {
      profile.relations = (fromRef.relations || []).map((r) => ({ ...r }));
    } else if (fromRef?.relations) {
      profile.relations = fromRef.relations.map((r) => ({ ...r }));
    }
  }

  function slugify(label) {
    return String(label || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48);
  }

  function getMP() {
    const g =
      typeof globalThis !== "undefined"
        ? globalThis
        : typeof window !== "undefined"
          ? window
          : null;
    return (g && g.LitLensMethodProfiles) || null;
  }

  function resolveVocab(vocab, options) {
    let v =
      vocab ||
      (typeof options?.getVocab === "function" ? options.getVocab() : null) ||
      (typeof window !== "undefined" && window.StructuredMeta?.getVocab
        ? window.StructuredMeta.getVocab()
        : null);
    const MP = getMP();
    if (v && MP) MP.ensureCatalog(v);
    return v;
  }

  async function loadVocab(vocab, options) {
    let v = resolveVocab(vocab, options);
    const MP = getMP();
    if (v?.methodCatalog?.length) return v;
    try {
      const origin =
        typeof window !== "undefined" && window.location?.origin
          ? window.location.origin
          : "";
      const res = await fetch(`${origin}/api/vocab`);
      if (!res.ok) throw new Error("Failed to load vocab");
      v = await res.json();
      if (MP) MP.ensureCatalog(v);
      options.onVocabReady?.(v);
      return v;
    } catch {
      return v || null;
    }
  }

  function methodLinkToken(profileOrLabel, labelOpt) {
    let id;
    let label;
    if (profileOrLabel && typeof profileOrLabel === "object") {
      label = String(profileOrLabel.label || "").trim();
      id = String(profileOrLabel.id || slugify(label)).trim();
    } else {
      label = String(profileOrLabel || labelOpt || "").trim();
      id = slugify(label);
    }
    if (!label) return "";
    return `[[method:${id}|${label}]]`;
  }

  function parseMethodLinkToken(text) {
    const raw = String(text || "")
      .trim()
      .replace(/[\u200B-\u200D\u2060]/g, "");
    let m = raw.match(METHOD_LINK_RE);
    if (!m) {
      m = raw.match(/\[\[method:([^|\]\s]+)(?:\|([^\]]*))?\]\]/i);
    }
    if (!m) return null;
    const id = m[1].trim();
    const label = (m[2] || "").trim();
    return { id, label: label || id };
  }

  function findInCatalog(vocab, idOrLabel) {
    const MP = getMP();
    if (!vocab || !MP) return null;
    // Only bootstrap the catalog when missing — avoid re-entering ensureCatalog
    // while it is already normalizing relations (infinite recursion).
    if (!Array.isArray(vocab.methodCatalog)) {
      MP.ensureCatalog(vocab);
    }
    const q = String(idOrLabel || "").trim().toLowerCase();
    if (!q) return null;
    return (
      vocab.methodCatalog.find(
        (p) =>
          p.id.toLowerCase() === q || p.label.toLowerCase() === q
      ) || null
    );
  }

  /** Profile in vocab.methodCatalog (canonical store for relations). */
  function profileInCatalog(vocab, profileOrLabel) {
    const label =
      typeof profileOrLabel === "string"
        ? profileOrLabel
        : profileOrLabel?.label;
    return findInCatalog(vocab, label);
  }

  function chipLabelText(chip) {
    if (!chip) return "";
    let s = "";
    for (const n of chip.childNodes) {
      if (n.nodeType === 3) s += n.textContent;
      else if (n.nodeType === 1 && !n.classList.contains("notion-chip-x")) {
        s += n.textContent;
      }
    }
    return s.trim();
  }

  function readLabelsFromRelationField(field) {
    if (!field) return [];
    if (typeof field._getLabels === "function") {
      const fromFn = field._getLabels();
      if (fromFn.length) return fromFn;
    }
    return [...field.querySelectorAll(".notion-chip")]
      .map(chipLabelText)
      .filter(Boolean);
  }

  /** Read chip labels grouped by relation type from the inline editor. */
  function readRelationsFromEditor(editorEl) {
    const out = {};
    if (!editorEl) return out;
    for (const field of editorEl.querySelectorAll(
      ".method-relations-field[data-relation-type]"
    )) {
      const typeId = field.dataset.relationType;
      if (!typeId) continue;
      out[typeId] = readLabelsFromRelationField(field);
    }
    return out;
  }

  function resolveTarget(vocab, idOrLabel, labelFallback) {
    const hit = findInCatalog(vocab, idOrLabel);
    if (hit) {
      return { targetId: hit.id, targetLabel: hit.label };
    }
    const label = String(labelFallback || idOrLabel || "").trim();
    if (!label) return null;
    return { targetId: slugify(label), targetLabel: label };
  }

  function normalizeRelationType(type) {
    return RELATION_SPECS[type] ? type : "linked";
  }

  function relationMeta(type) {
    return RELATION_SPECS[normalizeRelationType(type)] || RELATION_SPECS.linked;
  }

  function normalizeRelations(raw, vocab) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      let targetId = String(entry.targetId || entry.id || "").trim();
      let targetLabel = String(entry.targetLabel || entry.label || "").trim();
      if (!targetLabel && targetId) {
        const hit = findInCatalog(vocab, targetId);
        if (hit) {
          targetId = hit.id;
          targetLabel = hit.label;
        }
      }
      if (!targetLabel) continue;
      const resolved = resolveTarget(vocab, targetId || targetLabel, targetLabel);
      if (!resolved) continue;
      const type = normalizeRelationType(entry.type || entry.relation);
      const key = `${type}:${resolved.targetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...resolved, type });
    }
    return out;
  }

  function hasRelation(profile, targetId, type) {
    return (profile.relations || []).some(
      (r) => r.targetId === targetId && r.type === type
    );
  }

  function addOneRelation(profile, target, type) {
    if (!profile.relations) profile.relations = [];
    if (hasRelation(profile, target.id, type)) return;
    profile.relations.push({
      targetId: target.id,
      targetLabel: target.label,
      type,
    });
  }

  function removeOneRelation(profile, targetId, type) {
    if (!profile.relations) return;
    profile.relations = profile.relations.filter(
      (r) => !(r.targetId === targetId && r.type === type)
    );
  }

  /** Add link on both methods (bidirectional). Mutates profiles inside vocab. */
  function addRelationPair(vocab, fromProfileOrLabel, toLabel, type) {
    const spec = RELATION_SPECS[type];
    if (!spec?.userPick || !vocab) return { ok: false, reason: "invalid" };
    const fromLabel =
      typeof fromProfileOrLabel === "string"
        ? fromProfileOrLabel
        : fromProfileOrLabel?.label;
    const fromProfile = findInCatalog(vocab, fromLabel);
    const toProfile = findInCatalog(vocab, toLabel);
    if (!fromProfile || !toProfile) return { ok: false, reason: "not_found" };
    if (
      fromProfile.id === toProfile.id ||
      fromProfile.label.toLowerCase() === toProfile.label.toLowerCase()
    ) {
      return { ok: false, reason: "self" };
    }
    if (hasRelation(fromProfile, toProfile.id, spec.id)) {
      return { ok: false, reason: "duplicate" };
    }
    addOneRelation(fromProfile, toProfile, spec.id);
    addOneRelation(toProfile, fromProfile, spec.inverse);
    fromProfile.relations = normalizeRelations(fromProfile.relations, vocab);
    toProfile.relations = normalizeRelations(toProfile.relations, vocab);
    return { ok: true, fromProfile, toProfile, vocab };
  }

  /** Remove link on both methods. */
  function removeRelationPair(vocab, fromProfile, targetId, type) {
    const spec = relationMeta(type);
    const toProfile = findInCatalog(vocab, targetId);
    if (!fromProfile) return;
    removeOneRelation(fromProfile, targetId, type);
    if (toProfile) {
      removeOneRelation(toProfile, fromProfile.id, spec.inverse);
      toProfile.relations = normalizeRelations(toProfile.relations, vocab);
    }
    fromProfile.relations = normalizeRelations(fromProfile.relations, vocab);
  }

  function groupRelations(relations) {
    const groups = {};
    for (const id of DISPLAY_ORDER) groups[id] = [];
    for (const r of relations || []) {
      const type = normalizeRelationType(r.type);
      if (!groups[type]) groups[type] = [];
      groups[type].push(r);
    }
    return groups;
  }

  function searchCatalog(vocab, query, excludeProfile) {
    const MP = getMP();
    if (!vocab || !MP) return [];
    MP.ensureCatalog(vocab);
    const q = String(query || "").trim().toLowerCase();
    const selfId = excludeProfile?.id;
    return vocab.methodCatalog
      .filter((p) => {
        if (selfId && p.id === selfId) return false;
        if (!q) return true;
        return (
          p.label.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q)
        );
      })
      .sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
      )
      .slice(0, 24);
  }

  /**
   * Read-only: all relation rows on this profile (including inverse types
   * such as requiredFor, which are stored on the target after linking).
   */
  function buildRelationsReadOnly(profile, vocab, options = {}) {
    const wrap = document.createElement("div");
    wrap.className = "method-relations-readonly";
    profile = profileInCatalog(vocab, profile) || profile;
    if (!profile) {
      const empty = document.createElement("p");
      empty.className = "meta-hint";
      empty.textContent = "No linked methods — press ✎ to add.";
      wrap.appendChild(empty);
      return wrap;
    }
    if (!profile.relations) profile.relations = [];
    profile.relations = normalizeRelations(profile.relations, vocab);
    const groups = groupRelations(profile.relations);
    let any = false;
    for (const typeId of DISPLAY_ORDER) {
      const list = groups[typeId];
      if (!list?.length) continue;
      any = true;
      const spec = RELATION_SPECS[typeId];
      const row = document.createElement("div");
      row.className = "method-relations-readonly-row";
      const lab = document.createElement("span");
      lab.className = "method-relations-type-tag";
      lab.textContent = spec.label;
      row.appendChild(lab);
      const names = document.createElement("span");
      names.className = "method-relations-readonly-names";
      for (let i = 0; i < list.length; i++) {
        const rel = list[i];
        if (options.onOpenMethod) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "method-relation-link";
          btn.textContent = rel.targetLabel;
          btn.addEventListener("click", () => options.onOpenMethod(rel.targetLabel));
          names.appendChild(btn);
          if (i < list.length - 1) {
            names.appendChild(document.createTextNode(", "));
          }
        } else {
          names.appendChild(document.createTextNode(
            rel.targetLabel + (i < list.length - 1 ? ", " : "")
          ));
        }
      }
      row.appendChild(names);
      wrap.appendChild(row);
    }
    if (!any) {
      const empty = document.createElement("p");
      empty.className = "meta-hint";
      empty.textContent = "No linked methods — press ✎ to add.";
      wrap.appendChild(empty);
    }
    return wrap;
  }

  /**
   * One relation type field: tracks labels locally (sync), no DB on click.
   * DB is updated only when the parent calls applyRelationsFromEditor().
   */
  function createRelationField(typeId, initialLabels, spec, getVocabFn) {
    const group = document.createElement("div");
    group.className = "method-relations-field";
    group.dataset.relationType = typeId;

    const lab = document.createElement("label");
    lab.className = "method-relations-field-label";
    lab.textContent = spec.label;
    group.appendChild(lab);

    const inner = document.createElement("div");
    inner.className = "notion-select-inner";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "notion-select-input";
    input.placeholder = "Method name…";
    input.autocomplete = "off";

    // local state: Set of current labels
    const labels = new Set(initialLabels);

    // dropdown lives in body so overflow/stacking never clips it
    const dd = document.createElement("div");
    dd.style.cssText =
      "display:none;position:fixed;z-index:99999;" +
      "background:var(--color-surface-2);border:1px solid var(--color-border);" +
      "border-radius:var(--radius-md);box-shadow:var(--shadow-lg);" +
      "min-width:200px;max-height:200px;overflow-y:auto;";
    document.body.appendChild(dd);

    let ddOpen = false;

    function pos() {
      const r = inner.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 6;
      const above = r.top - 6;
      dd.style.width = Math.max(200, r.width) + "px";
      dd.style.left = Math.max(4, r.left) + "px";
      if (below >= 100 || below >= above) {
        dd.style.top = (r.bottom + 2) + "px";
        dd.style.bottom = "auto";
        dd.style.maxHeight = Math.max(80, below) + "px";
      } else {
        dd.style.bottom = (window.innerHeight - r.top + 2) + "px";
        dd.style.top = "auto";
        dd.style.maxHeight = Math.max(80, above) + "px";
      }
    }

    function showDd() { ddOpen = true; dd.style.display = "block"; pos(); }
    function hideDd() { ddOpen = false; dd.style.display = "none"; }

    function renderChips() {
      inner.querySelectorAll(".notion-chip").forEach((c) => c.remove());
      for (const label of labels) {
        const chip = document.createElement("span");
        chip.className = "notion-chip";
        chip.appendChild(document.createTextNode(label));
        const x = document.createElement("button");
        x.type = "button";
        x.className = "notion-chip-x";
        x.textContent = "×";
        x.addEventListener("click", (e) => {
          e.stopPropagation();
          labels.delete(label);
          renderChips();
        });
        chip.appendChild(x);
        inner.insertBefore(chip, input);
      }
    }

    // SYNC: just add to Set, render chip, done
    function addLabel(label) {
      const t = String(label || "").trim();
      if (!t || labels.has(t)) return;
      labels.add(t);
      input.value = "";
      renderChips();
      hideDd();
      input.focus();
    }

    function renderList() {
      dd.replaceChildren();
      const v = getVocabFn?.();
      const q = input.value.toLowerCase();
      const hits = v?.methodCatalog
        ? v.methodCatalog
            .filter((p) => !labels.has(p.label))
            .filter((p) => !q || p.label.toLowerCase().includes(q))
            .slice(0, 40)
        : [];

      if (!hits.length) {
        const msg = document.createElement("div");
        msg.style.cssText = "padding:8px 10px;font-size:11px;color:var(--color-text-faint)";
        msg.textContent = v ? (q ? "No matches" : "Type to search") : "Loading catalog…";
        dd.appendChild(msg);
        return;
      }
      for (const hit of hits) {
        const row = document.createElement("button");
        row.type = "button";
        row.style.cssText =
          "display:block;width:100%;text-align:left;padding:7px 12px;" +
          "font-size:11px;font-weight:500;border:none;background:transparent;" +
          "cursor:pointer;color:var(--color-text)";
        row.textContent = hit.label;
        row.addEventListener("mouseover", () => { row.style.background = "var(--color-surface-dynamic)"; });
        row.addEventListener("mouseout",  () => { row.style.background = "transparent"; });
        // mousedown + preventDefault = input keeps focus, then addLabel runs (pure sync)
        row.addEventListener("mousedown", (e) => { e.preventDefault(); addLabel(hit.label); });
        dd.appendChild(row);
      }
    }

    inner.addEventListener("mousedown", (e) => { e.stopPropagation(); input.focus(); renderList(); showDd(); });
    input.addEventListener("focus",  () => { renderList(); showDd(); });
    input.addEventListener("blur",   () => { setTimeout(hideDd, 120); });
    input.addEventListener("input",  () => { renderList(); if (!ddOpen) showDd(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const first = dd.querySelector("button");
        if (first) addLabel(first.textContent.trim());
      } else if (e.key === "Escape") {
        hideDd(); input.blur();
      }
    });

    const onScroll = () => { if (ddOpen) pos(); };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);

    // cleanup on DOM removal
    const obs = new MutationObserver(() => {
      if (!document.contains(group)) {
        dd.remove(); obs.disconnect();
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", onScroll);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    inner.appendChild(input);
    group.appendChild(inner);
    renderChips();

    /** Returns the current set of labels in this field. */
    group._getLabels = () => [...labels];
    return group;
  }

  /**
   * Three relation fields (Linked / Requires / Analogous).
   * Click = instant chip. DB update happens only when applyRelationsFromEditor is called.
   * @param {object} profile
   * @param {() => object} getVocabFn  - optional, returns current vocab for suggestions
   */
  function buildRelationsEditor(profile, getVocabFn) {
    if (!profile.relations) profile.relations = [];
    const groups = groupRelations(profile.relations);
    const wrap = document.createElement("div");
    wrap.className = "method-relations-editor";
    for (const typeId of PICK_TYPES) {
      const initial = (groups[typeId] || []).map((r) => r.targetLabel);
      wrap.appendChild(
        createRelationField(typeId, initial, RELATION_SPECS[typeId], getVocabFn)
      );
    }
    return wrap;
  }

  /**
   * Apply chip labels from the editor to vocab.methodCatalog (canonical store).
   * @param {HTMLElement} editorEl
   * @param {object} vocab
   * @param {string} methodLabel — label of the method being edited
   * @returns {object|null} catalog profile after update
   */
  function applyRelationsFromEditor(editorEl, vocab, methodLabel) {
    if (!editorEl || !vocab) return null;
    const label = String(methodLabel || "").trim();
    if (!label) return null;

    // Bootstrap catalog only if missing — do NOT call ensureCatalog after
    // mutations because it replaces every object in methodCatalog with new
    // copies (via normalizeProfile), which would discard everything we wrote.
    if (!Array.isArray(vocab.methodCatalog)) {
      const MP = getMP();
      if (MP) MP.ensureCatalog(vocab);
    }

    const fromRef = findInCatalog(vocab, label);
    if (!fromRef) return null;

    const chipsByType = readRelationsFromEditor(editorEl);

    for (const typeId of PICK_TYPES) {
      const spec = RELATION_SPECS[typeId];
      if (!spec?.userPick) continue;

      const newLabels = chipsByType[typeId] || [];
      const newLabelsLower = new Set(
        newLabels.map((l) => String(l).trim().toLowerCase()).filter(Boolean)
      );
      // snapshot before we start mutating
      const existingRels = (fromRef.relations || [])
        .filter((r) => normalizeRelationType(r.type) === typeId)
        .slice();

      // remove ones that were deleted
      for (const rel of existingRels) {
        if (!newLabelsLower.has(rel.targetLabel.toLowerCase())) {
          removeRelationPair(vocab, fromRef, rel.targetId, typeId);
        }
      }

      // add new ones
      for (const chipLabel of newLabels) {
        const trimmed = String(chipLabel || "").trim();
        if (!trimmed) continue;
        const already = (fromRef.relations || []).some(
          (r) =>
            normalizeRelationType(r.type) === typeId &&
            r.targetLabel.toLowerCase() === trimmed.toLowerCase()
        );
        if (already) continue;

        const result = addRelationPair(vocab, label, trimmed, typeId);
        // if target isn't in catalog, add it locally on this profile only
        if (!result.ok && result.reason === "not_found") {
          const resolved = resolveTarget(vocab, trimmed, trimmed);
          if (resolved) {
            addOneRelation(
              fromRef,
              { id: resolved.targetId, label: resolved.targetLabel },
              typeId
            );
          }
        }
      }
    }

    // Normalize in-place (doesn't replace the object itself)
    fromRef.relations = normalizeRelations(fromRef.relations, vocab);
    return fromRef;
  }

  function getPassageLinks() {
    const g =
      typeof globalThis !== "undefined"
        ? globalThis
        : typeof window !== "undefined"
          ? window
          : null;
    return (g && g.LitLensPassageLinks) || null;
  }

  function normalizeDocText(text) {
    const PL = getPassageLinks();
    return PL?.normalizeCiteSourceText
      ? PL.normalizeCiteSourceText(text)
      : String(text || "");
  }

  function hasMethodLinkMarkup(text) {
    METHOD_LINK_INLINE_RE.lastIndex = 0;
    return METHOD_LINK_INLINE_RE.test(normalizeDocText(text));
  }

  function findAllMethodLinkMatches(hay) {
    const matches = [];
    METHOD_LINK_INLINE_RE.lastIndex = 0;
    let m;
    while ((m = METHOD_LINK_INLINE_RE.exec(hay))) {
      matches.push({
        index: m.index,
        lastIndex: METHOD_LINK_INLINE_RE.lastIndex,
        raw: m[0],
        kind: "method",
        id: m[1].trim(),
        label: (m[2] || "").trim() || m[1].trim(),
      });
    }
    return matches;
  }

  function mergedDocParts(text, citeStore, vocab) {
    const hay = normalizeDocText(text);
    const PL = getPassageLinks();
    const citeMatches = PL?.findAllCiteMatches
      ? PL.findAllCiteMatches(hay)
      : [];
    const methodMatches = findAllMethodLinkMatches(hay);
    const spans = [...citeMatches, ...methodMatches].sort(
      (a, b) => a.index - b.index
    );
    const parts = [];
    let last = 0;
    for (const span of spans) {
      if (span.index < last) continue;
      if (span.index > last) {
        parts.push({ type: "text", value: hay.slice(last, span.index) });
      }
      if (span.kind === "method") {
        const profile =
          findInCatalog(vocab, span.id) || findInCatalog(vocab, span.label);
        parts.push({
          type: "method",
          id: span.id,
          label: span.label,
          methodLabel: profile?.label || span.label,
          missing: !profile,
          raw: span.raw,
        });
      } else if (span.kind === "ref") {
        const stored =
          typeof citeStore?.get === "function"
            ? citeStore.get(span.citeId)
            : citeStore?.[span.citeId];
        parts.push({
          type: "cite",
          citeId: span.citeId,
          articleId: stored?.articleId,
          offset: stored?.offset,
          length: stored?.length,
          quote: stored?.quote || "",
          label: span.label || stored?.label || "",
          missing: !stored?.articleId,
          raw: span.raw,
        });
      } else {
        parts.push({
          type: "cite",
          articleId: span.articleId,
          offset: span.offset,
          length: span.length,
          label: span.label,
          quote: span.quote,
          raw: span.raw,
        });
      }
      last = span.lastIndex;
    }
    if (last < hay.length) parts.push({ type: "text", value: hay.slice(last) });
    return parts;
  }

  function appendTextWithBreaks(frag, text) {
    const lines = String(text || "").split("\n");
    lines.forEach((line, i) => {
      if (i > 0) frag.appendChild(document.createElement("br"));
      if (line) frag.appendChild(document.createTextNode(line));
    });
  }

  function renderMethodDocFragment(text, options = {}) {
    const {
      articlesById,
      onCiteClick,
      citeStore,
      vocab,
      onMethodClick,
    } = options;
    const PL = getPassageLinks();
    const frag = document.createDocumentFragment();
    const parts = mergedDocParts(text, citeStore, vocab);
    if (!parts.length && !text) return frag;

    for (const part of parts) {
      if (part.type === "text") {
        appendTextWithBreaks(frag, part.value);
        continue;
      }
      if (part.type === "method") {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "method-cite-link method-ref-link";
        if (part.missing) btn.classList.add("method-cite-link--missing");
        btn.textContent = part.methodLabel || part.label || part.id;
        btn.title = part.missing
          ? "Method not in catalog"
          : `Open method: ${part.methodLabel}`;
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          if (part.missing) return;
          onMethodClick?.(part.methodLabel);
        });
        frag.appendChild(btn);
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
        part.label?.trim() ||
        (PL?.formatArticleCite ? PL.formatArticleCite(article) : "") ||
        part.citeId ||
        "cite";
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

  async function copyMethodLinkToClipboard(profile) {
    const token = methodLinkToken(profile);
    if (!token) return false;
    try {
      await navigator.clipboard.writeText(token);
      return true;
    } catch {
      const ta = document.createElement("textarea");
      ta.value = token;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    }
  }

  return {
    RELATION_SPECS,
    DISPLAY_ORDER,
    PICK_TYPES,
    methodLinkToken,
    parseMethodLinkToken,
    hasMethodLinkMarkup,
    renderMethodDocFragment,
    findInCatalog,
    resolveTarget,
    normalizeRelations,
    normalizeRelationType,
    relationMeta,
    groupRelations,
    addRelationPair,
    removeRelationPair,
    searchCatalog,
    profileInCatalog,
    readRelationsFromEditor,
    buildRelationsReadOnly,
    buildRelationsEditor,
    applyRelationsFromEditor,
    copyMethodLinkToClipboard,
  };
});
