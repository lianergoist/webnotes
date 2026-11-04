/* md.js - Markdown til visning samt import/eksport af .md- og .txt-filer.
 *
 * Noten gemmes stadig som ren tekst i serveren; Markdown er kun en måde at vise den på.
 * Visningen bygges som DOM-elementer (aldrig innerHTML), så noget i en note ikke kan blive
 * til script eller HTML. Links tillades kun med http, https og mailto, og billeder hentes
 * ikke (de vises som et link), så en note ikke kan få browseren til at kalde fremmede servere.
 *
 * Understøttet: overskrifter, afsnit, **fed**, *kursiv*, ~~overstreget~~, `kode`, kodeblokke,
 * citater, punkt- og nummerlister (også indlejrede), opgaver (- [ ]), tabeller, linjer og links.
 * Virker både som <script> i browseren (window.Md) og som require() i Node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Md = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---- indlejret tekst ----------------------------------------------------

  const INLINE = new RegExp([
    "(`+)([\\s\\S]*?[^`])\\1(?!`)",                    // 1,2  kode
    "\\\\([\\\\`*_{}\\[\\]()#+\\-.!~|>])",             // 3    \* escape
    "!?\\[((?:[^\\[\\]\\\\]|\\\\.)*)\\]\\(\\s*([^\\s)]+)(?:\\s+\"[^\"]*\")?\\s*\\)", // 4,5 [tekst](url) eller ![alt](url)
    "<((?:https?:\\/\\/|mailto:)[^\\s>]+)>",           // 6    <url>
    "(https?:\\/\\/[^\\s<]+)",                         // 7    nøgen url
    "\\*\\*(?=\\S)([\\s\\S]*?\\S)\\*\\*",              // 8    fed
    "__(?=\\S)([\\s\\S]*?\\S)__",                      // 9    fed
    "~~(?=\\S)([\\s\\S]*?\\S)~~",                      // 10   overstreget
    "\\*(?=[^\\s*])([\\s\\S]*?[^\\s*])\\*",            // 11   kursiv
    "(?<![A-Za-z0-9])_(?=[^\\s_])([\\s\\S]*?[^\\s_])_(?![A-Za-z0-9])", // 12 kursiv
    "\\n",                                             // linjeskift
  ].join("|"), "g");

  const SAFE_URL = /^(https?:\/\/|mailto:)[^\s\u0000-\u001f]+$/i;

  function link(doc, url, parent) {
    const a = doc.createElement("a");
    a.setAttribute("href", url);
    a.setAttribute("rel", "noopener noreferrer");
    a.setAttribute("target", "_blank");
    parent.append(a);
    return a;
  }

  function inline(doc, text, parent, allowLinks) {
    const re = new RegExp(INLINE.source, "g"); // egen udgave pr. kald, fordi inline() kalder sig selv
    let pos = 0, m;
    const plain = (s) => { if (s) parent.append(doc.createTextNode(s)); };
    while ((m = re.exec(text))) {
      plain(text.slice(pos, m.index));
      pos = m.index + m[0].length;
      if (m[1] !== undefined) {
        const code = doc.createElement("code");
        code.textContent = m[2].replace(/^ (.*) $/, "$1");
        parent.append(code);
      } else if (m[3] !== undefined) {
        plain(m[3]);
      } else if (m[5] !== undefined) {
        if (allowLinks && SAFE_URL.test(m[5])) {
          const a = link(doc, m[5], parent);
          // Et billede vises som et link med alt-teksten.
          if (m[0][0] === "!") a.textContent = m[4] || m[5];
          else inline(doc, m[4] || m[5], a, false);
          if (!m[4] || m[4] === m[5]) a.className = "auto"; // uden beskrivelse: selve adressen
        } else {
          plain(m[0]);
        }
      } else if (m[6] !== undefined) {
        const a = link(doc, m[6], parent);
        a.textContent = m[6].replace(/^mailto:/i, "");
        a.className = "auto";
      } else if (m[7] !== undefined) {
        // Skilletegn i enden hører til sætningen, ikke til adressen.
        let url = m[7];
        const cut = /[.,;:!?'"*_~]+$/.exec(url);
        if (cut) url = url.slice(0, cut.index);
        while (url.endsWith(")") && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) url = url.slice(0, -1);
        re.lastIndex = pos = m.index + url.length;
        if (allowLinks && SAFE_URL.test(url)) {
          const a = link(doc, url, parent);
          a.textContent = url;
          a.className = "auto";
        } else {
          plain(url);
        }
      } else if (m[8] !== undefined || m[9] !== undefined) {
        inline(doc, m[8] !== undefined ? m[8] : m[9], parent.appendChild(doc.createElement("strong")), allowLinks);
      } else if (m[10] !== undefined) {
        inline(doc, m[10], parent.appendChild(doc.createElement("del")), allowLinks);
      } else if (m[11] !== undefined || m[12] !== undefined) {
        inline(doc, m[11] !== undefined ? m[11] : m[12], parent.appendChild(doc.createElement("em")), allowLinks);
      } else {
        parent.append(doc.createElement("br"));
      }
    }
    plain(text.slice(pos));
  }

  // ---- blokke -------------------------------------------------------------

  const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
  const HEADING = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
  const HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const QUOTE = /^ {0,3}>\s?(.*)$/;
  const LI = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const SEP = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

  const isBlank = (l) => l.t.trim() === "";
  function startsBlock(l) {
    return FENCE.test(l.t) || HEADING.test(l.t) || HR.test(l.t) || QUOTE.test(l.t) || LI.test(l.t);
  }

  function splitRow(s) {
    s = s.trim().replace(/^\|/, "").replace(/\|$/, "");
    const cells = [];
    let cur = "";
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "\\" && s[i + 1] === "|") { cur += "|"; i++; }
      else if (s[i] === "|") { cells.push(cur.trim()); cur = ""; }
      else cur += s[i];
    }
    cells.push(cur.trim());
    return cells;
  }

  function parseList(doc, lines, i, base) {
    const first = LI.exec(lines[i].t);
    const ordered = /\d/.test(first[2]);
    const list = doc.createElement(ordered ? "ol" : "ul");
    if (ordered && Number(first[2].replace(/\D/g, "")) !== 1) list.setAttribute("start", String(Number(first[2].replace(/\D/g, ""))));
    let last = null;
    while (i < lines.length) {
      let j = i;
      while (j < lines.length && isBlank(lines[j])) j++; // tomme linjer mellem punkter
      const m = j < lines.length ? LI.exec(lines[j].t) : null;
      if (!m || m[1].length < base) break;
      if (m[1].length > base) {
        if (!last) break;
        const sub = parseList(doc, lines, j, m[1].length);
        last.append(sub.node);
        i = sub.next;
        continue;
      }
      if (/\d/.test(m[2]) !== ordered) break;
      i = j + 1;
      const li = doc.createElement("li");
      let text = m[3];
      const task = /^\[([ xX])\]\s+([\s\S]*)$/.exec(text);
      if (task) {
        text = task[2];
        li.className = "task";
        const box = doc.createElement("input");
        box.type = "checkbox";
        box.checked = task[1] !== " ";
        box.setAttribute("data-line", String(lines[j].n));
        li.append(box, doc.createTextNode(" "));
      }
      // Fortsættelseslinjer: indrykkede linjer, der ikke selv er et listepunkt.
      while (i < lines.length && !isBlank(lines[i]) && /^\s+\S/.test(lines[i].t) && !LI.test(lines[i].t)) {
        text += "\n" + lines[i].t.trim();
        i++;
      }
      const span = doc.createElement("span");
      inline(doc, text, span, true);
      li.append(span);
      list.append(li);
      last = li;
    }
    return { node: list, next: i };
  }

  function blocks(doc, lines, out) {
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (isBlank(l)) { i++; continue; }

      let m = FENCE.exec(l.t);
      if (m) {
        const buf = [];
        i++;
        const close = new RegExp("^ {0,3}" + m[1][0] + "{" + m[1].length + ",}\\s*$");
        while (i < lines.length && !close.test(lines[i].t)) buf.push(lines[i++].t);
        i++; // lukkelinjen
        const pre = doc.createElement("pre");
        const code = doc.createElement("code");
        code.textContent = buf.join("\n");
        pre.append(code);
        out.append(pre);
        continue;
      }

      m = HEADING.exec(l.t);
      if (m) {
        const h = doc.createElement("h" + m[1].length);
        inline(doc, m[2], h, true);
        out.append(h);
        i++;
        continue;
      }

      if (HR.test(l.t)) { out.append(doc.createElement("hr")); i++; continue; }

      if (QUOTE.test(l.t)) {
        const inner = [];
        while (i < lines.length && QUOTE.test(lines[i].t)) {
          inner.push({ t: QUOTE.exec(lines[i].t)[1], n: lines[i].n });
          i++;
        }
        const bq = doc.createElement("blockquote");
        blocks(doc, inner, bq);
        out.append(bq);
        continue;
      }

      if (LI.test(l.t)) {
        const r = parseList(doc, lines, i, LI.exec(l.t)[1].length);
        out.append(r.node);
        i = r.next;
        continue;
      }

      if (l.t.includes("|") && i + 1 < lines.length && SEP.test(lines[i + 1].t) && lines[i + 1].t.includes("-") &&
          (lines[i + 1].t.includes("|") || splitRow(l.t).length > 1) && splitRow(l.t).length === splitRow(lines[i + 1].t).length) {
        const head = splitRow(l.t);
        const align = splitRow(lines[i + 1].t).map((c) => (/^:-*:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : ""));
        const table = doc.createElement("table");
        const thead = table.appendChild(doc.createElement("thead")).appendChild(doc.createElement("tr"));
        head.forEach((c, k) => {
          const th = doc.createElement("th");
          if (align[k]) th.className = "a-" + align[k];
          inline(doc, c, th, true);
          thead.append(th);
        });
        const tbody = table.appendChild(doc.createElement("tbody"));
        i += 2;
        while (i < lines.length && !isBlank(lines[i]) && lines[i].t.includes("|")) {
          const cells = splitRow(lines[i].t);
          const tr = tbody.appendChild(doc.createElement("tr"));
          head.forEach((_, k) => {
            const td = doc.createElement("td");
            if (align[k]) td.className = "a-" + align[k];
            inline(doc, cells[k] || "", td, true);
            tr.append(td);
          });
          i++;
        }
        const wrap = doc.createElement("div");
        wrap.className = "table-wrap";
        wrap.append(table);
        out.append(wrap);
        continue;
      }

      const buf = [];
      while (i < lines.length && !isBlank(lines[i]) && (buf.length === 0 || !startsBlock(lines[i]))) buf.push(lines[i++].t.trim());
      const p = doc.createElement("p");
      inline(doc, buf.join("\n"), p, true);
      out.append(p);
    }
  }

  // Bygger visningen som DOM. doc er document (eller en jsdom-udgave).
  function render(text, doc) {
    doc = doc || document;
    const frag = doc.createDocumentFragment();
    const lines = String(text).replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n").map((t, n) => ({ t, n }));
    blocks(doc, lines, frag);
    return frag;
  }

  // Én linje uden Markdown-tegn, til uddraget i listen.
  function plain(line) {
    return String(line)
      .replace(/^\s*(?:#{1,6}\s+|>\s*|(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?)+/, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/`+([^`]*)`+/g, "$1")
      .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
      .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*)[*_](?![\w])/g, "$1$2")
      .replace(/\\([\\`*_{}\[\]()#+\-.!~|>])/g, "$1")
      .trim();
  }

  // ---- import og eksport ---------------------------------------------------

  const MAX_IMPORT = 1024 * 1024; // 1 MB pr. fil

  function isMarkdownName(name) { return /\.(md|markdown|mdown|mkd)$/i.test(name || ""); }
  function stripExt(name) { return String(name || "").replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "").trim(); }

  function parseFrontMatter(text) {
    const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text);
    if (!m || m[1].split("\n").length > 60) return null;
    const out = { title: null, tags: null, rest: text.slice(m[0].length).replace(/^\n+/, "") };
    const lines = m[1].split("\n");
    const unq = (s) => s.trim().replace(/^(["'])(.*)\1$/, "$2");
    for (let i = 0; i < lines.length; i++) {
      const kv = /^(title|tags)\s*:\s*(.*)$/i.exec(lines[i]);
      if (!kv) continue;
      const key = kv[1].toLowerCase();
      let val = kv[2].trim();
      if (key === "title") { out.title = unq(val); continue; }
      const tags = [];
      if (val === "") {
        while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) tags.push(unq(lines[++i].replace(/^\s*-\s+/, "")));
      } else {
        val = val.replace(/^\[/, "").replace(/\]$/, "");
        val.split(",").forEach((t) => tags.push(unq(t)));
      }
      out.tags = tags.map((t) => t.replace(/^#/, "").trim()).filter(Boolean);
    }
    return out.title === null && out.tags === null ? null : out; // ukendte felter lader vi ligge i teksten
  }

  // Fil -> {title, body, tags}. Markdown-filer kan have titel og tags i front matter eller som første "# overskrift".
  function importFile(name, text) {
    text = String(text).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    let title = "", tags = [], body = text;
    if (isMarkdownName(name)) {
      const fm = parseFrontMatter(body);
      if (fm) { title = fm.title || ""; tags = fm.tags || []; body = fm.rest; }
      if (!title) {
        const h = /^\s*#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*(?:\n+|$)/.exec(body);
        if (h) { title = h[1].trim(); body = body.slice(h[0].length); }
      }
    }
    if (!title) title = stripExt(name);
    title = title.replace(/\s+/g, " ").trim().slice(0, 200);
    body = body.replace(/\s+$/, "");
    return { title, body, tags: tags.filter((t, i) => tags.indexOf(t) === i) };
  }

  function fileSafe(title, fallback) {
    const s = String(title || "").replace(/[\u0000-\u001f\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 80).trim();
    return s || fallback || "note";
  }

  // {title, body, tags} -> {filename, text, mime}. kind: "md" eller "txt".
  function exportFile(note, kind, fallbackName) {
    const title = String(note.title || "").trim();
    const body = String(note.body || "").replace(/\r\n?/g, "\n").replace(/\s+$/, "");
    const tags = note.tags || [];
    if (kind === "txt") {
      return { filename: fileSafe(title, fallbackName) + ".txt", text: body + "\n", mime: "text/plain;charset=utf-8" };
    }
    let text = "";
    if (tags.length) text += "---\ntags: " + tags.join(", ") + "\n---\n\n";
    const dup = title && body.split("\n").find((l) => l.trim()) === "# " + title;
    if (title && !dup) text += "# " + title + (body ? "\n\n" : "\n");
    text += body ? body + "\n" : "";
    return { filename: fileSafe(title, fallbackName) + ".md", text, mime: "text/markdown;charset=utf-8" };
  }

  return { render, plain, importFile, exportFile, fileSafe, isMarkdownName, MAX_IMPORT };
});
