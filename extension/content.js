/* LitLens content script */

const IS_READER =
  location.hostname === "127.0.0.1" && location.port === "17321";

let termsCache = null;
let observer = null;
let refreshTimer = null;
let lastCount = 0;

function fetchTermsViaBackground() {
  return new Promise((resolve) => {
    if (!chrome.runtime?.id) {
      resolve(null);
      return;
    }
    chrome.runtime.sendMessage({ type: "GET_TERMS" }, (res) => {
      if (chrome.runtime.lastError || !res?.ok) {
        console.warn("[LitLens] terms:", chrome.runtime.lastError?.message || res?.error);
        resolve(null);
        return;
      }
      termsCache = res.terms;
      resolve(termsCache);
    });
  });
}

function getContentRoot() {
  return typeof getArticleRoot === "function" ? getArticleRoot() : document.body;
}

async function refreshHighlights() {
  if (IS_READER) return { count: 0 };

  const terms = termsCache || (await fetchTermsViaBackground());
  if (!terms?.terms?.length) {
    lastCount = 0;
    return { count: 0, reason: "no-terms" };
  }

  const root = getContentRoot();
  const textLen = (root?.innerText || "").trim().length;
  if (!textLen) {
    lastCount = 0;
    return { count: 0, reason: "no-text" };
  }

  try {
    const result = applyHighlights(root, terms);
    lastCount = result.count;
    if (result.count === 0) {
      console.info("[LitLens] 0 matches in this frame", location.href.slice(0, 80));
    } else {
      console.info(`[LitLens] ${result.count} highlights (${result.method})`);
    }
    return result;
  } catch (e) {
    console.warn("[LitLens] highlight error:", e);
    return { count: 0, reason: "error" };
  }
}

function scheduleRefresh(delay = 0) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => refreshHighlights(), delay);
}

function startObserver() {
  if (IS_READER || observer) return;
  observer = new MutationObserver(() => scheduleRefresh(500));
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "PING") {
    sendResponse({ ok: true, count: lastCount });
    return;
  }
  if (msg.type === "REFRESH_HIGHLIGHTS") {
    fetchTermsViaBackground().then(async () => {
      const result = await refreshHighlights();
      sendResponse({ ok: true, ...result });
    });
    return true;
  }
  if (msg.type === "GET_SELECTION") {
    sendResponse({ text: window.getSelection().toString().trim() });
  }
});

async function init() {
  if (IS_READER) return;

  await fetchTermsViaBackground();
  startObserver();

  scheduleRefresh(0);
  scheduleRefresh(800);
  scheduleRefresh(2000);
  scheduleRefresh(4500);

  window.addEventListener("load", () => scheduleRefresh(400));
}

init();
