# WebNotes - web client for VJOURNAL notes in Radicale

**English** | [Dansk](README.da.md)

Static files (HTML, CSS and JavaScript, no dependencies, no build step). The page talks
CalDAV directly to your Radicale server and reads/writes the same `.ics` notes as `notesync.py`
and jtx Board.

| File | Contents |
|---|---|
| `index.html`, `style.css` | The page: note list and editor, mobile friendly, light/dark following the system |
| `ical.js` | Read/write VJOURNAL (port of the iCalendar layer in `notesync.py`) |
| `md.js` | Markdown rendering, import and export of .md/.txt |
| `i18n.js` | Texts in Danish, English, German, Spanish and French, plus language selection |
| `dav.js` | CalDAV client: discover collections, fetch, create, update, delete |
| `app.js` | User interface: list, search, autosave, conflicts, deletion, refresh every 30 s |
| `stamp.js` | Adds version numbers to the files referenced in `index.html` (see below) |
| `web-selftest.js`, `package.json` | Tests (not part of the page itself) |

## Server setup

The page must be served from **the same domain as Radicale** (so there is no CORS, and the
browser's own login dialog can be used). The files are served directly from `/var/www/rpix.dk/notes` on one domain:

| Address | Radicale at | Vhost |
|---|---|---|
| `https://caldav.rpix.dk/notes/` | `/dav/` (`/` is the account portal) | `caldav.rpix.dk-le-ssl.conf` |

- `caldav.rpix.dk/noter/...` redirects to `/notes/...`.
- `radicale.rpix.dk/notes/` also serves the page (same files, Radicale at `/`), and
  `radicale.rpix.dk/noter/...` redirects to `/notes/...` (`radicale.rpix.dk-le-ssl.conf`).
- `noter.rpix.dk` is disabled (`a2dissite`). On `rpix.dk`, `/noter` and `/notes` return 404, and the
  directory is locked with `Require all denied`.

The page finds Radicale on its own: it first asks at `/`, and if that does not answer CalDAV, it tries `/dav/`
(`davRoots` in `dav.js`/`app.js`; can be set via `window.NOTEWEB_CONFIG`). Login and network errors
stop the search immediately.

Excerpt from `caldav.rpix.dk` (if the page is placed on a domain where `ProxyPass /` sends everything to Radicale,
you also need `ProxyPass /notes !` before it):

```apache
RedirectMatch 301 ^/noter(/.*)?$ /notes$1
Alias /notes /var/www/rpix.dk/notes
<Directory /var/www/rpix.dk/notes>
    Require all granted
    Options -Indexes
</Directory>
<Location /notes>
    Header always set Content-Security-Policy "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    Header always set X-Content-Type-Options "nosniff"
    Header always set Referrer-Policy "no-referrer"
</Location>

RedirectMatch 301 ^/dav$ /dav/
ProxyPass /dav/ http://localhost:5232/ retry=0
ProxyPassReverse /dav/ http://localhost:5232/
<Location /dav/>
    RequestHeader set X-Script-Name /dav
    RequestHeader set X-Forwarded-Port "%{SERVER_PORT}s"
    RequestHeader set X-Forwarded-Proto expr=%{REQUEST_SCHEME}
</Location>
```

Requires `mod_alias`, `mod_proxy`, `mod_proxy_http` and `mod_headers`. Then:

```
sudo apache2ctl configtest && sudo systemctl reload apache2
```

The browser asks for a username and password (Radicale's own login), and the page finds
your notes collection by itself. Login and selected collection are remembered separately for each domain.

- The selector at the top of the list always shows the name of the collection you are using, even when there is
  only one. If you have several collections with VJOURNAL, you can switch between them; collections that are
  *only* for VJOURNAL are listed first, and your choice is remembered.
- **New collection…** at the bottom of the selector creates a new collection under your own user. It may only
  contain notes (VJOURNAL), and the address is derived from the name (e.g. "Mine idéer" becomes
  `/<user>/mine-ideer/`). The name cannot be changed from here afterwards. If there is no
  collection at all, the page offers to create the first one.
- If the page cannot find the collection, you can specify the path: `/notes/?col=/thomas/noter/`.

## How it behaves

- **Autosave** 1.2 seconds after the last keystroke, and on Ctrl/Cmd+S. The status line shows Changed, Saving, Saved.
- **No note is overwritten blindly.** Every save uses `If-Match` with the note's etag.
- **Conflict** (the note was changed elsewhere while open): the other version stays
  in the original, and your text is saved as a new note with "(conflict)" in the title. Same
  rule as in `notesync.py`. If the note was deleted elsewhere, it is recreated with your changes.
- **Other clients' data is preserved**: only title, text, tags and timestamps are changed; `X-` fields,
  `CLASS`, `STATUS`, `PRODID` etc. are left untouched.
- **Without a connection** the text stays in the editor and saving is retried every 8 seconds.
  The page does not work offline (the Android app does).
- **Refresh**: every 30 seconds and when the tab gains focus, the collection's ctag is checked; the notes
  are only fetched again if it has changed. The note you are typing in is never overwritten mid-edit.
- Note text is only inserted as text (never as HTML), and the CSP above only allows files from the same domain.

## Known limitations

- **Log out** (in the ⋯ menu) is the best Basic auth allows: pending changes are saved, and the browser is given a
  wrong login (`XMLHttpRequest` with username and password) so it forgets the real one. Tested in
  Chromium; other browsers should behave the same, but it is not a standard. The message therefore asks people
  on shared computers to also close the browser. The menu is in the editor, so on a narrow screen a
  note must be open before you can reach it.
- Tags containing a comma are split when edited.
- `SEQUENCE` is not incremented on edit (jtx Board does).
- The whole list is fetched again when the collection has changed. Fine for hundreds of notes, not thousands.
  The Android app should use `sync-collection` like `notesync.py`.

## Tests

```
npm install
PYTHON=.venv/bin/python npm test     # or just "npm test" if python3 has radicale
```

Starts a local Radicale with login and runs: the iCalendar layer (including a cross-check against `notesync.py`,
which must be in the parent directory or specified with `NOTESYNC_DIR`), the CalDAV client, and the whole
user interface in jsdom (create, edit, search, delete, conflict, offline, wrong login).
jsdom is not a real browser: layout, CSS and the browser's login dialog are not tested.

## Languages

The page is in Danish by default. At the bottom of the sidebar you can choose Dansk, English, Deutsch, Español or Français; the choice is remembered in the browser. `?lang=en` (or `de`, `es`, `fr`) in the address also selects the language (and is remembered). The app's name is "WebNotes" in all languages. All texts are in `i18n.js`; a new language is added by copying the `da` block, translating it and adding the language to `LANGS`. The language selector is built from `LANGS` (the options in `<select id="lang">` in `index.html` are only a fallback before the script runs). The title of a conflict copy follows the language ("(konflikt)" / "(conflict)" / "(Konflikt)" / "(conflicto)" / "(conflit)").

## Markdown, import and export

Notes are stored as plain text on the server (DESCRIPTION in VJOURNAL), so other programs see them unchanged. Markdown is only a view:

- **Write / View** at the top of the editor switches between the text field and the formatted view. The choice is remembered in the browser. Tasks (`- [ ]`) can be checked directly in the view, and this is saved in the text.
- **Format buttons** (bold, italic, heading, link, bulleted/numbered/task list, quote, code) act on the selection. Shortcuts: Ctrl+B, Ctrl+I, Ctrl+K. Enter in a list continues it, and Enter on an empty item ends it.
- Supported: headings, bold, italic, strikethrough, code and code blocks, quotes, lists (including nested), tasks, tables, horizontal rules and links.
- Security: the note is never rendered as HTML. Only `http`, `https` and `mailto` become links, and images are not loaded (they are shown as links), so the CSP above is unchanged.
- **Import** reads one or more `.md` or `.txt` files (at most 1 MB each) and creates a new note for each in the selected collection. In `.md`, the first `# heading` or `title:` in front matter becomes the title, and `tags:` in front matter become tags; otherwise the file name is used. Other front matter fields remain in the text. `.txt` is read as plain text.
- **Export .md** downloads the open note as `title.md` with `# title` first (and tags in front matter, if any); **Export .txt** downloads only the text. The export also includes changes that have not been saved yet.

## New versions and caching

`index.html` references `style.css` and the scripts with a version number, e.g. `app.js?v=1a2b3c4d`, which is a short hash of the file's contents. When a file changes, the number changes, and the browser fetches it again instead of using an old copy. So **after every change** to a `.js` or `.css` file, run:

    node stamp.js

and then copy the files (including `index.html`) to the server. `node stamp.js --check` changes nothing, but fails if a number is outdated; the tests (`npm test`) do the same.

`index.html` itself must not be cached for long, otherwise the browser never sees the new numbers. Apache handles this with revalidation, which is still fast (304 response if nothing has changed):

    <FilesMatch "\.html$">
        Header set Cache-Control "no-cache"
    </FilesMatch>

If `mod_headers` is enabled (it is already used for the CSP), this can go in the same vhost.
