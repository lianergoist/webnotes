/* app.js - WebNotes (webklient mod Radicale/VJOURNAL).
 *
 * Alle netværkskald går gennem én kø (enqueue), så en opdatering aldrig kan overskrive
 * en note midt i et gem. Noters tekst sættes kun via textContent/value, aldrig som HTML. */
(function () {
  "use strict";

  const CFG = Object.assign({ saveDelay: 1200, retryMs: 8000, pollMs: 30000 }, window.NOTEWEB_CONFIG || {});
  const Ical = window.Ical;
  const Dav = window.Dav;
  const I18n = window.I18n;
  const Md = window.Md;
  const tr = I18n.t; // tekster: tr("nøgle", {pladsholder: værdi})
  // Samme origin; browseren håndterer Basic-login. Radicale ligger på "/" eller "/dav/" alt efter domænet.
  const dav = new Dav.DavClient({ roots: CFG.davRoots || ["/", "/dav/"] });
  const STORE_KEY = "webnotes.collection";
  const LANG_KEY = "webnotes.lang";
  const MODE_KEY = "webnotes.mode"; // "edit" eller "preview"
  const NEW_COLLECTION = "__new__"; // værdien på valget "Ny samling…" i vælgeren

  const $ = (id) => document.getElementById(id);
  const els = {
    list: $("list"), empty: $("empty"), search: $("search"), collection: $("collection"),
    status: $("status"), banner: $("banner"), bannerText: $("banner-text"),
    bannerAction: $("banner-action"), bannerClose: $("banner-close"),
    title: $("title"), tags: $("tags"), body: $("body"), meta: $("meta"),
    btnNew: $("btn-new"), btnDelete: $("btn-delete"), btnBack: $("btn-back"), lang: $("lang"),
    preview: $("preview"), modeEdit: $("mode-edit"), modePreview: $("mode-preview"), toolbar: $("toolbar"),
    btnMenu: $("btn-menu"), menu: $("menu"), btnImport: $("btn-import"), fileImport: $("file-import"),
    btnExportMd: $("btn-export-md"), btnExportTxt: $("btn-export-txt"), btnLogout: $("btn-logout"),
  };

  const blank = () => ({ title: "", body: "", tags: [] });
  const state = {
    collection: null,
    cols: [],              // kendte samlinger [{href, name, ...}]
    notes: new Map(),      // uid -> note
    selected: null,        // uid for noten i editoren, null = ny, endnu ikke gemt note
    baseline: blank(),     // det, editoren sidst var i overensstemmelse med serveren om
    shownEtag: null,
    ctag: null,
    query: "",
    saveTimer: null,
    bannerTimer: null,
    mode: "edit",          // "edit" = skriv, "preview" = vis som Markdown
  };

  // ---- hjælpere -----------------------------------------------------------

  let tail = Promise.resolve();
  function enqueue(fn) {
    const run = tail.then(fn);
    tail = run.catch(() => {});
    return run;
  }

  function storeGet(key) { try { return localStorage.getItem(key || STORE_KEY); } catch (e) { return null; } }
  function storeSet(v, key) { try { localStorage.setItem(key || STORE_KEY, v); } catch (e) { /* privat vindue */ } }

  function withSlash(p) { return p.endsWith("/") ? p : p + "/"; }

  function parseTags(s) {
    const out = [];
    s.split(",").forEach((t) => { t = t.trim(); if (t && !out.includes(t)) out.push(t); });
    return out;
  }
  function sameForm(a, b) {
    return a.title === b.title && a.body === b.body &&
      a.tags.length === b.tags.length && a.tags.every((t, i) => t === b.tags[i]);
  }
  function readForm() { return { title: els.title.value, body: els.body.value, tags: parseTags(els.tags.value) }; }
  function writeForm(f) {
    els.title.value = f.title;
    els.body.value = f.body;
    els.tags.value = f.tags.join(", ");
    updatePreview();
    updateExportButtons();
  }
  function isDirty() { return !sameForm(readForm(), state.baseline); }

  function parseStamp(s) {
    const m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)(Z?)$/.exec(s || "");
    if (!m) return null;
    const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number);
    return m[7] ? new Date(Date.UTC(y, mo - 1, d, h, mi, se)) : new Date(y, mo - 1, d, h, mi, se);
  }
  function dayDiff(t, now) {
    const day = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return Math.round((day(now) - day(t)) / 86400000);
  }
  function groupLabel(t, now) {
    const diff = dayDiff(t, now);
    if (diff <= 0) return tr("today");
    if (diff === 1) return tr("yesterday");
    if (diff < 7) return tr("last7");
    return t.toLocaleDateString(I18n.locale(), { month: "long", year: "numeric" });
  }
  function shortTime(t, now) {
    const diff = dayDiff(t, now);
    if (diff <= 0) return t.toLocaleTimeString(I18n.locale(), { hour: "2-digit", minute: "2-digit" });
    if (diff < 7) return t.toLocaleDateString(I18n.locale(), { weekday: "short" });
    return t.toLocaleDateString(I18n.locale(), { day: "numeric", month: "short" });
  }
  function fullTime(t) {
    return t ? t.toLocaleString(I18n.locale(), { dateStyle: "medium", timeStyle: "short" }) : "";
  }

  // ---- statuslinje og meddelelser -----------------------------------------

  function setStatus(text) { els.status.textContent = text; }

  // Gemt-status for noten i editoren: "Gemt", så længe den er i overensstemmelse med serveren, ellers "Ikke gemt".
  function syncStatus() {
    setStatus(isDirty() ? tr("statusNotSaved") : state.selected !== null ? tr("statusSaved") : "");
  }

  function hideBanner() {
    clearTimeout(state.bannerTimer);
    els.banner.hidden = true;
  }
  function showBanner(text, opts) {
    opts = opts || {};
    clearTimeout(state.bannerTimer);
    els.bannerText.textContent = text;
    els.banner.classList.toggle("error", !!opts.error);
    els.banner.setAttribute("role", opts.error ? "alert" : "status");
    if (opts.action) {
      els.bannerAction.textContent = opts.action.label;
      els.bannerAction.onclick = opts.action.run;
      els.bannerAction.hidden = false;
    } else {
      els.bannerAction.hidden = true;
      els.bannerAction.onclick = null;
    }
    els.banner.hidden = false;
    if (!opts.error && !opts.sticky) state.bannerTimer = setTimeout(hideBanner, 9000);
  }

  function handleError(e) {
    console.error(e);
    if (e instanceof Dav.AuthError) {
      showBanner(tr("loginRequired"), {
        error: true, action: { label: tr("login"), run: () => { hideBanner(); start(); } },
      });
    } else if (e instanceof Dav.NetworkError) {
      setStatus(tr("statusNotSaved"));
      showBanner(tr("networkDown"), { error: true });
      if (isDirty()) scheduleSave(CFG.retryMs);
    } else {
      // Kendte fejl har en kode og oversættes; resten (fx "HTTP 403: PUT ...") vises som den er.
      showBanner(tr("somethingWrong", { detail: e.code ? tr("err." + e.code) : e.message }), { error: true });
    }
  }

  // ---- liste --------------------------------------------------------------

  function visibleNotes() {
    const q = state.query.trim().toLowerCase();
    const all = Array.from(state.notes.values());
    const hit = q ? all.filter((n) => (n.title + "\n" + n.body + "\n" + n.tags.join(" ")).toLowerCase().includes(q)) : all;
    return hit
      .map((n) => ({ n, t: parseStamp(n.modified) }))
      .sort((a, b) => (b.t ? b.t.getTime() : 0) - (a.t ? a.t.getTime() : 0) || a.n.title.localeCompare(b.n.title));
  }

  function renderItem(n, t, now) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "note";
    btn.dataset.uid = n.uid;
    if (n.uid === state.selected) btn.setAttribute("aria-current", "true");

    const title = document.createElement("span");
    title.className = "note-title" + (n.title ? "" : " untitled");
    const text = document.createElement("span");
    text.className = "title-text";
    text.textContent = n.title || tr("untitled");
    title.append(text);
    btn.append(title);

    if (t) {
      const time = document.createElement("span");
      time.className = "note-time";
      time.textContent = shortTime(t, now);
      btn.append(time);
    }
    const first = n.body.split("\n").map((l) => Md.plain(l)).find(Boolean);
    if (first) {
      const snip = document.createElement("span");
      snip.className = "note-snippet";
      snip.textContent = first.slice(0, 140);
      btn.append(snip);
    }
    if (n.tags.length) {
      const tg = document.createElement("span");
      tg.className = "note-tags";
      tg.textContent = n.tags.join(", ");
      btn.append(tg);
    }
    li.append(btn);
    return li;
  }

  function render() {
    const items = visibleNotes();
    const now = new Date();
    els.list.textContent = "";
    let last = null, ul = null;
    for (const { n, t } of items) {
      const label = t ? groupLabel(t, now) : tr("noDate");
      if (label !== last) {
        const h = document.createElement("h2");
        h.className = "group";
        h.textContent = label;
        ul = document.createElement("ul");
        els.list.append(h, ul);
        last = label;
      }
      ul.append(renderItem(n, t, now));
    }
    els.empty.hidden = items.length > 0 || !state.collection;
    els.empty.textContent = state.notes.size === 0 ? tr("emptyNone") : tr("emptyNoMatch");
  }

  // ---- editor -------------------------------------------------------------

  function updateMeta(n) { els.meta.textContent = n ? tr("modified", { time: fullTime(parseStamp(n.modified)) }) : ""; }

  function openNote(uid, switchView) {
    const n = state.notes.get(uid);
    state.selected = uid;
    state.baseline = { title: n.title, body: n.body, tags: n.tags.slice() };
    state.shownEtag = n.etag;
    writeForm(state.baseline);
    updateMeta(n);
    syncStatus();
    els.btnDelete.disabled = false;
    if (switchView !== false) document.body.dataset.view = "editor";
    render();
  }

  function startNew() {
    state.selected = null;
    state.baseline = blank();
    state.shownEtag = null;
    writeForm(state.baseline);
    updateMeta(null);
    syncStatus();
    els.btnDelete.disabled = true;
    document.body.dataset.view = "editor";
    render();
    els.title.focus();
  }

  function closeEditor() {
    state.selected = null;
    state.baseline = blank();
    state.shownEtag = null;
    writeForm(state.baseline);
    updateMeta(null);
    syncStatus();
    els.btnDelete.disabled = true;
    document.body.dataset.view = "list";
    render();
  }

  // Gem det, der er ventende, før vi skifter note. Returnerer false, hvis det ikke lykkedes.
  async function leaveCurrent() {
    clearTimeout(state.saveTimer);
    try { await enqueue(saveTask); } catch (e) { handleError(e); }
    if (isDirty()) {
      showBanner(tr("notSavedYet"), { error: true });
      return false;
    }
    return true;
  }

  // ---- gem ----------------------------------------------------------------

  function scheduleSave(delay) {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => { enqueue(saveTask).catch(handleError); },
      delay === undefined ? CFG.saveDelay : delay);
  }

  async function saveTask() {
    let saved = false;
    for (let i = 0; i < 10 && isDirty(); i++) {
      setStatus(tr("statusNotSaved"));
      await doSave();
      saved = true;
    }
    if (saved) syncStatus();
  }

  async function doSave() {
    const form = readForm();
    if (state.selected === null) {
      const note = await dav.createNote(state.collection, form);
      state.notes.set(note.uid, note);
      state.selected = note.uid;
      state.baseline = form;
      state.shownEtag = note.etag;
      els.btnDelete.disabled = false;
      updateMeta(note);
      render();
      return;
    }
    const note = state.notes.get(state.selected);
    const r = await dav.saveNote(note, form);
    if (r.status === 412) return resolveConflict(note, form);
    state.notes.set(note.uid, r.note);
    state.baseline = form;
    state.shownEtag = r.note.etag;
    updateMeta(r.note);
    render();
  }

  // Noten er ændret (eller slettet) et andet sted, mens den var åben her.
  async function resolveConflict(note, form) {
    const server = await dav.getNote(note.href);

    if (!server) { // slettet et andet sted: opret den igen med vores tekst
      const raw = Ical.updateIcs(note.raw, form);
      const r = await dav.putNote(note.href, raw, null);
      if (r.status === 412) throw new Dav.DavError(412, "noten kunne ikke oprettes igen", "recreate_failed");
      const again = Dav.toNote(note.href, r.etag, raw);
      state.notes.set(again.uid, again);
      state.baseline = form;
      state.shownEtag = again.etag;
      updateMeta(again);
      render();
      showBanner(tr("recreated"));
      return;
    }

    const serverNote = Dav.toNote(note.href, server.etag, server.raw);
    const serverForm = { title: serverNote.title, body: serverNote.body, tags: serverNote.tags };
    if (sameForm(form, serverForm)) { // samme indhold: ingen konflikt
      state.notes.set(serverNote.uid, serverNote);
      state.baseline = form;
      state.shownEtag = serverNote.etag;
      updateMeta(serverNote);
      render();
      return;
    }

    // Behold begge: serverens version i originalen, vores tekst som ny note.
    const copy = await dav.createNote(state.collection, {
      title: (form.title + " " + tr("conflictMark")).trim(), body: form.body, tags: form.tags,
    });
    state.notes.set(serverNote.uid, serverNote);
    state.notes.set(copy.uid, copy);
    state.selected = copy.uid;
    // Editoren viser nu kopien, så den skal også vise kopiens titel (med "(konflikt)"),
    // ellers ville næste gem fjerne mærket igen.
    state.baseline = { title: copy.title, body: form.body, tags: form.tags };
    if (els.title.value === form.title) els.title.value = copy.title;
    state.shownEtag = copy.etag;
    els.btnDelete.disabled = false;
    updateMeta(copy);
    render();
    showBanner(tr("conflictBanner", { mark: tr("conflictMark") }), { sticky: true });
  }

  // ---- slet ---------------------------------------------------------------

  async function removeCurrent() {
    if (state.selected === null) return;
    const n = state.notes.get(state.selected);
    if (!window.confirm(tr("deleteConfirm", { title: n.title || tr("untitled").toLowerCase() }))) return;
    clearTimeout(state.saveTimer);
    await enqueue(async () => {
      const result = await dav.deleteNote(n.href, n.etag);
      if (result === "conflict") {
        showBanner(tr("deleteConflict"), { error: true });
        await refreshTask(true);
        return;
      }
      state.notes.delete(n.uid);
      closeEditor();
      showBanner(tr("deleted"));
    }).catch(handleError);
  }

  // ---- opdatering fra serveren --------------------------------------------

  async function refreshTask(force) {
    const ctag = await dav.getCtag(state.collection);
    if (!force && ctag && ctag === state.ctag) return;
    const list = await dav.listNotes(state.collection);
    state.ctag = ctag;
    merge(list);
    render();
  }

  function merge(list) {
    const incoming = new Map(list.map((n) => [n.uid, n]));
    const cur = state.selected;
    const editing = cur !== null && isDirty(); // rør ikke ved noten, mens der skrives i den
    for (const [uid, n] of incoming) {
      if (!(editing && uid === cur)) state.notes.set(uid, n);
    }
    for (const uid of Array.from(state.notes.keys())) {
      if (incoming.has(uid) || (editing && uid === cur)) continue;
      state.notes.delete(uid);
    }
    if (cur !== null && !editing) {
      if (!state.notes.has(cur)) {
        closeEditor();
        showBanner(tr("deletedElsewhere"));
      } else if (state.notes.get(cur).etag !== state.shownEtag) {
        openNote(cur, false);
      }
    }
  }

  function softError(e) {
    if (e instanceof Dav.NetworkError) setStatus(tr("statusOffline"));
    else handleError(e);
  }

  function pollNow() {
    if (document.hidden || !state.collection) return;
    enqueue(() => refreshTask(false))
      .then(() => { if (els.status.textContent === tr("statusOffline")) syncStatus(); })
      .catch(softError);
  }

  // ---- log ud -------------------------------------------------------------

  // Gem det ventende, få browseren til at glemme login (se dav.logout), og fjern noterne fra skærmen.
  // Kan noten ikke gemmes, logges der ikke ud (leaveCurrent viser hvorfor).
  async function logout() {
    if (!(await leaveCurrent())) return;
    clearTimeout(state.saveTimer);
    await enqueue(() => dav.logout());
    state.collection = null; // stopper også opdateringen hvert 30. sek. (pollNow)
    state.cols = [];
    state.ctag = null;
    state.notes.clear();
    closeEditor();
    els.collection.textContent = "";
    els.collection.hidden = true;
    document.body.dataset.view = "loggedout"; // kun beskeden vises (style.css)
    showBanner(tr("loggedOut"), { sticky: true, action: { label: tr("login"), run: () => location.reload() } });
  }

  // ---- start --------------------------------------------------------------

  // Samlinger kun til noter først, så navn.
  function sortCols(cols) {
    return cols.slice().sort((a, b) => Number(b.onlyJournal) - Number(a.onlyJournal) || a.name.localeCompare(b.name));
  }

  function fillCollections(cols) {
    els.collection.textContent = "";
    for (const c of cols) {
      const o = document.createElement("option");
      o.value = c.href;
      o.textContent = c.name;
      els.collection.append(o);
    }
    const add = document.createElement("option");
    add.value = NEW_COLLECTION;
    add.textContent = tr("newCollectionOption");
    els.collection.append(add);
    // Vises også ved kun én samling: man ser, hvilken samling man bruger,
    // og at der kan være flere.
    els.collection.hidden = false;
    els.collection.value = state.collection || (cols[0] && cols[0].href) || "";
  }

  async function switchCollection(href) {
    state.collection = href;
    storeSet(href);
    els.collection.value = href;
    state.notes.clear();
    state.ctag = null;
    closeEditor();
    await enqueue(() => refreshTask(true));
  }

  async function createCollection() {
    const input = window.prompt(tr("newCollectionPrompt"));
    const name = input ? input.trim().slice(0, 60) : "";
    if (!name) return;
    if (state.cols.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      showBanner(tr("collectionExists", { name }), { error: true });
      return;
    }
    if (!(await leaveCurrent())) return;
    try {
      const col = await enqueue(() => dav.createCollection(name));
      state.cols = sortCols(state.cols.concat(col));
      fillCollections(state.cols);
      await switchCollection(col.href);
      showBanner(tr("collectionCreated", { name }));
    } catch (e) {
      handleError(e);
    }
  }

  async function start() {
    try {
      setStatus(tr("statusLoading"));
      let cols;
      const override = new URLSearchParams(location.search).get("col");
      if (override) {
        cols = [{ href: withSlash(override), name: tr("appTitle"), journal: true, onlyJournal: true }];
      } else {
        cols = sortCols((await dav.discover()).filter((c) => c.journal));
      }
      state.cols = cols;
      if (!cols.length) {
        setStatus("");
        showBanner(tr("noCollection"), {
          error: true, action: { label: tr("createCollectionBtn"), run: () => { hideBanner(); createCollection(); } },
        });
        return;
      }
      const stored = storeGet();
      state.collection = (cols.find((c) => c.href === stored) || cols[0]).href;
      fillCollections(cols);
      await enqueue(() => refreshTask(true));
      if (els.banner.classList.contains("error")) hideBanner();
      setStatus("");
    } catch (e) {
      setStatus("");
      handleError(e);
    }
  }

  // ---- Markdown: visning, værktøjslinje, import og eksport ----------------

  function updatePreview() {
    if (state.mode !== "preview") return;
    const top = els.preview.scrollTop;
    els.preview.textContent = "";
    if (els.body.value.trim() === "") {
      const p = document.createElement("p");
      p.className = "preview-empty";
      p.textContent = tr("previewEmpty");
      els.preview.append(p);
    } else {
      els.preview.append(Md.render(els.body.value, document));
    }
    els.preview.scrollTop = top;
  }

  function setMode(mode, focus) {
    state.mode = mode === "preview" ? "preview" : "edit";
    const preview = state.mode === "preview";
    els.body.hidden = preview;
    els.preview.hidden = !preview;
    els.modeEdit.setAttribute("aria-pressed", String(!preview));
    els.modePreview.setAttribute("aria-pressed", String(preview));
    els.meta.hidden = !preview; // "Ændret ..." vises kun i visning
    els.toolbar.querySelectorAll("[data-fmt]").forEach((b) => { b.disabled = preview; });
    updatePreview();
    if (focus) { storeSet(state.mode, MODE_KEY); (preview ? els.preview : els.body).focus(); }
  }

  // Skriver i tekstfeltet på en måde, der bevarer fortryd (Ctrl+Z), hvor browseren kan det.
  function replaceRange(start, end, text, selStart, selEnd) {
    const ta = els.body;
    ta.focus();
    ta.setSelectionRange(start, end);
    let done = false;
    try { done = typeof document.execCommand === "function" && document.execCommand("insertText", false, text); } catch (e) { done = false; }
    if (!done || ta.value.slice(start, start + text.length) !== text) {
      ta.setRangeText(text, start, end, "end");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
    ta.setSelectionRange(selStart, selEnd);
  }

  function wrapSelection(mark) {
    const ta = els.body, v = ta.value, s = ta.selectionStart, e = ta.selectionEnd, n = mark.length;
    if (s >= n && v.slice(s - n, s) === mark && v.slice(e, e + n) === mark) { // allerede markeret: fjern
      replaceRange(s - n, e + n, v.slice(s, e), s - n, e - n);
    } else {
      replaceRange(s, e, mark + v.slice(s, e) + mark, s + n, e + n);
    }
  }

  const LIST_PREFIX = /^(\s*)(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)/;

  // Ændrer hele linjerne, som markeringen berører.
  function editLines(transform) {
    const ta = els.body, v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    const from = v.lastIndexOf("\n", s - 1) + 1;
    const eff = e > s && v[e - 1] === "\n" ? e - 1 : e;
    let to = v.indexOf("\n", eff);
    if (to === -1) to = v.length;
    const old = v.slice(from, to);
    const next = transform(old.split("\n")).join("\n");
    if (s === e) {
      const caret = Math.max(from, Math.min(from + next.length, s + next.length - old.length));
      replaceRange(from, to, next, caret, caret);
    } else {
      replaceRange(from, to, next, from, from + next.length);
    }
  }

  function toggleList(kind) {
    editLines((lines) => {
      const re = kind === "todo" ? /^\s*[-*+]\s+\[[ xX]\]\s+/ : kind === "numbers" ? /^\s*\d{1,9}[.)]\s+/ : /^\s*[-*+]\s+(?!\[[ xX]\]\s)/;
      const target = lines.filter((l) => l.trim() !== "");
      const all = target.length > 0 && target.every((l) => re.test(l));
      let k = 0;
      return lines.map((l) => {
        if (l.trim() === "" && lines.length > 1) return l;
        const bare = l.replace(LIST_PREFIX, "$1");
        if (all) return bare;
        const indent = /^\s*/.exec(bare)[0], rest = bare.slice(indent.length);
        k++;
        return indent + (kind === "todo" ? "- [ ] " : kind === "numbers" ? k + ". " : "- ") + rest;
      });
    });
  }

  // Ind- og tilbagerykning: 4 mellemrum pr. niveau, som i DavNotes. Tomme linjer i en
  // markering røres ikke; tilbagerykning fjerner op til 4 mellemrum (eller en tab).
  function shiftLines(dir) {
    editLines((lines) => lines.map((l) => {
      if (l.trim() === "" && lines.length > 1) return l;
      return dir > 0 ? "    " + l : l.replace(/^(?: {1,4}|\t)/, "");
    }));
  }

  function toggleQuote() {
    editLines((lines) => {
      const all = lines.every((l) => /^>\s?/.test(l));
      return lines.map((l) => (all ? l.replace(/^>\s?/, "") : "> " + l));
    });
  }

  function cycleHeading() {
    editLines((lines) => lines.map((l) => {
      const m = /^(#{1,6})\s+(.*)$/.exec(l);
      if (!m) return "# " + l;
      return m[1].length >= 3 ? m[2] : m[1] + "# " + m[2];
    }));
  }

  function insertCode() {
    const ta = els.body, v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    if (v.slice(s, e).includes("\n")) {
      const sel = v.slice(s, e).replace(/\n$/, "");
      replaceRange(s, e, "```\n" + sel + "\n```\n", s + 4, s + 4 + sel.length);
    } else {
      wrapSelection("`");
    }
  }

  function insertLink() {
    const ta = els.body, v = ta.value, s = ta.selectionStart, e = ta.selectionEnd, sel = v.slice(s, e);
    if (/^https?:\/\/\S+$/i.test(sel)) { // markeret adresse: spørg efter teksten
      replaceRange(s, e, "[" + tr("linkText") + "](" + sel + ")", s + 1, s + 1 + tr("linkText").length);
    } else if (sel) {
      replaceRange(s, e, "[" + sel + "](url)", s + sel.length + 3, s + sel.length + 6);
    } else {
      replaceRange(s, e, "[" + tr("linkText") + "](url)", s + 1, s + 1 + tr("linkText").length);
    }
  }

  const FORMATS = {
    bold: () => wrapSelection("**"),
    italic: () => wrapSelection("*"),
    heading: cycleHeading,
    link: insertLink,
    bullets: () => toggleList("bullets"),
    numbers: () => toggleList("numbers"),
    todo: () => toggleList("todo"),
    outdent: () => shiftLines(-1),
    indent: () => shiftLines(1),
    quote: toggleQuote,
    code: insertCode,
  };

  // Enter i en liste fortsætter listen; Enter på et tomt punkt afslutter den.
  function continueList(ev) {
    const ta = els.body, v = ta.value, pos = ta.selectionStart;
    if (ta.selectionEnd !== pos) return false;
    const from = v.lastIndexOf("\n", pos - 1) + 1;
    let to = v.indexOf("\n", pos);
    if (to === -1) to = v.length;
    if (to !== pos) return false; // kun når markøren står sidst på linjen
    const m = /^(\s*)([-*+]|(\d{1,9})([.)]))\s+(\[[ xX]\]\s+)?(.*)$/.exec(v.slice(from, to));
    if (!m) return false;
    ev.preventDefault();
    if (m[6].trim() === "") { replaceRange(from, to, "", from, from); return true; }
    const marker = m[3] !== undefined ? (Number(m[3]) + 1) + m[4] : m[2];
    const add = "\n" + m[1] + marker + " " + (m[5] ? "[ ] " : "");
    replaceRange(pos, pos, add, pos + add.length, pos + add.length);
    return true;
  }

  function updateExportButtons() {
    const f = readForm();
    const empty = f.title.trim() === "" && f.body.trim() === "";
    els.btnExportMd.disabled = empty;
    els.btnExportTxt.disabled = empty;
  }

  function download(file) {
    const url = URL.createObjectURL(new Blob([file.text], { type: file.mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = file.filename;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function exportCurrent(kind) {
    download(Md.exportFile(readForm(), kind, tr("untitled")));
  }

  function readText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsText(file, "utf-8");
    });
  }

  async function importFiles(files) {
    if (!files.length || !state.collection) return;
    if (!(await leaveCurrent())) return;
    const made = [], skipped = [];
    for (const f of files) {
      try {
        if (f.size > Md.MAX_IMPORT) { skipped.push(f.name); continue; }
        const text = await readText(f);
        if (text.includes("\u0000")) { skipped.push(f.name); continue; }
        const note = Md.importFile(f.name, text);
        const created = await enqueue(() => dav.createNote(state.collection, note));
        state.notes.set(created.uid, created);
        made.push(created);
      } catch (e) {
        handleError(e);
        break;
      }
    }
    if (made.length) openNote(made[made.length - 1].uid, made.length === 1);
    else render();
    const parts = [];
    if (made.length) parts.push(made.length === 1 ? tr("importedOne") : tr("imported", { count: made.length }));
    if (skipped.length) parts.push(tr("importSkipped", { name: skipped.join(", ") }));
    if (parts.length) showBanner(parts.join(" "), { error: skipped.length > 0 });
  }

  // ---- hændelser ----------------------------------------------------------

  function onEdit() {
    updateExportButtons();
    syncStatus();
    if (isDirty()) scheduleSave();
  }
  els.title.addEventListener("input", onEdit);
  els.tags.addEventListener("input", onEdit);
  els.body.addEventListener("input", onEdit);

  els.modeEdit.addEventListener("click", () => setMode("edit", true));
  els.modePreview.addEventListener("click", () => setMode("preview", true));
  els.toolbar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-fmt]");
    if (b && !b.disabled && FORMATS[b.dataset.fmt]) FORMATS[b.dataset.fmt]();
  });
  els.body.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      const f = { b: "bold", i: "italic", k: "link" }[e.key.toLowerCase()];
      if (f) { e.preventDefault(); FORMATS[f](); }
    } else if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      continueList(e);
    }
  });
  // Opgaver kan krydses af direkte i visningen.
  els.preview.addEventListener("click", (e) => {
    const box = e.target.closest('input[type="checkbox"][data-line]');
    if (!box) return;
    const lines = els.body.value.split("\n");
    const i = Number(box.dataset.line);
    const re = /^((?:\s*>)*\s*(?:[-*+]|\d{1,9}[.)])\s+\[)[ xX](\])/;
    if (!(i in lines) || !re.test(lines[i])) { updatePreview(); return; }
    lines[i] = lines[i].replace(re, "$1" + (box.checked ? "x" : " ") + "$2");
    els.body.value = lines.join("\n");
    onEdit();
    updatePreview();
  });

  // Menuen: ⋯ åbner og lukker; klik udenfor, Escape og valg af et punkt lukker den.
  function setMenu(open, focus) {
    els.menu.hidden = !open;
    els.btnMenu.setAttribute("aria-expanded", String(open));
    if (open && focus) {
      const first = Array.from(els.menu.querySelectorAll(".menu-item")).find((b) => !b.disabled);
      if (first) first.focus();
    } else if (!open && focus) {
      els.btnMenu.focus();
    }
  }
  els.btnMenu.addEventListener("click", () => setMenu(els.menu.hidden, true));
  els.menu.addEventListener("click", (e) => { if (e.target.closest(".menu-item")) setMenu(false, false); });
  document.addEventListener("click", (e) => {
    if (!els.menu.hidden && !e.target.closest(".menu-wrap")) setMenu(false, false);
  });
  els.menu.parentNode.addEventListener("keydown", (e) => {
    if (els.menu.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); setMenu(false, true); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(els.menu.querySelectorAll(".menu-item")).filter((b) => !b.disabled);
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement);
    const next = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next].focus();
  });

  els.btnImport.addEventListener("click", () => els.fileImport.click());
  els.fileImport.addEventListener("change", () => {
    const files = Array.from(els.fileImport.files || []);
    els.fileImport.value = "";
    importFiles(files).catch(handleError);
  });
  els.btnExportMd.addEventListener("click", () => exportCurrent("md"));
  els.btnExportTxt.addEventListener("click", () => exportCurrent("txt"));
  els.btnLogout.addEventListener("click", () => { logout().catch(handleError); });

  els.search.addEventListener("input", () => { state.query = els.search.value; render(); });

  els.list.addEventListener("click", async (e) => {
    const btn = e.target.closest("button.note");
    if (!btn) return;
    const uid = btn.dataset.uid;
    if (uid === state.selected) { // samme note igen (fx efter Tilbage på mobil): vis den
      if (document.body.dataset.view === "list") setMode("preview", false);
      document.body.dataset.view = "editor";
      return;
    }
    if (await leaveCurrent()) { openNote(uid); setMode("preview", false); } // en note man bare vil se, åbnes som visning
  });

  els.btnNew.addEventListener("click", async () => { if (await leaveCurrent()) { setMode("edit", false); startNew(); } }); // ny note: straks i skrivetilstand
  els.btnBack.addEventListener("click", async () => {
    if (await leaveCurrent()) document.body.dataset.view = "list";
  });
  els.btnDelete.addEventListener("click", removeCurrent);
  els.bannerClose.addEventListener("click", hideBanner);

  els.collection.addEventListener("change", async () => {
    const wanted = els.collection.value;
    els.collection.value = state.collection; // vis den nuværende, mens vi spørger og gemmer
    if (wanted === NEW_COLLECTION) return createCollection();
    if (wanted === state.collection) return;
    if (!(await leaveCurrent())) return;
    switchCollection(wanted).catch(handleError);
  });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      clearTimeout(state.saveTimer);
      enqueue(saveTask).catch(handleError);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { clearTimeout(state.saveTimer); enqueue(saveTask).catch(() => {}); }
    else pollNow();
  });

  window.addEventListener("beforeunload", (e) => {
    if (isDirty()) { e.preventDefault(); e.returnValue = ""; }
  });

  // ---- sprog --------------------------------------------------------------

  // Skift af sprog gælder med det samme: faste tekster, liste, tidspunkter og "Ny samling…".
  function relocalize() {
    I18n.apply(document);
    if (state.cols.length) fillCollections(state.cols);
    syncStatus();
    render();
    updateMeta(state.selected !== null ? state.notes.get(state.selected) : null);
    updatePreview();
  }

  // Sprogvælgeren bygges ud fra sprogene i i18n.js, så et nyt sprog kun skal tilføjes dér.
  els.lang.textContent = "";
  for (const l of I18n.languages()) {
    const o = document.createElement("option");
    o.value = l.code;
    o.textContent = l.name;
    els.lang.appendChild(o);
  }

  // Standard er dansk. ?lang=en (de, es, fr) vælger et sprog og huskes; ellers bruges det sidst valgte.
  const urlLang = new URLSearchParams(location.search).get("lang");
  if (urlLang && I18n.setLang(urlLang)) storeSet(urlLang, LANG_KEY);
  else I18n.setLang(storeGet(LANG_KEY));
  els.lang.value = I18n.getLang();
  I18n.apply(document);

  els.lang.addEventListener("change", () => {
    if (!I18n.setLang(els.lang.value)) return;
    storeSet(I18n.getLang(), LANG_KEY);
    relocalize();
  });

  setMode(storeGet(MODE_KEY) === "preview" ? "preview" : "edit", false);
  updateExportButtons();

  setInterval(pollNow, CFG.pollMs);
  start();
})();
