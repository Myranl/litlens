/** Settings: link term categories to Info columns. */
(function () {
  function $(id) {
    return document.getElementById(id);
  }

  function getTermsDoc() {
    return typeof window.litlensGetTermsDoc === "function"
      ? window.litlensGetTermsDoc()
      : { categories: [], terms: [], categoryColumnLinks: {} };
  }

  async function saveTermsDoc(doc) {
    if (typeof window.litlensSaveTermsDoc === "function") {
      await window.litlensSaveTermsDoc(doc);
    }
  }

  function render() {
    const wrap = $("settings-column-links");
    if (!wrap || !window.LitLensColumnLinks) return;
    const termsDoc = getTermsDoc();
    if (!termsDoc.categoryColumnLinks) termsDoc.categoryColumnLinks = {};

    wrap.replaceChildren();
    const hint = document.createElement("p");
    hint.className = "meta-hint";
    hint.style.marginTop = "0";
    hint.textContent =
      "Link a category to an Info field. When that field is filled, highlights hide automatically. Use ◉ on the Terms tab to show them again.";
    wrap.appendChild(hint);

    if (!termsDoc.categories?.length) {
      wrap.appendChild(
        Object.assign(document.createElement("p"), {
          className: "bookmarks-empty",
          textContent: "Create categories on the Terms tab first.",
        })
      );
      return;
    }

    for (const cat of termsDoc.categories) {
      const row = document.createElement("div");
      row.className = "settings-link-row";

      const name = document.createElement("span");
      name.className = "settings-link-cat";
      const dot = document.createElement("span");
      dot.className = "settings-link-dot";
      dot.style.background = cat.color;
      name.append(dot, document.createTextNode(cat.label));

      const select = document.createElement("select");
      select.className = "settings-link-select";
      select.dataset.categoryId = cat.id;
      for (const col of LitLensColumnLinks.INFO_COLUMNS) {
        const opt = document.createElement("option");
        opt.value = col.key;
        opt.textContent = col.label;
        select.appendChild(opt);
      }
      select.value = termsDoc.categoryColumnLinks[cat.id] || "";

      select.addEventListener("change", async () => {
        const doc = getTermsDoc();
        if (!doc.categoryColumnLinks) doc.categoryColumnLinks = {};
        if (select.value) doc.categoryColumnLinks[cat.id] = select.value;
        else delete doc.categoryColumnLinks[cat.id];
        await saveTermsDoc(doc);
        if (typeof window.litlensRenderTermsPanel === "function") {
          window.litlensRenderTermsPanel();
        }
        if (typeof window.litlensOnColumnLinksChanged === "function") {
          window.litlensOnColumnLinksChanged();
        }
      });

      row.append(name, select);
      wrap.appendChild(row);
    }
  }

  function init() {
    document.querySelectorAll(".panel-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        if (tab.dataset.tab === "settings") render();
      });
    });
    render();
  }

  window.SettingsUI = { render, init };
  init();
})();
