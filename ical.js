/* ical.js - læs/skriv VJOURNAL (RFC 5545). Port af iCalendar-laget i notesync.py,
 * så webklient og kommandolinjeværktøj skriver præcis samme format.
 * Virker både som <script> i browseren (window.Ical) og som require() i Node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Ical = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var CRLF = "\r\n";
  var PRODID = "-//webnotes//DA";

  // -- line folding -------------------------------------------------------
  function unfold(text) {
    var out = [];
    var lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if ((line[0] === " " || line[0] === "\t") && out.length) out[out.length - 1] += line.slice(1);
      else if (line !== "") out.push(line);
    }
    return out;
  }

  function utf8len(cp) {
    return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }

  // Max 75 oktetter pr. linje (UTF-8), uden at skære et tegn over.
  function fold(line) {
    var parts = [], cur = "", bytes = 0, limit = 75;
    for (var ch of line) {
      var n = utf8len(ch.codePointAt(0));
      if (bytes + n > limit) {
        parts.push(cur);
        cur = "";
        bytes = 0;
        limit = 74; // fortsættelseslinjer starter med et mellemrum
      }
      cur += ch;
      bytes += n;
    }
    parts.push(cur);
    return parts.join(CRLF + " ");
  }

  // -- TEXT-værdier -------------------------------------------------------
  function escapeText(s) {
    return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
      .replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  }

  function unescapeText(s) {
    return s.replace(/\\([\s\S])/g, function (_m, c) { return c === "n" || c === "N" ? "\n" : c; });
  }

  // 'NAME;PARAM=x:værdi' -> {name, params, value}. Kolon i citerede parametre ignoreres.
  function splitLine(line) {
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === ":" && !inQuotes) {
        var head = line.slice(0, i), semi = head.indexOf(";");
        return {
          name: (semi < 0 ? head : head.slice(0, semi)).toUpperCase(),
          params: semi < 0 ? "" : head.slice(semi + 1),
          value: line.slice(i + 1),
        };
      }
    }
    throw new Error("ugyldig iCalendar-linje: " + line);
  }

  // Del kommasepareret TEXT-liste (CATEGORIES) og respekter \,
  function splitCommas(value) {
    var out = [], cur = "", i = 0;
    while (i < value.length) {
      var c = value[i];
      if (c === "\\" && i + 1 < value.length) { cur += value.slice(i, i + 2); i += 2; continue; }
      if (c === ",") { out.push(cur); cur = ""; } else cur += c;
      i++;
    }
    out.push(cur);
    return out.filter(function (x) { return x !== ""; }).map(unescapeText);
  }

  // -- VJOURNAL -----------------------------------------------------------
  function vjournalSpan(lines) {
    var s = -1, e = -1, i;
    for (i = 0; i < lines.length; i++) if (lines[i].toUpperCase() === "BEGIN:VJOURNAL") { s = i; break; }
    if (s >= 0) for (i = s + 1; i < lines.length; i++) if (lines[i].toUpperCase() === "END:VJOURNAL") { e = i; break; }
    if (s < 0 || e < 0) throw new Error("objektet indeholder ingen VJOURNAL");
    return [s, e];
  }

  function parseIcs(raw) {
    var lines = unfold(raw), span = vjournalSpan(lines);
    var props = new Map(), tags = [];
    for (var i = span[0] + 1; i < span[1]; i++) {
      var p = splitLine(lines[i]);
      if (p.name === "CATEGORIES") tags = tags.concat(splitCommas(p.value));
      else if (!props.has(p.name)) props.set(p.name, p.value);
    }
    if (!props.get("UID")) throw new Error("VJOURNAL mangler UID");
    return {
      uid: unescapeText(props.get("UID")),
      title: unescapeText(props.get("SUMMARY") || ""),
      body: unescapeText(props.get("DESCRIPTION") || ""),
      tags: tags,
      modified: props.get("LAST-MODIFIED") || "",
    };
  }

  function nowUtc() {
    return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  }

  function serialize(lines) {
    return lines.map(fold).join(CRLF) + CRLF;
  }

  function tagsLine(tags) {
    return "CATEGORIES:" + tags.map(escapeText).join(",");
  }

  function newIcs(uid, title, body, tags) {
    body = body || "";
    tags = tags || [];
    var t = nowUtc();
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:" + PRODID, "BEGIN:VJOURNAL",
      "UID:" + uid, "DTSTAMP:" + t, "CREATED:" + t, "LAST-MODIFIED:" + t,
      "SUMMARY:" + escapeText(title || "")];
    if (body) lines.push("DESCRIPTION:" + escapeText(body));
    if (tags.length) lines.push(tagsLine(tags));
    lines.push("END:VJOURNAL", "END:VCALENDAR");
    return serialize(lines);
  }

  function sameList(a, b) {
    return a.length === b.length && a.every(function (x, i) { return x === b[i]; });
  }

  // Ret kun de felter, der faktisk ændres (ændringer = {title, body, tags}, udeladt = urørt).
  // Alt andet - X-egenskaber, CLASS, STATUS, VTIMEZONE osv. - bevares, så vi ikke
  // ødelægger data fra andre klienter (jtx Board m.fl.).
  function updateIcs(raw, changes) {
    var lines = unfold(raw), span = vjournalSpan(lines), cur = parseIcs(raw);
    var inner = lines.slice(span[0] + 1, span[1]), added = [], changed = false;

    function drop() {
      var names = Array.prototype.slice.call(arguments);
      inner = inner.filter(function (l) { return names.indexOf(splitLine(l).name) < 0; });
    }

    if (changes.title !== undefined && changes.title !== cur.title) {
      drop("SUMMARY");
      added.push("SUMMARY:" + escapeText(changes.title));
      changed = true;
    }
    if (changes.body !== undefined) {
      var body = changes.body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      if (body !== cur.body) {
        drop("DESCRIPTION");
        if (body) added.push("DESCRIPTION:" + escapeText(body));
        changed = true;
      }
    }
    if (changes.tags !== undefined && !sameList(changes.tags, cur.tags)) {
      drop("CATEGORIES");
      if (changes.tags.length) added.push(tagsLine(changes.tags));
      changed = true;
    }
    if (!changed) return raw;
    var t = nowUtc();
    drop("DTSTAMP", "LAST-MODIFIED");
    added.push("DTSTAMP:" + t, "LAST-MODIFIED:" + t);
    return serialize(lines.slice(0, span[0] + 1).concat(inner, added, lines.slice(span[1])));
  }

  function uuid() {
    var c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
    if (c && c.randomUUID) return c.randomUUID();
    var b = new Uint8Array(16);
    if (c && c.getRandomValues) c.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  return {
    CRLF: CRLF, unfold: unfold, fold: fold, escapeText: escapeText, unescapeText: unescapeText,
    splitLine: splitLine, splitCommas: splitCommas, parseIcs: parseIcs, newIcs: newIcs,
    updateIcs: updateIcs, nowUtc: nowUtc, uuid: uuid,
  };
});
