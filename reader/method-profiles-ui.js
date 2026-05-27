/** Method catalog (Methods map → Catalog) — edit locally, save with ✓ button only. */
(function () {
  const API = `${location.origin}/api`;
  const MP = () => window.LitLensMethodProfiles;
  const ML = () => window.LitLensMethodLinks;

  let vocab = null;
  let dirty = false;
  let saveInFlight = false;
  let expandedId = null;
  let settingsLoaded = false;
  /** Method ids added this session — stay on top until catalog ✓ save */
  const pendingNewMethodIds = new Set();

  function $(id) {
    return document.getElementById(id);
  }

  function getHighlightTerms() {
    const MPapi = MP();
    if (!MPapi) return new Set();
    const doc =
      typeof window.litlensGetTermsDoc === "function"
        ? window.litlensGetTermsDoc()
        : null;
    return MPapi.collectHighlightTerms(doc);
  }

  async function fetchVocab() {
    const res = await fetch(`${API}/vocab`);
    if (!res.ok) throw new Error("Failed to load vocab");
    vocab = await res.json();
    MP()?.ensureCatalog(vocab);
    return vocab;
  }

  function setSaveStatus(text, isError) {
    const el = $("method-profiles-save-status");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("error", Boolean(isError));
  }

  function updateSaveButton() {
    const btn = $("method-catalog-save-btn");
    if (!btn) return;
    btn.disabled = !dirty || saveInFlight;
    btn.classList.toggle("method-catalog-save-btn--dirty", dirty && !saveInFlight);
  }

  function markDirty() {
    dirty = true;
    setSaveStatus("Unsaved changes — press ✓ to save");
    updateSaveButton();
  }

  function markClean() {
    dirty = false;
    updateSaveButton();
  }

  function applyLabelFromInput(profile, labelInp) {
    const next = labelInp.value.trim();
    if (!next || next === profile.label) return true;
    const dup = vocab.methodCatalog.some(
      (p) => p.id !== profile.id && p.label.toLowerCase() === next.toLowerCase()
    );
    if (dup) {
      setSaveStatus("A method with this name already exists.", true);
      labelInp.value = profile.label;
      return false;
    }
    const oldLabel = profile.label;
    profile.label = next;
    const prevId = profile.id;
    profile.id = MP().slugify(next) || profile.id;
    if (pendingNewMethodIds.has(prevId)) {
      pendingNewMethodIds.delete(prevId);
      pendingNewMethodIds.add(profile.id);
    }
    if (expandedId === prevId) expandedId = profile.id;
    if (profile.triggers.direct[0] === oldLabel) {
      profile.triggers.direct[0] = next;
    } else if (!profile.triggers.direct.includes(next)) {
      profile.triggers.direct.unshift(next);
    }
    sortCatalog();
    return true;
  }

  /** Read open row inputs into vocab before save. */
  function flushPendingEdits() {
    if (!expandedId) return;
    const row = document.querySelector(
      `.method-catalog-row[data-id="${CSS.escape(expandedId)}"]`
    );
    const profile = findProfile(expandedId);
    if (!row || !profile) return;

    const labelInp = row.querySelector(".profile-label-input");
    if (labelInp) applyLabelFromInput(profile, labelInp);

    if (ML()) {
      profile.relations = ML().normalizeRelations(profile.relations, vocab);
    }

    const variantsWrap = row.querySelector(".profile-variant-list");
    if (variantsWrap) {
      profile.variants = MP().normalizeVariants(
        [...variantsWrap.querySelectorAll(".profile-variant-row input")].map(
          (inp) => inp.value
        )
      );
    }
  }

  async function persistVocab() {
    if (!vocab || saveInFlight) return;
    flushPendingEdits();
    MP()?.ensureCatalog(vocab);
    saveInFlight = true;
    updateSaveButton();
    setSaveStatus("Saving…");
    try {
      const res = await fetch(`${API}/vocab`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vocab),
      });
      if (!res.ok) throw new Error("Save failed");
      vocab = await res.json();
      MP()?.ensureCatalog(vocab);
      pendingNewMethodIds.clear();
      sortCatalog();
      markClean();
      setSaveStatus("Saved");
      if (window.StructuredMeta?.reloadVocab) {
        await window.StructuredMeta.reloadVocab();
      }
      if (window.LitLensMethodsMap?.isOpen?.()) {
        void window.LitLensMethodsMap.refresh();
      }
      updateAllSummaries();
    } catch (e) {
      markDirty();
      setSaveStatus(e.message || "Could not save", true);
    } finally {
      saveInFlight = false;
      updateSaveButton();
    }
  }

  function sortCatalog() {
    if (!vocab?.methodCatalog) return;
    const drafts = [];
    const saved = [];
    for (const p of vocab.methodCatalog) {
      if (pendingNewMethodIds.has(p.id)) drafts.push(p);
      else saved.push(p);
    }
    saved.sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
    );
    vocab.methodCatalog = [...drafts, ...saved];
    vocab.methods = vocab.methodCatalog.map((p) => p.label);
  }

  function addNewMethod() {
    const MPapi = MP();
    if (!MPapi || !vocab) return;
    let label = "New method";
    let n = 1;
    const labels = new Set(
      vocab.methodCatalog.map((p) => p.label.toLowerCase())
    );
    while (labels.has(label.toLowerCase())) {
      n += 1;
      label = `New method ${n}`;
    }
    const profile = MPapi.normalizeProfile({ label });
    vocab.methodCatalog.unshift(profile);
    pendingNewMethodIds.add(profile.id);
    expandedId = profile.id;
    render();
    markDirty();
  }

  function findProfile(id) {
    return vocab.methodCatalog.find((p) => p.id === id);
  }

  function updateRowSummary(profileId) {
    const row = document.querySelector(
      `.method-catalog-row[data-id="${CSS.escape(profileId)}"]`
    );
    if (!row) return;
    const profile = findProfile(profileId);
    if (!profile) return;
    const nameEl = row.querySelector(".method-catalog-name");
    if (nameEl) nameEl.textContent = profile.label;
    const badges = row.querySelector(".method-catalog-badges");
    if (badges) renderSummaryBadges(profile, badges);
    row.classList.toggle(
      "method-catalog-row--framework",
      MP().hasFrameworkModality(profile.modalities)
    );
    row.classList.toggle(
      "method-catalog-row--derived",
      MP().hasDerivedModality(profile.modalities)
    );
  }

  function updateAllSummaries() {
    for (const p of vocab.methodCatalog || []) {
      updateRowSummary(p.id);
    }
  }

  function splitTriggerPhrases(raw) {
    return String(raw || "")
      .split(/[,;\n]+/)
      .map((t) => t.trim())
      .filter(Boolean);
  }

  /** @returns {{ ok: boolean, reason?: string }} */
  function addTriggerTerm(profile, kind, raw) {
    const term = raw.trim();
    if (!term) return { ok: false, reason: "empty" };
    const list = profile.triggers[kind];
    const pool = kind === "direct" ? list : [...list, profile.label];
    const exists = pool.some((x) => x.toLowerCase() === term.toLowerCase());
    if (exists) return { ok: false, reason: "duplicate" };
    list.push(term);
    list.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    return { ok: true };
  }

  function addTriggerPhrases(profile, kind, raw) {
    const parts = splitTriggerPhrases(raw);
    let added = 0;
    for (const part of parts) {
      if (addTriggerTerm(profile, kind, part).ok) added += 1;
    }
    return added;
  }

  function getTriggerChipTerms(profile, kind) {
    if (kind === "direct") {
      return (profile.triggers.direct || []).filter(
        (t) => t.toLowerCase() !== profile.label.toLowerCase()
      );
    }
    return [...(profile.triggers[kind] || [])];
  }

  function removeTriggerTerm(profile, kind, term) {
    profile.triggers[kind] = (profile.triggers[kind] || []).filter((t) => t !== term);
  }

  function renderTriggerChips(profile, kind, wrap, options = {}) {
    const { onChanged, focusInput = false } = options;
    wrap.replaceChildren();
    const terms = getTriggerChipTerms(profile, kind);

    for (const term of terms) {
      const chip = document.createElement("span");
      chip.className = "profile-alias-chip";
      chip.appendChild(document.createTextNode(term));
      const x = document.createElement("button");
      x.type = "button";
      x.className = "profile-alias-chip-x";
      x.textContent = "×";
      x.addEventListener("click", () => {
        removeTriggerTerm(profile, kind, term);
        renderTriggerChips(profile, kind, wrap, { onChanged, focusInput: true });
        onChanged?.();
      });
      chip.appendChild(x);
      wrap.appendChild(chip);
    }

    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "profile-alias-inline-input";
    inp.placeholder = terms.length ? "" : "Type phrase, Enter…";
    inp.setAttribute("aria-label", "Add phrase");

    const commit = () => {
      const raw = inp.value.trim();
      if (!raw) return;
      const parts = splitTriggerPhrases(raw);
      if (parts.length > 1) {
        const added = addTriggerPhrases(profile, kind, raw);
        inp.value = "";
        if (added) {
          renderTriggerChips(profile, kind, wrap, { onChanged, focusInput: true });
          onChanged?.();
        } else {
          setSaveStatus("Already in list.", true);
          inp.focus();
        }
        return;
      }
      const term = raw.replace(/,+$/g, "");
      const result = addTriggerTerm(profile, kind, term);
      if (!result.ok) {
        if (result.reason === "duplicate") {
          setSaveStatus("Already in list.", true);
        }
        inp.focus();
        inp.select();
        return;
      }
      inp.value = "";
      renderTriggerChips(profile, kind, wrap, { onChanged, focusInput: true });
      onChanged?.();
    };

    inp.addEventListener("paste", (e) => {
      const text = e.clipboardData?.getData("text/plain") || "";
      if (!/[,;\n]/.test(text)) return;
      e.preventDefault();
      const added = addTriggerPhrases(profile, kind, text);
      inp.value = "";
      renderTriggerChips(profile, kind, wrap, { onChanged, focusInput: true });
      if (added) onChanged?.();
      else if (splitTriggerPhrases(text).length) {
        setSaveStatus("Already in list.", true);
      }
    });

    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        commit();
        return;
      }
      if (e.key === "Backspace" && !inp.value && terms.length) {
        e.preventDefault();
        const last = terms[terms.length - 1];
        removeTriggerTerm(profile, kind, last);
        renderTriggerChips(profile, kind, wrap, { onChanged, focusInput: true });
        onChanged?.();
      }
    });
    inp.addEventListener("blur", () => {
      if (inp.value.trim()) commit();
    });

    wrap.appendChild(inp);
    if (focusInput) {
      requestAnimationFrame(() => inp.focus());
    }
  }

  function renderVariantRows(profile, wrap, options = {}) {
    const onDirty = options.onDirty || (() => markDirty());
    wrap.replaceChildren();
    if (!Array.isArray(profile.variants)) profile.variants = [];
    profile.variants.forEach((text, rowIdx) => {
      const row = document.createElement("div");
      row.className = "profile-variant-row";
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "form-input profile-alias-input";
      inp.value = text;
      inp.placeholder = "Variant name or description";
      inp.addEventListener("input", onDirty);
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn-sm btn-ghost";
      del.textContent = "×";
      del.title = "Remove variant";
      del.addEventListener("mousedown", (e) => e.preventDefault());
      del.addEventListener("click", () => {
        profile.variants.splice(rowIdx, 1);
        renderVariantRows(profile, wrap, options);
        onDirty();
      });
      row.append(inp, del);
      wrap.appendChild(row);
    });
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn-sm btn-ghost profile-variant-add";
    addBtn.textContent = "+ Variant";
    addBtn.addEventListener("click", () => {
      profile.variants.push("");
      renderVariantRows(profile, wrap, options);
      onDirty();
      const firstInp = wrap.querySelector(".profile-variant-row input");
      firstInp?.focus();
    });
    wrap.appendChild(addBtn);
  }

  function renderConflictNote(profile, noteEl) {
    const MPapi = MP();
    if (!MPapi || !noteEl) return;
    const conflicts = MPapi.triggerConflictsWithHighlights(
      profile,
      getHighlightTerms()
    );
    noteEl.replaceChildren();
    if (!conflicts.length) return;
    const p = document.createElement("p");
    p.className = "profile-conflict-hint";
    p.textContent = `Also in Terms (highlights): ${conflicts.join(", ")} — catalog triggers are separate but may overlap in text.`;
    noteEl.appendChild(p);
  }

  function renderSummaryBadges(profile, wrap) {
    wrap.replaceChildren();
    for (const mod of profile.modalities || []) {
      const b = document.createElement("span");
      let badgeClass = "method-badge method-badge-mod";
      if (mod === "FRAMEWORK") badgeClass += " method-badge-framework";
      else if (mod === "DERIVED") badgeClass += " method-badge-derived";
      b.className = badgeClass;
      b.textContent = mod;
      wrap.appendChild(b);
    }
    if (profile.category && MP().usesMethodCategory(profile.modalities)) {
      const b = document.createElement("span");
      b.className = "method-badge method-badge-cat";
      b.textContent = profile.category;
      wrap.appendChild(b);
    }
    if (!profile.modalities?.length && !profile.category) {
      const b = document.createElement("span");
      b.className = "method-badge method-badge-empty";
      b.textContent = "no attributes";
      wrap.appendChild(b);
    }
  }

  function renderProfileRow(profile) {
    const row = document.createElement("div");
    row.className = "method-catalog-row";
    row.dataset.id = profile.id;
    if (MP().hasFrameworkModality(profile.modalities)) {
      row.classList.add("method-catalog-row--framework");
    }
    if (MP().hasDerivedModality(profile.modalities)) {
      row.classList.add("method-catalog-row--derived");
    }
    const isOpen = expandedId === profile.id;
    if (isOpen) row.classList.add("method-catalog-row--open");

    const summary = document.createElement("button");
    summary.type = "button";
    summary.className = "method-catalog-summary";
    summary.setAttribute("aria-expanded", isOpen ? "true" : "false");

    const name = document.createElement("span");
    name.className = "method-catalog-name";
    name.textContent = profile.label;

    const badges = document.createElement("span");
    badges.className = "method-catalog-badges";
    renderSummaryBadges(profile, badges);

    const chevron = document.createElement("span");
    chevron.className = "method-catalog-chevron";
    chevron.textContent = isOpen ? "▾" : "▸";

    const copyLinkBtn = document.createElement("button");
    copyLinkBtn.type = "button";
    copyLinkBtn.className = "method-catalog-copy-link";
      copyLinkBtn.title = "Copy [[method:…]] for text fields (Definition, etc.)";
    copyLinkBtn.textContent = "⎘";
    copyLinkBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const links = ML();
      if (!links) return;
      void links.copyMethodLinkToClipboard(profile).then((ok) => {
        setSaveStatus(
          ok ? "Link copied — paste into text fields" : "Could not copy",
          !ok
        );
        if (ok) window.setTimeout(() => setSaveStatus(""), 2000);
      });
    });

    summary.append(name, badges, copyLinkBtn, chevron);
    summary.addEventListener("click", () => {
      if (isOpen) flushPendingEdits();
      else if (expandedId) flushPendingEdits();
      expandedId = isOpen ? null : profile.id;
      render();
    });

    row.appendChild(summary);

    if (isOpen) {
      const detail = document.createElement("div");
      detail.className = "method-catalog-detail";

      const labelRow = document.createElement("div");
      labelRow.className = "profile-detail-field";
      const labelLbl = document.createElement("label");
      labelLbl.textContent = "Name";
      const labelInp = document.createElement("input");
      labelInp.type = "text";
      labelInp.className = "form-input profile-label-input";
      labelInp.value = profile.label;
      labelInp.addEventListener("input", () => markDirty());
      labelRow.append(labelLbl, labelInp);

      const modRow = document.createElement("div");
      modRow.className = "profile-detail-field profile-mod-row";
      const modLbl = document.createElement("span");
      modLbl.className = "profile-alias-label";
      modLbl.textContent = "Modalities";
      const modChecks = document.createElement("div");
      modChecks.className = "profile-mod-checks";
      const syncCategoryField = () => {
        const showCat = MP().usesMethodCategory(profile.modalities);
        catRow.hidden = !showCat;
        if (!showCat) {
          profile.category = "";
          catSel.value = "";
        }
        updateRowSummary(profile.id);
      };

      for (const mod of MP().MODALITIES) {
        const lab = document.createElement("label");
        lab.className = "profile-mod-check";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = profile.modalities.includes(mod);
        cb.addEventListener("change", () => {
          if (cb.checked) {
            if (!profile.modalities.includes(mod)) profile.modalities.push(mod);
          } else {
            profile.modalities = profile.modalities.filter((m) => m !== mod);
          }
          syncCategoryField();
          markDirty();
        });
        lab.append(cb, document.createTextNode(mod));
        modChecks.appendChild(lab);
      }
      modRow.append(modLbl, modChecks);

      const catRow = document.createElement("div");
      catRow.className = "profile-detail-field";
      const catLbl = document.createElement("label");
      catLbl.textContent = "Category (one)";
      const catSel = document.createElement("select");
      catSel.className = "form-input profile-cat-select";
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "—";
      catSel.appendChild(empty);
      for (const c of MP().CATEGORIES) {
        const opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        if (profile.category === c) opt.selected = true;
        catSel.appendChild(opt);
      }
      catSel.addEventListener("change", () => {
        profile.category = catSel.value;
        updateRowSummary(profile.id);
        markDirty();
      });
      catRow.append(catLbl, catSel);
      syncCategoryField();

      const conflictNote = document.createElement("div");
      renderConflictNote(profile, conflictNote);

      function triggerBlock(title, hint, kind) {
        const block = document.createElement("div");
        block.className = "profile-trigger-block";
        const h = document.createElement("div");
        h.className = "profile-trigger-head";
        const t = document.createElement("span");
        t.className = "profile-alias-label";
        t.textContent = title;
        const sub = document.createElement("span");
        sub.className = "profile-trigger-hint";
        sub.textContent = hint;
        h.append(t, sub);
        const chips = document.createElement("div");
        chips.className = "profile-alias-chips profile-alias-chips--editable";
        const onTriggerChanged = () => {
          renderConflictNote(profile, conflictNote);
          markDirty();
        };
        renderTriggerChips(profile, kind, chips, { onChanged: onTriggerChanged });
        block.append(h, chips);
        return block;
      }

      const directBlock = triggerBlock("Direct", "exact word match", "direct");
      const indirectBlock = triggerBlock("Indirect", "related wording", "indirect");

      const foot = document.createElement("div");
      foot.className = "method-catalog-detail-foot";
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn-sm btn-ghost profile-del-btn";
      delBtn.textContent = "Delete method";
      delBtn.addEventListener("click", () => {
        if (!confirm(`Delete "${profile.label}" from catalog?`)) return;
        const idx = vocab.methodCatalog.findIndex((p) => p.id === profile.id);
        if (idx >= 0) vocab.methodCatalog.splice(idx, 1);
        pendingNewMethodIds.delete(profile.id);
        if (expandedId === profile.id) expandedId = null;
        sortCatalog();
        render();
        markDirty();
      });
      foot.appendChild(delBtn);

      const coreSection = document.createElement("div");
      coreSection.className = "method-catalog-detail-core";
      coreSection.append(labelRow, modRow, catRow);
      if (conflictNote.childNodes.length) coreSection.appendChild(conflictNote);

      const relationsSection = document.createElement("div");
      relationsSection.className = "method-catalog-detail-relations";
      if (ML()) {
        profile.relations = ML().normalizeRelations(profile.relations, vocab);
        relationsSection.appendChild(ML().buildRelationsReadOnly(profile, vocab));
      }

      const variantsBlock = document.createElement("div");
      variantsBlock.className = "profile-trigger-block profile-variants-block";
      const variantsHead = document.createElement("div");
      variantsHead.className = "profile-trigger-head";
      const variantsTitle = document.createElement("span");
      variantsTitle.className = "profile-alias-label";
      variantsTitle.textContent = "Variants";
      const variantsHint = document.createElement("span");
      variantsHint.className = "profile-trigger-hint";
      variantsHint.textContent = "optional named variants";
      variantsHead.append(variantsTitle, variantsHint);
      const variantsWrap = document.createElement("div");
      variantsWrap.className = "profile-variant-list";
      renderVariantRows(profile, variantsWrap);
      variantsBlock.append(variantsHead, variantsWrap);

      const triggersSection = document.createElement("div");
      triggersSection.className = "method-catalog-detail-triggers";
      triggersSection.append(directBlock, indirectBlock);

      const variantsSection = document.createElement("div");
      variantsSection.className = "method-catalog-detail-variants";
      variantsSection.appendChild(variantsBlock);

      detail.append(coreSection, relationsSection, variantsSection, triggersSection, foot);
      row.appendChild(detail);
    }

    return row;
  }

  function render() {
    const wrap = $("method-catalog-profiles");
    if (!wrap || !vocab) return;
    wrap.replaceChildren();

    const list = document.createElement("div");
    list.className = "method-catalog-list";
    for (const profile of vocab.methodCatalog || []) {
      list.appendChild(renderProfileRow(profile));
    }
    wrap.appendChild(list);

    updateSaveButton();
    if (dirty) setSaveStatus("Unsaved changes — press ✓ to save");
  }

  function bindSaveButton() {
    const btn = $("method-catalog-save-btn");
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => void persistVocab());
  }

  function bindAddMethodButton() {
    const btn = $("method-catalog-add-btn");
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => addNewMethod());
  }

  async function loadAndRender(force) {
    const wrap = $("method-catalog-profiles");
    if (!wrap) return;
    if (settingsLoaded && !force && dirty) {
      render();
      return;
    }
    try {
      if (!settingsLoaded || force) {
        if (dirty) {
          render();
          return;
        }
        await fetchVocab();
        pendingNewMethodIds.clear();
        settingsLoaded = true;
        markClean();
      }
      render();
      if (!dirty) setSaveStatus("");
    } catch (e) {
      wrap.replaceChildren();
      const err = document.createElement("p");
      err.className = "bookmarks-empty";
      err.textContent = e.message || "Could not load vocab";
      wrap.appendChild(err);
    }
  }

  function init() {
    bindSaveButton();
    bindAddMethodButton();
  }

  function invalidateVocabCache() {
    settingsLoaded = false;
    vocab = null;
  }

  window.MethodProfilesUI = {
    render: () => loadAndRender(true),
    loadAndRender,
    invalidateVocabCache,
    init,
    renderVariantRows,
  };
  init();
})();
