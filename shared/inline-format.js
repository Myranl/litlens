/**
 * Lightweight formatting in plain text (method doc fields, etc.).
 * Inline: <b>, <i>, <u>, <s>, <code> (also <strong>, <em>, <del>).
 * Lists: <ul>…</ul> with <li>…</li> or lines starting with "- " / "* ".
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof root !== "undefined") {
    root.LitLensInlineFormat = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const INLINE_TAG_NAMES = ["b", "strong", "i", "em", "u", "s", "del", "code"];
  const LIST_TAG_NAMES = ["ul", "ol", "li"];
  const TAG_NAMES = [...INLINE_TAG_NAMES, ...LIST_TAG_NAMES];

  const INLINE_TAG_RE = new RegExp(
    `<\\/?(?:${INLINE_TAG_NAMES.join("|")})\\s*>`,
    "gi"
  );
  const ANY_TAG_RE = new RegExp(
    `<\\/?(?:${TAG_NAMES.join("|")})\\s*>`,
    "gi"
  );
  const UL_BLOCK_RE = /<ul\s*>([\s\S]*?)<\/ul>/gi;
  const OL_BLOCK_RE = /<ol\s*>([\s\S]*?)<\/ol>/gi;

  const OPEN_RE = new RegExp(
    `^<(${INLINE_TAG_NAMES.join("|")})\\s*>`,
    "i"
  );
  const CLOSE_RE = new RegExp(
    `^<\\/(${INLINE_TAG_NAMES.join("|")})\\s*>`,
    "i"
  );

  const ELEMENT_FOR = {
    b: "strong",
    strong: "strong",
    i: "em",
    em: "em",
    u: "u",
    s: "s",
    del: "s",
    code: "code",
  };

  function normalizeTagName(raw) {
    return String(raw || "").toLowerCase();
  }

  function hasLooseBulletLines(text) {
    return String(text || "")
      .split("\n")
      .some((line) => isBulletLine(line));
  }

  function hasInlineFormat(text) {
    ANY_TAG_RE.lastIndex = 0;
    return ANY_TAG_RE.test(String(text || "")) || hasLooseBulletLines(text);
  }

  function createFormatElement(tag) {
    const el = document.createElement(ELEMENT_FOR[tag] || "span");
    el.className = "litlens-fmt";
    return el;
  }

  function isBulletLine(line) {
    return /^[-*•]\s+\S/.test(String(line || "").trim());
  }

  function splitLooseBulletBlocks(text) {
    const hay = String(text || "");
    const parts = [];
    const lines = hay.split("\n");
    let i = 0;
    while (i < lines.length) {
      if (!isBulletLine(lines[i])) {
        let j = i;
        while (j < lines.length && !isBulletLine(lines[j])) j++;
        const chunk = lines.slice(i, j).join("\n");
        if (chunk) parts.push({ type: "text", value: chunk });
        i = j;
        continue;
      }
      const bullets = [];
      while (i < lines.length && isBulletLine(lines[i])) {
        const m = lines[i].trim().match(/^[-*•]\s+(.+)$/);
        if (m) bullets.push(m[1].trim());
        i++;
      }
      if (bullets.length) {
        parts.push({ type: "ul-loose", items: bullets });
      }
    }
    if (!parts.length) parts.push({ type: "text", value: hay });
    return parts;
  }

  function splitListBlocks(text) {
    const hay = String(text || "");
    const parts = [];
    const re = /<(?:ul|ol)\s*>[\s\S]*?<\/(?:ul|ol)>/gi;
    let last = 0;
    let m;
    while ((m = re.exec(hay))) {
      if (m.index > last) {
        parts.push({ type: "text", value: hay.slice(last, m.index) });
      }
      const open = m[0].match(/^<(ul|ol)/i);
      parts.push({
        type: open && open[1].toLowerCase() === "ol" ? "ol" : "ul",
        value: m[0],
        raw: m[0],
      });
      last = re.lastIndex;
    }
    if (last < hay.length) parts.push({ type: "text", value: hay.slice(last) });
    if (!parts.length) parts.push({ type: "text", value: hay });
    return parts;
  }

  function parseListInner(inner, ordered) {
    const items = [];
    const hay = String(inner || "");
    const liRe = /<li\s*>([\s\S]*?)<\/li>/gi;
    let m;
    while ((m = liRe.exec(hay))) {
      const t = m[1].replace(/\s+/g, " ").trim();
      if (t) items.push(t);
    }
    if (items.length) return items;

    for (const line of hay.split("\n")) {
      let t = line.trim();
      if (!t) continue;
      const bullet = t.match(/^[-*•]\s+(.+)$/);
      if (bullet) {
        items.push(bullet[1].trim());
        continue;
      }
      const num = ordered && t.match(/^\d+[.)]\s+(.+)$/);
      if (num) {
        items.push(num[1].trim());
        continue;
      }
      if (!/^<\/?(?:ul|ol|li)\b/i.test(t)) items.push(t);
    }
    return items;
  }

  function extractListInner(raw) {
    const m = String(raw || "").match(/^<(?:ul|ol)\s*>([\s\S]*)<\/(?:ul|ol)\s*>$/i);
    return m ? m[1] : raw;
  }

  function appendBulletList(parent, raw, ordered) {
    const inner = extractListInner(raw);
    const items = parseListInner(inner, ordered);
    if (!items.length) return;

    const list = document.createElement(ordered ? "ol" : "ul");
    list.className = "litlens-fmt-list";
    for (const item of items) {
      const li = document.createElement("li");
      appendFormattedInline(li, item);
      list.appendChild(li);
    }
    parent.appendChild(list);
  }

  /** Inline tags + line breaks only (no <ul> / loose bullets). */
  function appendInlineFormattedText(parent, text) {
    if (!parent) return;
    const hay = String(text || "");
    if (!hay) return;
    INLINE_TAG_RE.lastIndex = 0;
    if (!INLINE_TAG_RE.test(hay)) {
      appendPlainWithBreaks(parent, hay);
      return;
    }
    INLINE_TAG_RE.lastIndex = 0;
    const lines = hay.split("\n");
    lines.forEach((line, i) => {
      if (i > 0) parent.appendChild(document.createElement("br"));
      if (line) appendFormattedLine(parent, line);
    });
  }

  /** Append formatted text into parent (lists, inline tags, \\n → <br>). */
  function appendFormattedText(parent, text, opts) {
    if (!parent) return;
    const hay = String(text || "");
    if (!hay) return;
    if (opts?.inlineOnly) {
      appendInlineFormattedText(parent, hay);
      return;
    }
    if (!hasInlineFormat(hay)) {
      appendPlainWithBreaks(parent, hay);
      return;
    }

    const blocks = splitListBlocks(hay);
    const onlyLoose =
      !/<(?:ul|ol)\s*>/i.test(hay) && hasLooseBulletLines(hay);
    if (onlyLoose) {
      splitLooseBulletBlocks(hay).forEach((sub) => {
        if (sub.type === "ul-loose") {
          const list = document.createElement("ul");
          list.className = "litlens-fmt-list";
          for (const item of sub.items) {
            const li = document.createElement("li");
            appendFormattedInline(li, item);
            list.appendChild(li);
          }
          parent.appendChild(list);
        } else if (sub.value) {
          appendPlainWithBreaks(parent, sub.value);
        }
      });
      return;
    }
    let blockIndex = 0;
    blocks.forEach((block) => {
      if (block.type === "ul" || block.type === "ol") {
        appendBulletList(parent, block.raw, block.type === "ol");
        blockIndex++;
        return;
      }
      const subparts = splitLooseBulletBlocks(block.value || "");
      subparts.forEach((sub, si) => {
        if (sub.type === "ul-loose") {
          const list = document.createElement("ul");
          list.className = "litlens-fmt-list";
          for (const item of sub.items) {
            const li = document.createElement("li");
            appendFormattedInline(li, item);
            list.appendChild(li);
          }
          parent.appendChild(list);
          blockIndex++;
          return;
        }
        const chunk = sub.value;
        if (!chunk) return;
        INLINE_TAG_RE.lastIndex = 0;
        if (!INLINE_TAG_RE.test(chunk)) {
          if (blockIndex > 0 || si > 0) {
            const gap = document.createElement("div");
            gap.className = "litlens-fmt-block-gap";
            parent.appendChild(gap);
          }
          appendPlainWithBreaks(parent, chunk);
          blockIndex++;
          return;
        }
        INLINE_TAG_RE.lastIndex = 0;
        const lines = chunk.split("\n");
        lines.forEach((line, i) => {
          if (blockIndex > 0 || si > 0 || i > 0) {
            parent.appendChild(document.createElement("br"));
          }
          if (line) appendFormattedLine(parent, line);
        });
        blockIndex++;
      });
    });
  }

  function appendPlainWithBreaks(parent, text) {
    const lines = String(text || "").split("\n");
    lines.forEach((line, i) => {
      if (i > 0) parent.appendChild(document.createElement("br"));
      if (line) parent.appendChild(document.createTextNode(line));
    });
  }

  /** Inline tags inside one list item (may contain \\n → <br>). */
  function appendFormattedInline(parent, text) {
    const lines = String(text || "").split("\n");
    lines.forEach((line, i) => {
      if (i > 0) parent.appendChild(document.createElement("br"));
      if (line) appendFormattedLine(parent, line);
    });
  }

  function appendFormattedLine(parent, line) {
    const stack = [parent];
    let i = 0;
    const hay = String(line || "");

    while (i < hay.length) {
      const rest = hay.slice(i);
      const openM = rest.match(OPEN_RE);
      if (openM) {
        const tag = normalizeTagName(openM[1]);
        const el = createFormatElement(tag);
        stack[stack.length - 1].appendChild(el);
        stack.push(el);
        i += openM[0].length;
        continue;
      }
      const closeM = rest.match(CLOSE_RE);
      if (closeM) {
        const tag = normalizeTagName(closeM[1]);
        const elName = ELEMENT_FOR[tag];
        let matchIdx = -1;
        for (let d = stack.length - 1; d >= 1; d--) {
          if (stack[d].tagName.toLowerCase() === elName) {
            matchIdx = d;
            break;
          }
        }
        if (matchIdx >= 1) stack.length = matchIdx;
        else if (stack.length > 1) stack.pop();
        else stack[0].appendChild(document.createTextNode(closeM[0]));
        i += closeM[0].length;
        continue;
      }

      const next = rest.search(INLINE_TAG_RE);
      const end = next < 0 ? rest.length : next;
      if (end > 0) {
        stack[stack.length - 1].appendChild(
          document.createTextNode(rest.slice(0, end))
        );
        i += end;
        continue;
      }
      stack[stack.length - 1].appendChild(document.createTextNode(rest[0]));
      i += 1;
    }
  }

  const FORMAT_SPECS = [
    { tag: "b", label: "Bold", hint: "<b>…</b>" },
    { tag: "i", label: "Italic", hint: "<i>…</i>" },
    { tag: "u", label: "Underline", hint: "<u>…</u>" },
    { tag: "s", label: "Strikethrough", hint: "<s>…</s>" },
    { tag: "code", label: "Code", hint: "<code>…</code>" },
    {
      tag: "ul",
      label: "Bullet list",
      hint: "<ul><li>…</li></ul>",
      action: "bulletList",
    },
  ];

  function wrapTextareaSelection(textarea, tag) {
    if (!textarea || !tag) return;
    const t = String(tag).toLowerCase();
    const open = `<${t}>`;
    const close = `</${t}>`;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const val = textarea.value;
    const selected = val.slice(start, end);
    textarea.value = val.slice(0, start) + open + selected + close + val.slice(end);
    const caret = start + open.length + selected.length + close.length;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function wrapTextareaAsBulletList(textarea) {
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const val = textarea.value;
    const selected = val.slice(start, end).trim();
    let inner;
    if (!selected) {
      inner = "<li></li>";
    } else if (/<li[\s>]/i.test(selected)) {
      inner = selected;
    } else if (selected.includes("\n")) {
      inner = selected
        .split("\n")
        .map((line) => {
          const t = line.trim();
          if (!t) return "";
          const stripped = t.replace(/^[-*•]\s+/, "");
          return `<li>${stripped}</li>`;
        })
        .filter(Boolean)
        .join("");
    } else {
      inner = `<li>${selected}</li>`;
    }
    const block = `<ul>${inner}</ul>`;
    textarea.value = val.slice(0, start) + block + val.slice(end);
    const caret = start + block.length;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function buildFormatToolbar(textarea) {
    const bar = document.createElement("div");
    bar.className = "litlens-format-bar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Text formatting");
    for (const spec of FORMAT_SPECS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "litlens-format-btn";
      btn.dataset.fmtTag = spec.tag;
      btn.title = `${spec.label} — ${spec.hint}`;
      btn.setAttribute("aria-label", spec.label);
      if (spec.tag === "b") btn.innerHTML = "<strong>B</strong>";
      else if (spec.tag === "i") btn.innerHTML = "<em>I</em>";
      else if (spec.tag === "u") btn.textContent = "U";
      else if (spec.tag === "s") btn.textContent = "S";
      else if (spec.tag === "ul") btn.textContent = "•";
      else btn.textContent = "</>";
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        if (spec.action === "bulletList") wrapTextareaAsBulletList(textarea);
        else wrapTextareaSelection(textarea, spec.tag);
      });
      bar.appendChild(btn);
    }
    return bar;
  }

  return {
    TAG_NAMES,
    hasInlineFormat,
    appendFormattedText,
    appendInlineFormattedText,
    appendPlainWithBreaks,
    extractListInner,
    parseListInner,
    wrapTextareaSelection,
    wrapTextareaAsBulletList,
    buildFormatToolbar,
    FORMAT_SPECS,
  };
});
