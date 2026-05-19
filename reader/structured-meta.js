/** Multi-select study metadata (Info tab) + vocab suggestions. */
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

  function setFromArticle(article) {
    if (!article) {
      structured = emptyStructured();
      const nEl = $("meta-n-animals");
      if (nEl) nEl.value = "";
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
    const nEl = $("meta-n-animals");
    if (nEl) nEl.value = article.nAnimals || s.nAnimals || "";
    renderAll();
  }

  function readPayload() {
    const nAnimals = ($("meta-n-animals")?.value || "").trim();
    return {
      nAnimals,
      structured: {
        ...structured,
        nAnimals,
      },
    };
  }

  function renderChips(container, items, onRemove) {
    container.replaceChildren();
    for (let i = 0; i < items.length; i++) {
      const chip = document.createElement("span");
      chip.className = "meta-chip";
      const label = document.createElement("span");
      label.textContent = typeof items[i] === "string" ? items[i] : items[i].__label;
      const x = document.createElement("span");
      x.className = "meta-chip-x";
      x.textContent = "×";
      x.title = "Remove";
      x.addEventListener("click", () => onRemove(i));
      chip.append(label, x);
      container.appendChild(chip);
    }
  }

  function renderListField(field) {
    const section = document.createElement("div");
    section.className = "meta-section";
    section.dataset.field = field.key;

    const label = document.createElement("label");
    label.className = "meta-section-label";
    label.textContent = field.label;

    const chips = document.createElement("div");
    chips.className = "meta-chips";

    const items = structured[field.key];
    renderChips(
      chips,
      items.map((v) => ({ __label: v })),
      (idx) => {
        structured[field.key].splice(idx, 1);
        renderAll();
        scheduleSave();
      }
    );

    const row = document.createElement("div");
    row.className = "meta-add-row";

    const input = document.createElement("input");
    input.className = "kw-input";
    input.placeholder = "Type or pick…";
    input.setAttribute("list", `vocab-${field.key}`);

    const datalist = document.createElement("datalist");
    datalist.id = `vocab-${field.key}`;
    for (const opt of vocab[field.vocabKey] || []) {
      const o = document.createElement("option");
      o.value = opt;
      datalist.appendChild(o);
    }

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "kw-add-btn";
    addBtn.textContent = "+";
    addBtn.title = "Add";

    const addCurrent = async () => {
      const v = input.value.trim();
      if (!v) return;
      if (!structured[field.key].includes(v)) {
        structured[field.key].push(v);
        scheduleSave();
      }
      if (!(vocab[field.vocabKey] || []).includes(v)) {
        await addVocabOption(field.vocabKey, v);
      }
      input.value = "";
      renderAll();
    };

    addBtn.addEventListener("click", () => void addCurrent());
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void addCurrent();
      }
    });

    row.append(input, datalist, addBtn);
    section.append(label, chips, row);
    return section;
  }

  function renderBrainField(field) {
    const section = document.createElement("div");
    section.className = "meta-section";

    const label = document.createElement("label");
    label.className = "meta-section-label";
    label.textContent = field.label;

    const chips = document.createElement("div");
    chips.className = "meta-chips";
    renderChips(
      chips,
      structured.brainRegions.map((r) => ({ __label: regionChipLabel(r) })),
      (idx) => {
        structured.brainRegions.splice(idx, 1);
        renderAll();
        scheduleSave();
      }
    );

    const regionInput = document.createElement("input");
    regionInput.className = "kw-input";
    regionInput.placeholder = "Region (e.g. CA1)";
    regionInput.setAttribute("list", "vocab-brainRegions");

    const datalist = document.createElement("datalist");
    datalist.id = "vocab-brainRegions";
    for (const opt of vocab.brainRegions || []) {
      const o = document.createElement("option");
      o.value = opt;
      datalist.appendChild(o);
    }

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

    const row = document.createElement("div");
    row.className = "meta-add-row";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "kw-add-btn";
    addBtn.textContent = "+";

    const addRegion = async () => {
      const labelVal = regionInput.value.trim();
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
      regionInput.value = "";
      ap.value = "";
      ml.value = "";
      dv.value = "";
      renderAll();
      scheduleSave();
    };

    addBtn.addEventListener("click", () => void addRegion());
    regionInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void addRegion();
      }
    });

    row.append(regionInput, datalist, addBtn);
    const hint = document.createElement("p");
    hint.className = "meta-vocab-hint";
    hint.textContent = "Optional AP / ML / DV (mm). Exported like: AP = -3.8; ML = 3; DV = 2.5, CA1";

    section.append(label, chips, coords, row, hint);
    return section;
  }

  function renderAll() {
    const root = $("meta-structured-fields");
    if (!root) return;
    root.replaceChildren();
    for (const field of FIELDS) {
      root.appendChild(
        field.coords ? renderBrainField(field) : renderListField(field)
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

  function init() {
    bindExportButtons();
    const nEl = $("meta-n-animals");
    if (nEl && !nEl.dataset.bound) {
      nEl.dataset.bound = "1";
      nEl.addEventListener("input", scheduleSave);
    }
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
