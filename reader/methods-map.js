/** Methods map grid + cross-article mentions for a method. */
(function () {
  const API = `${location.origin}/api`;
  const MP = () => window.LitLensMethodProfiles;
  const ML = () => window.LitLensMethodLinks;

  let mapOpen = false;
  /** @type {'grid' | 'catalog' | 'card'} */
  let mapViewMode = "grid";
  let lastTopbarTitle = "";
  let selectedMethodLabel = null;
  let cardEditing = false;
  let cardSaveInFlight = false;
  /** @type {object | null} */
  let currentProfile = null;
  /** @type {object | null} */
  let vocabCache = null;
  /** @type {object[]} */
  let libraryArticles = [];
  let articlesById = new Map();

  function passageCiteStore() {
    return window.LitLensPassageCiteStore || null;
  }

  function escapeRegex(s) {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /** Terms from evidence + current method profile to bold in excerpt. */
  function termsToHighlightInExcerpt(mention, profile) {
    const terms = [];
    const seen = new Set();
    const add = (t) => {
      const s = String(t || "").trim();
      if (s.length < 2) return;
      const key = s.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      terms.push(s);
    };
    if (mention?.matchedTerm) {
      if (mention.matchType === "combination") {
        String(mention.matchedTerm)
          .split(/\s*\+\s*/)
          .forEach(add);
      } else {
        add(mention.matchedTerm);
      }
    }
    if (profile?.label) add(profile.label);
    const triggers = profile?.triggers || {};
    for (const t of triggers.direct || []) add(t);
    for (const t of triggers.indirect || []) add(t);
    for (const combo of triggers.combination || []) {
      if (Array.isArray(combo)) combo.forEach(add);
    }
    return terms.sort((a, b) => b.length - a.length);
  }

  function fillQuoteWithHighlights(el, text, terms) {
    el.replaceChildren();
    const hay = String(text || "");
    if (!hay) return;
    if (!terms.length) {
      el.textContent = hay;
      return;
    }
    const pattern = terms.map((t) => `\\b${escapeRegex(t)}\\b`).join("|");
    if (!pattern) {
      el.textContent = hay;
      return;
    }
    const re = new RegExp(`(${pattern})`, "gi");
    let last = 0;
    let m;
    while ((m = re.exec(hay))) {
      if (m.index > last) {
        el.appendChild(document.createTextNode(hay.slice(last, m.index)));
      }
      const strong = document.createElement("strong");
      strong.className = "methods-map-mention-hit";
      strong.textContent = m[0];
      el.appendChild(strong);
      last = re.lastIndex;
    }
    if (last < hay.length) {
      el.appendChild(document.createTextNode(hay.slice(last)));
    }
    if (!el.childNodes.length) el.textContent = hay;
  }

  const DOC_FIELD_LABELS = {
    definition: "Definition",
    input: "Input",
    output: "Output",
    inputRequirements: "Input filters / requirements",
    parameters: "Parameters",
    comments: "Comments",
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function fetchVocab({ fresh = false } = {}) {
    if (!fresh && window.StructuredMeta?.getVocab) {
      const cached = StructuredMeta.getVocab();
      if (cached?.methodCatalog?.length) {
        MP()?.ensureCatalog(cached);
        return cached;
      }
    }
    const res = await fetch(`${API}/vocab`);
    if (!res.ok) throw new Error("Failed to load vocab");
    const vocab = await res.json();
    MP()?.ensureCatalog(vocab);
    return vocab;
  }

  async function fetchAllArticlesMeta() {
    const res = await fetch(`${API}/articles`);
    if (!res.ok) throw new Error("Failed to load articles");
    return res.json();
  }

  function evidenceForMethod(article, methodLabel) {
    const me = article?.methodEvidence;
    if (!me || typeof me !== "object") return [];
    if (Array.isArray(me[methodLabel])) return me[methodLabel];
    const q = methodLabel.toLowerCase();
    const key = Object.keys(me).find((k) => k.toLowerCase() === q);
    return key && Array.isArray(me[key]) ? me[key] : [];
  }

  function articleHasMethod(article, methodLabel) {
    const q = methodLabel.toLowerCase();
    const methods = article?.structured?.methods || article?.methods || [];
    return methods.some((m) => String(m).toLowerCase() === q);
  }

  /** @returns {{ articleId: string, title: string, excerpt: string, offset?: number, length?: number, matchedTerm?: string, matchType?: string, linkedOnly?: boolean }[]} */
  async function collectMentions(methodLabel) {
    const articles = await fetchAllArticlesMeta();
    const mentions = [];
    for (const article of articles) {
      const title = article.title || "Untitled";
      const entries = evidenceForMethod(article, methodLabel);
      if (entries.length) {
        for (const ev of entries) {
          mentions.push({
            articleId: article.id,
            title,
            excerpt: ev.excerpt || "",
            offset: ev.offset,
            length: ev.length,
            matchedTerm: ev.matchedTerm,
            matchType: ev.matchType,
          });
        }
      } else if (articleHasMethod(article, methodLabel)) {
        mentions.push({
          articleId: article.id,
          title,
          excerpt: "Method linked — no passage saved for this article.",
          linkedOnly: true,
        });
      }
    }
    return mentions;
  }

  function setCardToolbarEditing(editing) {
    cardEditing = editing;
    const editBtn = $("methods-map-card-edit");
    const saveBtn = $("methods-map-card-save");
    const cancelBtn = $("methods-map-card-cancel");
    if (editBtn) editBtn.hidden = editing;
    if (saveBtn) saveBtn.hidden = !editing;
    if (cancelBtn) cancelBtn.hidden = !editing;
  }

  function renderUsageChart(container, methodLabel, articles) {
    if (!container) return;
    container.replaceChildren();
    const MPapi = MP();
    if (!MPapi) return;

    const counts = MPapi.countMethodUsageByYear(articles, methodLabel);
    const years = [...counts.keys()].sort((a, b) => a - b);

    if (!years.length) {
      const empty = document.createElement("p");
      empty.className = "methods-map-chart-empty";
      empty.textContent =
        "No articles with this method yet, or year is missing in metadata.";
      container.appendChild(empty);
      return;
    }

    const max = Math.max(...years.map((y) => counts.get(y)), 1);
    const total = years.reduce((s, y) => s + counts.get(y), 0);
    const w = 280;
    const h = 150;
    const pad = { l: 30, r: 8, t: 10, b: 26 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const gap = Math.min(10, plotW / years.length / 3);
    const barW = Math.max(6, (plotW - gap * (years.length - 1)) / years.length);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "methods-map-chart-svg");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      `Histogram: ${total} articles using ${methodLabel} by year`
    );

    const axisColor = "var(--color-text-faint)";
    const barColor = "var(--color-primary)";

    const yAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
    yAxis.setAttribute("x1", String(pad.l));
    yAxis.setAttribute("y1", String(pad.t));
    yAxis.setAttribute("x2", String(pad.l));
    yAxis.setAttribute("y2", String(h - pad.b));
    yAxis.setAttribute("stroke", axisColor);
    svg.appendChild(yAxis);

    const xAxis = document.createElementNS("http://www.w3.org/2000/svg", "line");
    xAxis.setAttribute("x1", String(pad.l));
    xAxis.setAttribute("y1", String(h - pad.b));
    xAxis.setAttribute("x2", String(w - pad.r));
    xAxis.setAttribute("y2", String(h - pad.b));
    xAxis.setAttribute("stroke", axisColor);
    svg.appendChild(xAxis);

    const yLbl = document.createElementNS("http://www.w3.org/2000/svg", "text");
    yLbl.setAttribute("class", "methods-map-chart-tick");
    yLbl.setAttribute("x", "4");
    yLbl.setAttribute("y", String(pad.t + plotH / 2));
    yLbl.setAttribute("transform", `rotate(-90 4 ${pad.t + plotH / 2})`);
    yLbl.textContent = "Articles";
    svg.appendChild(yLbl);

    years.forEach((year, i) => {
      const n = counts.get(year);
      const barH = (n / max) * plotH;
      const x = pad.l + i * (barW + gap);
      const y = h - pad.b - barH;

      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(barW));
      rect.setAttribute("height", String(Math.max(barH, 2)));
      rect.setAttribute("fill", barColor);
      rect.setAttribute("rx", "2");
      rect.setAttribute("title", `${year}: ${n}`);
      svg.appendChild(rect);

      const xl = document.createElementNS("http://www.w3.org/2000/svg", "text");
      xl.setAttribute("class", "methods-map-chart-tick");
      xl.setAttribute("x", String(x + barW / 2));
      xl.setAttribute("y", String(h - pad.b + 13));
      xl.setAttribute("text-anchor", "middle");
      xl.textContent = String(year);
      svg.appendChild(xl);
    });

    container.appendChild(svg);
    const cap = document.createElement("p");
    cap.className = "methods-map-chart-caption";
    cap.textContent = `${total} article${total === 1 ? "" : "s"} · ${years[0]}–${years[years.length - 1]}`;
    container.appendChild(cap);
  }

  function openCitation(cite) {
    if (!cite?.articleId || cite.offset == null) return;
    const methodLabel = selectedMethodLabel || "";
    if (typeof window.litlensSelectArticle === "function") {
      void window.litlensSelectArticle(cite.articleId, {
        scrollToTextSpan: {
          offset: cite.offset,
          length: cite.length || 20,
          quote: cite.quote || "",
          expandToSentence: false,
        },
        returnToMethodLabel: methodLabel || undefined,
      });
    }
  }

  async function persistMethodRelations(vocabInMemory) {
    if (!selectedMethodLabel || !currentProfile || cardSaveInFlight) return;
    const links = ML();
    if (!links) return;
    setCardSaveStatus("Saving relations…");
    try {
      let vocab = vocabInMemory;
      if (!vocab) {
        const getRes = await fetch(`${API}/vocab`);
        if (!getRes.ok) throw new Error("Failed to load vocab");
        vocab = await getRes.json();
      }
      MP()?.ensureCatalog(vocab);
      const existing = MP().profileByLabel(vocab, selectedMethodLabel);
      const doc =
        (cardEditing ? readDocFromCard() : null) ||
        existing?.doc ||
        currentProfile.doc ||
        MP().emptyDoc();
      const fromInCatalog = MP().profileByLabel(vocab, selectedMethodLabel);
      const relations =
        fromInCatalog?.relations ||
        currentProfile.relations ||
        [];
      if (cardEditing) flushCardEdits();
      applyDocToVocab(
        vocab,
        selectedMethodLabel,
        doc,
        relations,
        currentProfile?.variants
      );
      const putRes = await fetch(`${API}/vocab`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vocab),
      });
      if (!putRes.ok) throw new Error("Save failed");
      vocabCache = await putRes.json();
      MP()?.ensureCatalog(vocabCache);
      currentProfile =
        MP().profileByLabel(vocabCache, selectedMethodLabel) || currentProfile;
      if (window.StructuredMeta?.reloadVocab) {
        await window.StructuredMeta.reloadVocab();
      }
      if (!cardEditing) refreshRelationsOnCard();
      setCardSaveStatus("Relation saved");
      window.setTimeout(() => setCardSaveStatus(""), 2000);
    } catch (e) {
      setCardSaveStatus(e.message || "Could not save relations", true);
      throw e;
    }
  }


  function refreshRelationsOnCard() {
    if (cardEditing) return; // don't disrupt editing
    const card = $("methods-map-method-card");
    const links = ML();
    if (!card || !currentProfile || !links) return;
    const section = card.querySelector(".methods-map-relations-section");
    if (!section) return;
    const head = section.querySelector(".methods-map-doc-heading");
    section.replaceChildren();
    if (head) section.appendChild(head);
    else {
      const h = document.createElement("h4");
      h.className = "methods-map-doc-heading";
      h.textContent = "Related methods";
      section.appendChild(h);
    }
    const catalogProfile = profileForCard(currentProfile);
    if (catalogProfile) {
      section.appendChild(
        links.buildRelationsReadOnly(catalogProfile, vocabCache, {
          onOpenMethod: (label) => void openMethodCard(label),
        })
      );
    }
  }

  /** Relations live on vocab.methodCatalog — not on detached card copies. */
  function profileForCard(profile) {
    if (!profile) return null;
    const label = profile.label || selectedMethodLabel;
    const links = ML();
    const MPapi = MP();
    if (vocabCache && MPapi && label) {
      const inCatalog = MPapi.profileByLabel(vocabCache, label);
      if (inCatalog) return inCatalog;
    }
    if (vocabCache && links) {
      profile.relations = links.normalizeRelations(profile.relations, vocabCache);
    }
    return profile;
  }

  function readVariantsFromCard() {
    const card = $("methods-map-method-card");
    const wrap = card?.querySelector(".profile-variant-list");
    if (!wrap) return null;
    return MP().normalizeVariants(
      [...wrap.querySelectorAll(".profile-variant-row input")].map((inp) => inp.value)
    );
  }

  function appendVariantsToCard(card, profile, editing) {
    if (!card || !profile) return;
    const section = document.createElement("section");
    section.className = "methods-map-doc-section methods-map-variants-section";
    const head = document.createElement("h4");
    head.className = "methods-map-doc-heading";
    head.textContent = "Variants";
    section.appendChild(head);

    if (editing && window.MethodProfilesUI?.renderVariantRows) {
      const wrap = document.createElement("div");
      wrap.className = "profile-variant-list";
      window.MethodProfilesUI.renderVariantRows(profile, wrap, {
        onDirty: () => {},
      });
      section.appendChild(wrap);
    } else {
      const variants = profile.variants || [];
      if (!variants.length) {
        const empty = document.createElement("p");
        empty.className = "methods-map-variant-empty";
        empty.textContent = "—";
        section.appendChild(empty);
      } else {
        const list = document.createElement("ul");
        list.className = "methods-map-variant-list";
        for (const v of variants) {
          const li = document.createElement("li");
          li.className = "methods-map-variant-line";
          li.textContent = v;
          list.appendChild(li);
        }
        section.appendChild(list);
      }
    }
    card.appendChild(section);
  }

  function appendRelationsToCard(card, profile) {
    const links = ML();
    if (!card || !profile || !links) return;
    const catalogProfile = profileForCard(profile);
    if (!catalogProfile) return;
    const relSection = document.createElement("section");
    relSection.className = "methods-map-doc-section methods-map-relations-section";
    const head = document.createElement("h4");
    head.className = "methods-map-doc-heading";
    head.textContent = "Related methods";
    relSection.appendChild(head);
    const ui = cardEditing
      ? links.buildRelationsEditor(catalogProfile, () => vocabCache)
      : links.buildRelationsReadOnly(catalogProfile, vocabCache, {
          onOpenMethod: (label) => void openMethodCard(label),
        });
    relSection.appendChild(ui);
    card.appendChild(relSection);
  }

  function renderMethodCardView(profile) {
    const card = $("methods-map-method-card");
    const PL = window.LitLensPassageLinks;
    const links = ML();
    if (!card || !profile) return;
    card.replaceChildren();
    if (!profile.doc) profile.doc = MP().emptyDoc();

    for (const key of MP().DOC_FIELDS) {
      const section = document.createElement("section");
      section.className = "methods-map-doc-section";
      const head = document.createElement("h4");
      head.className = "methods-map-doc-heading";
      head.textContent = DOC_FIELD_LABELS[key] || key;
      section.appendChild(head);
      const raw = PL?.normalizeCiteSourceText
        ? PL.normalizeCiteSourceText(profile.doc[key])
        : String(profile.doc[key] || "");
      const hasText = raw.trim().length > 0;
      const hasCite =
        PL && (PL.hasCiteMarkup ? PL.hasCiteMarkup(raw) : /\[\[litlens:/i.test(raw));
      const hasMethodLink =
        links?.hasMethodLinkMarkup?.(raw) || /\[\[method:/i.test(raw);
      if (hasText || hasCite || hasMethodLink) {
        const body = document.createElement("div");
        body.className = "methods-map-doc-text";
        if (links && (hasCite || hasMethodLink) && links.renderMethodDocFragment) {
          body.appendChild(
            links.renderMethodDocFragment(raw, {
              articlesById,
              onCiteClick: openCitation,
              citeStore: passageCiteStore(),
              vocab: vocabCache,
              onMethodClick: (label) => void openMethodCard(label),
            })
          );
        } else if (PL && hasCite) {
          body.appendChild(
            PL.renderDocFragment(raw, articlesById, openCitation, passageCiteStore())
          );
        } else {
          body.textContent = raw;
        }
        section.appendChild(body);
      }
      card.appendChild(section);
      if (key === "definition") appendRelationsToCard(card, profile);
    }
    appendVariantsToCard(card, profile, false);
  }

  function renderMethodCardEdit(profile) {
    const card = $("methods-map-method-card");
    const PL = window.LitLensPassageLinks;
    const links = ML();
    if (!card || !profile) return;
    card.replaceChildren();
    if (!profile.doc) profile.doc = MP().emptyDoc();

    for (const key of MP().DOC_FIELDS) {
      const section = document.createElement("section");
      section.className = "methods-map-doc-section methods-map-doc-section--edit";
      const head = document.createElement("h4");
      head.className = "methods-map-doc-heading";
      head.textContent = DOC_FIELD_LABELS[key] || key;
      const ta = document.createElement("textarea");
      ta.className = "methods-map-doc-textarea";
      ta.dataset.docField = key;
      ta.rows = key === "definition" ? 3 : 2;
      ta.value = profile.doc[key] || "";
      ta.placeholder =
        "Paste citation link from article (right-click selection). Links appear in preview below.";
      const preview = document.createElement("div");
      preview.className = "methods-map-doc-preview";
      preview.hidden = true;
      const syncPreview = () => {
        const val = ta.value;
        const hasCite = PL?.hasCiteMarkup?.(val);
        const hasMethodLink =
          links?.hasMethodLinkMarkup?.(val) || /\[\[method:/i.test(val);
        if (!hasCite && !hasMethodLink) {
          preview.replaceChildren();
          preview.hidden = true;
          return;
        }
        preview.hidden = false;
        preview.replaceChildren();
        if (links?.renderMethodDocFragment) {
          preview.appendChild(
            links.renderMethodDocFragment(val, {
              articlesById,
              onCiteClick: openCitation,
              citeStore: passageCiteStore(),
              vocab: vocabCache,
              onMethodClick: (label) => void openMethodCard(label),
            })
          );
        } else if (hasCite && PL) {
          const norm = PL.normalizeCiteSourceText
            ? PL.normalizeCiteSourceText(val)
            : val;
          preview.appendChild(
            PL.renderDocFragment(norm, articlesById, openCitation, passageCiteStore())
          );
        }
      };
      ta.addEventListener("input", syncPreview);
      ta.addEventListener("paste", () => window.setTimeout(syncPreview, 0));
      section.append(head, ta, preview);
      card.appendChild(section);
      syncPreview();
      if (key === "definition") appendRelationsToCard(card, profile);
    }
    appendVariantsToCard(card, profile, true);
  }

  function readDocFromCard() {
    const doc = MP().emptyDoc();
    const card = $("methods-map-method-card");
    if (!card) return doc;
    for (const key of MP().DOC_FIELDS) {
      const el = card.querySelector(`[data-doc-field="${key}"]`);
      if (el) {
        let val = el.value;
        if (window.LitLensPassageLinks?.normalizeCiteSourceText) {
          val = LitLensPassageLinks.normalizeCiteSourceText(val);
        }
        doc[key] = val.trim();
      }
    }
    return doc;
  }

  function flushCardEdits() {
    if (!currentProfile) return;
    const doc = cardEditing
      ? readDocFromCard()
      : currentProfile.doc || MP().emptyDoc();
    currentProfile.doc = doc;
    const variants = readVariantsFromCard();
    if (variants !== null) currentProfile.variants = variants;
    if (ML()) {
      currentProfile.relations = ML().normalizeRelations(
        currentProfile.relations,
        vocabCache
      );
    }
  }

  function syncMethodCardDecorStyle(profile) {
    const card = $("methods-map-method-card");
    if (!card || !MP()) return;
    card.classList.toggle(
      "methods-map-method-card--framework",
      MP().hasFrameworkModality(profile?.modalities)
    );
    card.classList.toggle(
      "methods-map-method-card--derived",
      MP().hasDerivedModality(profile?.modalities)
    );
  }

  function renderMethodCard() {
    if (!currentProfile) return;
    if (cardEditing) renderMethodCardEdit(currentProfile);
    else renderMethodCardView(currentProfile);
    syncMethodCardDecorStyle(currentProfile);
  }

  /** Write doc + relations (+ variants) onto the catalog entry inside vocab (by label). */
  function applyDocToVocab(vocab, methodLabel, doc, relations, variants) {
    const MPapi = MP();
    const links = ML();
    if (!vocab || !MPapi) return null;
    MPapi.ensureCatalog(vocab);
    const q = String(methodLabel || "").trim().toLowerCase();
    let profile = vocab.methodCatalog.find(
      (p) => p.label.toLowerCase() === q
    );
    const rels = links?.normalizeRelations
      ? links.normalizeRelations(relations, vocab)
      : relations;
    if (!profile) {
      profile = MPapi.normalizeProfile({
        label: methodLabel,
        doc,
        relations: rels,
        variants: variants !== undefined ? variants : [],
      });
      vocab.methodCatalog.push(profile);
      vocab.methodCatalog.sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
      );
    } else {
      profile.doc = { ...MPapi.emptyDoc(), ...doc };
      profile.relations = rels || [];
      if (variants !== undefined) {
        profile.variants = MPapi.normalizeVariants(variants);
      }
    }
    // Do NOT call ensureCatalog here — it would replace all array objects
    // with new copies, breaking any references held by the caller.
    return profile;
  }

  function setCardSaveStatus(text, isError) {
    const el = $("methods-map-card-save-status");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("error", Boolean(isError));
  }

  async function saveMethodCard() {
    if (!selectedMethodLabel || cardSaveInFlight) return;
    if (!cardEditing) {
      setCardSaveStatus("Press ✎ to edit first.", true);
      return;
    }
    let doc = readDocFromCard();
    const PL = window.LitLensPassageLinks;
    const Store = passageCiteStore();
    if (PL?.migrateDocFields && Store) {
      await Store.load();
      doc = await PL.migrateDocFields(doc, MP().DOC_FIELDS, (entry) =>
        Store.registerFromLegacy(entry)
      );
    }
    cardSaveInFlight = true;
    const saveBtn = $("methods-map-card-save");
    if (saveBtn) saveBtn.disabled = true;
    setCardSaveStatus("Saving…");
    try {
      const getRes = await fetch(`${API}/vocab`);
      if (!getRes.ok) throw new Error("Failed to load vocab");
      const vocab = await getRes.json();
      flushCardEdits();
      const card = $("methods-map-method-card");
      const editor = card?.querySelector(
        ".methods-map-relations-section .method-relations-editor"
      );
      // applyDocToVocab ensures the profile is in the catalog (creates if missing).
      // Relation chips live only in the editor until save — don't write stale relations here.
      currentProfile = applyDocToVocab(
        vocab,
        selectedMethodLabel,
        doc,
        editor ? [] : currentProfile?.relations,
        currentProfile?.variants
      );
      vocabCache = vocab;

      const links = ML();
      if (links && editor) {
        const updated = links.applyRelationsFromEditor(
          editor,
          vocab,
          selectedMethodLabel
        );
        if (updated) currentProfile = updated;
      }

      let vocabBody;
      try {
        vocabBody = JSON.stringify(vocab);
      } catch (e) {
        throw new Error(
          e?.message?.includes("circular")
            ? "Could not serialize vocab (internal error)."
            : e?.message || "Could not serialize vocab."
        );
      }

      const putRes = await fetch(`${API}/vocab`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: vocabBody,
      });
      if (!putRes.ok) {
        const errText = await putRes.text().catch(() => "");
        let detail = errText;
        try {
          const errJson = JSON.parse(errText);
          if (errJson?.error) detail = errJson.error;
        } catch {
          /* plain text / HTML */
        }
        if (/EPERM|operation not permitted/i.test(detail)) {
          throw new Error(
            "Cannot write vocab.json — restart the server from Terminal (not Cursor sandbox)."
          );
        }
        throw new Error(detail ? `Save failed: ${detail}` : "Save failed");
      }
      vocabCache = await putRes.json();
      MP()?.ensureCatalog(vocabCache);
      currentProfile =
        MP().profileByLabel(vocabCache, selectedMethodLabel) || currentProfile;

      setCardToolbarEditing(false);
      renderMethodCardView(currentProfile);

      if (window.StructuredMeta?.reloadVocab) {
        await window.StructuredMeta.reloadVocab();
      }
      if (window.MethodProfilesUI?.invalidateVocabCache) {
        window.MethodProfilesUI.invalidateVocabCache();
      }
      setCardSaveStatus("Saved");
      window.setTimeout(() => setCardSaveStatus(""), 2400);
    } catch (e) {
      setCardSaveStatus(e.message || "Could not save", true);
    } finally {
      cardSaveInFlight = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  function startCardEdit() {
    if (!currentProfile) return;
    setCardToolbarEditing(true);
    renderMethodCardEdit(currentProfile);
    const first = $("methods-map-method-card")?.querySelector("textarea");
    first?.focus();
  }

  function cancelCardEdit() {
    setCardToolbarEditing(false);
    renderMethodCardView(currentProfile);
  }

  function applyMapViewMode() {
    const gridWrap = $("methods-map-grid-wrap");
    const catalogWrap = $("methods-map-catalog-wrap");
    const mentionsView = $("methods-map-mentions");
    const statusEl = $("methods-map-status");
    const gridBtn = $("methods-map-show-grid");
    const catalogBtn = $("methods-map-show-catalog");
    const nav = $("methods-map-nav");
    const editCatalogBtn = $("methods-map-edit-catalog-btn");

    const isCard = mapViewMode === "card";
    const isCatalog = mapViewMode === "catalog";
    const isGrid = !isCard && !isCatalog;

    if (mentionsView) mentionsView.style.display = isCard ? "block" : "none";
    if (gridWrap) gridWrap.style.display = isGrid ? "block" : "none";
    if (catalogWrap) catalogWrap.style.display = isCatalog ? "block" : "none";
    if (nav) nav.style.display = isCard ? "none" : "flex";
    if (editCatalogBtn) {
      editCatalogBtn.style.display = isGrid ? "inline-flex" : "none";
    }
    if (statusEl) statusEl.style.display = isGrid ? "block" : "none";

    if (gridBtn) {
      const on = isGrid;
      gridBtn.setAttribute("aria-selected", on ? "true" : "false");
      gridBtn.setAttribute("aria-pressed", on ? "true" : "false");
    }
    if (catalogBtn) {
      const on = isCatalog;
      catalogBtn.setAttribute("aria-selected", on ? "true" : "false");
      catalogBtn.setAttribute("aria-pressed", on ? "true" : "false");
    }

    const topbar = $("topbar-title");
    if (mapOpen && topbar) {
      if (isCatalog) topbar.textContent = "Method catalog";
      else if (isCard) topbar.textContent = selectedMethodLabel || "Method";
      else topbar.textContent = "Methods map";
    }
  }

  function clearMethodCardState() {
    selectedMethodLabel = null;
    currentProfile = null;
    cardEditing = false;
    setCardToolbarEditing(false);
    const card = $("methods-map-method-card");
    if (card) {
      card.classList.remove("methods-map-method-card--framework");
      card.classList.remove("methods-map-method-card--derived");
    }
  }

  async function showMentionsPanel(methodLabel) {
    const mentionsView = $("methods-map-mentions");
    const titleEl = $("methods-map-mentions-title");
    const hintEl = $("methods-map-mentions-hint");
    const listEl = $("methods-map-mentions-list");
    const chartEl = $("methods-map-method-chart");
    if (!mentionsView || !listEl) return;

    mapViewMode = "card";
    selectedMethodLabel = methodLabel;
    cardEditing = false;
    setCardToolbarEditing(false);
    applyMapViewMode();
    if (titleEl) titleEl.textContent = methodLabel;
    if (hintEl) hintEl.textContent = "Loading…";
    listEl.replaceChildren();
    if ($("methods-map-method-card")) $("methods-map-method-card").replaceChildren();
    if (chartEl) {
      chartEl.replaceChildren();
      const loading = document.createElement("p");
      loading.className = "methods-map-chart-empty";
      loading.textContent = "Loading chart…";
      chartEl.appendChild(loading);
    }

    try {
      const citeLoad = passageCiteStore()?.load?.() || Promise.resolve();
      const [vocab, articles, mentions] = await Promise.all([
        fetchVocab({ fresh: true }),
        fetchAllArticlesMeta(),
        collectMentions(methodLabel),
        citeLoad,
      ]);
      libraryArticles = articles;
      articlesById = new Map(articles.map((a) => [a.id, a]));
      vocabCache = vocab;
      currentProfile = MP().profileByLabel(vocab, methodLabel);
      if (!currentProfile) {
        currentProfile = MP().normalizeProfile({ label: methodLabel });
      }
      if (!currentProfile.doc) currentProfile.doc = MP().emptyDoc();

      renderMethodCardView(currentProfile);
      if (chartEl) renderUsageChart(chartEl, methodLabel, articles);

      const articleIds = new Set(mentions.map((m) => m.articleId));
      if (hintEl) {
        hintEl.textContent = mentions.length
          ? `${mentions.length} passage${mentions.length === 1 ? "" : "s"} in ${articleIds.size} article${articleIds.size === 1 ? "" : "s"}. Click to open.`
          : "No passages saved yet. Link this method on the Info tab to add excerpts.";
      }
      renderMentionsList(mentions);
    } catch (e) {
      if (hintEl) hintEl.textContent = e.message || "Could not load";
      listEl.replaceChildren();
      if (chartEl) {
        chartEl.replaceChildren();
        const err = document.createElement("p");
        err.className = "methods-map-chart-empty";
        err.textContent = e.message || "Error";
        chartEl.appendChild(err);
      }
    }
  }

  function hideMentionsPanel() {
    clearMethodCardState();
    if (mapViewMode === "card") mapViewMode = "grid";
    applyMapViewMode();
  }

  function renderMentionsList(mentions) {
    const listEl = $("methods-map-mentions-list");
    const PL = window.LitLensPassageLinks;
    if (!listEl) return;
    listEl.replaceChildren();

    if (!mentions.length) {
      const empty = document.createElement("p");
      empty.className = "bookmarks-empty";
      empty.textContent = "No mentions in your library yet.";
      listEl.appendChild(empty);
      return;
    }

    for (const m of mentions) {
      const article = articlesById.get(m.articleId);
      const citeLabel = PL?.formatCiteLabel
        ? PL.formatCiteLabel(article)
        : "(article)";
      const needsMeta = PL?.citeLabelNeedsMetadata?.(citeLabel);

      const row = document.createElement("button");
      row.type = "button";
      row.className = "methods-map-mention-row";
      if (m.linkedOnly) row.classList.add("methods-map-mention-row--muted");
      row.title = m.title
        ? `${m.title}${m.matchedTerm ? ` · «${m.matchedTerm}»` : ""}`
        : "";

      const quote = document.createElement("span");
      quote.className = "methods-map-mention-quote";
      if (m.linkedOnly) {
        quote.textContent =
          "Method linked — open article to save a passage on the Info tab.";
      } else {
        const excerpt = (m.excerpt || "").trim() || "…";
        fillQuoteWithHighlights(
          quote,
          excerpt,
          termsToHighlightInExcerpt(m, currentProfile)
        );
      }

      const cite = document.createElement("span");
      cite.className = "methods-map-mention-cite";
      if (needsMeta) cite.classList.add("methods-map-mention-cite--placeholder");
      cite.textContent = citeLabel;
      cite.setAttribute("aria-label", "Article citation");

      row.append(quote, cite);
      row.addEventListener("click", () => void openMention(m));
      listEl.appendChild(row);
    }
  }

  async function openMention(mention) {
    if (!mention?.articleId) return;
    const methodLabel = selectedMethodLabel || "";
    const scrollToTextSpan =
      !mention.linkedOnly && mention.offset != null
        ? {
            offset: mention.offset,
            length: mention.length || 20,
            methodLabel,
            expandToSentence: true,
          }
        : null;
    if (typeof window.litlensSelectArticle === "function") {
      await window.litlensSelectArticle(mention.articleId, {
        scrollToTextSpan,
        returnToMethodLabel: methodLabel || undefined,
      });
    }
  }

  function renderGrid(vocab) {
    const root = $("methods-map-grid");
    if (!root || !MP()) return;
    const { xCols, yRows, cells } = MP().buildMethodsMapGrid(vocab);

    const table = document.createElement("table");
    table.className = "methods-map-table";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const corner = document.createElement("th");
    corner.className = "methods-map-corner";
    corner.textContent = "Category ↓ · Modality →";
    headRow.appendChild(corner);
    for (const col of xCols) {
      const th = document.createElement("th");
      th.className = "methods-map-col-head";
      th.textContent = col.label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of yRows) {
      const tr = document.createElement("tr");
      const rowHead = document.createElement("th");
      rowHead.className = "methods-map-row-head";
      rowHead.textContent = row.label;
      tr.appendChild(rowHead);
      for (const col of xCols) {
        const td = document.createElement("td");
        td.className = "methods-map-cell";
        const key = `${row.key}|${col.key}`;
        const labels = cells.get(key) || [];
        if (labels.length) {
          const list = document.createElement("div");
          list.className = "methods-map-cell-list";
          for (const label of labels) {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "methods-map-method";
            const profile = MP().profileByLabel(vocab, label);
            if (profile && MP().hasFrameworkModality(profile.modalities)) {
              chip.classList.add("methods-map-method--framework");
            }
            if (profile && MP().hasDerivedModality(profile.modalities)) {
              chip.classList.add("methods-map-method--derived");
            }
            chip.textContent = label;
            chip.title = `View mentions in articles: ${label}`;
            chip.addEventListener("click", (e) => {
              e.stopPropagation();
              showMentionsPanel(label);
            });
            list.appendChild(chip);
          }
          td.appendChild(list);
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    root.replaceChildren(table);

    const count = (vocab.methodCatalog || []).length;
    const status = $("methods-map-status");
    if (status && !selectedMethodLabel) {
      status.textContent = `${count} method${count === 1 ? "" : "s"} in catalog — click a name for cross-article mentions`;
    }
  }

  async function refresh() {
    if (mapViewMode !== "grid") return;
    clearMethodCardState();
    applyMapViewMode();
    try {
      const vocab = await fetchVocab();
      renderGrid(vocab);
    } catch (e) {
      const root = $("methods-map-grid");
      if (root) {
        root.replaceChildren();
        const err = document.createElement("p");
        err.className = "bookmarks-empty";
        err.textContent = e.message || "Could not load catalog";
        root.appendChild(err);
      }
    }
  }

  function ensureMapOpen() {
    const mapView = $("methods-map-view");
    const body = $("article-body");
    const empty = $("empty-state");
    if (!mapView || mapOpen) return;
    const topbar = $("topbar-title");
    if (topbar) lastTopbarTitle = topbar.textContent;
    mapOpen = true;
    if (body) body.style.display = "none";
    if (empty) empty.style.display = "none";
    mapView.style.display = "block";
    const link = $("source-link");
    const del = $("delete-btn");
    if (link) link.style.display = "none";
    if (del) del.style.display = "none";
    updateMapButton();
  }

  function restoreArticlePane() {
    const mapView = $("methods-map-view");
    const body = $("article-body");
    const empty = $("empty-state");
    if (mapView) mapView.style.display = "none";
    hideMentionsPanel();
    const id =
      typeof window.litlensCurrentId === "function" ? window.litlensCurrentId() : null;
    const hasArticle = Boolean(id);
    if (hasArticle) {
      if (body) body.style.display = "block";
      if (empty) empty.style.display = "none";
    } else {
      if (body) body.style.display = "none";
      if (empty) empty.style.display = "flex";
    }
    const topbar = $("topbar-title");
    if (topbar) {
      topbar.textContent = lastTopbarTitle || "Select an article";
    }
    const link = $("source-link");
    const del = $("delete-btn");
    if (hasArticle && window.litlensGetArticles) {
      const article = window.litlensGetArticles().find((a) => a.id === id);
      if (article?.title && topbar) topbar.textContent = article.title;
      if (article?.url && link) {
        link.href = article.url;
        link.style.display = "inline-flex";
      } else if (link) {
        link.style.display = "none";
      }
      if (del) del.style.display = "flex";
    } else {
      if (link) link.style.display = "none";
      if (del) del.style.display = "none";
    }
  }

  function showMap() {
    ensureMapOpen();
    clearMethodCardState();
    mapViewMode = "grid";
    applyMapViewMode();
    void refresh();
    updateMapButton();
  }

  async function showCatalog() {
    ensureMapOpen();
    clearMethodCardState();
    mapViewMode = "catalog";
    applyMapViewMode();
    updateMapButton();
    if (window.MethodProfilesUI?.loadAndRender) {
      await window.MethodProfilesUI.loadAndRender(false);
    }
  }

  function hideMap() {
    mapOpen = false;
    mapViewMode = "grid";
    clearMethodCardState();
    restoreArticlePane();
    updateMapButton();
  }

  async function openMethodCard(methodLabel) {
    if (!methodLabel) return;
    ensureMapOpen();
    updateMapButton();
    await showMentionsPanel(methodLabel);
  }

  function toggleMap() {
    if (mapOpen) hideMap();
    else showMap();
  }

  function updateMapButton() {
    const mapLabel = mapOpen ? "Back to article" : "Methods map";
    const sidebarBtn = $("sidebar-methods-map-btn");
    if (sidebarBtn) {
      sidebarBtn.title = mapLabel;
      sidebarBtn.setAttribute("aria-label", mapLabel);
      sidebarBtn.setAttribute("aria-pressed", mapOpen ? "true" : "false");
    }
  }

  function bindMapNav() {
    const backArticle = $("methods-map-back-article");
    if (backArticle && !backArticle.dataset.bound) {
      backArticle.dataset.bound = "1";
      backArticle.addEventListener("click", () => hideMap());
    }
    const gridTab = $("methods-map-show-grid");
    if (gridTab && !gridTab.dataset.bound) {
      gridTab.dataset.bound = "1";
      gridTab.addEventListener("click", () => showMap());
    }
    const catalogTab = $("methods-map-show-catalog");
    if (catalogTab && !catalogTab.dataset.bound) {
      catalogTab.dataset.bound = "1";
      catalogTab.addEventListener("click", () => void showCatalog());
    }
    const editCatalog = $("methods-map-edit-catalog-btn");
    if (editCatalog && !editCatalog.dataset.bound) {
      editCatalog.dataset.bound = "1";
      editCatalog.addEventListener("click", () => void showCatalog());
    }
    const catalogBackMap = $("method-catalog-back-map");
    if (catalogBackMap && !catalogBackMap.dataset.bound) {
      catalogBackMap.dataset.bound = "1";
      catalogBackMap.addEventListener("click", () => showMap());
    }
  }

  function bindMapButton() {
    bindMapNav();
    const sidebarBtn = $("sidebar-methods-map-btn");
    if (sidebarBtn && !sidebarBtn.dataset.bound) {
      sidebarBtn.dataset.bound = "1";
      sidebarBtn.addEventListener("click", () => toggleMap());
    }
  }

  function bindMentionsBack() {
    const back = $("methods-map-mentions-back");
    if (!back || back.dataset.bound) return;
    back.dataset.bound = "1";
    back.addEventListener("click", () => {
      hideMentionsPanel();
      const status = $("methods-map-status");
      if (status) {
        status.textContent =
          "Click a method name for mentions across articles";
      }
    });
  }

  async function copyCurrentMethodLink() {
    if (!currentProfile) return;
    const links = ML();
    if (!links) return;
    const ok = await links.copyMethodLinkToClipboard(currentProfile);
    setCardSaveStatus(
      ok ? "Link copied — paste into Definition or other text" : "Could not copy",
      !ok
    );
    if (ok) window.setTimeout(() => setCardSaveStatus(""), 2800);
  }

  function bindMethodCard() {
    const toolbar = $("methods-map-card-toolbar");
    if (!toolbar || toolbar.dataset.bound) return;
    toolbar.dataset.bound = "1";
    $("methods-map-copy-link")?.addEventListener("click", (e) => {
      e.preventDefault();
      void copyCurrentMethodLink();
    });
    $("methods-map-card-edit")?.addEventListener("click", startCardEdit);
    $("methods-map-card-save")?.addEventListener("click", (e) => {
      e.preventDefault();
      void saveMethodCard();
    });
    $("methods-map-card-cancel")?.addEventListener("click", cancelCardEdit);
  }

  function init() {
    bindMapButton();
    bindMentionsBack();
    bindMethodCard();
    updateMapButton();
  }

  window.LitLensMethodsMap = {
    init,
    show: showMap,
    hide: hideMap,
    toggle: toggleMap,
    refresh,
    isOpen: () => mapOpen,
    showCatalog,
    showMentions: showMentionsPanel,
    openMethodCard,
    termsToHighlightInExcerpt,
    fillQuoteWithHighlights,
  };

  init();
})();
