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
    if (!id) return;
    await fetch(`${location.origin}/api/articles/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookmarks }),
    });
    const articles =
      typeof window.litlensGetArticles === "function"
        ? window.litlensGetArticles()
        : null;
    if (articles) {
      const a = articles.find((x) => x.id === id);
      if (a) a.bookmarks = [...bookmarks];
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
      if (empty) empty.textContent = "No bookmarks yet. Select a place in the text and click + Methods or + Bookmark.";
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
      title.textContent = bm.label || "Bookmark";

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
    if (!LitLensBookmarks) return;

    const anchor = LitLensBookmarks.selectionAnchor(body);
    if (!anchor) {
      alert("Click in the article or select text where the bookmark should go");
      return;
    }

    const name = (label || "Bookmark").trim() || "Bookmark";
    bookmarks.push({
      id: uid(),
      label: name,
      offset: anchor.offset,
      excerpt: anchor.excerpt,
      createdAt: Date.now(),
    });
    bookmarks.sort((a, b) => a.offset - b.offset);
    await apiPatchBookmarks();
    applyMarkers();
    renderList();
  }

  async function removeBookmark(id) {
    bookmarks = bookmarks.filter((b) => b.id !== id);
    await apiPatchBookmarks();
    applyMarkers();
    renderList();
  }

  function setFromArticle(article) {
    bookmarks = article?.bookmarks ? [...article.bookmarks] : [];
    renderList();
  }

  function clear() {
    bookmarks = [];
    renderList();
  }

  function init() {
    $("add-bookmark-btn")?.addEventListener("click", () => void addBookmark("Bookmark"));
    $("add-methods-bookmark-btn")?.addEventListener("click", () => void addBookmark("Methods"));
    renderList();
  }

  window.BookmarksUI = {
    init,
    setFromArticle,
    clear,
    applyMarkers,
    renderList,
    jumpTo,
  };

  init();
})();
