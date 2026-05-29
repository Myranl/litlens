/**
 * Plain text from stored article HTML/text — same offsets for server scan and reader UI.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof root !== "undefined") {
    root.LitLensArticlePlain = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function htmlToPlain(html) {
    let s = String(html || "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
    s = s
      .replace(/<\/(h[1-6])>/gi, "\n\n")
      .replace(/<h[1-6][^>]*>/gi, "\n\n")
      .replace(/<\/(p|div|section|article|li|tr|table|blockquote)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16))
      )
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n");
    return s.trim();
  }

  function textToPlain(text) {
    return String(text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .trim();
  }

  /** @param {{ html?: string, text?: string }} article */
  function articlePlain(article) {
    const html = String(article?.html || "").trim();
    const text = String(article?.text || "").trim();
    if (html) return htmlToPlain(html);
    if (text) return textToPlain(text);
    return "";
  }

  return { htmlToPlain, textToPlain, articlePlain };
});
