const API = "http://127.0.0.1:17321/api";

async function fetchTermsFromServer() {
  const res = await fetch(`${API}/terms`, { cache: "no-store" });
  if (!res.ok) throw new Error(`terms ${res.status}`);
  return res.json();
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "litlens-add-term",
    title: 'LitLens: add "%s" as term',
    contexts: ["selection"],
  });
});

async function saveArticleToServer(meta) {
  const res = await fetch(`${API}/articles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(meta),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 409) {
    return { ok: false, duplicate: true, existing: body.existing };
  }
  if (!res.ok) {
    return {
      ok: false,
      error: body.message || body.error || `HTTP ${res.status}`,
    };
  }
  return {
    ok: true,
    article: { id: body.id, title: body.title || meta?.title || "Untitled" },
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_TERMS") {
    fetchTermsFromServer()
      .then((terms) => sendResponse({ ok: true, terms }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === "LITLENS_SAVE_ARTICLE") {
    saveArticleToServer(msg.meta)
      .then((result) => sendResponse(result))
      .catch((e) => {
        const msgText = e?.message || "network";
        sendResponse({
          ok: false,
          error:
            msgText === "Failed to fetch"
              ? "Server not running (npm start in ~/litlens)"
              : msgText,
        });
      });
    return true;
  }
});

function broadcastRefreshHighlights() {
  chrome.tabs.query({}, (tabs) => {
    for (const t of tabs) {
      if (t.id && t.url?.startsWith("http")) {
        chrome.tabs.sendMessage(t.id, { type: "REFRESH_HIGHLIGHTS" }).catch(() => {});
      }
    }
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "litlens-add-term" || !tab?.id) return;
  const lemma = info.selectionText?.trim();
  if (!lemma) return;
  try {
    const terms = await fetchTermsFromServer();
    const cat = terms.categories?.[0];
    if (!cat) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => alert("LitLens: create a category in the reader first (npm start)"),
      });
      return;
    }
    const exists = (terms.terms || []).some(
      (t) => t.lemma.toLowerCase() === lemma.toLowerCase()
    );
    if (!exists) {
      terms.terms.push({
        id: Math.random().toString(36).slice(2, 10),
        lemma,
        aliases: [],
        categoryId: cat.id,
        caseSensitive: false,
      });
      await fetch(`${API}/terms`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(terms),
      });
    }
    await ensureContentScripts(tab.id);
    broadcastRefreshHighlights();
  } catch {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () =>
        alert("LitLens: start the server — cd ~/litlens && npm start"),
    });
  }
});

async function ensureContentScripts(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["highlight.js", "content.js"],
    });
  }
}
