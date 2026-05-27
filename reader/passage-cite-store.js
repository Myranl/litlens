/** Client cache for ~/LiteratureReview/passage-citations.json */
(function () {
  const API = `${location.origin}/api`;
  /** @type {Record<string, object>} */
  let byId = {};
  let loadPromise = null;

  async function load({ fresh = false } = {}) {
    if (!fresh && loadPromise) return loadPromise;
    loadPromise = (async () => {
      const res = await fetch(`${API}/passage-citations`);
      if (!res.ok) throw new Error("Failed to load passage citations");
      const data = await res.json();
      byId = data.citations && typeof data.citations === "object" ? data.citations : {};
      return byId;
    })();
    return loadPromise;
  }

  function get(id) {
    return byId[id] || null;
  }

  function asMap() {
    return byId;
  }

  async function register(entry) {
    const res = await fetch(`${API}/passage-citations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to save citation");
    }
    const data = await res.json();
    if (data.id && data.entry) byId[data.id] = data.entry;
    return data;
  }

  async function registerFromLegacy(legacyEntry) {
    return register({
      articleId: legacyEntry.articleId,
      offset: legacyEntry.offset,
      length: legacyEntry.length,
      quote: legacyEntry.quote || "",
      label: legacyEntry.label || "",
    });
  }

  window.LitLensPassageCiteStore = {
    load,
    get,
    asMap,
    register,
    registerFromLegacy,
  };
})();
