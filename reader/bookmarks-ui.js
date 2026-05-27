/** In-article bookmarks panel (Marks tab). */
(function () {
  let bookmarks = [];

  function $(id) {
    return document.getElementById(id);
  }

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function getBody() {
    return $("article-body");
  }

  function getCurrentId() {
    return typeof window.litlensCurrentId === "function"
      ? window.litlensCurrentId()
      : null;
  }

  async function apiPatchBookmarks() {
    const id = getCurrentId();
    if (!id) return false;
    const payload = { bookmarks };
    try {
      let updated;
      if (typeof window.litlensApi === "function") {
        updated = await window.litlensApi(`/articles/${id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        const res = await fetch(`${location.origin}/api/articles/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || res.statusText || `HTTP ${res.status}`);
        }
        updated = await res.json();
      }
      if (Array.isArray(updated?.bookmarks)) {
        bookmarks = [...updated.bookmarks];
      }
      const articles =
        typeof window.litlensGetArticles === "function"
          ? window.litlensGetArticles()
          : null;
      if (articles) {
        const a = articles.find((x) => x.id === id);
        if (a) a.bookmarks = [...bookmarks];
      }
      return true;
    } catch (e) {
      console.error("[LitLens] bookmark save failed:", e);
      alert(`Could not save bookmarks: ${e.message}`);
      return false;
    }
  }

  function applyMarkers() {
    const body = getBody();
    if (!body || !window.LitLensBookmarks) return;
    LitLensBookmarks.applyMarkers(body, bookmarks);
    bindMarkerClicks();
  }

  function bindMarkerClicks() {
    const body = getBody();
    if (!body) return;
    body.querySelectorAll(".litlens-bookmark-marker").forEach((el) => {
      if (el.dataset.bound) return;
      el.dataset.bound = "1";
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = el.dataset.bookmarkId;
        if (id) jumpTo(id);
        document.querySelectorAll(".panel-tab").forEach((t) => {
          t.classList.toggle("active", t.dataset.tab === "marks");
        });
        document.querySelectorAll(".panel-content").forEach((p) => {
          p.classList.toggle("active", p.id === "tab-marks");
        });
        renderList();
      });
    });
  }

  function jumpTo(id) {
    const body = getBody();
    if (!body || !LitLensBookmarks) return;
    LitLensBookmarks.scrollToBookmark(body, id);
    document.querySelectorAll(".bookmark-row").forEach((row) => {
      row.classList.toggle("active", row.dataset.id === id);
    });
  }

  function findMethodsBookmark() {
    return bookmarks.find((b) => /^methods$/i.test((b.label || "").trim()));
  }

  function hasAutoSectionBookmarks(list) {
    return (list || []).some((b) => b.auto && b.kind === "section");
  }

  function scrollToMethodsIfPresent() {
    const bm = findMethodsBookmark();
    if (!bm) return false;
    requestAnimationFrame(() => {
      window.setTimeout(() => jumpTo(bm.id), 100);
    });
    return true;
  }

  function renderList() {
    const list = $("bookmarks-list");
    const empty = $("bookmarks-empty");
    if (!list) return;
    list.replaceChildren();

    if (!getCurrentId()) {
      if (empty) empty.textContent = "Open an article to add bookmarks.";
      return;
    }
    if (!bookmarks.length) {
      if (empty) {
        empty.textContent =
          "No bookmarks yet. Select a place in the text and click + Methods or + Bookmark.";
      }
      return;
    }
    if (empty) empty.textContent = "";

    const sorted = [...bookmarks].sort((a, b) => a.offset - b.offset);
    for (const bm of sorted) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "bookmark-row";
      row.dataset.id = bm.id;

      const title = document.createElement("span");
      title.className = "bookmark-row-label";
      const labelText = bm.label || "Bookmark";
      title.textContent =
        bm.auto && bm.kind === "section" ? `${labelText} (auto)` : labelText;

      const excerpt = document.createElement("span");
      excerpt.className = "bookmark-row-excerpt";
      excerpt.textContent = bm.excerpt || "";

      const del = document.createElement("span");
      del.className = "bookmark-row-del";
      del.title = "Remove bookmark";
      del.textContent = "×";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        void removeBookmark(bm.id);
      });

      row.append(title, excerpt, del);
      row.addEventListener("click", () => jumpTo(bm.id));
      list.appendChild(row);
    }
  }

  async function addBookmark(label) {
    const body = getBody();
    if (!body || !getCurrentId()) {
      alert("Open an article first");
      return;
    }
    if (!LitLensBookmarks) {
      alert("Bookmarks module failed to load. Hard-refresh the page.");
      return;
    }

    const anchor = LitLensBookmarks.selectionAnchor(body);
    if (!anchor) {
      alert("Click in the article or select text where the bookmark should go");
      return;
    }

    const name = (label || "Bookmark").trim() || "Bookmark";
    if (name.toLowerCase() === "methods") {
      const existing = findMethodsBookmark();
      if (existing) {
        const ok = confirm(
          "A Methods bookmark already exists. Replace it with the new position?"
        );
        if (!ok) return;
        bookmarks = bookmarks.filter((b) => b.id !== existing.id);
      }
    }

    const newId = uid();
    bookmarks.push({
      id: newId,
      label: name,
      offset: anchor.offset,
      excerpt: anchor.excerpt,
      createdAt: Date.now(),
    });
    bookmarks.sort((a, b) => a.offset - b.offset);
    const ok = await apiPatchBookmarks();
    if (!ok) {
      bookmarks = bookmarks.filter((b) => b.id !== newId);
      return;
    }
    applyMarkers();
    renderList();
    if (name.toLowerCase() === "methods") jumpTo(newId);
  }

  async function removeBookmark(id) {
    const prev = [...bookmarks];
    bookmarks = bookmarks.filter((b) => b.id !== id);
    const ok = await apiPatchBookmarks();
    if (!ok) {
      bookmarks = prev;
      return;
    }
    applyMarkers();
    renderList();
  }

  function setFromArticle(article) {
    bookmarks = Array.isArray(article?.bookmarks) ? [...article.bookmarks] : [];
    renderList();
  }

  function clear() {
    bookmarks = [];
    renderList();
  }

  async function detectSections(opts = {}) {
    const body = getBody();
    const id = getCurrentId();
    if (!body || !id) {
      if (!opts.silent) alert("Open an article first");
      return false;
    }
    if (!window.LitLensSectionDetect) {
      if (!opts.silent) {
        alert("Section detection failed to load. Hard-refresh the page.");
      }
      return false;
    }

    const detected = LitLensSectionDetect.detectSectionBookmarks(body);
    const manualAndOther = bookmarks.filter(
      (b) => !(b.auto && b.kind === "section")
    );
    const reservedLabels = new Set(
      manualAndOther.map((b) => (b.label || "").trim().toLowerCase())
    );
    const newSections = detected.filter(
      (d) => !reservedLabels.has((d.label || "").trim().toLowerCase())
    );
    const prev = [...bookmarks];
    const hadAuto = hasAutoSectionBookmarks(prev);

    if (!newSections.length && !hadAuto) {
      if (!opts.silent) {
        alert(
          "No standard sections found. Look for h1–h6 headings titled Abstract, Introduction, Methods, Results, …"
        );
      }
      return false;
    }

    bookmarks = [...manualAndOther, ...newSections].sort(
      (a, b) => a.offset - b.offset
    );
    const ok = await apiPatchBookmarks();
    if (!ok) {
      bookmarks = prev;
      return false;
    }
    applyMarkers();
    renderList();
    if (opts.scrollToMethods) scrollToMethodsIfPresent();
    if (!opts.silent && newSections.length) {
      const names = newSections.map((b) => b.label).join(", ");
      console.info(`[LitLens] detected sections: ${names}`);
    }
    return newSections.length > 0;
  }

  async function autoDetectSectionsIfNeeded(opts = {}) {
    const scrollToMethods = opts.scrollToMethods !== false;
    if (!getCurrentId() || !getBody()?.innerHTML) return;
    if (
      opts.skipDetect ||
      bookmarks.length > 0 ||
      hasAutoSectionBookmarks(bookmarks)
    ) {
      if (scrollToMethods) scrollToMethodsIfPresent();
      return;
    }
    await detectSections({ silent: true, scrollToMethods });
  }

  function init() {
    $("add-bookmark-btn")?.addEventListener("click", () => void addBookmark("Bookmark"));
    $("add-methods-bookmark-btn")?.addEventListener("click", () => void addBookmark("Methods"));
    $("detect-sections-btn")?.addEventListener("click", () =>
      void detectSections({ scrollToMethods: true })
    );
    renderList();
  }

  window.BookmarksUI = {
    init,
    setFromArticle,
    clear,
    applyMarkers,
    renderList,
    jumpTo,
    scrollToMethodsIfPresent,
    detectSections,
    autoDetectSectionsIfNeeded,
  };

  init();
})();
