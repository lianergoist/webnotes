#!/usr/bin/env node
/* Sætter ?v=<kort hash> på style.css og scripts i index.html, så browseren henter en fil igen,
 * så snart indholdet er ændret (og ellers bruger sin kopi).
 *
 *   node stamp.js          opdaterer index.html
 *   node stamp.js --check  ændrer intet; afslutter med fejl, hvis versionerne er forældede
 *
 * Kør den efter hver ændring af en .js- eller .css-fil, og før filerne kopieres til serveren. */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const HTML = path.join(ROOT, "index.html");
const REF = /\b(href|src)="([A-Za-z0-9_.-]+\.(?:css|js))(?:\?v=[0-9a-f]+)?"/g;

function version(file) {
  return crypto.createHash("sha1").update(fs.readFileSync(path.join(ROOT, file))).digest("hex").slice(0, 8);
}

function stamped(html) {
  return html.replace(REF, (_, attr, file) => attr + '="' + file + "?v=" + version(file) + '"');
}

if (require.main === module) {
  const html = fs.readFileSync(HTML, "utf8");
  const next = stamped(html);
  if (process.argv.includes("--check")) {
    if (next !== html) { console.error("index.html har forældede versioner. Kør: node stamp.js"); process.exit(1); }
    console.log("versionerne i index.html er ajour");
  } else {
    if (next !== html) fs.writeFileSync(HTML, next);
    console.log((next !== html ? "opdateret: " : "uændret: ") + (next.match(REF) || []).join(" "));
  }
}
module.exports = { stamped, version };
