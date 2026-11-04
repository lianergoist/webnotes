#!/usr/bin/env node
/* Selvtest for webklienten.
 *
 *   1. ical.js         enhedstests + krydstjek mod notesync.py (samme format begge veje)
 *   2. dav.js          integrationstest mod en rigtig, lokal Radicale (htpasswd-login)
 *   3. app.js          hele brugerfladen kørt i jsdom mod samme Radicale
 *
 * Kør:  npm install && npm test
 * Kræver: Node 18+ og Python med "radicale" (pip install radicale; brug evt. venv:
 *         PYTHON=.venv/bin/python npm test).
 * Krydstjekket mod notesync.py springes over, hvis filen ikke findes
 * (angiv ellers mappen med NOTESYNC_DIR). jsdom er ikke en rigtig browser: layout og CSS
 * afprøves ikke her, kun logik og DOM. */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const crypto = require("crypto");
const { spawn, execFileSync } = require("child_process");
const { JSDOM } = require("jsdom");

const ROOT = __dirname;
const Ical = require(path.join(ROOT, "ical.js"));
const Md = require(path.join(ROOT, "md.js"));
const { DavClient, DavError, AuthError, NetworkError, slugify } = require(path.join(ROOT, "dav.js"));
const PY = process.env.PYTHON || "python3";

