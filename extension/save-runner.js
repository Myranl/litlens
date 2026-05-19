/** Injected last after extract scripts; saves via background (localhost fetch). */
(async function litlensSaveRunner() {
  const send = (result) => {
    chrome.runtime.sendMessage({ type: "LITLENS_SAVE_RESULT", result }).catch(() => {});
  };
  try {
    if (typeof extractPageForLitLens !== "function") {
      send({ ok: false, error: "extract_scripts_missing" });
      return;
    }
    const meta = extractPageForLitLens();
    if (!meta?.text) {
      send({ ok: false, error: "no_text" });
      return;
    }
    chrome.runtime.sendMessage({ type: "LITLENS_SAVE_ARTICLE", meta }, (response) => {
      if (chrome.runtime.lastError) {
        send({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      send(response || { ok: false, error: "no_response" });
    });
  } catch (e) {
    send({ ok: false, error: e?.message || "save_error" });
  }
})();
