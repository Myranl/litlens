/** Multi-select study metadata (Info tab) — Notion-style comboboxes. */
(function () {
  const API = `${location.origin}/api`;

  const FIELDS = [
    { key: "species", label: "Species", vocabKey: "species" },
    { key: "brainRegions", label: "Brain region", vocabKey: "brainRegions", coords: true },
    { key: "behavioralParadigms", label: "Behavioral paradigm", vocabKey: "behavioralParadigms" },
    { key: "recordingMethods", label: "Recording methods", vocabKey: "recordingMethods" },
    { key: "cellTypes", label: "Cell type", vocabKey: "cellTypes" },
    { key: "methods", label: "Methods", vocabKey: "methods" },
  ];

  let vocab = {};
  let structured = emptyStructured();
  let openDropdown = null;

  function emptyStructured() {
    return {
      species: [],
      brainRegions: [],
      behavioralParadigms: [],
      recordingMethods: [],
      cellTypes: [],
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
    if (!vocab[vocabKey]) vocab[vocabKey] = [];
    if (vocab[vocabKey].includes(v)) return;
    vocab[vocabKey] = [...vocab[vocabKey], v].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
    await saveVocab();
  }

  function scheduleSave() {
    if (typeof window.litlensScheduleSaveMetadata === "function") {
      window.litlensScheduleSaveMetadata();
    }
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
        chip.appendChild(document.createTextNode(val));
        const x = document.createElement("button");
        x.type = "button";
        x.className = "notion-chip-x";
        x.textContent = "×";
        x.addEventListener("click", (e) => {
          e.stopPropagation();
          structured[field.key].splice(idx, 1);
          renderChips();
          scheduleSave();
        });
        chip.appendChild(x);
        inner.insertBefore(chip, input);
      });
    }

    function filteredOptions(query) {
      const q = query.trim().toLowerCase();
      const opts = vocab[field.vocabKey] || [];
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
        !(vocab[field.vocabKey] || []).some(
          (o) => o.toLowerCase() === exact.toLowerCase()
        )
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
      structured[field.key].push(v);
      if (!(vocab[field.vocabKey] || []).includes(v)) {
        await addVocabOption(field.vocabKey, v);
      }
      input.value = "";
      renderChips();
      renderList();
      scheduleSave();
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

    input.addEventListener("input", () => {
      openDropdownEl(dropdown);
      renderList();
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const v = input.value.trim();
        if (v) void pickValue(v);
      } else if (e.key === "Backspace" && !input.value && structured[field.key].length) {
        structured[field.key].pop();
        renderChips();
        scheduleSave();
      } else if (e.key === "Escape") {
        closeDropdown(dropdown);
        input.blur();
      }
    });

    inner.appendChild(input);
    wrap.append(inner, dropdown);
    section.append(label, wrap);

    renderChips();
    return section;
  }

  function renderBrainField(field) {
    const section = document.createElement("div");
    section.className = "meta-section";

    const label = document.createElement("label");
    label.className = "meta-section-label";
    label.textContent = field.label;

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
        chip.appendChild(document.createTextNode(regionChipLabel(r)));
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
      const opts = (vocab.brainRegions || []).filter((o) =>
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
    input.addEventListener("input", () => {
      openDropdownEl(dropdown);
      renderList();
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
    section.append(label, wrap, coords);
    const hint2 = document.createElement("p");
    hint2.className = "meta-vocab-hint";
    hint2.textContent =
      "Optional AP / ML / DV (mm), then Enter. CSV: AP = -3.8; ML = 3, CA1";
    section.appendChild(hint2);

    renderChips();
    return section;
  }

  function setFromArticle(article) {
    const nEl = $("meta-n-animals");
    const cfEl = $("meta-cell-filter");
    if (!article) {
      structured = emptyStructured();
      if (nEl) nEl.value = "";
      if (cfEl) cfEl.value = "";
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
      methods: [...(s.methods || [])],
    };
    if (nEl) nEl.value = article.nAnimals || s.nAnimals || "";
    if (cfEl) {
      cfEl.value =
        article.cellFilterCriterion || s.cellFilterCriterion || "";
    }
    renderAll();
  }

  function readPayload() {
    const nAnimals = ($("meta-n-animals")?.value || "").trim();
    const cellFilterCriterion = ($("meta-cell-filter")?.value || "").trim();
    return {
      nAnimals,
      cellFilterCriterion,
      structured: {
        ...structured,
        nAnimals,
        cellFilterCriterion,
      },
    };
  }

  function renderAll() {
    const root = $("meta-structured-fields");
    if (!root) return;
    root.replaceChildren();
    for (const field of FIELDS) {
      root.appendChild(
        field.coords ? renderBrainField(field) : createNotionMultiSelect(field)
      );
    }
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
        el.addEventListener("input", scheduleSave);
      }
    }
  }

  function init() {
    bindExportButtons();
    bindScalarFields();
    renderAll();
  }

  window.StructuredMeta = {
    loadVocab,
    setFromArticle,
    readPayload,
    init,
    exportCsv,
  };

  init();
})();
