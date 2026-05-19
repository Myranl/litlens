const API = "http://127.0.0.1:17321/api";

const status = document.getElementById("status");
const saveBtn = document.getElementById("save-btn");
const deleteBtn = document.getElementById("delete-btn");

let savedArticleId = null;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function checkHealth() {
  try {
    const res = await fetch(`${API}/health`);
    const data = await res.json();
    return data;
  } catch {
    return null;
  }
}

async function lookupCurrentPage(tab) {
  if (!tab?.url || !tab.url.startsWith("http")) {
    savedArticleId = null;
    return null;
  }
  const res = await fetch(
    `${API}/articles/lookup?url=${encodeURIComponent(tab.url)}`
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.found ? data.article : null;
}

function setSavedState(article) {
  savedArticleId = article?.id || null;
  if (article) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Already saved";
    deleteBtn.style.display = "block";
    status.textContent = `In library: ${article.title.slice(0, 42)}${article.title.length > 42 ? "…" : ""}`;
    status.classList.add("saved");
  } else {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save this page to disk";
    deleteBtn.style.display = "none";
    status.classList.remove("saved");
  }
}

async function refreshUI() {
  const health = await checkHealth();
  if (!health) {
    status.textContent = "Server not running (npm start in ~/litlens)";
    status.classList.remove("saved");
    saveBtn.disabled = true;
    deleteBtn.style.display = "none";
    return;
  }

  const tab = await getActiveTab();
  try {
    const existing = await lookupCurrentPage(tab);
    if (existing) {
      setSavedState(existing);
    } else {
      setSavedState(null);
      status.textContent = `OK · ready to save`;
    }
  } catch {
    setSavedState(null);
    status.textContent = `OK · ${health.dataRoot}`;
  }
}

saveBtn.addEventListener("click", async () => {
  const health = await checkHealth();
  if (!health) {
    status.textContent = "Server not running (npm start in ~/litlens)";
    return;
  }

  const tab = await getActiveTab();
  if (!tab?.id) return;

  const existing = await lookupCurrentPage(tab);
  if (existing) {
    setSavedState(existing);
    status.textContent = "This page is already in your library";
    return;
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["metadata-extract.js"],
    func: () => extractPageMetadata(),
  });

  if (!result?.text) {
    status.textContent = "Could not read page text";
    return;
  }

  status.textContent = "Saving…";
  status.classList.remove("saved");
  try {
    const res = await fetch(`${API}/articles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409) {
      setSavedState(body.existing);
      status.textContent = "Already saved (duplicate URL blocked)";
      return;
    }
    if (!res.ok) throw new Error(body.error || "save failed");
    setSavedState(body);
    status.textContent = `Saved: ${body.title.slice(0, 40)}…`;
    await ensureScriptsAndRefresh(tab.id);
  } catch {
    status.textContent = "Save failed";
    await refreshUI();
  }
});

deleteBtn.addEventListener("click", async () => {
  if (!savedArticleId) return;
  if (!confirm("Remove this article from your library?")) return;

  status.textContent = "Removing…";
  try {
    const res = await fetch(`${API}/articles/${savedArticleId}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error("delete failed");
    savedArticleId = null;
    await refreshUI();
    status.textContent = "Removed from library";
    const tab = await getActiveTab();
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: "REFRESH_HIGHLIGHTS" }).catch(() => {});
    }
  } catch {
    status.textContent = "Could not delete";
  }
});

async function ensureScriptsAndRefresh(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["highlight.js", "content.js"],
    });
    await new Promise((r) => setTimeout(r, 150));
  }
  await chrome.tabs.sendMessage(tabId, { type: "REFRESH_HIGHLIGHTS" });
}

document.getElementById("highlight-btn").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  const health = await checkHealth();
  if (!health) {
    status.textContent = "Server not running (npm start in ~/litlens)";
    return;
  }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "REFRESH_HIGHLIGHTS" }).catch(async () => {
      await ensureScriptsAndRefresh(tab.id);
      return chrome.tabs.sendMessage(tab.id, { type: "REFRESH_HIGHLIGHTS" });
    });
    const n = res?.count ?? 0;
    if (n > 0) {
      status.textContent = `Highlighted ${n} occurrence${n === 1 ? "" : "s"} on this page`;
    } else if (!res?.ok) {
      status.textContent = "Reload the page, then try again";
    } else {
      status.textContent = "No term matches in page text (try F5)";
    }
  } catch {
    status.textContent = "Reload the page, then try Refresh highlights";
  }
});

refreshUI();