let failed = 0;
function check(name, cond, detail) {
  if (!cond) failed++;
  const d = !cond && detail !== undefined ? "   -> " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : "";
  console.log("  [" + (cond ? "ok" : "FEJL") + "] " + name + d);
}
const info = (m) => console.log("  [info] " + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (e) { /* prøv igen */ }
    if (Date.now() - t0 > (ms || 5000)) return false;
    await sleep(25);
  }
}
function freePort() {
  return new Promise((res) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

const FOREIGN = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ical4j//jtx Board//EN",
  "BEGIN:VJOURNAL", "UID:foreign-1", "DTSTAMP:20260101T100000Z",
  "SUMMARY:Fra jtx", "DESCRIPTION;LANGUAGE=da:Hej\\, verden",
  "CATEGORIES:Arbejde,Privat", "CLASS:PUBLIC", "STATUS:FINAL", "X-JTX-FOO:bar",
  'ATTACH;FMTTYPE="text/x:y":https://example.dk/a.txt',
  "END:VJOURNAL", "END:VCALENDAR", "",
].join("\r\n");

const VEVENT = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//t//EN", "BEGIN:VEVENT", "UID:ev-1",
  "DTSTAMP:20260101T100000Z", "DTSTART:20260101T100000Z", "SUMMARY:Møde", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");

// ---------------------------------------------------------------------------
function icalTests() {
  console.log("\n== ical.js ==");
  let raw = Ical.newIcs("u-1", "Indkøb, og mere; ting", "Mælk\nBrød\\rugbrød", ["Privat", "A,B"]);
  let p = Ical.parseIcs(raw);
  check("rundtur: titel med komma/semikolon", p.title === "Indkøb, og mere; ting", p.title);
  check("rundtur: flere linjer og backslash", p.body === "Mælk\nBrød\\rugbrød", p.body);
  check("rundtur: tags (inkl. komma i tag)", JSON.stringify(p.tags) === JSON.stringify(["Privat", "A,B"]), p.tags);

  const longBody = "Lang linje med æøå og 😀 ".repeat(40).trim();
  raw = Ical.newIcs("u-2", "Lang", longBody);
  const phys = raw.split("\r\n").slice(0, -1);
  check("folding: alle linjer <= 75 oktetter", phys.every((l) => Buffer.byteLength(l) <= 75), Math.max(...phys.map((l) => Buffer.byteLength(l))));
  check("folding: rundtur uden tab af æøå/emoji", Ical.parseIcs(raw).body === longBody);

  const upd = Ical.updateIcs(FOREIGN, { title: "Ny titel" });
  for (const needle of ["CLASS:PUBLIC", "STATUS:FINAL", "X-JTX-FOO:bar", "CATEGORIES:Arbejde,Privat",
    'ATTACH;FMTTYPE="text/x:y":https://example.dk/a.txt', "PRODID:-//ical4j//jtx Board//EN", "DESCRIPTION;LANGUAGE=da:Hej\\, verden"]) {
    check("update bevarer: " + needle.slice(0, 34), upd.includes(needle));
  }
  check("update ændrer titlen", Ical.parseIcs(upd).title === "Ny titel");
  check("update uden ændring giver uændret tekst", Ical.updateIcs(FOREIGN, { title: "Fra jtx" }) === FOREIGN);
  const upd2 = Ical.updateIcs(FOREIGN, { body: "", tags: [] });
  check("tom brødtekst/tags fjerner egenskaberne", !/^DESCRIPTION/m.test(upd2) && !/^CATEGORIES/m.test(upd2));
  check("ugyldigt objekt (VEVENT) afvises", (() => { try { Ical.parseIcs(VEVENT); return false; } catch (e) { return true; } })());
}

// ---------------------------------------------------------------------------
function findNotesync() {
  const cands = [process.env.NOTESYNC_DIR, path.resolve(ROOT, "..", "notesync"), path.resolve(ROOT, "..")].filter(Boolean);
  return cands.find((d) => fs.existsSync(path.join(d, "notesync.py")));
}

function crossTests(dir) {
  console.log("\n== Krydstjek mod notesync.py ==");
  if (!dir) { info("notesync.py ikke fundet (sæt NOTESYNC_DIR) - springer over"); return; }
  const head = "import sys, json, os\nsys.path.insert(0, os.environ['NOTESYNC_DIR'])\nimport notesync as ns\nd = json.load(sys.stdin)\n";
  const py = (code, input) => JSON.parse(execFileSync(PY, ["-c", head + code], {
    input: JSON.stringify(input), encoding: "utf8", env: Object.assign({}, process.env, { NOTESYNC_DIR: dir }),
  }));
  const sample = { uid: "x-1", title: "Tværs, af; sprog ÆØÅ 😀", body: "linje 1\nlinje 2, med komma; og \\ backslash " + "ord ".repeat(60), tags: ["a", "b,c"] };

  const jsRaw = Ical.newIcs(sample.uid, sample.title, sample.body, sample.tags);
  const asPy = py("p = ns.parse_ics(d['raw'])\nprint(json.dumps(dict(uid=p.uid, title=p.title, body=p.body, tags=p.tags)))", { raw: jsRaw });
  check("Python læser det, JavaScript skrev", asPy.title === sample.title && asPy.body === sample.body && JSON.stringify(asPy.tags) === JSON.stringify(sample.tags), asPy);

  const pyRaw = py("print(json.dumps(dict(raw=ns.new_ics(d['uid'], d['title'], d['body'], d['tags']))))", sample).raw;
  const asJs = Ical.parseIcs(pyRaw);
  check("JavaScript læser det, Python skrev", asJs.title === sample.title && asJs.body === sample.body && JSON.stringify(asJs.tags) === JSON.stringify(sample.tags), asJs);

  const pyUpd = py("print(json.dumps(dict(raw=ns.update_ics(d['raw'], title=d['title']))))", { raw: FOREIGN, title: "Rettet i Python" }).raw;
  check("Python-redigering kan læses i JavaScript og bevarer X-felter", Ical.parseIcs(pyUpd).title === "Rettet i Python" && pyUpd.includes("X-JTX-FOO:bar"));
  const jsUpd = Ical.updateIcs(pyRaw, { title: "Rettet i JS" });
  const back = py("p = ns.parse_ics(d['raw'])\nprint(json.dumps(dict(title=p.title, body=p.body)))", { raw: jsUpd });
  check("JavaScript-redigering kan læses i Python", back.title === "Rettet i JS" && back.body === sample.body, back);
}

// ---------------------------------------------------------------------------
function i18nTests() {
  console.log("\n== i18n.js ==");
  const I18n = require(path.join(ROOT, "i18n.js"));
  const placeholders = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  const langs = I18n.languages().map((l) => l.code);
  check("dansk, engelsk, tysk, spansk og fransk findes, og dansk er standard",
    ["da", "en", "de", "es", "fr"].every((c) => langs.includes(c)) && I18n.DEFAULT === "da" && I18n.getLang() === "da", langs);

  const da = I18n.messages("da"), en = I18n.messages("en");
  const others = langs.filter((c) => c !== "da");
  // Appens navn er "WebNotes" på alle sprog. Ellers kan få ord være ens på tværs af sprog.
  const SAME_OK = ["appTitle", "back", "tagsLabel", "langLabel", "statusOffline", "fmtLink", "fmtCode", "titleField", "collectionLabel", "exportMd", "exportTxt"];
  for (const c of others) {
    const m = I18n.messages(c);
    const onlyDa = Object.keys(da).filter((k) => !(k in m)), onlyX = Object.keys(m).filter((k) => !(k in da));
    check(c + ": præcis de samme nøgler som dansk", !onlyDa.length && !onlyX.length, { onlyDa, onlyX });
    const badPh = Object.keys(da).filter((k) => k in m && placeholders(da[k]) !== placeholders(m[k]));
    check(c + ": de samme {pladsholdere} som dansk", !badPh.length, badPh);
    const same = Object.keys(m).filter((k) => m[k] === da[k] && !SAME_OK.includes(k));
    check(c + ": er faktisk oversat (ingen tekst er ens med dansk, bortset fra få undtagelser)", !same.length, same);
  }
  check("ingen tom tekst på noget sprog",
    langs.every((c) => Object.values(I18n.messages(c)).every((s) => typeof s === "string" && s.trim() !== "")));
  check("appens navn er WebNotes på alle sprog", langs.every((c) => I18n.messages(c).appTitle === "WebNotes" && I18n.messages(c).back === "WebNotes"));

  const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const htmlSrc = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const davSrc = fs.readFileSync(path.join(ROOT, "dav.js"), "utf8");
  const used = new Set();
  for (const m of appSrc.matchAll(/\btr\("([A-Za-z0-9_.]+)"/g)) if (!m[1].endsWith(".")) used.add(m[1]); // "err." + kode samles op nedenfor
  for (const m of htmlSrc.matchAll(/data-i18n(?:-[a-z-]+)?="([A-Za-z0-9_.]+)"/g)) used.add(m[1]);
  for (const m of davSrc.matchAll(/new DavError\(\d+, "[^"]*", "(\w+)"\)/g)) used.add("err." + m[1]);
  for (const m of appSrc.matchAll(/new Dav\.DavError\(\d+, "[^"]*", "(\w+)"\)/g)) used.add("err." + m[1]);
  const missing = Array.from(used).filter((k) => !langs.every((c) => k in I18n.messages(c)));
  check("alle nøgler, som siden bruger, findes på alle sprog (" + used.size + " nøgler)", used.size > 30 && !missing.length, missing);
  const unused = Object.keys(da).filter((k) => !used.has(k));
  check("ingen ubrugte tekster", !unused.length, unused);
  const strayDanish = appSrc.split("\n").filter((l) => /["'`][^"'`\n]*(Noten|Samling|noter|gemt|slet)[^"'`\n]*["'`]/.test(l) && !/^\s*(\/\/|\*)/.test(l) && !/tr\(|DavError|console/.test(l));
  check("app.js har ingen faste, danske brugertekster tilbage", !strayDanish.length, strayDanish.slice(0, 5));

  check("tekst med pladsholder", I18n.t("deleteConfirm", { title: "X" }) === 'Slet noten "X"?');
  check("ukendt sprogkode afvises, og sproget er uændret", I18n.setLang("xx") === false && I18n.setLang(null) === false && I18n.getLang() === "da");
  check("manglende pladsholder bliver stående", I18n.t("collectionCreated", {}) === 'Samlingen "{name}" er oprettet.');
  check("ukendt nøgle vises som nøglen", I18n.t("findes.ikke") === "findes.ikke");
  I18n.setLang("en");
  check("engelsk: tekst, sted og pladsholder", I18n.t("newNote") === "New note" && I18n.locale() === "en-GB" && I18n.t("deleteConfirm", { title: "X" }) === 'Delete the note "X"?');
  I18n.setLang("de");
  check("tysk: tekst, sted og pladsholder", I18n.t("newNote") === "Neue Notiz" && I18n.locale() === "de-DE" && I18n.t("deleteConfirm", { title: "X" }) === 'Notiz "X" löschen?');
  I18n.setLang("es");
  check("spansk: tekst, sted og pladsholder", I18n.t("newNote") === "Nueva nota" && I18n.locale() === "es-ES" && I18n.t("deleteConfirm", { title: "X" }) === '¿Eliminar la nota "X"?');
  I18n.setLang("fr");
  check("fransk: tekst, sted og pladsholder", I18n.t("newNote") === "Nouvelle note" && I18n.locale() === "fr-FR" && I18n.t("deleteConfirm", { title: "X" }) === "Supprimer la note « X » ?");
  I18n.setLang("da");
}

// ---------------- md.js ----------------
function markdownTests() {
  console.log("\n== md.js (Markdown, import, eksport) ==");
  const doc = new JSDOM("<body></body>").window.document;
  const html = (t) => { const d = doc.createElement("div"); d.append(Md.render(t, doc)); return d.innerHTML; };
  const has = (t, frag) => html(t).includes(frag);

  check("overskrifter, afsnit og linjeskift", has("# A\n\n### B\n\nto\nlinjer", "<h1>A</h1><h3>B</h3><p>to<br>linjer</p>"), html("# A\n\n### B\n\nto\nlinjer"));
  check("fed, kursiv, overstreget og kode", has("**f** *k* __f2__ _k2_ ~~s~~ `c`", "<strong>f</strong> <em>k</em> <strong>f2</strong> <em>k2</em> <del>s</del> <code>c</code>"), html("**f** *k* __f2__ _k2_ ~~s~~ `c`"));
  check("understregning midt i et ord er ikke kursiv", has("snake_case_name", "snake_case_name") && !has("snake_case_name", "<em>"));
  check("escape med bagstreg", has("\\*ikke\\*", "*ikke*") && !has("\\*ikke\\*", "<em>"));
  check("punktliste med indlejret liste", has("- a\n- b\n  - c\n- d", "<ul><li><span>a</span></li><li><span>b</span><ul><li><span>c</span></li></ul></li><li><span>d</span></li></ul>"), html("- a\n- b\n  - c\n- d"));
  check("nummereret liste begynder ved første tal", has("3. x\n4. y", '<ol start="3">') && has("1. x\n2. y", "<ol><li>"));
  const tdiv = doc.createElement("div"); tdiv.append(Md.render("tekst\n\n- [ ] a\n- [x] b", doc));
  const tbx = tdiv.querySelectorAll('input[type="checkbox"]');
  check("opgaver: afkrydsningsfelter med linjenummer", tbx.length === 2 && tbx[0].dataset.line === "2" && tbx[1].dataset.line === "3" && !tbx[0].checked && tbx[1].checked, tdiv.innerHTML);
  check("kodeblok bevarer tegn som tekst", has("```js\nlet a = <b>;\n```", "<pre><code>let a = &lt;b&gt;;</code></pre>"), html("```js\nlet a = <b>;\n```"));
  check("ulukket kodeblok løber til slutningen", has("```\nabc\ndef", "<pre><code>abc\ndef</code></pre>"));
  check("citat med indhold", has("> et\n> to", "<blockquote><p>et<br>to</p></blockquote>"), html("> et\n> to"));
  check("vandret streg", html("---\n\n***") === "<hr><hr>", html("---\n\n***"));
  check("tabel med justering", has("| A | B |\n|---|--:|\n| 1 | 2 |", '<th class="a-right">B</th>') && has("| A | B |\n|---|--:|\n| 1 | 2 |", '<td class="a-right">2</td>'), html("| A | B |\n|---|--:|\n| 1 | 2 |"));
  check("links: http, https og mailto bliver links med rel og target", has("[x](https://a.dk/b)", '<a href="https://a.dk/b" rel="noopener noreferrer" target="_blank">x</a>') && has("<mailto:a@b.dk>", 'href="mailto:a@b.dk"'));
  check("nøgen adresse bliver link uden slutpunktum", has("se https://a.dk/b.", '<a href="https://a.dk/b"') && has("se https://a.dk/b.", "</a>."), html("se https://a.dk/b."));
  check("links uden beskrivelse får klassen auto (så de kan vises mindre); links med tekst gør ikke",
    has("https://a.dk/x", 'class="auto"') && has("<https://a.dk/x>", 'class="auto"') && has("[](https://a.dk/x)", 'class="auto"') && has("[https://a.dk/x](https://a.dk/x)", 'class="auto"') &&
    !has("[tekst](https://a.dk/x)", "auto"), html("[](https://a.dk/x)"));
  check("javascript:-links bliver aldrig links", !has("[x](javascript:alert(1))", "<a ") && !has("[x](JaVaScRiPt:alert(1))", "<a ") && !has("[x](data:text/html,hej)", "<a "), html("[x](javascript:alert(1))"));
  check("billeder hentes ikke: de vises som link", !has("![alt](https://a.dk/x.png)", "<img") && has("![alt](https://a.dk/x.png)", ">alt</a>"));
  const evil = html('<script>alert(1)</script> <img src=x onerror=alert(1)> <b>fed</b> [<i>x</i>](https://a.dk) # ikke overskrift');
  check("HTML i noter bliver til tekst", !/<(script|img|b|i)[ >]/i.test(evil.replace(/<\/?(p|a|br)[^>]*>/g, "")) && evil.includes("&lt;script&gt;"), evil);
  check("tom tekst giver tomt resultat", html("") === "" && html("\n\n") === "");
  check("meget indlejret tekst stopper (ingen uendelig løkke)", html("**a *b ~~c `d` e~~ f* g** " + "*".repeat(200)).length > 0);
  check("uddrag uden Markdown-tegn",
    Md.plain("## **Hej** [link](http://x) `k`") === "Hej link k" && Md.plain("- [ ] opgave") === "opgave" && Md.plain("> citat") === "citat" && Md.plain("1. første") === "første",
    [Md.plain("## **Hej** [link](http://x) `k`"), Md.plain("- [ ] opgave")]);

  // import
  const j = (o) => JSON.stringify(o);
  check("import: første # overskrift bliver titlen", j(Md.importFile("x.md", "# Titel\n\nBrødtekst\n")) === j({ title: "Titel", body: "Brødtekst", tags: [] }), Md.importFile("x.md", "# Titel\n\nBrødtekst\n"));
  check("import: uden overskrift bruges filnavnet", j(Md.importFile("Mine ideer.md", "Bare tekst\n")) === j({ title: "Mine ideer", body: "Bare tekst", tags: [] }));
  check("import: front matter med titel og tags (liste, [..] og komma)",
    j(Md.importFile("a.md", "---\ntitle: T\ntags: [x, y]\n---\n\ntekst")) === j({ title: "T", body: "tekst", tags: ["x", "y"] }) &&
    j(Md.importFile("a.md", "---\ntags:\n  - a\n  - \"b\"\n---\n# H\ntekst")) === j({ title: "H", body: "tekst", tags: ["a", "b"] }) &&
    Md.importFile("a.md", "---\ntags: #u, v, u\n---\nx").tags.join() === "u,v");
  check("import: ukendt front matter bliver stående i teksten", Md.importFile("a.md", "---\ndato: 1\n---\nx").body.startsWith("---\ndato: 1"));
  check("import: .txt er ren tekst (ingen overskrift eller front matter fjernes)", j(Md.importFile("liste.txt", "# ikke titel\nhej")) === j({ title: "liste", body: "# ikke titel\nhej", tags: [] }));
  check("import: BOM og Windows-linjeskift", j(Md.importFile("a.md", "﻿# T\r\n\r\nlinje1\r\nlinje2\r\n")) === j({ title: "T", body: "linje1\nlinje2", tags: [] }));
  // eksport
  const e1 = Md.exportFile({ title: "Plan/2026: nu?", body: "tekst", tags: ["a", "b"] }, "md", "Uden titel");
  check("eksport .md: filnavn, front matter, overskrift og tekst",
    e1.filename === "Plan 2026 nu.md" && e1.text === "---\ntags: a, b\n---\n\n# Plan/2026: nu?\n\ntekst\n" && e1.mime.startsWith("text/markdown"), e1);
  const e2 = Md.exportFile({ title: "Plan", body: "tekst\n\n", tags: ["a"] }, "txt", "Uden titel");
  check("eksport .txt: kun teksten", e2.filename === "Plan.txt" && e2.text === "tekst\n" && e2.mime.startsWith("text/plain"), e2);
  check("eksport: uden titel bruges reservenavnet; ingen dobbelt overskrift",
    Md.exportFile({ title: "", body: "x", tags: [] }, "md", "Uden titel").filename === "Uden titel.md" &&
    Md.exportFile({ title: "A", body: "# A\n\nx", tags: [] }, "md").text === "# A\n\nx\n");
  const trip = (n) => { const f = Md.exportFile(n, "md"); return Md.importFile(f.filename, f.text); };
  const orig = { title: "Rundtur", body: "# Under\n\n- a\n- [x] b\n\n```\nkode\n```", tags: ["én", "to"] };
  check("eksport og import af .md giver samme note tilbage", j(trip(orig)) === j(orig), trip(orig));
}

// ---------------- versioner i index.html ----------------
function versionTest() {
  console.log("\n== index.html (versioner mod cache) ==");
  const { stamped } = require(path.join(ROOT, "stamp.js"));
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const refs = html.match(/\b(?:href|src)="[A-Za-z0-9_.-]+\.(?:css|js)[^"]*"/g) || [];
  check("alle lokale filer har ?v= (" + refs.length + ")", refs.length >= 6 && refs.every((r) => /\?v=[0-9a-f]{8}"$/.test(r)), refs);
  check("versionerne passer til filernes indhold (ellers: node stamp.js)", stamped(html) === html);
}

async function main() {
  icalTests();
  i18nTests();
  markdownTests();
  versionTest();
  crossTests(findNotesync());

  console.log("\n== Radicale ==");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "webnotes-test-"));
  const port = await freePort();
  fs.writeFileSync(path.join(tmp, "users"), "anna:hemmelig\n");
  fs.writeFileSync(path.join(tmp, "config"),
    "[server]\nhosts = 127.0.0.1:" + port + "\n[auth]\ntype = htpasswd\nhtpasswd_filename = " + tmp + "/users\n" +
    "htpasswd_encryption = plain\n[storage]\nfilesystem_folder = " + tmp + "/collections\n[logging]\nlevel = warning\n");
  const server = spawn(PY, ["-m", "radicale", "--config", path.join(tmp, "config")], { stdio: ["ignore", "pipe", "pipe"] });
  let serverLog = "";
  server.stdout.on("data", (d) => { serverLog += d; });
  server.stderr.on("data", (d) => { serverLog += d; });

  const ORIGIN = "http://127.0.0.1:" + port;
  const AUTH = "Basic " + Buffer.from("anna:hemmelig").toString("base64");
  const XmlParser = new JSDOM("").window.DOMParser;
  const mk = (auth, origin) => new DavClient({ origin: origin || ORIGIN, auth: auth === undefined ? AUTH : auth, parser: new XmlParser() });

  try {
    const up = await waitFor(() => new Promise((res) => { const s = net.connect(port, "127.0.0.1", () => { s.destroy(); res(true); }); s.on("error", () => res(false)); }), 10000);
    if (!up) throw new Error("Radicale startede ikke:\n" + serverLog);
    info("Radicale kører på port " + port);

    const admin = mk();
    async function mkcal(p, name, comps) {
      const body = '<?xml version="1.0"?><C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop>' +
        "<D:displayname>" + name + "</D:displayname><C:supported-calendar-component-set>" +
        comps.map((x) => '<C:comp name="' + x + '"/>').join("") + "</C:supported-calendar-component-set></D:prop></D:set></C:mkcalendar>";
      const r = await admin.request("MKCALENDAR", p, { body, headers: { "Content-Type": "application/xml" } });
      if (r.status !== 201 && r.status !== 200) throw new Error("MKCALENDAR " + p + " -> " + r.status + " " + r.text.slice(0, 200));
    }

    // ---------------- dav.js ----------------
    console.log("\n== dav.js ==");
    await mkcal("/anna/dav/", "DavTest", ["VJOURNAL"]);
    await mkcal("/anna/kal/", "Kalender", ["VEVENT", "VTODO", "VJOURNAL"]);
    const cols = await admin.discover();
    const dt = cols.find((c) => c.href === "/anna/dav/");
    const kal = cols.find((c) => c.href === "/anna/kal/");
    check("discover finder begge samlinger via brugerens principal", !!dt && !!kal, cols);
    check("discover: navn og komponenter læses", dt && dt.name === "DavTest" && dt.onlyJournal && kal && kal.journal && !kal.onlyJournal, cols);

    // Radicale under en understi (caldav.rpix.dk: "/" er kontoportalen, Radicale ligger på "/dav/").
    const portalFetch = (u, init) => {
      const p = u.slice(ORIGIN.length);
      if (p === "/") return Promise.resolve(new Response("<html>portal</html>", { status: 200, headers: { "Content-Type": "text/html" } }));
      return fetch(p.startsWith("/dav/") ? ORIGIN + p.slice(4) : u, init);
    };
    const viaDav = new DavClient({ origin: ORIGIN, auth: AUTH, parser: new XmlParser(), roots: ["/", "/dav/"], fetch: portalFetch });
    check("principalPath: springer en ikke-CalDAV-side over og bruger næste sti", (await viaDav.principalPath()) === "/anna/");
    const onlyPortal = new DavClient({ origin: ORIGIN, auth: AUTH, parser: new XmlParser(), fetch: portalFetch });
    let opErr = null; try { await onlyPortal.principalPath(); } catch (e) { opErr = e; }
    check("principalPath: giver en DavError, når ingen sti svarer som CalDAV", opErr instanceof DavError && !(opErr instanceof AuthError), opErr);
    const noAuth = new DavClient({ origin: ORIGIN, auth: null, parser: new XmlParser(), roots: ["/", "/dav/"] });
    let naErr = null; try { await noAuth.principalPath(); } catch (e) { naErr = e; }
    check("principalPath: manglende login stopper med det samme (prøver ikke næste sti)", naErr instanceof AuthError, naErr);

    check("slugify: æøå, mellemrum og tegnsætning", slugify("Mine idéer") === "mine-ideer" && slugify("Århus – nye ideer!") === "aarhus-nye-ideer" &&
      slugify("Test samling æøå") === "test-samling-aeoeaa", [slugify("Mine idéer"), slugify("Århus – nye ideer!")]);
    check("slugify: tomt navn giver et gyldigt standardnavn", slugify("  !!! ") === "samling" && slugify("x".repeat(100)).length <= 40);
    const nc1 = await admin.createCollection("Test samling æøå & co");
    check("createCollection: adresse laves af navnet, kun VJOURNAL",
      nc1.href === "/anna/test-samling-aeoeaa-co/" && nc1.name === "Test samling æøå & co" && nc1.onlyJournal, nc1);
    const nc2 = await admin.createCollection("test-samling aeoeaa co");
    check("createCollection: optaget adresse får et løbenummer", nc2.href === "/anna/test-samling-aeoeaa-co-2/", nc2);
    const ncFound = (await admin.discover()).find((x) => x.href === nc1.href);
    check("discover finder den nye samling med navn (også & og æøå) og kun VJOURNAL",
      ncFound && ncFound.onlyJournal && ncFound.name === "Test samling æøå & co", ncFound);
    const ncNote = await admin.createNote(nc1.href, { title: "Test i ny samling" });
    check("der kan oprettes og læses noter i en ny samling", (await admin.listNotes(nc1.href)).length === 1 && ncNote.href.startsWith(nc1.href));
    await admin.request("DELETE", nc1.href);
    await admin.request("DELETE", nc2.href);

    const DC = "/anna/dav/";
    const ctag0 = await admin.getCtag(DC);
    check("ctag findes", typeof ctag0 === "string" && ctag0.length > 0, ctag0);

    const a = await admin.createNote(DC, { title: "Første, note", body: "Mælk\nBrød", tags: ["Privat"] });
    check("createNote returnerer note med etag", /"/.test(a.etag) && a.href === DC + a.uid + ".ics", a);
    check("ctag ændres ved ændring", (await admin.getCtag(DC)) !== ctag0);

    let list = await admin.listNotes(DC);
    check("listNotes finder noten med alle felter", list.length === 1 && list[0].title === "Første, note" && list[0].body === "Mælk\nBrød" && list[0].tags[0] === "Privat", list);

    const s1 = await admin.saveNote(a, { title: "Første, note", body: "Mælk\nBrød\nKaffe", tags: ["Privat"] });
    check("saveNote opdaterer med If-Match og giver ny etag", s1.status < 300 && s1.etag !== a.etag && s1.note.body.endsWith("Kaffe"), s1);
    const stale = await admin.saveNote(a, { title: "Gammel version", body: "x", tags: [] });
    check("forældet etag giver 412 (ingen overskrivning)", stale.status === 412, stale);
    check("noten er uændret efter afvist gem", (await admin.getNote(a.href)).raw.includes("Kaffe"));
    check("sletning med forældet etag giver 'conflict'", (await admin.deleteNote(a.href, a.etag)) === "conflict");

    const f = await admin.putNote(DC + "foreign-1.ics", FOREIGN, null);
    check("fremmed note kan oprettes", f.status === 201, f);
    const fn = (await admin.listNotes(DC)).find((n) => n.uid === "foreign-1");
    check("fremmed note læses (tags, escaped komma)", fn && fn.title === "Fra jtx" && fn.body === "Hej, verden" && fn.tags.join() === "Arbejde,Privat", fn);
    const fs1 = await admin.saveNote(fn, { title: "Fra jtx (rettet)" });
    const fraw = (await admin.getNote(DC + "foreign-1.ics")).raw.replace(/\r?\n /g, "");
    check("redigering bevarer fremmede egenskaber på serveren", fs1.status < 300 && ["X-JTX-FOO:bar", "CLASS:PUBLIC", "STATUS:FINAL", "CATEGORIES:Arbejde,Privat", "PRODID:-//ical4j//jtx Board//EN", "DESCRIPTION;LANGUAGE=da:Hej\\, verden"].every((s) => fraw.includes(s)), fraw);

    await admin.putNote(DC + "ev-1.ics", VEVENT, null);
    list = await admin.listNotes(DC);
    check("VEVENT i samlingen ignoreres af listNotes", list.length === 2 && !list.some((n) => n.uid === "ev-1"), list.map((n) => n.uid));

    check("getNote på ukendt href giver null", (await admin.getNote(DC + "findes-ikke.ics")) === null);
    check("slet med korrekt etag lykkes", (await admin.deleteNote(s1.note.href, s1.etag)) === "deleted" && (await admin.getNote(s1.note.href)) === null);

    let err = null;
    try { await mk("Basic " + Buffer.from("anna:forkert").toString("base64")).discover(); } catch (e) { err = e; }
    check("forkert adgangskode giver AuthError", err instanceof AuthError, err && err.message);
    err = null;
    try { await mk(AUTH, "http://127.0.0.1:" + (await freePort())).discover(); } catch (e) { err = e; }
    check("utilgængelig server giver NetworkError", err instanceof NetworkError, err && err.message);

    // krydstjek: notesync.py ser det, webklienten skriver, og omvendt
    const dir = findNotesync();
    if (dir) {
      const head = "import sys, json, os\nsys.path.insert(0, os.environ['NOTESYNC_DIR'])\nimport notesync as ns\n" +
        "st = ns.Store(':memory:')\ncl = ns.DavClient(os.environ['URL'], 'anna', 'hemmelig')\nsy = ns.Syncer(st, cl)\n";
      const pyRun = (code) => JSON.parse(execFileSync(PY, ["-c", head + code], {
        encoding: "utf8", env: Object.assign({}, process.env, { NOTESYNC_DIR: dir, URL: ORIGIN + DC }),
      }));
      const web = await admin.createNote(DC, { title: "Skrevet i browser", body: "hej fra web", tags: ["web"] });
      const seen = pyRun("sy.sync()\nprint(json.dumps(sorted(n.title for n in st.visible())))");
      check("notesync.py henter noten, webklienten skrev", seen.includes("Skrevet i browser") && seen.includes("Fra jtx (rettet)"), seen);
      const fromPy = pyRun("sy.sync()\nn = st.add('Skrevet i Python', 'hej fra cli', ['cli'])\nsy.sync()\nprint(json.dumps(n.uid))");
      const after = await admin.listNotes(DC);
      const pn = after.find((n) => n.uid === fromPy);
      check("webklienten læser noten, notesync.py skrev", pn && pn.title === "Skrevet i Python" && pn.body === "hej fra cli" && pn.tags[0] === "cli", pn);
      await admin.deleteNote(web.href, web.etag);
    }
    await admin.request("DELETE", "/anna/dav/");

    // ---------------- app.js i jsdom ----------------
    console.log("\n== app.js (brugerflade i jsdom) ==");
    const COL = "/anna/noter/";
    await mkcal(COL, "Noter", ["VJOURNAL"]);
    const n1 = await admin.createNote(COL, { title: "Indkøbsliste", body: "Mælk\nBrød", tags: ["Privat"] });
    await admin.putNote(COL + "foreign-1.ics", FOREIGN, null);
    await admin.putNote(COL + "ev-1.ics", VEVENT, null);

    function loadApp(auth, search) {
      const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
      const dom = new JSDOM(html, { url: ORIGIN + "/webnotes/index.html" + (search || ""), runScripts: "outside-only", pretendToBeVisual: true });
      const w = dom.window;
      w.NOTEWEB_CONFIG = { saveDelay: 50, pollMs: 250, retryMs: 300 };
      w.realFetch = (u, init) => fetch(new URL(u, ORIGIN), Object.assign({}, init, { headers: Object.assign({}, init && init.headers, { Authorization: auth }) }));
      w.fetch = w.realFetch;
      w.confirm = () => true;
      w.prompt = () => null; // jsdom har ingen prompt; tests sætter den selv
      if (!w.crypto || !w.crypto.randomUUID) Object.defineProperty(w, "crypto", { value: crypto.webcrypto, configurable: true });
      w.console.error = () => {}; // forventede fejl i fejlscenarier
      for (const file of ["ical.js", "dav.js", "i18n.js", "md.js", "app.js"]) w.eval(fs.readFileSync(path.join(ROOT, file), "utf8"));
      const $ = (id) => w.document.getElementById(id);
      return {
        dom, w, $,
        items: () => Array.from(w.document.querySelectorAll("button.note")),
        titles: () => Array.from(w.document.querySelectorAll("button.note .title-text")).map((e) => e.textContent),
        click: (el) => el.click(),
        type: (el, v) => { el.value = v; el.dispatchEvent(new w.Event("input", { bubbles: true })); },
        open: async (title) => {
          const b = Array.from(w.document.querySelectorAll("button.note")).find((x) => x.querySelector(".title-text").textContent === title);
          b.click();
          return waitFor(() => $("title").value === title, 3000);
        },
      };
    }
    const serverNote = async (uid) => (await admin.listNotes(COL)).find((n) => n.uid === uid);
    const j2 = (v) => JSON.stringify(v);
    const serverByTitleIn = async (col, t) => (await admin.listNotes(col)).find((n) => n.title === t);
    const serverByTitle = async (t) => (await admin.listNotes(COL)).find((n) => n.title === t);

    const app = loadApp(AUTH);
    const { $, w } = app;
    check("noterne vises i listen (VEVENT ignoreres)", await waitFor(() => app.items().length === 2), app.titles());
    check("samlingsvælger vises, noter-samlingen står først, og 'Ny samling…' står til sidst",
      !$("collection").hidden && Array.from($("collection").options).map((o) => o.textContent).join("|") === "Noter|Kalender|Ny samling…",
      Array.from($("collection").options).map((o) => o.textContent));
    check("dansk er standard: sprog, titel, knapper og vælger",
      w.document.documentElement.lang === "da" && w.document.title === "WebNotes" && $("btn-new").textContent === "Ny note" &&
      $("search").placeholder === "Søg i noter" && $("lang").value === "da", [w.document.documentElement.lang, w.document.title, $("lang").value]);
    const groups = Array.from(w.document.querySelectorAll("h2.group")).map((h) => h.textContent);
    check("noter grupperes efter dato (I dag / Uden dato)", groups.join("|") === "I dag|Uden dato", groups);
    check("brugerfladen indeholder ingen HTML fra noterne (kun tekst)", !w.document.querySelector("#list script, #list img"));

    app.type($("search"), "jtx");
    check("søgning filtrerer listen", app.titles().join() === "Fra jtx", app.titles());
    app.type($("search"), "");
    check("tom søgning viser alt igen", app.items().length === 2);

    // åbn og ret en fremmed note
    check("klik åbner noten i editoren", await app.open("Fra jtx"));
    check("editoren viser tags og tekst", $("tags").value === "Arbejde, Privat" && $("body").value === "Hej, verden", [$("tags").value, $("body").value]);
    check("mobilvisning skifter til editoren", w.document.body.dataset.view === "editor");
    check("åbnet note står som Gemt", $("status").textContent === "Gemt", $("status").textContent);
    app.type($("title"), "Fra jtx (web)");
    check("straks efter en ændring står der Ikke gemt", $("status").textContent === "Ikke gemt", $("status").textContent);
    check("autosave gemmer titlen på serveren", await waitFor(async () => (await serverNote("foreign-1")).title === "Fra jtx (web)"));
    const uiRaw = (await admin.getNote(COL + "foreign-1.ics")).raw.replace(/\r?\n /g, "");
    check("autosave bevarer fremmede egenskaber", ["X-JTX-FOO:bar", "CLASS:PUBLIC", "STATUS:FINAL", "DESCRIPTION;LANGUAGE=da:Hej\\, verden"].every((s) => uiRaw.includes(s)), uiRaw);
    check("statuslinjen siger Gemt", await waitFor(() => $("status").textContent === "Gemt"), $("status").textContent);

    // ny note
    const before = (await admin.listNotes(COL)).length;
    app.click($("btn-new"));
    check("ny note: editor er tom og slet er deaktiveret", await waitFor(() => $("title").value === "" && $("btn-delete").disabled));
    await sleep(200);
    check("tom ny note oprettes ikke på serveren", (await admin.listNotes(COL)).length === before);
    app.type($("title"), "Fra browseren");
    app.type($("body"), "linje 1\nlinje 2, med komma");
    app.type($("tags"), "web, test");
    const created = await waitFor(() => serverByTitle("Fra browseren"));
    check("ny note oprettes på serveren med tekst og tags", created && created.body === "linje 1\nlinje 2, med komma" && created.tags.join() === "web,test", created);
    check("ny note vises i listen og slet aktiveres", await waitFor(() => app.titles().includes("Fra browseren") && !$("btn-delete").disabled));
    await sleep(300);
    check("autosave opretter ikke dubletter", (await admin.listNotes(COL)).filter((n) => n.title === "Fra browseren").length === 1);

    // konflikt: noten ændres udefra, mens den er åben her
    check("åbn Indkøbsliste", await app.open("Indkøbsliste"));
    const fresh = (await admin.listNotes(COL)).find((n) => n.uid === n1.uid);
    await admin.saveNote(fresh, { body: "Server-version" });
    app.type($("body"), "Browser-version");
    const copy = await waitFor(() => serverByTitle("Indkøbsliste (konflikt)"));
    check("konflikt: brugerens tekst gemmes som ny note", copy && copy.body === "Browser-version", copy);
    const orig = await serverNote(n1.uid);
    check("konflikt: originalen beholder den andens version", orig && orig.body === "Server-version" && orig.title === "Indkøbsliste", orig);
    check("konflikt: brugeren får besked", !$("banner").hidden && $("banner-text").textContent.includes("(konflikt)"), $("banner-text").textContent);
    check("konflikt: editoren viser kopiens titel", await waitFor(() => $("title").value === "Indkøbsliste (konflikt)"), $("title").value);
    app.type($("body"), "Browser-version, rettet bagefter");
    check("videre redigering rammer kopien, ikke originalen",
      await waitFor(async () => (await serverByTitle("Indkøbsliste (konflikt)")).body === "Browser-version, rettet bagefter") && (await serverNote(n1.uid)).body === "Server-version");

    // slet
    check("åbn note der skal slettes", await app.open("Fra browseren"));
    app.click($("btn-delete"));
    check("sletning fjerner noten fra serveren og listen",
      await waitFor(async () => !(await serverByTitle("Fra browseren")) && !app.titles().includes("Fra browseren")));
    check("efter sletning vender visningen tilbage til listen", w.document.body.dataset.view === "list");

    // opdatering udefra
    await admin.createNote(COL, { title: "Udefra", body: "oprettet et andet sted" });
    check("polling henter nye noter fra andre enheder", await waitFor(() => app.titles().includes("Udefra"), 4000), app.titles());

    // offline og gentagelse
    check("åbn note før offline-test", await app.open("Udefra"));
    w.fetch = () => Promise.reject(new TypeError("fetch failed"));
    app.type($("body"), "skrevet uden forbindelse");
    check("offline: brugeren får besked om, at noget ikke er gemt",
      await waitFor(() => !$("banner").hidden && $("banner-text").textContent.includes("Kan ikke nå serveren"), 3000), $("banner-text").textContent);
    check("offline: teksten ligger stadig i editoren", $("body").value === "skrevet uden forbindelse");
    w.fetch = w.realFetch;
    check("online igen: ændringen gemmes automatisk",
      await waitFor(async () => (await serverByTitle("Udefra")).body === "skrevet uden forbindelse", 4000));

    w.close();

    // kun én samling: vælgeren vises alligevel og viser samlingens navn
    await admin.request("DELETE", "/anna/kal/");
    const solo = loadApp(AUTH);
    check("én samling: vælgeren vises med samlingens navn og 'Ny samling…'",
      await waitFor(() => !solo.$("collection").hidden && Array.from(solo.$("collection").options).map((o) => o.textContent).join("|") === "Noter|Ny samling…", 4000),
      [solo.$("collection").hidden, Array.from(solo.$("collection").options).map((o) => o.textContent)]);
    check("én samling: noterne vises stadig", await waitFor(() => solo.items().length > 0, 4000));

    // Ny samling…
    const sel = solo.$("collection");
    const pick = (value) => { sel.value = value; sel.dispatchEvent(new solo.w.Event("change")); };
    const countCols = async () => (await admin.discover()).length;
    const colsBefore = await countCols();

    solo.w.prompt = () => null;
    pick("__new__");
    await sleep(250);
    check("Ny samling…: annulleret giver ingen ny samling, og vælgeren står på den nuværende",
      sel.value === "/anna/noter/" && (await countCols()) === colsBefore, [sel.value, await countCols()]);

    solo.w.prompt = () => "  noter ";
    pick("__new__");
    check("Ny samling…: et navn der findes giver besked og ingen ny samling",
      await waitFor(() => !solo.$("banner").hidden && solo.$("banner-text").textContent.includes("findes allerede"), 3000) &&
      (await countCols()) === colsBefore, solo.$("banner-text").textContent);

    solo.w.prompt = () => "Mine idéer";
    pick("__new__");
    check("Ny samling…: samlingen oprettes og vælges", await waitFor(() => sel.value === "/anna/mine-ideer/", 4000), sel.value);
    const made = (await admin.discover()).find((c) => c.href === "/anna/mine-ideer/");
    check("Ny samling…: navn og kun VJOURNAL på serveren", made && made.name === "Mine idéer" && made.onlyJournal, made);
    check("Ny samling…: besked om oprettelsen", await waitFor(() => solo.$("banner-text").textContent.includes("er oprettet"), 3000), solo.$("banner-text").textContent);
    check("Ny samling…: den nye samling er tom og forklarer, hvad man gør",
      await waitFor(() => solo.items().length === 0 && !solo.$("empty").hidden && solo.$("empty").textContent.startsWith("Ingen noter endnu"), 3000));
    check("Ny samling…: vælgeren viser alle tre, nye samling før Noter (alfabetisk)",
      Array.from(sel.options).map((o) => o.textContent).join("|") === "Mine idéer|Noter|Ny samling…", Array.from(sel.options).map((o) => o.textContent));

    solo.click(solo.$("btn-new"));
    solo.type(solo.$("title"), "I den nye samling");
    check("Ny samling…: en note gemmes i den nye samling",
      await waitFor(async () => (await admin.listNotes("/anna/mine-ideer/")).some((n) => n.title === "I den nye samling"), 4000));
    check("Ny samling…: noten ligger ikke i den gamle samling", !(await admin.listNotes("/anna/noter/")).some((n) => n.title === "I den nye samling"));

    pick("/anna/noter/");
    check("skift tilbage: de gamle noter vises, den nye note gør ikke",
      await waitFor(() => solo.items().length > 0 && !solo.titles().includes("I den nye samling"), 4000), solo.titles());

    solo.w.prompt = () => "Mine ideer"; // andet navn, men samme adresse som før
    pick("__new__");
    check("Ny samling…: optaget adresse får løbenummer", await waitFor(() => sel.value === "/anna/mine-ideer-2/", 4000), sel.value);
    solo.w.close();

    // huskes mellem besøg (localStorage hører til den lukkede side, så vi tjekker via en ny side)
    const again = loadApp(AUTH);
    check("de nye samlinger findes ved næste besøg", await waitFor(() => Array.from(again.$("collection").options).map((o) => o.textContent).join("|") === "Mine ideer|Mine idéer|Noter|Ny samling…", 4000),
      Array.from(again.$("collection").options).map((o) => o.textContent));
    again.w.close();

    // ---- engelsk ----
    await admin.putNote("/anna/noter/nodate-1.ics", FOREIGN.replace("UID:foreign-1", "UID:nodate-1"), null);

    const xx = loadApp(AUTH, "?lang=xx");
    check("ukendt ?lang= giver dansk og gemmer ikke noget",
      xx.w.document.documentElement.lang === "da" && xx.$("btn-new").textContent === "Ny note" && xx.w.localStorage.getItem("webnotes.lang") === null,
      [xx.w.document.documentElement.lang, xx.w.localStorage.getItem("webnotes.lang")]);
    xx.w.close();

    const fr = loadApp(AUTH, "?lang=fr");
    const frStatic = [fr.w.document.documentElement.lang, fr.w.document.title, fr.$("btn-new").textContent, fr.$("search").placeholder, fr.$("btn-back").textContent, fr.$("lang").value];
    check("fransk via ?lang=fr: sprog, titel, knapper og sprogvælger",
      frStatic.join("|") === ["fr", "WebNotes", "Nouvelle note", "Rechercher dans les notes", "WebNotes", "fr"].join("|") && fr.w.localStorage.getItem("webnotes.lang") === "fr", frStatic);
    fr.w.close();

    const en = loadApp(AUTH, "?lang=en");
    const enD = en.w.document;
    const enOpts = () => Array.from(en.$("collection").options).map((o) => o.textContent);
    const enGroups = () => Array.from(enD.querySelectorAll("h2.group")).map((h) => h.textContent).join("|");
    const pickEn = (el, v) => { el.value = v; el.dispatchEvent(new en.w.Event("change")); };

    const enStatic = [enD.documentElement.lang, enD.title, enD.querySelector("h1").textContent, en.$("btn-new").textContent, en.$("search").placeholder,
      en.$("search").getAttribute("aria-label"), en.$("title").placeholder, en.$("tags").placeholder, en.$("body").placeholder,
      en.$("btn-delete").textContent, en.$("btn-back").textContent, en.$("banner-close").textContent, en.$("lang").value];
    check("engelsk via ?lang=en: sprog, titel, knapper, felter og sprogvælger",
      enStatic.join("|") === ["en", "WebNotes", "WebNotes", "New note", "Search notes", "Search notes", "Title", "Add tags, separated by commas", "Write here",
        "Delete note", "WebNotes", "Close", "en"].join("|"), enStatic);
    check("engelsk: valget huskes", en.w.localStorage.getItem("webnotes.lang") === "en");
    check("sprogvælgeren har alle sprog fra i18n.js",
      Array.from(en.$("lang").options).map((o) => o.value + ":" + o.textContent).join("|") === "da:Dansk|en:English|de:Deutsch|es:Español|fr:Français",
      Array.from(en.$("lang").options).map((o) => o.value));
    check("engelsk: en tom samling forklarer, hvad man gør", await waitFor(() => en.$("empty").textContent.startsWith("No notes yet"), 4000), en.$("empty").textContent);
    check("engelsk: 'New collection…' står til sidst i vælgeren", await waitFor(() => enOpts().slice(-1)[0] === "New collection…", 3000), enOpts());

    pickEn(en.$("collection"), "/anna/noter/");
    check("engelsk: gruppenavne i listen", await waitFor(() => enGroups() === "Today|No date", 4000), enGroups());
    check("engelsk: åbn en note, og tidspunktet står på engelsk", (await en.open("Udefra")) && en.$("meta").textContent.startsWith("Modified "), en.$("meta").textContent);

    const udefra = (await admin.listNotes(COL)).find((n) => n.title === "Udefra");
    await admin.saveNote(udefra, { body: "Server edit" });
    en.type(en.$("body"), "Browser edit");
    check("engelsk: konfliktkopien får (conflict) i titlen", await waitFor(() => serverByTitle("Udefra (conflict)"), 4000));
    check("engelsk: konfliktbesked",
      await waitFor(() => en.$("banner-text").textContent === 'The note was changed elsewhere. Your version has been saved as a new note with "(conflict)" in the title.', 3000),
      en.$("banner-text").textContent);

    let confirmMsg = "";
    en.w.confirm = (m) => { confirmMsg = m; return true; };
    en.click(en.$("btn-delete"));
    check("engelsk: bekræftelse ved sletning", await waitFor(() => confirmMsg === 'Delete the note "Udefra (conflict)"?', 3000), confirmMsg);
    check("engelsk: besked efter sletning", await waitFor(() => en.$("banner-text").textContent === "Note deleted.", 3000), en.$("banner-text").textContent);

    check("engelsk: åbn en note igen", await en.open("Udefra"));
    pickEn(en.$("lang"), "da");
    check("skift til dansk virker med det samme: sider, tidspunkt, gruppenavne og vælger",
      enD.documentElement.lang === "da" && enD.title === "WebNotes" && en.$("btn-new").textContent === "Ny note" && en.$("meta").textContent.startsWith("Ændret ") &&
      enGroups() === "I dag|Uden dato" && enOpts().slice(-1)[0] === "Ny samling…" && en.w.localStorage.getItem("webnotes.lang") === "da",
      [enD.documentElement.lang, en.$("meta").textContent, enGroups(), enOpts().slice(-1)[0]]);
    check("skiftet bevarer valgt samling og åben note", en.$("collection").value === "/anna/noter/" && en.$("title").value === "Udefra");
    pickEn(en.$("lang"), "en");
    check("og tilbage til engelsk", enD.documentElement.lang === "en" && en.$("btn-new").textContent === "New note" && en.w.localStorage.getItem("webnotes.lang") === "en");
    en.w.close();

    // ---- Markdown i brugerfladen ----
    console.log("\n== app.js (Markdown, værktøjslinje, import og eksport) ==");
    await mkcal("/anna/md/", "Markdown", ["VJOURNAL"]);
    const MD = "/anna/md/";
    const mdapp = loadApp(AUTH, "?col=" + MD);
    const mw = mdapp.w, mdoc = mw.document, M = mdapp.$;
    await waitFor(() => M("collection").value === MD, 4000);
    const fmtBtn = (f) => mdoc.querySelector('[data-fmt="' + f + '"]');
    const caret = (a, b) => { M("body").setSelectionRange(a, b === undefined ? a : b); };
    const press = (f) => fmtBtn(f).click();
    const bodyVal = (v) => { M("body").value = v; };
    const key = (k, extra) => { const ev = new mw.KeyboardEvent("keydown", Object.assign({ key: k, bubbles: true, cancelable: true }, extra)); M("body").dispatchEvent(ev); return ev; };
    const readBlob = (b) => new Promise((res) => { const r = new mw.FileReader(); r.onload = () => res(r.result); r.readAsText(b); });

    check("værktøjslinje: 9 formatknapper, skriv/vis, import og eksport",
      mdoc.querySelectorAll("[data-fmt]").length === 9 && M("mode-edit").getAttribute("aria-pressed") === "true" && M("mode-preview").getAttribute("aria-pressed") === "false" &&
      M("preview").hidden && !M("body").hidden && M("btn-import").textContent === "Importér" && M("btn-export-md").textContent === "Eksportér .md");
    check("siden er bygget rigtigt: værktøjslinje og felter ligger i editoren", ["toolbar", "title", "body", "preview", "btn-back"].every((id) => M(id).closest(".editor")) && !mdoc.querySelector(".app > .sheet"));
    check("Tilbage-knappen står først i værktøjslinjen, og 'Ændret' ligger i noten over titlen",
      M("toolbar").firstElementChild === M("btn-back") && M("meta").closest(".sheet") && M("meta").parentNode.nextElementSibling === M("title") && M("status").parentNode === M("meta").parentNode && !mdoc.querySelector(".editor > .bar"));
    check("'Ændret ...' er skjult i skrivetilstand", M("meta").hidden);
    check("ingen note åben: ingen gemt-status", await waitFor(() => M("status").textContent === "", 4000), M("status").textContent);
    check("menuen er lukket og åbnes med ⋯ (import, eksport og slet ligger i den)",
      M("menu").hidden && M("btn-menu").getAttribute("aria-expanded") === "false" && ["btn-import", "btn-export-md", "btn-export-txt", "btn-delete"].every((id) => M(id).closest("#menu")));
    M("btn-menu").click();
    check("menuen åbner, og første aktive punkt får fokus", !M("menu").hidden && M("btn-menu").getAttribute("aria-expanded") === "true" && mdoc.activeElement === M("btn-import"), mdoc.activeElement.id);
    M("menu").parentNode.dispatchEvent(new mw.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    check("Escape lukker menuen og flytter fokus tilbage", M("menu").hidden && mdoc.activeElement === M("btn-menu"));
    M("btn-menu").click(); mdoc.body.click();
    check("klik udenfor lukker menuen", M("menu").hidden);
    M("btn-menu").click(); M("btn-import").click();
    check("valg af et punkt lukker menuen", M("menu").hidden);
    check("eksport er slået fra, mens noten er tom", M("btn-export-md").disabled && M("btn-export-txt").disabled);

    mdapp.click(M("btn-new"));
    check("ny note får fokus i titelfeltet", await waitFor(() => mdoc.activeElement === M("title"), 3000));
    bodyVal("ord"); caret(0, 3); press("bold");
    check("fed: omslutter markeringen og beholder den", M("body").value === "**ord**" && M("body").selectionStart === 2 && M("body").selectionEnd === 5, [M("body").value, M("body").selectionStart]);
    press("bold");
    check("fed igen: fjerner mærkerne", M("body").value === "ord" && M("body").selectionStart === 0 && M("body").selectionEnd === 3, M("body").value);
    caret(0, 3); press("italic");
    check("kursiv", M("body").value === "*ord*");
    bodyVal(""); caret(0, 0); press("bold");
    check("fed uden markering: sætter mærker og markøren imellem", M("body").value === "****" && M("body").selectionStart === 2, [M("body").value, M("body").selectionStart]);

    bodyVal("tekst"); caret(2); press("heading");
    const h1 = M("body").value; press("heading"); const h2 = M("body").value; press("heading"); const h3 = M("body").value; press("heading");
    check("overskrift: # -> ## -> ### -> ingen", h1 === "# tekst" && h2 === "## tekst" && h3 === "### tekst" && M("body").value === "tekst", [h1, h2, h3, M("body").value]);

    bodyVal("a\nb\nc"); caret(0, 5); press("bullets");
    const l1 = M("body").value; press("bullets"); const l2 = M("body").value;
    check("punktliste: på alle valgte linjer og af igen", l1 === "- a\n- b\n- c" && l2 === "a\nb\nc", [l1, l2]);
    caret(0, 5); press("numbers");
    const l3 = M("body").value; press("todo"); const l4 = M("body").value; press("quote"); const l5 = M("body").value; press("quote");
    check("nummereret -> opgaver (skifter markør) -> citat", l3 === "1. a\n2. b\n3. c" && l4 === "- [ ] a\n- [ ] b\n- [ ] c" && l5 === "> - [ ] a\n> - [ ] b\n> - [ ] c" && M("body").value === l4, [l3, l4, l5]);
    bodyVal("x\n\ny"); caret(0, 4); press("bullets");
    check("tomme linjer i en markering springes over", M("body").value === "- x\n\n- y", M("body").value);

    bodyVal("se ord her"); caret(3, 6); press("link");
    check("link: markeringen bliver teksten, og 'url' er markeret", M("body").value === "se [ord](url) her" && M("body").value.slice(M("body").selectionStart, M("body").selectionEnd) === "url", [M("body").value, M("body").selectionStart]);
    bodyVal("https://a.dk"); caret(0, 12); press("link");
    check("link: en markeret adresse bliver målet", M("body").value === "[tekst](https://a.dk)" && M("body").value.slice(M("body").selectionStart, M("body").selectionEnd) === "tekst", M("body").value);
    bodyVal("a"); caret(0, 1); press("code");
    const c1 = M("body").value; bodyVal("x\ny"); caret(0, 3); press("code");
    check("kode: ` om én linje, kodeblok om flere", c1 === "`a`" && M("body").value === "```\nx\ny\n```\n", [c1, M("body").value]);

    bodyVal("ord"); caret(0, 3); key("b", { ctrlKey: true });
    check("Ctrl+B", M("body").value === "**ord**");
    bodyVal("ord"); caret(0, 3); key("k", { ctrlKey: true });
    check("Ctrl+K", M("body").value === "[ord](url)");

    const enter = (v) => { bodyVal(v); caret(v.length); const ev = key("Enter"); return [M("body").value, ev.defaultPrevented]; };
    check("Enter fortsætter en punktliste", j2(enter("- a")) === j2(["- a\n- ", true]), enter("- a"));
    check("Enter på et tomt punkt afslutter listen", j2(enter("- a\n- ")) === j2(["- a\n", true]), enter("- a\n- "));
    check("Enter tæller nummereringen op", j2(enter("1. x")) === j2(["1. x\n2. ", true]), enter("1. x"));
    check("Enter fortsætter opgaver med et tomt felt", j2(enter("  - [x] t")) === j2(["  - [x] t\n  - [ ] ", true]), enter("  - [x] t"));
    check("Enter i almindelig tekst røres ikke", j2(enter("bare tekst")) === j2(["bare tekst", false]));
    bodyVal("- a b"); caret(3); const midEnter = key("Enter");
    check("Enter midt i et punkt røres ikke", !midEnter.defaultPrevented && M("body").value === "- a b");

    // visning
    {
      mdapp.type(M("title"), "Mdnote");
      mdapp.type(M("body"), "## Overskrift\n\nEn **fed** tekst med [link](https://a.dk) og <b>html</b>\n\n- [ ] et\n- [x] to\n\n[ond](javascript:alert(1))");
    }
    check("noten gemmes som almindelig tekst på serveren", await waitFor(async () => { const n = await serverByTitleIn(MD, "Mdnote"); return n && n.body.startsWith("## Overskrift"); }, 4000));
    check("eksport slås til, når noten har indhold", !M("btn-export-md").disabled && !M("btn-export-txt").disabled);
    M("mode-preview").click();
    const pv = M("preview");
    check("Vis: forhåndsvisning vises, feltet skjules, formatknapper slås fra og valget huskes",
      !pv.hidden && M("body").hidden && M("mode-preview").getAttribute("aria-pressed") === "true" && Array.from(mdoc.querySelectorAll("[data-fmt]")).every((b) => b.disabled) && mw.localStorage.getItem("webnotes.mode") === "preview");
    check("Vis: overskrift, fed og link", !!pv.querySelector("h2") && pv.querySelector("h2").textContent === "Overskrift" && pv.querySelector("strong").textContent === "fed" && pv.querySelector('a[href="https://a.dk"]'), pv.innerHTML);
    check("Vis: HTML og javascript:-link er kun tekst", !pv.querySelector("b, script, img") && pv.textContent.includes("<b>html</b>") && pv.querySelectorAll("a").length === 1 && pv.textContent.includes("[ond](javascript:alert(1))"), pv.innerHTML);
    const boxes = pv.querySelectorAll('input[type="checkbox"]');
    check("Vis: opgaver som afkrydsningsfelter", boxes.length === 2 && !boxes[0].checked && boxes[1].checked);
    boxes[0].click();
    check("afkrydsning i visningen ændrer teksten", M("body").value.includes("- [x] et\n- [x] to"), M("body").value);
    check("... og gemmer den på serveren", await waitFor(async () => { const n = await serverByTitleIn(MD, "Mdnote"); return n && n.body.includes("- [x] et"); }, 4000));
    pv.querySelectorAll('input[type="checkbox"]')[1].click();
    check("... også for at fjerne et kryds", M("body").value.includes("- [x] et\n- [ ] to"), M("body").value);
    check("listen viser uddrag uden Markdown-tegn", (mdoc.querySelector("button.note .note-snippet") || {}).textContent === "Overskrift", (mdoc.querySelector("button.note .note-snippet") || {}).textContent);
    M("mode-edit").click();
    check("Skriv: feltet er tilbage, og formatknapperne virker igen", !M("body").hidden && pv.hidden && Array.from(mdoc.querySelectorAll("[data-fmt]")).every((b) => !b.disabled) && mw.localStorage.getItem("webnotes.mode") === "edit");

    // tilstand ved navigation: klik på en note viser den, Ny note skriver
    mdapp.click(M("btn-new"));
    check("Ny note åbner i skrivetilstand (også når forrige note blev vist)", await waitFor(() => mdoc.activeElement === M("title") && !M("body").hidden && M("preview").hidden && M("mode-edit").getAttribute("aria-pressed") === "true", 3000));
    await mdapp.open("Mdnote");
    check("klik på en note åbner den i visning", await waitFor(() => M("body").hidden && !M("preview").hidden && M("mode-preview").getAttribute("aria-pressed") === "true" && M("preview").textContent.includes("Overskrift"), 3000));
    M("mode-edit").click();
    mdapp.click(M("btn-new"));
    check("Ny note efter manuelt skift til Skriv er stadig Skriv", await waitFor(() => mdoc.activeElement === M("title") && !M("body").hidden, 3000));
    await mdapp.open("Mdnote");
    M("mode-edit").click();
    check("'Ændret ...' vises i visning, og ikke i skrivetilstand", (M("mode-preview").click(), !M("meta").hidden && M("meta").textContent.startsWith("Ændret ")) && (M("mode-edit").click(), M("meta").hidden), M("meta").textContent);
    M("mode-edit").click();
    M("btn-back").click();
    await waitFor(() => mdoc.body.dataset.view === "list");
    mdapp.items().find((b) => b.querySelector(".title-text").textContent === "Mdnote").click();
    check("Tilbage og klik på samme note igen åbner den i visning", await waitFor(() => M("body").hidden && !M("preview").hidden, 3000));
    M("mode-edit").click();
    check("efter åbning kan man skifte til Skriv og redigere", !M("body").hidden && M("body").value.includes("Overskrift"));

    // eksport
    const downloads = [];
    mw.URL.createObjectURL = (b) => { downloads.push({ blob: b }); return "blob:test"; };
    mw.URL.revokeObjectURL = () => {};
    mw.HTMLAnchorElement.prototype.click = function () { downloads[downloads.length - 1].name = this.download; };
    mdapp.type(M("tags"), "a, b");
    M("btn-export-md").click();
    M("btn-export-txt").click();
    const dmd = downloads[0], dtx = downloads[1];
    const tmd = dmd && await readBlob(dmd.blob), ttx = dtx && await readBlob(dtx.blob);
    check("eksport .md: filnavn efter titlen, tags, overskrift og tekst", dmd && dmd.name === "Mdnote.md" && tmd.startsWith("---\ntags: a, b\n---\n\n# Mdnote\n\n## Overskrift") && tmd.endsWith("\n"), [dmd && dmd.name, tmd]);
    check("eksport .txt: kun teksten", dtx && dtx.name === "Mdnote.txt" && ttx === M("body").value.trim() + "\n", [dtx && dtx.name, ttx]);

    // import
    const mkFile = (name, text) => new mw.File([text], name, { type: "text/plain" });
    const chooseFiles = (files) => { Object.defineProperty(M("file-import"), "files", { value: files, configurable: true }); M("file-import").dispatchEvent(new mw.Event("change", { bubbles: true })); };
    chooseFiles([
      mkFile("første.md", "# Importeret\n\nFra **fil**\n"),
      mkFile("anden.txt", "Ren tekst\nlinje 2"),
      mkFile("tredje.md", "---\ntitle: Med tags\ntags: [x, y]\n---\n\ntekst"),
      mkFile("binær.txt", "ab\u0000cd"),
      mkFile("stor.txt", "a".repeat(Md.MAX_IMPORT + 1)),
    ]);
    check("import: tre noter oprettes, to filer springes over (binær og for stor)",
      await waitFor(() => !M("banner").hidden && M("banner-text").textContent.includes("3 noter importeret"), 6000) && M("banner-text").textContent.includes("binær.txt, stor.txt") && M("banner").classList.contains("error"), M("banner-text").textContent);
    const srv = await admin.listNotes(MD);
    const byT = (t) => srv.find((n) => n.title === t);
    check("import: titel, tekst og tags på serveren",
      byT("Importeret") && byT("Importeret").body === "Fra **fil**" && byT("anden") && byT("anden").body === "Ren tekst\nlinje 2" && byT("Med tags") && byT("Med tags").tags.join() === "x,y" && !byT("binær") && !byT("stor"),
      srv.map((n) => n.title));
    check("import: kun importerede noter + den, der fandtes (4 i alt)", srv.length === 4, srv.map((n) => n.title));
    check("import: listen viser de nye noter", await waitFor(() => ["Importeret", "anden", "Med tags"].every((t) => mdapp.titles().includes(t)), 3000), mdapp.titles());
    chooseFiles([mkFile("enkelt.md", "# Alene\n\nx")]);
    check("import af én fil åbner noten", await waitFor(() => M("title").value === "Alene" && M("banner-text").textContent === "1 note importeret.", 4000), [M("title").value, M("banner-text").textContent]);

    // sprog
    const mdLang = (v) => { M("lang").value = v; M("lang").dispatchEvent(new mw.Event("change", { bubbles: true })); };
    mdLang("en");
    check("engelsk: værktøjslinjens tekster og hjælpetekster",
      M("mode-edit").textContent === "Write" && M("mode-preview").textContent === "Preview" && M("btn-import").textContent === "Import" && M("btn-export-md").textContent === "Export .md" &&
      fmtBtn("bold").title === "Bold (Ctrl+B)" && fmtBtn("bold").getAttribute("aria-label") === "Bold (Ctrl+B)" && M("toolbar").getAttribute("aria-label") === "Note tools" && M("btn-import").title.startsWith("Import .md"),
      [M("mode-edit").textContent, fmtBtn("bold").title]);
    M("mode-preview").click();
    bodyVal(""); M("body").dispatchEvent(new mw.Event("input", { bubbles: true }));
    mdLang("da"); mdLang("en");
    check("engelsk: tom visning har sin egen tekst", M("preview").textContent === "Nothing has been written yet." || /^Nothing/.test(M("preview").textContent), M("preview").textContent);
    mdapp.w.close();
    await admin.request("DELETE", MD);

    // ingen samling overhovedet: knappen i beskeden opretter den første
    for (const c of await admin.discover()) await admin.request("DELETE", c.href);
    const none = loadApp(AUTH);
    check("ingen samling: besked med knap til at oprette en",
      await waitFor(() => !none.$("banner").hidden && !none.$("banner-action").hidden && none.$("banner-action").textContent === "Opret samling", 4000), none.$("banner-text").textContent);
    none.w.prompt = () => "Mine noter";
    none.click(none.$("banner-action"));
    check("ingen samling: den første samling oprettes og vælges", await waitFor(() => none.$("collection").value === "/anna/mine-noter/", 4000), none.$("collection").value);
    check("ingen samling: noterne kan vises (tom liste)", await waitFor(() => !none.$("empty").hidden, 3000));
    none.w.close();

    // log ud: det ventende gemmes først, browseren får et forkert login (så den glemmer det rigtige),
    // og noterne fjernes fra siden
    const out = loadApp(AUTH);
    const xhrOpen = [];
    const origOpen = out.w.XMLHttpRequest.prototype.open;
    out.w.XMLHttpRequest.prototype.open = function (m, u, a, user, pass) { xhrOpen.push([m, u, user, !!pass]); return origOpen.apply(this, arguments); };
    check("log ud: menupunktet findes", out.$("btn-logout") && out.$("btn-logout").textContent === "Log ud", out.$("btn-logout") && out.$("btn-logout").textContent);
    await waitFor(() => !out.$("collection").hidden, 4000);
    out.click(out.$("btn-new"));
    out.type(out.$("title"), "Skrevet lige før log ud");
    out.type(out.$("body"), "skal gemmes");
    out.click(out.$("btn-logout"));
    check("log ud: siden står i 'logget ud' med besked og knap",
      await waitFor(() => out.w.document.body.dataset.view === "loggedout" && !out.$("banner").hidden && out.$("banner-text").textContent.startsWith("Du er logget ud") && out.$("banner-action").textContent === "Log ind", 9000),
      [out.w.document.body.dataset.view, out.$("banner-text").textContent]);
    check("log ud: noten, der blev skrevet i, blev gemt først", !!(await serverByTitleIn("/anna/mine-noter/", "Skrevet lige før log ud")));
    check("log ud: browseren fik et forkert login (PROPFIND med brugernavn og adgangskode)",
      xhrOpen.length === 1 && xhrOpen[0][0] === "PROPFIND" && xhrOpen[0][2] === "logout" && xhrOpen[0][3], JSON.stringify(xhrOpen));
    check("log ud: noterne og samlingsvælgeren er fjernet", out.items().length === 0 && out.$("collection").hidden && out.$("title").value === "", out.items().length);
    out.w.close();

    // login mislykkes
    const bad = loadApp("Basic " + Buffer.from("anna:forkert").toString("base64"));
    check("forkert login: besked og knap til at prøve igen",
      await waitFor(() => !bad.$("banner").hidden && bad.$("banner-text").textContent.includes("ikke logget ind") && !bad.$("banner-action").hidden, 4000),
      bad.$("banner-text").textContent);
    bad.w.close();
  } finally {
    server.kill();
    await sleep(100);
    if (failed && serverLog.trim()) console.log("\n-- Radicale-log --\n" + serverLog.slice(-2000));
  }
}

main().then(() => {
  console.log("\n" + (failed ? failed + " TEST(S) FEJLEDE" : "ALLE TESTS BESTÅET"));
  process.exit(failed ? 1 : 0);
}).catch((e) => {
  console.error("\nTESTEN STOPPEDE: " + (e && e.stack || e));
  process.exit(2);
});
