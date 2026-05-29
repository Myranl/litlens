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
  /** @type {'passages' | 'library'} */
  let mentionsSubTab = "passages";
  /** @type {{ label: string, data: object } | null} */
  let libraryScanCache = null;
  let libraryScanLoading = false;

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
    purpose: "Purpose",
    naming: "Naming",
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

  function methodEvidenceStorageKey(me, methodLabel) {
    if (!me || typeof me !== "object" || !methodLabel) return null;
    if (Array.isArray(me[methodLabel])) return methodLabel;
    const q = String(methodLabel).trim().toLowerCase();
    return Object.keys(me).find((k) => k.toLowerCase() === q) || null;
  }

  function evidenceOverlapsPassage(ev, passage) {
    if (ev?.offset == null || passage?.offset == null) return false;
    const a0 = ev.offset;
    const a1 = ev.offset + Math.max(1, ev.length || 1);
    const b0 = passage.offset;
    const b1 = passage.offset + Math.max(1, passage.length || 1);
    return a0 < b1 && b0 < a1;
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

  function renderLibraryCoverage(methodLabel, articles) {
    const el = $("methods-map-library-coverage");
    const MPapi = MP();
    if (!el || !MPapi) return;
    const list = articles || libraryArticles || [];
    const total = list.length;
    const used = MPapi.countMethodArticles(list, methodLabel);
    const share = MPapi.formatMethodLibraryShare(used, total);
    const articleWord = share.total === 1 ? "article" : "articles";
    el.textContent = `Appears in ${share.used} / ${share.total} ${articleWord} (${share.percentLabel}%)`;
    el.hidden = false;
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
    const rotateLabels = years.length > 5;
    const labelStride =
      years.length <= 10 ? 1 : years.length <= 18 ? 2 : Math.ceil(years.length / 9);
    const pad = { l: 30, r: 8, t: 10, b: rotateLabels ? 40 : 26 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    const gap = Math.min(10, plotW / years.length / 3);
    const barW = Math.max(6, (plotW - gap * (years.length - 1)) / years.length);

    function shouldShowYearLabel(index, totalYears) {
      if (totalYears <= 1) return true;
      if (index === 0 || index === totalYears - 1) return true;
      if (labelStride <= 1) return true;
      return index % labelStride === 0;
    }

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

      if (!shouldShowYearLabel(i, years.length)) return;

      const xl = document.createElementNS("http://www.w3.org/2000/svg", "text");
      xl.setAttribute("class", "methods-map-chart-tick");
      const cx = x + barW / 2;
      const cy = h - pad.b + (rotateLabels ? 4 : 13);
      xl.setAttribute("x", String(cx));
      xl.setAttribute("y", String(cy));
      if (rotateLabels) {
        xl.setAttribute("text-anchor", "end");
        xl.setAttribute("transform", `rotate(-55 ${cx} ${cy})`);
      } else {
        xl.setAttribute("text-anchor", "middle");
      }
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
        currentProfile?.variants,
        currentProfile?.firstIn
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


  function relationsPanelEl() {
    return $("methods-map-relations-panel");
  }

  function firstInPanelEl() {
    return $("methods-map-first-in-panel");
  }

  function readFirstInFromPanel() {
    const panel = firstInPanelEl();
    const MPapi = MP();
    if (!panel || !MPapi?.normalizeFirstIn) return [];
    const raw = [];
    for (const row of panel.querySelectorAll(".methods-map-first-in-row")) {
      raw.push({
        name: row.querySelector('[data-first-in-field="name"]')?.value,
        year: row.querySelector('[data-first-in-field="year"]')?.value,
        url: row.querySelector('[data-first-in-field="url"]')?.value,
        comment: row.querySelector('[data-first-in-field="comment"]')?.value,
      });
    }
    return MPapi.normalizeFirstIn(raw);
  }

  function renderFirstInPanel(profile) {
    const panel = firstInPanelEl();
    const MPapi = MP();
    if (!panel || !profile || !MPapi) return;
    const catalogProfile = profileForCard(profile) || profile;
    let entries = MPapi.normalizeFirstIn(catalogProfile.firstIn);
    entries = [...entries].sort((a, b) => {
      const yearA = parseInt(String(a?.year || "").match(/\b(19|20)\d{2}\b/)?.[0] || "0", 10) || 0;
      const yearB = parseInt(String(b?.year || "").match(/\b(19|20)\d{2}\b/)?.[0] || "0", 10) || 0;
      const hasA = yearA > 0;
      const hasB = yearB > 0;
      if (!hasA && !hasB) {
        return String(a?.name || "").localeCompare(String(b?.name || ""), undefined, {
          sensitivity: "base",
        });
      }
      if (!hasA) return 1;
      if (!hasB) return -1;
      if (yearA !== yearB) return yearB - yearA;
      return String(a?.name || "").localeCompare(String(b?.name || ""), undefined, {
        sensitivity: "base",
      });
    });
    catalogProfile.firstIn = entries;
    profile.firstIn = entries;

    panel.replaceChildren();
    const section = document.createElement("section");
    section.className = "methods-map-first-in-section";

    const head = document.createElement("h4");
    head.className = "methods-map-doc-heading notes-label";
    head.textContent = "First in…";
    const hint = document.createElement("p");
    hint.className = "meta-hint methods-map-first-in-hint";
    hint.textContent =
      "First report of this metric or a variant (external source).";
    section.append(head, hint);

    if (cardEditing) {
      const list = document.createElement("div");
      list.className = "methods-map-first-in-list";
      const profileRef = catalogProfile;
      if (!Array.isArray(profileRef.firstIn)) profileRef.firstIn = [];

      const renderRows = () => {
        list.replaceChildren();
        profileRef.firstIn.forEach((entry, rowIdx) => {
          const row = document.createElement("div");
          row.className = "methods-map-first-in-row";

          const grid = document.createElement("div");
          grid.className = "methods-map-first-in-fields";
          const fieldDefs = [
            {
              key: "name",
              label: "Name",
              placeholder: "Metric or variant",
              type: "text",
            },
            {
              key: "year",
              label: "Year",
              placeholder: "e.g. 2012",
              type: "text",
            },
            {
              key: "url",
              label: "Link",
              placeholder: "https://…",
              type: "url",
            },
            {
              key: "comment",
              label: "Comment",
              placeholder: "Optional note",
              type: "text",
            },
          ];
          for (const f of fieldDefs) {
            const lab = document.createElement("label");
            lab.className =
              "methods-map-first-in-field" +
              (f.key === "comment" ? " methods-map-first-in-field--comment" : "");
            const span = document.createElement("span");
            span.className = "methods-map-first-in-field-label";
            span.textContent = f.label;
            let control;
            if (f.key === "comment") {
              control = document.createElement("textarea");
              control.className =
                "form-input methods-map-first-in-comment-input";
              control.rows = 4;
              control.value = entry.comment || "";
            } else {
              control = document.createElement("input");
              control.type = f.type;
              control.value = entry[f.key] || "";
            }
            control.dataset.firstInField = f.key;
            control.placeholder = f.placeholder;
            lab.append(span, control);
            grid.appendChild(lab);
          }

          const del = document.createElement("button");
          del.type = "button";
          del.className = "btn-sm btn-ghost methods-map-first-in-remove";
          del.textContent = "×";
          del.title = "Remove entry";
          del.addEventListener("click", () => {
            profileRef.firstIn.splice(rowIdx, 1);
            renderRows();
          });
          row.append(grid, del);
          list.appendChild(row);
        });

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "btn-sm btn-ghost methods-map-first-in-add";
        addBtn.textContent = "+ Entry";
        addBtn.addEventListener("click", () => {
          profileRef.firstIn.push({ name: "", year: "", url: "", comment: "" });
          renderRows();
          list.querySelector('[data-first-in-field="name"]')?.focus();
        });
        list.appendChild(addBtn);
      };

      renderRows();
      section.appendChild(list);
    } else if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "methods-map-first-in-empty";
      empty.textContent = "—";
      section.appendChild(empty);
    } else {
      const list = document.createElement("ul");
      list.className = "methods-map-first-in-read-list";
      for (const e of entries) {
        const li = document.createElement("li");
        li.className = "methods-map-first-in-read-item";
        const head = document.createElement("div");
        head.className = "methods-map-first-in-read-head";
        const title = document.createElement("span");
        title.className = "methods-map-first-in-read-title";
        const name = e.name || "—";
        title.textContent = e.year ? `${name} (${e.year})` : name;
        head.appendChild(title);
        if (e.url) {
          const a = document.createElement("a");
          a.className = "methods-map-first-in-read-link-icon";
          a.href = e.url;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.title = e.url;
          a.setAttribute("aria-label", "Open source link");
          a.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
          head.appendChild(a);
        }
        li.appendChild(head);
        if (e.comment) {
          const c = document.createElement("div");
          c.className = "methods-map-first-in-read-comment";
          c.textContent = e.comment;
          li.appendChild(c);
        }
        list.appendChild(li);
      }
      section.appendChild(list);
    }

    panel.appendChild(section);
  }

  function refreshRelationsOnCard() {
    if (cardEditing) return; // don't disrupt editing
    const panel = relationsPanelEl();
    const links = ML();
    if (!panel || !currentProfile || !links) return;
    const section = panel.querySelector(".methods-map-relations-section");
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
    const PL = window.LitLensPassageLinks;
    const links = ML();
    return MP().normalizeVariants(
      [...wrap.querySelectorAll(
        ".profile-variant-row textarea, .profile-variant-row input"
      )].map((el) => {
        let val = el.value;
        if (links?.normalizeDocFieldText) {
          val = links.normalizeDocFieldText(val);
        } else if (PL?.normalizeCiteSourceText) {
          val = PL.normalizeCiteSourceText(val);
        }
        return val;
      })
    );
  }

  function appendVariantViewContent(li, raw) {
    const PL = window.LitLensPassageLinks;
    const links = ML();
    const IF = window.LitLensInlineFormat;
    const text = links?.normalizeDocFieldText
      ? links.normalizeDocFieldText(raw)
      : PL?.normalizeCiteSourceText
        ? PL.normalizeCiteSourceText(raw)
        : String(raw || "");
    const hasCite = PL?.hasCiteMarkup?.(text);
    const hasMethodLink =
      links?.hasMethodLinkMarkup?.(text) || /\[\[method:/i.test(text);
    const hasFmt = IF?.hasInlineFormat?.(text);
    if (
      links &&
      (hasCite || hasMethodLink || hasFmt) &&
      links.renderMethodDocFragment
    ) {
      li.appendChild(
        links.renderMethodDocFragment(text, {
          articlesById,
          onCiteClick: openCitation,
          citeStore: passageCiteStore(),
          vocab: vocabCache,
          onMethodClick: (label) => void openMethodCard(label),
        })
      );
    } else if (hasCite && PL) {
      li.appendChild(
        PL.renderDocFragment(
          text,
          articlesById,
          openCitation,
          passageCiteStore()
        )
      );
    } else if (hasFmt && IF?.appendFormattedText) {
      IF.appendFormattedText(li, text);
    } else {
      li.textContent = text;
    }
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
        rich: true,
        previewCtx: {
          articlesById,
          onCiteClick: openCitation,
          citeStore: passageCiteStore(),
          vocab: vocabCache,
          onMethodClick: (label) => void openMethodCard(label),
        },
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
          li.className = "methods-map-variant-line methods-map-doc-text";
          appendVariantViewContent(li, v);
          list.appendChild(li);
        }
        section.appendChild(list);
      }
    }
    card.appendChild(section);
  }

  function renderRelationsPanel(profile) {
    const panel = relationsPanelEl();
    const links = ML();
    if (!panel || !profile || !links) return;
    panel.replaceChildren();
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
    panel.appendChild(relSection);
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
      const raw = ML()?.normalizeDocFieldText
        ? ML().normalizeDocFieldText(profile.doc[key])
        : PL?.normalizeCiteSourceText
          ? PL.normalizeCiteSourceText(profile.doc[key])
          : String(profile.doc[key] || "");
      const hasText = raw.trim().length > 0;
      const hasCite =
        PL && (PL.hasCiteMarkup ? PL.hasCiteMarkup(raw) : /\[\[litlens:/i.test(raw));
      const hasMethodLink =
        links?.hasMethodLinkMarkup?.(raw) || /\[\[method:/i.test(raw);
      const IF = window.LitLensInlineFormat;
      const hasFmt = IF?.hasInlineFormat?.(raw);
      if (hasText || hasCite || hasMethodLink || hasFmt) {
        const body = document.createElement("div");
        body.className = "methods-map-doc-text";
        if (
          links &&
          (hasCite || hasMethodLink || hasFmt) &&
          links.renderMethodDocFragment
        ) {
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
        } else if (hasFmt && IF?.appendFormattedText) {
          IF.appendFormattedText(body, raw);
        } else {
          body.textContent = raw;
        }
        section.appendChild(body);
      }
      card.appendChild(section);
    }
    appendVariantsToCard(card, profile, false);
    renderRelationsPanel(profile);
  }

  function renderMethodCardEdit(profile) {
    const card = $("methods-map-method-card");
    const PL = window.LitLensPassageLinks;
    const links = ML();
    if (!card || !profile) return;
    card.replaceChildren();
    if (!profile.doc) profile.doc = MP().emptyDoc();

    renderRelationsPanel(profile);

    for (const key of MP().DOC_FIELDS) {
      const section = document.createElement("section");
      section.className = "methods-map-doc-section methods-map-doc-section--edit";
      const head = document.createElement("h4");
      head.className = "methods-map-doc-heading";
      head.textContent = DOC_FIELD_LABELS[key] || key;
      const IF = window.LitLensInlineFormat;
      const ta = document.createElement("textarea");
      const fmtBar =
        IF?.buildFormatToolbar ? IF.buildFormatToolbar(ta) : null;
      ta.className = "methods-map-doc-textarea";
      ta.dataset.docField = key;
      ta.rows = key === "definition" ? 3 : 2;
      ta.value = profile.doc[key] || "";
      ta.placeholder =
        "Formatting: <b>bold</b>, <i>italic</i>, <ul><li>bullets</li></ul>. " +
        "Paste [[cite:…]] from a passage row (⎘). Preview below.";
      const preview = document.createElement("div");
      preview.className = "methods-map-doc-preview";
      preview.hidden = true;
      const syncPreview = () => {
        const val = ta.value;
        const hasCite = PL?.hasCiteMarkup?.(val);
        const hasMethodLink =
          links?.hasMethodLinkMarkup?.(val) || /\[\[method:/i.test(val);
        const hasFmt = IF?.hasInlineFormat?.(val);
        if (!hasCite && !hasMethodLink && !hasFmt) {
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
        } else if (hasFmt && IF?.appendFormattedText) {
          IF.appendFormattedText(preview, val);
        }
      };
      ta.addEventListener("input", syncPreview);
      ta.addEventListener("paste", () => window.setTimeout(syncPreview, 0));
      if (fmtBar) {
        fmtBar.querySelectorAll("button").forEach((btn) => {
          btn.addEventListener("click", () => window.setTimeout(syncPreview, 0));
        });
        section.append(head, fmtBar, ta, preview);
      } else {
        section.append(head, ta, preview);
      }
      card.appendChild(section);
      syncPreview();
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
        if (ML()?.normalizeDocFieldText) {
          val = ML().normalizeDocFieldText(val);
        } else if (window.LitLensPassageLinks?.normalizeCiteSourceText) {
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
    if (cardEditing) {
      currentProfile.firstIn = readFirstInFromPanel();
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
    renderFirstInPanel(currentProfile);
  }

  /** Write doc + relations (+ variants, firstIn) onto the catalog entry inside vocab (by label). */
  function applyDocToVocab(vocab, methodLabel, doc, relations, variants, firstIn) {
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
        firstIn: firstIn !== undefined ? firstIn : [],
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
      if (firstIn !== undefined) {
        profile.firstIn = MPapi.normalizeFirstIn(firstIn);
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
      const editor = relationsPanelEl()?.querySelector(
        ".methods-map-relations-section .method-relations-editor"
      );
      // applyDocToVocab ensures the profile is in the catalog (creates if missing).
      // Relation chips live only in the editor until save — don't write stale relations here.
      currentProfile = applyDocToVocab(
        vocab,
        selectedMethodLabel,
        doc,
        editor ? [] : currentProfile?.relations,
        currentProfile?.variants,
        currentProfile?.firstIn
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
      renderMethodCard();

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
    renderMethodCard();
    const first = $("methods-map-method-card")?.querySelector("textarea");
    first?.focus();
  }

  function cancelCardEdit() {
    setCardToolbarEditing(false);
    renderMethodCard();
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

  function setMentionsSubTab(tab) {
    mentionsSubTab = tab === "library" ? "library" : "passages";
    const isLibrary = mentionsSubTab === "library";
    const passagesTab = $("methods-map-tab-passages");
    const libraryTab = $("methods-map-tab-library");
    const panels = $("methods-map-mentions-panels");
    const hintEl = $("methods-map-mentions-hint");

    passagesTab?.classList.toggle(
      "methods-map-mentions-subtab--active",
      !isLibrary
    );
    passagesTab?.setAttribute("aria-selected", !isLibrary ? "true" : "false");
    libraryTab?.classList.toggle("methods-map-mentions-subtab--active", isLibrary);
    libraryTab?.setAttribute("aria-selected", isLibrary ? "true" : "false");

    panels?.classList.toggle("methods-map-mentions-panels--library", isLibrary);

    if (hintEl) {
      if (isLibrary && libraryScanCache?.label === selectedMethodLabel) {
        hintEl.textContent = libraryScanHintText(libraryScanCache.data);
      } else if (!isLibrary && selectedMethodLabel) {
        hintEl.textContent =
          "Saved passages you confirmed on the Info tab. ⎘ copy cite link · ✕ remove. Switch to Library scan for new matches.";
      }
    }

    if (isLibrary) void ensureLibraryScan();
  }

  function libraryHitDismissKey(offset, length) {
    const label = String(selectedMethodLabel || "")
      .trim()
      .toLowerCase();
    const len = Math.max(1, length || 1);
    return `methods:${label}@${offset}:${len}`;
  }

  function parseLibraryHitDismissKey(key) {
    const m = /^methods:([^@]+)@(\d+)(?::(\d+))?$/.exec(String(key || ""));
    if (!m) return null;
    return {
      label: m[1].toLowerCase(),
      offset: parseInt(m[2], 10),
      length: m[3] != null ? Math.max(1, parseInt(m[3], 10)) : null,
    };
  }

  function libraryHitDismissed(article, hit) {
    const label = String(selectedMethodLabel || "")
      .trim()
      .toLowerCase();
    if (!label || hit?.offset == null) return false;
    const h0 = hit.offset;
    const h1 = h0 + Math.max(1, hit.length || 1);
    for (const key of article?.methodSuggestionsDismissedHits || []) {
      const p = parseLibraryHitDismissKey(key);
      if (!p || p.label !== label) continue;
      const dLen = p.length != null ? p.length : 1;
      const d1 = p.offset + dLen;
      if (p.offset < h1 && d1 > h0) return true;
    }
    return false;
  }

  function articleSkipsMethodLibraryScan(article, methodLabel) {
    const MPapi = MP();
    if (MPapi?.articleSkipsMethodLibraryScan) {
      return MPapi.articleSkipsMethodLibraryScan(article, methodLabel);
    }
    if (!article) return false;
    const label = methodLabel || selectedMethodLabel;
    if (evidenceForMethod(article, label).length > 0) return true;
    return articleHasMethod(article, label);
  }

  function isMethodAbsentFromArticle(article, methodLabel) {
    const MPapi = MP();
    if (MPapi?.isMethodAbsentFromArticle) {
      return MPapi.isMethodAbsentFromArticle(article, methodLabel);
    }
    const q = String(methodLabel || "").trim().toLowerCase();
    const list = article?.methodAbsentLabels || [];
    return list.some((l) => String(l).trim().toLowerCase() === q);
  }

  function isLibraryHitPending(articleId, hit) {
    const article = articlesById.get(articleId);
    if (!article || hit?.offset == null) return false;
    if (isMethodAbsentFromArticle(article, selectedMethodLabel)) return false;
    if (articleSkipsMethodLibraryScan(article, selectedMethodLabel)) {
      return false;
    }
    const evidence = evidenceForMethod(article, selectedMethodLabel);
    if (evidence.some((e) => evidenceOverlapsPassage(e, hit))) {
      return false;
    }
    return !libraryHitDismissed(article, hit);
  }

  function pruneLibraryScanCacheHit(articleId, offset) {
    const cache = libraryScanCache?.data;
    if (!cache?.articles) return;
    for (const art of cache.articles) {
      if (art.articleId !== articleId) continue;
      art.hits = (art.hits || []).filter((h) => h.offset !== offset);
      art.hitCount = art.hits.length;
      break;
    }
    cache.articles = cache.articles.filter(
      (a) => (a.hits?.length || a.hitCount || 0) > 0
    );
    cache.totalPassages = cache.articles.reduce(
      (s, a) => s + (a.hits?.length || a.hitCount || 0),
      0
    );
    cache.articleCount = cache.articles.length;
  }

  async function patchArticleMeta(articleId, patch) {
    const res = await fetch(`${API}/articles/${articleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || res.statusText || "Save failed");
    return body;
  }

  function mergeArticleIntoLibraryState(updated) {
    if (!updated?.id) return;
    articlesById.set(updated.id, updated);
    libraryArticles = libraryArticles.map((a) =>
      a.id === updated.id ? { ...a, ...updated } : a
    );
  }

  async function acceptLibraryScanHit(articleId, hit) {
    const label = selectedMethodLabel;
    if (!articleId || !label || hit?.offset == null) return;
    let article = articlesById.get(articleId);
    if (!article) {
      const res = await fetch(`${API}/articles/${articleId}`);
      if (!res.ok) throw new Error("Could not load article");
      article = await res.json();
      mergeArticleIntoLibraryState(article);
    }
    const me = {
      ...(article.methodEvidence && typeof article.methodEvidence === "object"
        ? article.methodEvidence
        : {}),
    };
    const list = Array.isArray(me[label]) ? [...me[label]] : [];
    const excerpt = String(hit.excerpt || hit.quote || "").trim();
    const candidate = {
      id: `ev-${hit.offset}`,
      excerpt,
      offset: hit.offset,
      length: hit.length || 20,
      matchedTerm: hit.matchedTerm || "",
      matchType: hit.matchType || "direct",
      sentenceBounds: true,
    };
    if (
      !list.some(
        (e) =>
          e.offset === candidate.offset &&
          Math.max(1, e.length || 1) === candidate.length
      )
    ) {
      list.push(candidate);
    }
    me[label] = list;

    const structured = {
      ...(article.structured || {}),
      methods: [...(article.structured?.methods || [])],
    };
    const q = label.toLowerCase();
    if (!structured.methods.some((m) => String(m).toLowerCase() === q)) {
      structured.methods.push(label);
    }

    const updated = await patchArticleMeta(articleId, {
      methodEvidence: me,
      structured,
    });
    mergeArticleIntoLibraryState(updated);
    pruneLibraryScanCacheArticle(articleId);
    renderLibraryScan(libraryScanCache?.data);
    renderLibraryAbsentList();
    const hintEl = $("methods-map-mentions-hint");
    if (hintEl && libraryScanCache?.data) {
      hintEl.textContent = libraryScanHintText(libraryScanCache.data);
    }
  }

  async function refreshSavedMentionsList() {
    const label = selectedMethodLabel;
    const hintEl = $("methods-map-mentions-hint");
    const listEl = $("methods-map-mentions-list");
    if (!label || !listEl) return;
    const mentions = await collectMentions(label);
    const groups = await buildSavedMentionGroups(mentions);
    const passageCount = groups.reduce(
      (s, g) => s + g.passages.length + (g.linkedOnly ? 1 : 0),
      0
    );
    if (hintEl) {
      hintEl.textContent = passageCount
        ? `${passageCount} saved passage${passageCount === 1 ? "" : "s"} in ${groups.length} article${groups.length === 1 ? "" : "s"}. Click to open · right-click excerpt for cite link.`
        : "No passages saved yet. Link this method on the Info tab to add excerpts.";
    }
    renderMentionsList(groups);
  }

  async function removeSavedPassage(articleId, passage) {
    const label = selectedMethodLabel;
    if (!articleId || !label || passage?.offset == null) return;
    let article = articlesById.get(articleId);
    if (!article) {
      const res = await fetch(`${API}/articles/${articleId}`);
      if (!res.ok) throw new Error("Could not load article");
      article = await res.json();
      mergeArticleIntoLibraryState(article);
    }
    const me = {
      ...(article.methodEvidence && typeof article.methodEvidence === "object"
        ? article.methodEvidence
        : {}),
    };
    const key = methodEvidenceStorageKey(me, label);
    const list = key && Array.isArray(me[key]) ? [...me[key]] : [];
    const kept = list.filter((ev) => !evidenceOverlapsPassage(ev, passage));
    if (kept.length === list.length) {
      setCardSaveStatus("Passage not found in saved evidence", true);
      return;
    }

    if (kept.length) me[key] = kept;
    else delete me[key];

    const structured = {
      ...(article.structured || {}),
      methods: [...(article.structured?.methods || [])],
    };
    if (!kept.length) {
      const q = label.toLowerCase();
      structured.methods = structured.methods.filter(
        (m) => String(m).toLowerCase() !== q
      );
    }

    const updated = await patchArticleMeta(articleId, {
      methodEvidence: me,
      structured,
    });
    mergeArticleIntoLibraryState(updated);

    if (
      typeof window.litlensCurrentId === "function" &&
      window.litlensCurrentId() === articleId &&
      window.StructuredMeta?.setFromArticle
    ) {
      window.StructuredMeta.setFromArticle(updated);
    }

    await refreshSavedMentionsList();
    setCardSaveStatus("Saved passage removed");
    window.setTimeout(() => setCardSaveStatus(""), 2400);
  }

  function pruneLibraryScanCacheArticle(articleId) {
    const cache = libraryScanCache?.data;
    if (!cache?.articles) return;
    cache.articles = cache.articles.filter((a) => a.articleId !== articleId);
    cache.totalPassages = cache.articles.reduce(
      (s, a) => s + (a.hits?.length || a.hitCount || 0),
      0
    );
    cache.articleCount = cache.articles.length;
  }

  async function markLibraryScanArticleAbsent(articleId) {
    const label = selectedMethodLabel;
    if (!articleId || !label) return;
    let article = articlesById.get(articleId);
    if (!article) {
      const res = await fetch(`${API}/articles/${articleId}`);
      if (!res.ok) throw new Error("Could not load article");
      article = await res.json();
      mergeArticleIntoLibraryState(article);
    }
    const MPapi = MP();
    let absent = MPapi?.normalizeMethodAbsentLabels
      ? MPapi.normalizeMethodAbsentLabels(article.methodAbsentLabels)
      : [...(article.methodAbsentLabels || [])].map((l) => String(l).trim()).filter(Boolean);
    const q = label.toLowerCase();
    if (!absent.some((l) => l.toLowerCase() === q)) absent.push(label);

    const updated = await patchArticleMeta(articleId, {
      methodAbsentLabels: absent,
    });
    mergeArticleIntoLibraryState(updated);
    pruneLibraryScanCacheArticle(articleId);
    renderLibraryScan(libraryScanCache?.data);
    renderLibraryAbsentList();
    const hintEl = $("methods-map-mentions-hint");
    if (hintEl && libraryScanCache?.data) {
      hintEl.textContent = libraryScanHintText(libraryScanCache.data);
    }
    setCardSaveStatus("Marked as not in this article");
    window.setTimeout(() => setCardSaveStatus(""), 2400);
  }

  async function unmarkLibraryScanArticleAbsent(articleId) {
    const label = selectedMethodLabel;
    if (!articleId || !label) return;
    let article = articlesById.get(articleId);
    if (!article) {
      const res = await fetch(`${API}/articles/${articleId}`);
      if (!res.ok) throw new Error("Could not load article");
      article = await res.json();
      mergeArticleIntoLibraryState(article);
    }
    const q = label.toLowerCase();
    const absent = (article.methodAbsentLabels || []).filter(
      (l) => String(l).trim().toLowerCase() !== q
    );
    const updated = await patchArticleMeta(articleId, {
      methodAbsentLabels: absent,
    });
    mergeArticleIntoLibraryState(updated);
    libraryScanCache = null;
    renderLibraryAbsentList();
    await ensureLibraryScan();
    setCardSaveStatus("Restored for library scan");
    window.setTimeout(() => setCardSaveStatus(""), 2400);
  }

  function collectAbsentArticlesForMethod(methodLabel) {
    const q = String(methodLabel || "").trim().toLowerCase();
    if (!q) return [];
    const out = [];
    for (const article of libraryArticles) {
      if (isMethodAbsentFromArticle(article, methodLabel)) {
        out.push(article);
      }
    }
    const PL = window.LitLensPassageLinks;
    if (PL?.compareArticlesBibliographic) {
      out.sort((a, b) => PL.compareArticlesBibliographic(a, b));
    }
    return out;
  }

  function renderLibraryAbsentList() {
    const wrap = $("methods-map-library-absent-wrap");
    const label = selectedMethodLabel;
    if (!wrap || !label) return;
    const absent = collectAbsentArticlesForMethod(label);
    wrap.replaceChildren();
    if (!absent.length) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;

    const head = document.createElement("div");
    head.className = "methods-map-library-absent-head";
    const title = document.createElement("h4");
    title.className = "methods-map-library-absent-title";
    title.textContent = "Definitely not in these articles";
    const hint = document.createElement("p");
    hint.className = "methods-map-library-absent-hint";
    hint.textContent =
      "Excluded from library scan for this method. Restore if that was a mistake.";
    head.append(title, hint);
    wrap.appendChild(head);

    const list = document.createElement("ul");
    list.className = "methods-map-library-absent-list";
    const PL = window.LitLensPassageLinks;
    for (const article of absent) {
      const li = document.createElement("li");
      li.className = "methods-map-library-absent-row";
      const cite = document.createElement("span");
      cite.className = "methods-map-library-absent-cite";
      cite.textContent = PL?.formatCiteLabel
        ? PL.formatCiteLabel(article)
        : article.title || "Untitled";
      const restoreBtn = document.createElement("button");
      restoreBtn.type = "button";
      restoreBtn.className = "btn-sm btn-ghost methods-map-library-absent-restore";
      restoreBtn.textContent = "Restore";
      restoreBtn.title = "Show this article in library scan again";
      restoreBtn.addEventListener("click", () => {
        restoreBtn.disabled = true;
        void unmarkLibraryScanArticleAbsent(article.id).catch((e) => {
          restoreBtn.disabled = false;
          setCardSaveStatus(e.message || "Restore failed", true);
        });
      });
      li.append(cite, restoreBtn);
      list.appendChild(li);
    }
    wrap.appendChild(list);
  }

  async function dismissLibraryScanHit(articleId, hit) {
    const label = selectedMethodLabel;
    if (!articleId || !label || hit?.offset == null) return;
    let article = articlesById.get(articleId);
    if (!article) {
      const res = await fetch(`${API}/articles/${articleId}`);
      if (!res.ok) throw new Error("Could not load article");
      article = await res.json();
      mergeArticleIntoLibraryState(article);
    }
    const dismissed = [
      ...(article.methodSuggestionsDismissedHits || []),
    ];
    const key = libraryHitDismissKey(hit.offset, hit.length);
    if (!dismissed.includes(key)) dismissed.push(key);
    const legacyOnly = `methods:${String(label).trim().toLowerCase()}@${hit.offset}`;
    if (!dismissed.includes(legacyOnly)) dismissed.push(legacyOnly);
    const updated = await patchArticleMeta(articleId, {
      methodSuggestionsDismissedHits: dismissed,
    });
    mergeArticleIntoLibraryState(updated);
    pruneLibraryScanCacheHit(articleId, hit.offset);
    renderLibraryScan(libraryScanCache?.data);
    const hintEl = $("methods-map-mentions-hint");
    if (hintEl && libraryScanCache?.data) {
      hintEl.textContent = libraryScanHintText(libraryScanCache.data);
    }
  }

  function countPendingLibraryScan(data) {
    let passages = 0;
    let articles = 0;
    for (const art of data?.articles || []) {
      const pending = (art.hits || []).filter((h) =>
        isLibraryHitPending(art.articleId, h)
      );
      if (pending.length) {
        passages += pending.length;
        articles += 1;
      }
    }
    return { passages, articles };
  }

  function formatCitationExportLine(articleMeta, excerpt) {
    const authors = String(articleMeta?.authors || "").trim() || "[Author?]";
    const year =
      String(articleMeta?.year || articleMeta?.structured?.year || "").trim() ||
      "[Year?]";
    const quote = String(excerpt || "")
      .replace(/\s+/g, " ")
      .trim();
    return quote ? `${authors}, ${year} - ${quote}` : `${authors}, ${year}`;
  }

  function citationExportFilename(methodLabel) {
    const MPapi = MP();
    const slug = MPapi?.slugify
      ? MPapi.slugify(methodLabel)
      : String(methodLabel || "method")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
    const date = new Date().toISOString().slice(0, 10);
    return `${slug || "method"}-citations-${date}.txt`;
  }

  function downloadTextFile(filename, text) {
    const blob = new Blob([String(text || "")], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  async function collectCitationExportLines(methodLabel) {
    const saved = [];
    const pending = [];
    const mentions = await collectMentions(methodLabel);
    const groups = await buildSavedMentionGroups(mentions);
    const PL = window.LitLensPassageLinks;
    const sortByYear = PL?.compareArticlesByYear || PL?.compareArticlesBibliographic;
    if (sortByYear) {
      groups.sort((a, b) => sortByYear(a, b));
    }
    for (const g of groups) {
      const meta =
        articlesById.get(g.articleId) ||
        {
          title: g.title,
          authors: g.authors,
          year: g.year,
        };
      for (const p of g.passages || []) {
        const excerpt = String(p.excerpt || "").trim();
        if (!excerpt) continue;
        saved.push(formatCitationExportLine(meta, excerpt));
      }
    }

    if (
      libraryScanCache?.label === methodLabel &&
      libraryScanCache.data?.profileFound
    ) {
      const data = libraryScanCache.data;
      const arts = [...(data.articles || [])];
      if (PL?.compareArticlesBibliographic) {
        arts.sort((a, b) => PL.compareArticlesBibliographic(a, b));
      }
      for (const art of arts) {
        const articleMeta = articlesById.get(art.articleId) || art;
        if (articleSkipsMethodLibraryScan(articleMeta, methodLabel)) continue;
        const hits = (art.hits || []).filter((h) =>
          isLibraryHitPending(art.articleId, h)
        );
        for (const h of hits) {
          const excerpt = String(h.excerpt || h.quote || "").trim();
          if (!excerpt) continue;
          pending.push(formatCitationExportLine(articleMeta, excerpt));
        }
      }
    }

    return { saved, pending };
  }

  async function exportMethodCitations() {
    const label = String(selectedMethodLabel || "").trim();
    if (!label) {
      setCardSaveStatus("Open a method card first", true);
      return;
    }
    const btn = $("methods-map-export-citations");
    if (btn) btn.disabled = true;
    setCardSaveStatus("Preparing export…");
    try {
      if (!libraryScanCache?.data || libraryScanCache.label !== label) {
        await ensureLibraryScan(true);
      }
      const { saved, pending } = await collectCitationExportLines(label);
      const lines = [];
      const stamp = new Date().toISOString().slice(0, 10);
      lines.push(`Method: ${label}`);
      lines.push(`Exported: ${stamp}`);
      lines.push("");

      if (saved.length) {
        lines.push("=== Saved passages ===");
        lines.push(...saved);
        lines.push("");
      }
      if (pending.length) {
        lines.push("=== Library scan (pending) ===");
        lines.push(...pending);
        lines.push("");
      }

      const total = saved.length + pending.length;
      if (!total) {
        setCardSaveStatus("No passages to export", true);
        window.setTimeout(() => setCardSaveStatus(""), 2800);
        return;
      }

      if (lines[lines.length - 1] === "") lines.pop();
      downloadTextFile(citationExportFilename(label), `${lines.join("\n")}\n`);
      const parts = [];
      if (saved.length) {
        parts.push(`${saved.length} saved`);
      }
      if (pending.length) {
        parts.push(`${pending.length} pending`);
      }
      setCardSaveStatus(`Exported ${parts.join(", ")} — .txt downloaded`);
      window.setTimeout(() => setCardSaveStatus(""), 3200);
    } catch (e) {
      setCardSaveStatus(e.message || "Export failed", true);
      window.setTimeout(() => setCardSaveStatus(""), 3200);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function libraryScanHintText(data) {
    if (!data?.profileFound) {
      return "Method not in catalog — add it in Method catalog to scan triggers.";
    }
    const { passages, articles } = countPendingLibraryScan(data);
    if (!passages) {
      const skipped = data.skippedNoMethods || 0;
      const extra =
        skipped > 0
          ? ` (${skipped} article${skipped === 1 ? "" : "s"} without a Methods section)`
          : "";
      return `No new matches in Methods${extra}. Confirmed passages are under Saved passages.`;
    }
    const scopeNote = data.methodsOnly !== false ? " (Methods section only)" : "";
    return `${passages} pending match${passages === 1 ? "" : "es"} in ${articles} article${articles === 1 ? "" : "s"}${scopeNote}. ✓ save · ⎘ cite · ✕ dismiss match · ⊘ not in article · click excerpt to open.`;
  }

  function articlePlainFromRecord(article) {
    const AP = window.LitLensArticlePlain;
    if (AP?.articlePlain) return AP.articlePlain(article);
    const html = String(article?.html || "").trim();
    const text = String(article?.text || "").trim();
    return html || text ? String(html || text) : "";
  }

  async function fetchArticlePlain(articleId) {
    const cached = articlesById.get(articleId);
    if (cached?._plainForMap) return cached._plainForMap;
    const res = await fetch(`${API}/articles/${articleId}`);
    if (!res.ok) return "";
    const art = await res.json();
    const plain = articlePlainFromRecord(art);
    const prev = articlesById.get(articleId) || {};
    articlesById.set(articleId, { ...prev, ...art, _plainForMap: plain });
    return plain;
  }

  function groupSavedEntriesToPassages(entries, plain) {
    const MPapi = MP();
    const rows = entries
      .filter((e) => e.offset != null)
      .map((e) => ({
        offset: e.offset,
        length: e.length || 20,
        matchedTerm: e.matchedTerm,
        matchType: e.matchType,
        excerpt: String(e.excerpt || "").trim(),
      }));
    if (!rows.length) return [];

    const rowFromEntry = (e) => ({
      offset: e.offset,
      length: e.length,
      excerpt: e.excerpt,
      hits: [
        {
          offset: e.offset,
          matchedTerm: e.matchedTerm,
          matchType: e.matchType,
          excerpt: e.excerpt,
        },
      ],
    });

    if (!MPapi?.groupHitsIntoSentencePassages) {
      return rows.map(rowFromEntry);
    }

    const hay = String(plain || "");
    const passages = MPapi.groupHitsIntoSentencePassages(hay, rows);
    return passages.map((p) => {
      const matched = rows.filter((e) => evidenceOverlapsPassage(e, p));
      const fallback = rows.find((e) => e.offset === p.offset);
      const parts = matched.length ? matched : fallback ? [fallback] : [];
      const excerpt =
        parts
          .map((e) => e.excerpt)
          .filter(Boolean)
          .join(" ")
          .trim() ||
        (hay.length && MPapi.sentenceExcerptFromPlain
          ? MPapi.sentenceExcerptFromPlain(hay, p.offset, p.length, 420)
          : "") ||
        "…";
      return {
        offset: p.offset,
        length: p.length,
        excerpt,
        hits: parts.map((e) => ({
          offset: e.offset,
          matchedTerm: e.matchedTerm,
          matchType: e.matchType,
          excerpt: e.excerpt,
        })),
      };
    });
  }

  async function buildSavedMentionGroups(mentions) {
    const byArticle = new Map();
    for (const m of mentions) {
      if (!byArticle.has(m.articleId)) {
        byArticle.set(m.articleId, {
          articleId: m.articleId,
          title: m.title,
          entries: [],
          linkedOnly: false,
        });
      }
      const g = byArticle.get(m.articleId);
      if (m.linkedOnly) g.linkedOnly = true;
      else g.entries.push(m);
    }

    const groups = await Promise.all(
      [...byArticle.values()].map(async (g) => {
        let passages = [];
        if (g.entries.length) {
          const plain = await fetchArticlePlain(g.articleId);
          passages = groupSavedEntriesToPassages(g.entries, plain);
        }
        const meta = articlesById.get(g.articleId);
        return {
          articleId: g.articleId,
          title: g.title,
          authors: meta?.authors || "",
          year: meta?.year || "",
          linkedOnly: g.linkedOnly && !g.entries.length,
          passages,
        };
      })
    );

    const PL = window.LitLensPassageLinks;
    const sortByYear = PL?.compareArticlesByYear || PL?.compareArticlesBibliographic;
    if (sortByYear) {
      groups.sort((a, b) => sortByYear(a, b));
    }
    for (const g of groups) {
      if (g.passages?.length > 1) {
        g.passages.sort((a, b) => (a.offset || 0) - (b.offset || 0));
      }
    }
    return groups;
  }

  /**
   * @param {HTMLElement} parent
   * @param {{ articleId: string, title?: string, passages: object[], linkedOnly?: boolean, hitCount?: number }} art
   * @param {'library' | 'saved'} mode
   */
  function renderArticlePassageSection(parent, art, mode) {
    const PL = window.LitLensPassageLinks;
    const article = articlesById.get(art.articleId);
    const citeLabel = PL?.formatCiteLabel
      ? PL.formatCiteLabel(
          article || {
            title: art.title,
            authors: article?.authors,
            year: article?.year,
          }
        )
      : art.title || "Untitled";

    const section = document.createElement("section");
    section.className = "methods-map-library-article";

    const head = document.createElement("div");
    head.className = "methods-map-library-article-head";

    const cite = document.createElement("span");
    cite.className = "methods-map-library-article-cite";
    if (PL?.citeLabelNeedsMetadata?.(citeLabel)) {
      cite.classList.add("methods-map-mention-cite--placeholder");
    }
    cite.textContent = citeLabel;

    const badge = document.createElement("span");
    badge.className = "methods-map-library-article-count";
    if (art.linkedOnly) {
      badge.textContent = "linked only";
    } else if (mode === "library") {
      const n = (art.hits || []).length;
      const total = art.hitCount ?? n;
      badge.textContent =
        n < total ? `${n} of ${total} matches` : `${n} match${n === 1 ? "" : "es"}`;
    } else {
      const n = art.passages?.length || 0;
      badge.textContent = `${n} passage${n === 1 ? "" : "s"}`;
    }

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "btn-sm btn-ghost methods-map-library-open-btn";
    openBtn.textContent = "Open";
    openBtn.title =
      mode === "library"
        ? "Open article at Methods section"
        : "Open article";
    openBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void openLibraryArticle(art.articleId);
    });

    if (mode === "library") {
      const absentBtn = document.createElement("button");
      absentBtn.type = "button";
      absentBtn.className =
        "btn-sm btn-ghost methods-map-library-absent-btn";
      absentBtn.textContent = "Not in article";
      absentBtn.title =
        "This method is not in this article — never show in library scan";
      absentBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        absentBtn.disabled = true;
        void markLibraryScanArticleAbsent(art.articleId).catch((err) => {
          absentBtn.disabled = false;
          setCardSaveStatus(err.message || "Could not save", true);
        });
      });
      head.append(cite, badge, openBtn, absentBtn);
    } else {
      head.append(cite, badge, openBtn);
    }
    section.appendChild(head);

    if (art.linkedOnly) {
      const muted = document.createElement("p");
      muted.className = "methods-map-mention-linked-hint";
      muted.textContent =
        "Method linked — open article to save a passage on the Info tab.";
      section.appendChild(muted);
      parent.appendChild(section);
      return;
    }

    const hitsWrap = document.createElement("div");
    hitsWrap.className = "methods-map-library-hits";

    const rows =
      mode === "library" ? art.hits || [] : art.passages || [];

    for (const row of rows) {
      const hit =
        mode === "library"
          ? row
          : {
              offset: row.offset,
              length: row.length,
              matchedTerm: [
                ...new Set(row.hits?.map((h) => h.matchedTerm).filter(Boolean)),
              ].join(", "),
              matchType: "direct",
              excerpt: row.excerpt,
              quote: row.excerpt,
            };

      const rowEl = document.createElement("div");
      rowEl.className = "methods-map-library-hit-row";

      const quoteBtn = document.createElement("button");
      quoteBtn.type = "button";
      quoteBtn.className = "methods-map-library-hit-quote";
      quoteBtn.title = "Open article at this passage";
      const quote = document.createElement("span");
      quote.className = "methods-map-mention-quote";
      const excerpt = (hit.excerpt || hit.quote || "").trim() || "…";
      fillQuoteWithHighlights(
        quote,
        excerpt,
        termsToHighlightInExcerpt(hit, currentProfile)
      );
      quoteBtn.appendChild(quote);
      quoteBtn.addEventListener("click", () => {
        if (mode === "library") void openLibraryHit(art.articleId, hit);
        else void openSavedPassage(art.articleId, row);
      });
      const citePassage = {
        offset: hit.offset,
        length: hit.length,
        excerpt,
        quote: excerpt,
      };

      rowEl.appendChild(quoteBtn);

      if (mode === "library") {
        const actions = document.createElement("div");
        actions.className = "methods-map-library-hit-actions";

        const acceptBtn = document.createElement("button");
        acceptBtn.type = "button";
        acceptBtn.className =
          "methods-map-library-hit-btn methods-map-library-hit-btn--accept";
        acceptBtn.title = "Save passage (confirm)";
        acceptBtn.textContent = "✓";
        acceptBtn.addEventListener("click", () => {
          acceptBtn.disabled = true;
          void acceptLibraryScanHit(art.articleId, hit).catch((e) => {
            acceptBtn.disabled = false;
            setCardSaveStatus(e.message || "Save failed", true);
          });
        });

        const dismissBtn = document.createElement("button");
        dismissBtn.type = "button";
        dismissBtn.className =
          "methods-map-library-hit-btn methods-map-library-hit-btn--dismiss";
        dismissBtn.title = "Hide this match (may appear again on rescan)";
        dismissBtn.textContent = "✕";
        dismissBtn.addEventListener("click", () => {
          dismissBtn.disabled = true;
          void dismissLibraryScanHit(art.articleId, hit).catch((e) => {
            dismissBtn.disabled = false;
            setCardSaveStatus(e.message || "Dismiss failed", true);
          });
        });

        actions.append(
          acceptBtn,
          createPassageCiteCopyButton(art.articleId, citePassage),
          dismissBtn
        );
        rowEl.appendChild(actions);
      } else if (mode === "saved") {
        const actions = document.createElement("div");
        actions.className = "methods-map-library-hit-actions";

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className =
          "methods-map-library-hit-btn methods-map-library-hit-btn--dismiss";
        removeBtn.title = "Remove saved passage from this article";
        removeBtn.textContent = "✕";
        removeBtn.addEventListener("click", () => {
          removeBtn.disabled = true;
          void removeSavedPassage(art.articleId, row).catch((e) => {
            removeBtn.disabled = false;
            setCardSaveStatus(e.message || "Remove failed", true);
          });
        });

        actions.append(
          createPassageCiteCopyButton(art.articleId, citePassage),
          removeBtn
        );
        rowEl.appendChild(actions);
      }

      hitsWrap.appendChild(rowEl);
    }

    section.appendChild(hitsWrap);
    parent.appendChild(section);
  }

  async function openSavedPassage(articleId, passage) {
    if (!articleId || !passage || passage.offset == null) return;
    const methodLabel = selectedMethodLabel || "";
    const scrollToTextSpan = {
      offset: passage.offset,
      length: passage.length || 20,
      methodLabel,
      expandToSentence: false,
      quote: passage.excerpt || "",
    };
    if (typeof window.litlensSelectArticle === "function") {
      await window.litlensSelectArticle(articleId, {
        scrollToTextSpan,
        returnToMethodLabel: methodLabel || undefined,
      });
    }
  }

  async function fetchLibraryScan(methodLabel) {
    const label = encodeURIComponent(String(methodLabel || "").trim());
    const res = await fetch(
      `${API}/method-library-scan?label=${label}&methodsOnly=1&scope=methods-section`
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.error || res.statusText || "Scan failed");
    }
    return body;
  }

  function sortArticlesBibliographic(articles) {
    const PL = window.LitLensPassageLinks;
    if (PL?.compareArticlesBibliographic && articles?.length) {
      articles.sort((a, b) => PL.compareArticlesBibliographic(a, b));
    }
  }

  function renderLibraryScan(data) {
    const scanEl = $("methods-map-library-scan");
    if (!scanEl) return;
    sortArticlesBibliographic(data?.articles);
    scanEl.replaceChildren();
    renderLibraryAbsentList();

    if (!data?.profileFound) {
      const empty = document.createElement("p");
      empty.className = "bookmarks-empty";
      empty.textContent =
        "Method not in catalog — add triggers in Method catalog to scan the library.";
      scanEl.appendChild(empty);
      return;
    }

    if (!data.articles?.length) {
      const empty = document.createElement("p");
      empty.className = "bookmarks-empty";
      empty.textContent = "No trigger matches in Methods sections.";
      scanEl.appendChild(empty);
      return;
    }

    for (const art of data.articles) {
      const articleMeta = articlesById.get(art.articleId);
      if (isMethodAbsentFromArticle(articleMeta, selectedMethodLabel)) continue;
      if (articleSkipsMethodLibraryScan(articleMeta, selectedMethodLabel)) continue;
      const pendingHits = (art.hits || []).filter((h) =>
        isLibraryHitPending(art.articleId, h)
      );
      if (!pendingHits.length) continue;

      const total = art.hitCount ?? art.hits?.length ?? pendingHits.length;
      renderArticlePassageSection(
        scanEl,
        {
          articleId: art.articleId,
          title: art.title,
          hits: pendingHits,
          hitCount: total,
        },
        "library"
      );
    }

    if (!scanEl.childElementCount) {
      const empty = document.createElement("p");
      empty.className = "bookmarks-empty";
      empty.textContent =
        "No new matches — saved or dismissed passages are hidden here. See Saved passages tab.";
      scanEl.appendChild(empty);
    }
  }

  async function openLibraryHit(articleId, hit) {
    if (!articleId || !hit || hit.offset == null) return;
    const methodLabel = selectedMethodLabel || "";
    if (typeof window.litlensSelectArticle === "function") {
      await window.litlensSelectArticle(articleId, {
        scrollToTextSpan: {
          offset: hit.offset,
          length: hit.length || 20,
          methodLabel,
          expandToSentence: false,
          quote: hit.quote || hit.excerpt || "",
        },
        returnToMethodLabel: methodLabel || undefined,
      });
    }
  }

  async function ensureLibraryScan(force = false) {
    const label = selectedMethodLabel;
    const hintEl = $("methods-map-mentions-hint");
    const scanEl = $("methods-map-library-scan");
    if (!label || !scanEl) return;

    if (
      !force &&
      libraryScanCache?.label === label &&
      libraryScanCache.data
    ) {
      renderLibraryScan(libraryScanCache.data);
      renderLibraryAbsentList();
      const d = libraryScanCache.data;
      if (hintEl) hintEl.textContent = libraryScanHintText(d);
      return;
    }

    if (libraryScanLoading) return;
    libraryScanLoading = true;
    scanEl.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "methods-map-library-scan-status";
    loading.textContent = "Scanning Methods sections…";
    scanEl.appendChild(loading);
    if (hintEl) {
      hintEl.textContent =
        "Scanning Methods sections for catalog trigger words…";
    }

    try {
      const data = await fetchLibraryScan(label);
      sortArticlesBibliographic(data?.articles);
      libraryScanCache = { label, data };
      renderLibraryScan(data);
      if (hintEl) hintEl.textContent = libraryScanHintText(data);
    } catch (e) {
      if (hintEl) hintEl.textContent = e.message || "Scan failed";
      scanEl.replaceChildren();
      const err = document.createElement("p");
      err.className = "methods-map-library-scan-status";
      err.textContent = e.message || "Scan failed";
      scanEl.appendChild(err);
    } finally {
      libraryScanLoading = false;
    }
  }

  async function openLibraryArticle(articleId) {
    if (!articleId) return;
    const methodLabel = selectedMethodLabel || "";
    if (typeof window.litlensSelectArticle === "function") {
      await window.litlensSelectArticle(articleId, {
        scrollToMethods: true,
        returnToMethodLabel: methodLabel || undefined,
      });
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
    libraryScanCache = null;
    cardEditing = false;
    setCardToolbarEditing(false);
    applyMapViewMode();
    $("methods-map-mentions-panels")?.classList.remove(
      "methods-map-mentions-panels--library"
    );
    setMentionsSubTab("passages");
    if (titleEl) titleEl.textContent = methodLabel;
    if (hintEl) hintEl.textContent = "Loading…";
    listEl.replaceChildren();
    if ($("methods-map-method-card")) $("methods-map-method-card").replaceChildren();
    relationsPanelEl()?.replaceChildren();
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

      renderMethodCard();
      renderLibraryCoverage(methodLabel, articles);
      if (chartEl) renderUsageChart(chartEl, methodLabel, articles);

      const groups = await buildSavedMentionGroups(mentions);
      const passageCount = groups.reduce(
        (s, g) => s + g.passages.length + (g.linkedOnly ? 1 : 0),
        0
      );
      if (hintEl) {
        hintEl.textContent = passageCount
          ? `${passageCount} saved passage${passageCount === 1 ? "" : "s"} in ${groups.length} article${groups.length === 1 ? "" : "s"}. Click to open · right-click excerpt for cite link.`
          : "No passages saved yet. Link this method on the Info tab to add excerpts.";
      }
      renderMentionsList(groups);
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

  function renderMentionsList(groups) {
    const listEl = $("methods-map-mentions-list");
    if (!listEl) return;
    listEl.replaceChildren();

    if (!groups?.length) {
      const empty = document.createElement("p");
      empty.className = "bookmarks-empty";
      empty.textContent = "No mentions in your library yet.";
      listEl.appendChild(empty);
      return;
    }

    for (const g of groups) {
      if (!g.passages?.length && !g.linkedOnly) continue;
      renderArticlePassageSection(listEl, g, "saved");
    }

    if (!listEl.childElementCount) {
      const empty = document.createElement("p");
      empty.className = "bookmarks-empty";
      empty.textContent = "No mentions in your library yet.";
      listEl.appendChild(empty);
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

  async function copyTextToClipboard(text) {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Register passage + copy [[cite:id|label]] (same as article selection context menu).
   * @param {string} articleId
   * @param {{ offset: number, length?: number, excerpt?: string, quote?: string }} passage
   * @param {{ quiet?: boolean }} opts
   */
  async function copyPassageCiteLink(articleId, passage, opts = {}) {
    const PL = window.LitLensPassageLinks;
    const Store = passageCiteStore();
    if (!PL || !Store?.register) {
      if (!opts.quiet) {
        setCardSaveStatus("Citation store unavailable", true);
      }
      return false;
    }
    if (!articleId || passage?.offset == null) {
      if (!opts.quiet) {
        setCardSaveStatus("No passage to link", true);
      }
      return false;
    }
    const quote = String(passage.excerpt || passage.quote || "").trim();
    if (quote.length < 4) {
      if (!opts.quiet) {
        setCardSaveStatus("Passage too short for citation link", true);
      }
      return false;
    }
    try {
      await Store.load();
      let article = articlesById.get(articleId);
      if (!article?.id) {
        const res = await fetch(`${API}/articles/${articleId}`);
        if (res.ok) {
          article = await res.json();
          mergeArticleIntoLibraryState(article);
        }
      }
      const label = PL.formatCiteLabel(article || {});
      const data = await Store.register({
        articleId,
        offset: passage.offset,
        length: passage.length || 20,
        quote,
        label,
      });
      const token =
        data?.token ||
        PL.buildShortToken(data?.id, data?.entry?.label || label);
      const ok = await copyTextToClipboard(token);
      if (!opts.quiet) {
        const msg = ok
          ? "Citation link copied — paste into method card text"
          : "Could not copy to clipboard";
        const mapStatus = $("methods-map-card-save-status");
        const metaStatus = $("meta-suggest-status");
        if (mapOpen && mapStatus) {
          setCardSaveStatus(msg, !ok);
          if (ok) window.setTimeout(() => setCardSaveStatus(""), 3200);
        } else if (metaStatus) {
          metaStatus.textContent = msg;
        }
      }
      return ok;
    } catch (e) {
      if (!opts.quiet) {
        const msg = e.message || "Could not save citation";
        const mapStatus = $("methods-map-card-save-status");
        const metaStatus = $("meta-suggest-status");
        if (mapOpen && mapStatus) setCardSaveStatus(msg, true);
        else if (metaStatus) metaStatus.textContent = msg;
      }
      return false;
    }
  }

  /**
   * Copy [[cite:id|label]] for an existing sentence passage (library / saved / Info).
   * @param {string} articleId
   * @param {{ offset: number, length?: number, excerpt?: string, quote?: string }} passage
   * @param {{ btnClass?: string }} [opts]
   */
  function createPassageCiteCopyButton(articleId, passage, opts = {}) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      opts.btnClass ||
      "methods-map-library-hit-btn methods-map-library-hit-btn--cite";
    btn.title =
      "Copy citation link for this sentence — paste into Definition, Purpose, etc.";
    btn.textContent = "⎘";
    btn.setAttribute("aria-label", "Copy citation link");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      btn.disabled = true;
      void copyPassageCiteLink(articleId, passage).finally(() => {
        btn.disabled = false;
      });
    });
    return btn;
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

  function bindMentionsSubtabs() {
    const corner = $("methods-map-library-corner-btn");
    if (corner && !corner.dataset.bound) {
      corner.dataset.bound = "1";
      corner.addEventListener("click", () => setMentionsSubTab("library"));
    }
    const passagesTab = $("methods-map-tab-passages");
    if (passagesTab && !passagesTab.dataset.bound) {
      passagesTab.dataset.bound = "1";
      passagesTab.addEventListener("click", () => setMentionsSubTab("passages"));
    }
    const libraryTab = $("methods-map-tab-library");
    if (libraryTab && !libraryTab.dataset.bound) {
      libraryTab.dataset.bound = "1";
      libraryTab.addEventListener("click", () => setMentionsSubTab("library"));
    }
    const exportBtn = $("methods-map-export-citations");
    if (exportBtn && !exportBtn.dataset.bound) {
      exportBtn.dataset.bound = "1";
      exportBtn.addEventListener("click", () => {
        void exportMethodCitations();
      });
    }
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
    bindMentionsSubtabs();
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
    copyPassageCiteLink,
    exportMethodCitations,
    createPassageCiteCopyButton,
    termsToHighlightInExcerpt,
    fillQuoteWithHighlights,
  };

  init();
})();
