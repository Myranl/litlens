/**
 * Extract bibliographic metadata from a Document (live page or parsed HTML).
 */
function metaContent(doc, names) {
  const list = Array.isArray(names) ? names : [names];
  for (const name of list) {
    const els = doc.querySelectorAll(
      `meta[name="${name}"], meta[property="${name}"], meta[itemprop="${name}"]`
    );
    if (els.length === 1 && els[0].getAttribute("content")) {
      return els[0].getAttribute("content").trim();
    }
    if (els.length > 1) {
      return [...els]
        .map((e) => e.getAttribute("content")?.trim())
        .filter(Boolean)
        .join("; ");
    }
  }
  return "";
}

function parseYear(raw) {
  if (!raw) return "";
  const m = String(raw).match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : "";
}

function fromJsonLd(doc) {
  const out = {};
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const s of scripts) {
    try {
      let data = JSON.parse(s.textContent);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const nodes = item["@graph"] ? item["@graph"] : [item];
        for (const node of nodes) {
          if (!node || typeof node !== "object") continue;
          const type = node["@type"];
          const types = Array.isArray(type) ? type : [type];
          const scholarly = types.some((t) =>
            /Article|ScholarlyArticle|NewsArticle|PublicationIssue/i.test(String(t))
          );
          if (!scholarly && !node.headline && !node.name) continue;
          if (!out.title && (node.headline || node.name)) {
            out.title = node.headline || node.name;
          }
          if (!out.journal && node.isPartOf?.name) out.journal = node.isPartOf.name;
          if (!out.year && node.datePublished) out.year = parseYear(node.datePublished);
          if (!out.url && node.url) out.url = node.url;
          if (!out.authors && node.author) {
            const authors = Array.isArray(node.author) ? node.author : [node.author];
            out.authors = authors
              .map((a) => (typeof a === "string" ? a : a?.name))
              .filter(Boolean)
              .join("; ");
          }
        }
      }
    } catch {
      /* ignore invalid JSON-LD */
    }
  }
  return out;
}

function extractMetadata(doc, pageUrl) {
  const ld = fromJsonLd(doc);

  const authorEls = doc.querySelectorAll('meta[name="citation_author"]');
  let authors = "";
  if (authorEls.length) {
    authors = [...authorEls]
      .map((e) => e.getAttribute("content")?.trim())
      .filter(Boolean)
      .join("; ");
  }
  if (!authors) {
    authors =
      metaContent(doc, ["citation_authors", "author", "dc.creator", "DC.creator"]) ||
      ld.authors ||
      "";
  }

  let title =
    metaContent(doc, ["citation_title", "og:title", "dc.title", "DC.Title"]) ||
    ld.title ||
    "";
  if (!title) {
    const h1 = doc.querySelector("h1, .article-title, [itemprop=headline]");
    if (h1?.textContent?.trim()) title = h1.textContent.trim();
  }
  if (!title && doc.title) {
    title = doc.title.replace(/\s*[\|–—-]\s*.*$/, "").trim();
  }

  const journal =
    metaContent(doc, [
      "citation_journal_title",
      "citation_journal",
      "prism.publicationName",
      "og:site_name",
      "dc.source",
    ]) ||
    ld.journal ||
    "";

  const year =
    parseYear(metaContent(doc, ["citation_year", "citation_date", "dc.date", "DC.Date"])) ||
    ld.year ||
    parseYear(metaContent(doc, ["article:published_time", "datePublished"])) ||
    "";

  let url =
    metaContent(doc, [
      "citation_fulltext_html_url",
      "citation_public_url",
      "citation_pdf_url",
      "og:url",
      "dc.identifier",
    ]) ||
    ld.url ||
    pageUrl ||
    "";

  if (url && !url.startsWith("http")) url = pageUrl || url;

  return {
    title: title || "Untitled",
    authors,
    year,
    journal,
    url: url || pageUrl || "",
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { extractMetadata, parseYear };
}
if (typeof window !== "undefined") {
  window.LitLensMetadata = { extractMetadata, parseYear };
}
