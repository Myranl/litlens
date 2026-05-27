/** Settings: term catalogs (species, brain region, …) with search triggers. */
(function () {
  const API = `${location.origin}/api`;
  const VTP = () => window.LitLensVocabTermProfiles;

  let vocab = null;
  let dirty = false;
  let saveInFlight = false;
  let activeKey = "species";
  let expandedId = null;
  let loaded = false;

  function $(id) {
    return document.getElementById(id);
  }

  async function fetchVocab() {
    const res = await fetch(`${API}/vocab`);
    if (!res.ok) throw new Error("Failed to load vocab");
    vocab = await res.json();
    VTP()?.ensureAllTermCatalogs(vocab);
    return vocab;
  }

  function setStatus(text, isError) {
    const el = $("term-catalog-save-status");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("error", Boolean(isError));
  }

  function updateSaveBtn() {
    const btn = $("term-catalog-save-btn");
    if (!btn) return;
    btn.disabled = !dirty || saveInFlight;
    btn.classList.toggle("method-catalog-save-btn--dirty", dirty && !saveInFlight);
  }

  function markDirty() {
    dirty = true;
    setStatus("Unsaved — press ✓ to save");
    updateSaveBtn();
  }

  function markClean() {
    dirty = false;
    updateSaveBtn();
  }

  function catalog() {
    return VTP()?.getCatalog(vocab, activeKey) || [];
  }

  function findProfile(id) {
    return catalog().find((p) => p.id === id) || null;
  }

  function sortCatalog() {
    const list = catalog();
    list.sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
    );
    VTP()?.ensureTermCatalog(vocab, activeKey);
  }

  function splitPasteToLines(text) {
    return String(text || "")
      .split(/[,;\n]+/)
      .map((t) => t.trim())
      .filter(Boolean);
  }

  function mergePasteIntoTextarea(el, pasted) {
    const parts = splitPasteToLines(pasted);
    if (parts.length <= 1 && !/[,;\n]/.test(pasted)) return false;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const before = el.value.slice(0, start).replace(/\n?$/, "");
    const after = el.value.slice(end).replace(/^\n?/, "");
    const block = parts.join("\n");
    el.value = before ? `${before}\n${block}` : block;
    if (after) el.value = `${el.value}\n${after}`;
    return true;
  }

  function countAlsoMatch(label, directTerms) {
    const canon = String(label || "").trim().toLowerCase();
    const terms = Array.isArray(directTerms)
      ? directTerms
      : String(directTerms || "")
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean);
    return terms.filter((t) => t.toLowerCase() !== canon).length;
  }

  function formatCatalogName(label, alsoMatchCount) {
    const name = String(label || "").trim() || "?";
    return alsoMatchCount > 0 ? `${name} [${alsoMatchCount}]` : name;
  }

  function updateSummaryAlsoMatchCount(row, label, directText) {
    const nameEl = row?.querySelector(".method-catalog-name");
    if (!nameEl) return;
    const n = countAlsoMatch(label, directText);
    nameEl.textContent = formatCatalogName(label, n);
  }

  function flushRow(profile, row) {
    if (!profile || !row) return;
    const labelInp = row.querySelector(".term-profile-label-input");
    if (labelInp) {
      const next = labelInp.value.trim();
      if (next && next !== profile.label) {
        const dup = catalog().some(
          (p) => p.id !== profile.id && p.label.toLowerCase() === next.toLowerCase()
        );
        if (dup) {
          setStatus("This name already exists.", true);
          labelInp.value = profile.label;
        } else {
          const old = profile.label;
          profile.label = next;
          profile.id = VTP().normalizeTermProfile({ label: next }).id;
          if (profile.triggers.direct[0] === old) profile.triggers.direct[0] = next;
          expandedId = profile.id;
        }
      }
    }
    const directInp = row.querySelector(".term-profile-direct");
    if (directInp) {
      profile.triggers.direct = directInp.value
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean);
      if (!profile.triggers.direct.includes(profile.label)) {
        profile.triggers.direct.unshift(profile.label);
      }
    }
    const indirectInp = row.querySelector(".term-profile-indirect");
    if (indirectInp) {
      profile.triggers.indirect = indirectInp.value
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean);
    }
  }

  function flushPending() {
    if (!expandedId) return;
    const row = document.querySelector(
      `.term-catalog-row[data-id="${CSS.escape(expandedId)}"]`
    );
    flushRow(findProfile(expandedId), row);
  }

  async function persistVocab() {
    if (!vocab || saveInFlight) return;
    flushPending();
    VTP()?.ensureAllTermCatalogs(vocab);
    saveInFlight = true;
    updateSaveBtn();
    setStatus("Saving…");
    try {
      const res = await fetch(`${API}/vocab`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vocab),
      });
      if (!res.ok) throw new Error("Save failed");
      vocab = await res.json();
      VTP()?.ensureAllTermCatalogs(vocab);
      markClean();
      setStatus("Saved");
      window.setTimeout(() => setStatus(""), 2000);
      if (window.StructuredMeta?.reloadVocab) {
        await window.StructuredMeta.reloadVocab();
      }
    } catch (e) {
      setStatus(e.message || "Could not save", true);
    } finally {
      saveInFlight = false;
      updateSaveBtn();
    }
  }

  function buildRow(profile) {
    const row = document.createElement("div");
    row.className = "method-catalog-row term-catalog-row";
    row.dataset.id = profile.id;
    if (expandedId === profile.id) row.classList.add("method-catalog-row--open");

    const summary = document.createElement("div");
    summary.className = "method-catalog-summary";
    const name = document.createElement("span");
    name.className = "method-catalog-name";
    name.textContent = formatCatalogName(
      profile.label,
      countAlsoMatch(profile.label, profile.triggers.direct)
    );
    const chevron = document.createElement("span");
    chevron.className = "method-catalog-chevron";
    chevron.textContent = expandedId === profile.id ? "▾" : "▸";
    summary.append(name, chevron);
    summary.addEventListener("click", () => {
      flushPending();
      expandedId = expandedId === profile.id ? null : profile.id;
      render();
    });
    row.appendChild(summary);

    if (expandedId === profile.id) {
      const detail = document.createElement("div");
      detail.className = "method-catalog-detail";

      const lab = document.createElement("label");
      lab.className = "form-label";
      lab.textContent = "Canonical name";
      const labelInp = document.createElement("input");
      labelInp.type = "text";
      labelInp.className = "form-input term-profile-label-input";
      labelInp.value = profile.label;
      labelInp.addEventListener("input", () => {
        markDirty();
        updateSummaryAlsoMatchCount(row, labelInp.value, directInp?.value ?? "");
      });

      const dLab = document.createElement("label");
      dLab.className = "form-label";
      const alsoCount = countAlsoMatch(profile.label, profile.triggers.direct);
      dLab.textContent =
        alsoCount > 0
          ? `Also match [${alsoCount}] (one per line)`
          : "Also match (one per line)";
      const directInp = document.createElement("textarea");
      directInp.className = "meta-textarea term-profile-direct";
      directInp.rows = 3;
      directInp.value = (profile.triggers.direct || [])
        .filter((t) => t.toLowerCase() !== profile.label.toLowerCase())
        .join("\n");
      directInp.placeholder = "Kilosort 2.5, KS — paste comma-separated";
      directInp.addEventListener("paste", (e) => {
        const text = e.clipboardData?.getData("text/plain") || "";
        if (!mergePasteIntoTextarea(directInp, text)) return;
        e.preventDefault();
        markDirty();
        const n = countAlsoMatch(labelInp.value, directInp.value);
        dLab.textContent =
          n > 0 ? `Also match [${n}] (one per line)` : "Also match (one per line)";
        updateSummaryAlsoMatchCount(row, labelInp.value, directInp.value);
      });
      directInp.addEventListener("input", () => {
        markDirty();
        const n = countAlsoMatch(labelInp.value, directInp.value);
        dLab.textContent =
          n > 0 ? `Also match [${n}] (one per line)` : "Also match (one per line)";
        updateSummaryAlsoMatchCount(row, labelInp.value, directInp.value);
      });

      const iLab = document.createElement("label");
      iLab.className = "form-label";
      iLab.textContent = "Indirect phrases (one per line)";
      const indirectInp = document.createElement("textarea");
      indirectInp.className = "meta-textarea term-profile-indirect";
      indirectInp.rows = 2;
      indirectInp.value = (profile.triggers.indirect || []).join("\n");
      indirectInp.placeholder = "spike sorting — paste comma-separated";
      indirectInp.addEventListener("paste", (e) => {
        const text = e.clipboardData?.getData("text/plain") || "";
        if (!mergePasteIntoTextarea(indirectInp, text)) return;
        e.preventDefault();
        markDirty();
      });
      indirectInp.addEventListener("input", () => markDirty());

      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn-sm btn-ghost";
      del.textContent = "Remove term";
      del.addEventListener("click", () => {
        const list = catalog();
        const idx = list.findIndex((p) => p.id === profile.id);
        if (idx >= 0) list.splice(idx, 1);
        expandedId = null;
        markDirty();
        render();
      });

      detail.append(lab, labelInp, dLab, directInp, iLab, indirectInp, del);
      row.appendChild(detail);
    }
    return row;
  }

  function render() {
    const wrap = $("term-catalog-profiles");
    if (!wrap || !vocab) return;

    const tabs = $("term-catalog-tabs");
    if (tabs) {
      tabs.replaceChildren();
      for (const key of VTP().TERM_VOCAB_KEYS) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn-sm btn-ghost term-catalog-tab";
        if (key === activeKey) btn.classList.add("term-catalog-tab--active");
        btn.textContent = VTP().FIELD_LABELS[key] || key;
        btn.addEventListener("click", () => {
          flushPending();
          activeKey = key;
          expandedId = null;
          render();
        });
        tabs.appendChild(btn);
      }
    }

    wrap.replaceChildren();
    const list = document.createElement("div");
    list.className = "method-catalog-list";
    for (const profile of catalog()) {
      list.appendChild(buildRow(profile));
    }
    wrap.appendChild(list);

    const addRow = document.createElement("div");
    addRow.className = "term-catalog-add-row";
    const addInp = document.createElement("input");
    addInp.type = "text";
    addInp.className = "form-input";
    addInp.placeholder = "New term…";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn-sm btn-primary";
    addBtn.textContent = "+ Add";
    addBtn.addEventListener("click", () => {
      const label = addInp.value.trim();
      if (!label) return;
      const p = VTP().normalizeTermProfile({ label });
      if (!p) return;
      if (catalog().some((x) => x.label.toLowerCase() === label.toLowerCase())) {
        setStatus("Already in catalog.", true);
        return;
      }
      catalog().push(p);
      addInp.value = "";
      expandedId = p.id;
      sortCatalog();
      markDirty();
      render();
    });
    addRow.append(addInp, addBtn);
    wrap.appendChild(addRow);
  }

  async function loadAndRender(force) {
    const wrap = $("term-catalog-profiles");
    if (!wrap) return;
    if (loaded && !force && dirty) {
      render();
      return;
    }
    try {
      if (!loaded || force) {
        if (dirty) {
          render();
          return;
        }
        await fetchVocab();
        loaded = true;
        markClean();
      }
      render();
      if (!dirty) setStatus("");
    } catch (e) {
      setStatus(e.message || "Could not load", true);
    }
  }

  function init() {
    $("term-catalog-save-btn")?.addEventListener("click", () => void persistVocab());
    document.querySelectorAll(".panel-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        if (tab.dataset.tab === "settings") void loadAndRender(false);
      });
    });
    if (document.querySelector("#tab-settings.panel-content.active")) {
      void loadAndRender(false);
    }
  }

  window.TermProfilesUI = {
    loadAndRender,
    invalidateVocabCache() {
      loaded = false;
      vocab = null;
    },
  };

  init();
})();
