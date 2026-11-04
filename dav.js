/* dav.js - lille CalDAV-klient til VJOURNAL-noter (window.Dav i browseren, require() i Node).
 *
 * I browseren kører siden på samme domæne som Radicale, så der er ingen CORS, og
 * browserens egen Basic-login-dialog tager sig af adgangskoden: koden her ser den aldrig.
 * I Node (tests) angives origin og et færdigt "Basic ..."-headerlinje i options. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./ical.js"));
  else root.Dav = factory(root.Ical);
})(typeof self !== "undefined" ? self : this, function (Ical) {
  "use strict";

  var DAV = "DAV:";
  var CAL = "urn:ietf:params:xml:ns:caldav";
  var CS = "http://calendarserver.org/ns/";
  var NSDECL = 'xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/"';
  var XML_HEAD = '<?xml version="1.0" encoding="utf-8"?>';
  var XML_CT = { "Content-Type": "application/xml; charset=utf-8" };

  // code: kort navn for fejl, der ikke er en HTTP-status; brugerfladen oversætter dem (se i18n.js, "err.*").
  class DavError extends Error {
    constructor(status, msg, code) {
      super(status ? "HTTP " + status + (msg ? ": " + msg : "") : msg);
      this.name = "DavError";
      this.status = status;
      this.code = code || null;
    }
  }
  class AuthError extends DavError {
    constructor(msg) { super(401, msg || "login mislykkedes"); this.name = "AuthError"; }
  }
  class NetworkError extends Error {
    constructor(msg) { super(msg); this.name = "NetworkError"; }
  }

  // Hrefs gemmes altid som afkodede stier, så sammenligning er entydig.
  function normHref(href) {
    var path;
    try { path = new URL(href, "http://x").pathname; } catch (e) { path = href; }
    try { return decodeURIComponent(path); } catch (e) { return path; }
  }
  function encodePath(p) { return p.split("/").map(encodeURIComponent).join("/"); }
  function withSlash(p) { return p.charAt(p.length - 1) === "/" ? p : p + "/"; }
  function xmlEscape(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  // Navn -> adresse: "Mine idéer" -> "mine-ideer", "Århus" -> "aarhus". Aldrig tom.
  function slugify(name) {
    var s = name.toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa");
    s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    s = s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
    return s || "samling";
  }

  // -- XML-hjælpere (kun direkte børn, så indlejrede <href> ikke forveksles) ----
  function kids(el, ns, name) {
    var out = [];
    for (var n = el.firstChild; n; n = n.nextSibling)
      if (n.nodeType === 1 && n.namespaceURI === ns && n.localName === name) out.push(n);
    return out;
  }
  function kid(el, ns, name) { return kids(el, ns, name)[0] || null; }
  function txt(el) { return el ? el.textContent : null; }

  function okProps(resp) {
    var out = [];
    kids(resp, DAV, "propstat").forEach(function (ps) {
      if (/\s200\b/.test(txt(kid(ps, DAV, "status")) || "")) {
        var p = kid(ps, DAV, "prop");
        if (p) out.push(p);
      }
    });
    return out;
  }
  function findProp(props, ns, name) {
    for (var i = 0; i < props.length; i++) {
      var e = kid(props[i], ns, name);
      if (e) return e;
    }
    return null;
  }

  function toNote(href, etag, raw) {
    var p = Ical.parseIcs(raw);
    return { uid: p.uid, href: href, etag: etag, raw: raw, title: p.title, body: p.body, tags: p.tags, modified: p.modified };
  }

  class DavClient {
    constructor(opts) {
      opts = opts || {};
      this.origin = opts.origin || "";   // "" = samme origin som siden
      this.auth = opts.auth || null;     // kun til Node/tests
      this._fetch = opts.fetch || function (u, i) { return fetch(u, i); };
      this._parser = opts.parser || null;
      // Hvor Radicale ligger på domænet. Prøves i rækkefølge; den første, der svarer som CalDAV, bruges.
      // Fx "/dav/" på caldav.rpix.dk, hvor "/" er kontoportalen, eller "/" hvor Radicale ligger på roden.
      this.roots = (opts.roots && opts.roots.length) ? opts.roots.slice() : ["/"];
    }

    get parser() {
      if (!this._parser) this._parser = new DOMParser();
      return this._parser;
    }

    async request(method, path, options) {
      options = options || {};
      var headers = Object.assign({}, options.headers);
      if (this.auth) headers["Authorization"] = this.auth;
      var res;
      try {
        res = await this._fetch(this.origin + encodePath(path), {
          method: method, body: options.body, headers: headers, cache: "no-store", credentials: "same-origin",
        });
      } catch (e) {
        throw new NetworkError((e && e.message) || String(e));
      }
      var text = await res.text();
      if (res.status === 401) throw new AuthError();
      return { status: res.status, headers: res.headers, text: text };
    }

    parseXml(text) {
      var doc = this.parser.parseFromString(text, "application/xml");
      if (doc.getElementsByTagName("parsererror").length) throw new DavError(0, "ugyldigt XML-svar fra serveren", "bad_xml");
      return doc;
    }

    async propfind(path, depth, inner) {
      var body = XML_HEAD + "<D:propfind " + NSDECL + ">" + inner + "</D:propfind>";
      var r = await this.request("PROPFIND", path, { body: body, headers: Object.assign({ Depth: String(depth) }, XML_CT) });
      if (r.status !== 207) throw new DavError(r.status, "PROPFIND " + path);
      return this.parseXml(r.text);
    }

    // Find brugerens samlinger. Returnerer [{href, name, comps, journal, onlyJournal}].
    // Brugerens egen mappe på serveren, fx "/thomas/". Slås kun op én gang.
    async principalPath() {
      if (this._principal) return this._principal;
      var href = null, lastErr = null;
      for (var i = 0; i < this.roots.length && !href; i++) {
        var doc;
        try {
          doc = await this.propfind(this.roots[i], 0, "<D:prop><D:current-user-principal/></D:prop>");
        } catch (e) {
          if (!(e instanceof DavError) || e instanceof AuthError) throw e; // login og netværksfejl: stop her
          lastErr = e; continue;                                         // ikke CalDAV her: prøv næste
        }
        var cup = doc.getElementsByTagNameNS(DAV, "current-user-principal")[0];
        href = cup && cup.getElementsByTagNameNS(DAV, "href")[0];
        if (href) this._root = this.roots[i];
      }
      if (!href) throw lastErr || new DavError(0, "kunne ikke finde din bruger på serveren", "no_principal");
      this._principal = withSlash(normHref(href.textContent.trim()));
      return this._principal;
    }

    // Log ud: Basic-login har ingen rigtig "log ud". I stedet sendes én forespørgsel med et forkert
    // login (XMLHttpRequest med brugernavn og adgangskode i open()). Serveren afviser det, og browseren
    // glemmer så det login, den huskede, så næste kald beder om login igen. Det er den gængse metode,
    // men ikke en standard, så det er ikke sikkert, at alle browsere glemmer det. Giver HTTP-status
    // (401 er det forventede) eller 0 ved netværksfejl / uden browser.
    logout() {
      var url = this.origin + encodePath(this._root || this.roots[0]);
      this._principal = null;
      this._root = null;
      if (typeof XMLHttpRequest === "undefined") return Promise.resolve(0); // Node/tests: intet at glemme
      return new Promise(function (resolve) {
        var x = new XMLHttpRequest();
        x.open("PROPFIND", url, true, "logout", "logout-" + Date.now());
        x.setRequestHeader("Depth", "0");
        x.timeout = 4000; // log ud må aldrig hænge, heller ikke hvis serveren ikke svarer
        x.onloadend = function () { resolve(x.status); };
        x.send();
      });
    }

    async collectionExists(path) {
      var body = XML_HEAD + "<D:propfind " + NSDECL + "><D:prop><D:resourcetype/></D:prop></D:propfind>";
      var r = await this.request("PROPFIND", path, { body: body, headers: Object.assign({ Depth: "0" }, XML_CT) });
      if (r.status === 207) return true;
      if (r.status === 404) return false;
      throw new DavError(r.status, "PROPFIND " + path);
    }

    // Opret en samling, der kun må indeholde VJOURNAL, under brugerens egen mappe.
    // Adressen laves af navnet (æøå -> ae/oe/aa) og får et løbenummer, hvis den er optaget.
    async createCollection(name) {
      name = name.trim();
      var principal = await this.principalPath();
      var base = slugify(name), href = null;
      for (var i = 1; i <= 20 && !href; i++) {
        var cand = principal + (i === 1 ? base : base + "-" + i) + "/";
        if (!(await this.collectionExists(cand))) href = cand;
      }
      if (!href) throw new DavError(0, "kunne ikke finde en ledig adresse til samlingen", "no_free_address");
      var body = XML_HEAD + "<C:mkcalendar " + NSDECL + "><D:set><D:prop><D:displayname>" + xmlEscape(name) +
        '</D:displayname><C:supported-calendar-component-set><C:comp name="VJOURNAL"/>' +
        "</C:supported-calendar-component-set></D:prop></D:set></C:mkcalendar>";
      var r = await this.request("MKCALENDAR", href, { body: body, headers: XML_CT });
      if (r.status !== 200 && r.status !== 201) throw new DavError(r.status, "MKCALENDAR " + href);
      return { href: href, name: name, comps: ["VJOURNAL"], journal: true, onlyJournal: true };
    }

    async discover() {
      var principal = await this.principalPath();
      var doc = await this.propfind(principal, 1,
        "<D:prop><D:displayname/><D:resourcetype/><C:supported-calendar-component-set/></D:prop>");
      var out = [];
      kids(doc.documentElement, DAV, "response").forEach(function (resp) {
        var path = withSlash(normHref(txt(kid(resp, DAV, "href")).trim()));
        if (path === principal) return;
        var props = okProps(resp);
        var rt = findProp(props, DAV, "resourcetype");
        if (!rt || !kids(rt, CAL, "calendar").length) return;
        var setEl = findProp(props, CAL, "supported-calendar-component-set");
        var comps = setEl ? kids(setEl, CAL, "comp").map(function (c) { return (c.getAttribute("name") || "").toUpperCase(); }) : [];
        var dn = txt(findProp(props, DAV, "displayname"));
        out.push({
          href: path,
          name: dn || path.split("/").filter(Boolean).pop() || path,
          comps: comps,
          journal: comps.indexOf("VJOURNAL") >= 0,
          onlyJournal: comps.length === 1 && comps[0] === "VJOURNAL",
        });
      });
      return out;
    }

    // Billig ændringstjek: samme ctag = intet nyt. null hvis serveren ikke har den.
    async getCtag(col) {
      var body = XML_HEAD + "<D:propfind " + NSDECL + "><D:prop><CS:getctag/></D:prop></D:propfind>";
      var r = await this.request("PROPFIND", col, { body: body, headers: Object.assign({ Depth: "0" }, XML_CT) });
      if (r.status !== 207) return null;
      var el = this.parseXml(r.text).getElementsByTagNameNS(CS, "getctag")[0];
      return el ? el.textContent : null;
    }

    async getEtag(href) {
      var doc = await this.propfind(href, 0, "<D:prop><D:getetag/></D:prop>");
      var el = doc.getElementsByTagNameNS(DAV, "getetag")[0];
      if (!el) throw new DavError(0, "svar uden etag", "no_etag");
      return el.textContent;
    }

    // Alle VJOURNAL-noter i samlingen. Objekter af anden type ignoreres.
    async listNotes(col) {
      var body = XML_HEAD + "<C:calendar-query " + NSDECL + "><D:prop><D:getetag/><C:calendar-data/></D:prop>" +
        '<C:filter><C:comp-filter name="VCALENDAR"><C:comp-filter name="VJOURNAL"/></C:comp-filter></C:filter></C:calendar-query>';
      var r = await this.request("REPORT", col, { body: body, headers: Object.assign({ Depth: "1" }, XML_CT) });
      if (r.status !== 207) throw new DavError(r.status, "REPORT " + col);
      var notes = [];
      kids(this.parseXml(r.text).documentElement, DAV, "response").forEach(function (resp) {
        var props = okProps(resp);
        var etag = txt(findProp(props, DAV, "getetag"));
        var data = txt(findProp(props, CAL, "calendar-data"));
        if (!etag || !data) return;
        try { notes.push(toNote(normHref(txt(kid(resp, DAV, "href")).trim()), etag, data)); }
        catch (e) { /* ikke en gyldig VJOURNAL */ }
      });
      return notes;
    }

    // -> {etag, raw} eller null hvis den ikke findes
    async getNote(href) {
      var r = await this.request("GET", href);
      if (r.status === 404) return null;
      if (r.status !== 200) throw new DavError(r.status, "GET " + href);
      return { etag: r.headers.get("ETag") || (await this.getEtag(href)), raw: r.text };
    }

    // etag = null opretter (If-None-Match: *), ellers opdaterer (If-Match). -> {status:412} ved konflikt
    async putNote(href, raw, etag) {
      var headers = { "Content-Type": "text/calendar; charset=utf-8" };
      if (etag) headers["If-Match"] = etag; else headers["If-None-Match"] = "*";
      var r = await this.request("PUT", href, { body: raw, headers: headers });
      if (r.status === 412) return { status: 412 };
      if (r.status < 200 || r.status > 299) throw new DavError(r.status, "PUT " + href);
      return { status: r.status, etag: r.headers.get("ETag") || (await this.getEtag(href)) };
    }

    // -> "deleted" | "conflict"
    async deleteNote(href, etag) {
      var r = await this.request("DELETE", href, { headers: etag ? { "If-Match": etag } : {} });
      if (r.status === 412) return "conflict";
      if (r.status === 200 || r.status === 204 || r.status === 404) return "deleted";
      throw new DavError(r.status, "DELETE " + href);
    }

    async createNote(col, fields) {
      col = withSlash(col);
      var uid = Ical.uuid();
      var raw = Ical.newIcs(uid, fields.title, fields.body, fields.tags);
      var href = col + uid + ".ics";
      var r = await this.putNote(href, raw, null);
      if (r.status === 412) throw new DavError(412, "noten findes allerede", "exists");
      return toNote(href, r.etag, raw);
    }

    // Opdatér en eksisterende note. -> {status:412} eller {status, etag, note}
    async saveNote(note, fields) {
      var raw = Ical.updateIcs(note.raw, fields);
      if (raw === note.raw) return { status: 204, etag: note.etag, note: note };
      var r = await this.putNote(note.href, raw, note.etag);
      if (r.status === 412) return { status: 412 };
      return { status: r.status, etag: r.etag, note: toNote(note.href, r.etag, raw) };
    }
  }

  return { DavClient: DavClient, DavError: DavError, AuthError: AuthError, NetworkError: NetworkError,
    normHref: normHref, toNote: toNote, slugify: slugify };
});
