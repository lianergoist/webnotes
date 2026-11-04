# WebNotes - webklient til VJOURNAL i Radicale

[English](README.md) | **Dansk**

Statiske filer (HTML, CSS og JavaScript, ingen afhængigheder, ingen build). Siden taler
CalDAV direkte med din Radicale og læser/skriver samme `.ics`-noter som `notesync.py`
og jtx Board.

| Fil | Indhold |
|---|---|
| `index.html`, `style.css` | Siden: noteliste og editor, mobilvenlig, lys/mørk efter systemet |
| `ical.js` | Læs/skriv VJOURNAL (port af iCalendar-laget i `notesync.py`) |
| `md.js` | Markdown-visning, import og eksport af .md/.txt |
| `i18n.js` | Tekster på dansk, engelsk, tysk, spansk og fransk samt sprogvalg |
| `dav.js` | CalDAV-klient: find samlinger, hent, opret, ret, slet |
| `app.js` | Brugerfladen: liste, søgning, autosave, konflikter, sletning, opdatering hvert 30. sek. |
| `stamp.js` | Sætter versionsnummer på filerne i `index.html` (se nedenfor) |
| `web-selftest.js`, `package.json` | Tests (ikke en del af selve siden) |

## Opsætning på din server

Siden skal ligge på **samme domæne som Radicale** (så der ikke er CORS, og så browserens
egen login-dialog kan bruges). Filerne serveres direkte fra `/var/www/rpix.dk/notes` på ét domæne:

| Adresse | Radicale på | Vhost |
|---|---|---|
| `https://caldav.rpix.dk/notes/` | `/dav/` (`/` er kontoportalen) | `caldav.rpix.dk-le-ssl.conf` |

- `caldav.rpix.dk/noter/...` sender videre til `/notes/...`.
- `radicale.rpix.dk/notes/` serverer også siden (samme filer, Radicale på `/`), og
  `radicale.rpix.dk/noter/...` sender videre til `/notes/...` (`radicale.rpix.dk-le-ssl.conf`).
- `noter.rpix.dk` er slået fra (`a2dissite`). På `rpix.dk` giver `/noter` og `/notes` 404, og mappen
  er spærret med `Require all denied`.

Siden finder selv Radicale: den spørger først på `/`, og svarer der ikke CalDAV, prøver den `/dav/`
(`davRoots` i `dav.js`/`app.js`; kan sættes via `window.NOTEWEB_CONFIG`). Login- og netværksfejl
stopper søgningen med det samme.

Uddrag af `caldav.rpix.dk` (lægges siden på et domæne, hvor `ProxyPass /` sender alt til Radicale,
skal der også stå `ProxyPass /notes !` før den):

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

Skal bruge `mod_alias`, `mod_proxy`, `mod_proxy_http` og `mod_headers`. Derefter:

```
sudo apache2ctl configtest && sudo systemctl reload apache2
```

Browseren spørger om brugernavn og adgangskode (Radicales egen login), og siden finder selv
din samling til noter. Login og valgt samling huskes for hvert domæne for sig.

- Vælgeren øverst på listen viser altid navnet på den samling, du bruger, også når der kun er
  én. Har du flere samlinger med VJOURNAL, kan du skifte mellem dem; samlinger der *kun* er
  til VJOURNAL står først, og dit valg huskes.
- **Ny samling…** nederst i vælgeren opretter en ny samling under din egen bruger. Den får kun lov
  at indeholde noter (VJOURNAL), og adressen laves af navnet (fx "Mine idéer" bliver til
  `/<bruger>/mine-ideer/`). Navnet kan ikke ændres bagefter herfra. Findes der slet ingen
  samling, tilbyder siden at oprette den første.
- Finder siden ikke samlingen, kan du angive stien: `/notes/?col=/thomas/noter/`.

## Hvordan den opfører sig

- **Autosave** 1,2 sekund efter sidste tastetryk, og ved Ctrl/Cmd+S. Statuslinjen viser Ændret, Gemmer, Gemt.
- **Ingen note overskrives i blinde.** Hvert gem bruger `If-Match` med noteens etag.
- **Konflikt** (noten er ændret et andet sted, mens den er åben): den andens version bliver
  stående i originalen, og din tekst gemmes som en ny note med "(konflikt)" i titlen. Samme
  regel som i `notesync.py`. Er noten slettet et andet sted, oprettes den igen med dine ændringer.
- **Andre klienters data bevares**: kun titel, tekst, tags og tidsstempler ændres; `X-`-felter,
  `CLASS`, `STATUS`, `PRODID` m.m. står urørt.
- **Uden forbindelse** bliver teksten stående i editoren og forsøges gemt igen hvert 8. sekund.
  Siden virker ikke offline (det gør Android-appen).
- **Opdatering**: hvert 30. sekund og når fanen får fokus tjekkes samlingens ctag; først hvis
  den er ændret hentes noterne igen. Noten du skriver i, bliver aldrig overskrevet midt i en redigering.
- Notetekst indsættes kun som tekst (aldrig som HTML), og CSP'en ovenfor tillader kun filer fra eget domæne.

## Kendte begrænsninger

- **Log ud** (i ⋯-menuen) er det bedste, Basic-login tillader: det ventende gemmes, og browseren får et
  forkert login (`XMLHttpRequest` med brugernavn og adgangskode), så den glemmer det rigtige. Afprøvet i
  Chromium; andre browsere bør gøre det samme, men det er ikke en standard. Beskeden beder derfor folk
  på delte computere om også at lukke browseren. Menuen sidder i editoren, så på en smal skærm skal en
  note være åben, før man kan komme til den.
- Tags med komma i selve tagget deles ved redigering.
- `SEQUENCE` øges ikke ved redigering (det gør jtx Board).
- Hele listen hentes igen, når samlingen er ændret. Fint til hundreder af noter, ikke tusinder.
  Android-appen bør bruge `sync-collection` som `notesync.py`.

## Tests

```
npm install
PYTHON=.venv/bin/python npm test     # eller blot "npm test", hvis python3 har radicale
```

Starter en lokal Radicale med login og kører: iCalendar-lag (også krydstjek mod `notesync.py`,
som skal ligge i mappen over eller angives med `NOTESYNC_DIR`), CalDAV-klienten, og hele
brugerfladen i jsdom (opret, ret, søg, slet, konflikt, offline, forkert login).
jsdom er ikke en rigtig browser: layout, CSS og browserens login-dialog er ikke afprøvet.

## Sprog

Siden er på dansk som standard. Nederst i sidepanelet kan man vælge Dansk, English, Deutsch, Español eller Français; valget huskes i browseren. `?lang=en` (eller `de`, `es`, `fr`) i adressen vælger også sproget (og huskes). Appens navn er "WebNotes" på alle sprog. Alle tekster ligger i `i18n.js`; et nyt sprog tilføjes ved at kopiere `da`-blokken, oversætte den og tilføje sproget i `LANGS`. Sprogvælgeren bygges ud fra `LANGS` (valgene i `<select id="lang">` i `index.html` er kun en reserve, før scriptet kører). Titlen på en konfliktkopi følger sproget ("(konflikt)" / "(conflict)" / "(Konflikt)" / "(conflicto)" / "(conflit)").

## Markdown, import og eksport

Noterne gemmes som ren tekst i serveren (DESCRIPTION i VJOURNAL), så andre programmer ser dem uændret. Markdown er kun en visning:

- **Skriv / Vis** øverst i editoren skifter mellem tekstfeltet og den formaterede visning. Valget huskes i browseren. Opgaver (`- [ ]`) kan krydses af direkte i visningen, og det gemmes i teksten.
- **Formatknapper** (fed, kursiv, overskrift, link, punkt-/nummereret-/opgaveliste, citat, kode) virker på markeringen. Genveje: Ctrl+B, Ctrl+I, Ctrl+K. Enter i en liste fortsætter den, og Enter på et tomt punkt afslutter den.
- Understøttet: overskrifter, fed, kursiv, overstreget, kode og kodeblokke, citater, lister (også indlejrede), opgaver, tabeller, vandrette streger og links.
- Sikkerhed: noten vises aldrig som HTML. Kun `http`, `https` og `mailto` bliver til links, og billeder hentes ikke (de vises som link), så CSP'en ovenfor er uændret.
- **Importér** læser en eller flere `.md`- eller `.txt`-filer (højst 1 MB hver) og opretter en ny note for hver i den valgte samling. I `.md` bliver første `# overskrift` eller `title:` i front matter til titlen, og `tags:` i front matter bliver til tags; ellers bruges filnavnet. Andre felter i front matter bliver stående i teksten. `.txt` læses som ren tekst.
- **Eksportér .md** henter den åbne note som `titel.md` med `# titel` først (og tags i front matter, hvis der er nogen); **Eksportér .txt** henter kun teksten. Eksporten indeholder også ændringer, der endnu ikke er gemt.

## Nye versioner og cache

`index.html` henviser til `style.css` og scripts med et versionsnummer, fx `app.js?v=1a2b3c4d`, som er en kort hash af filens indhold. Ændres en fil, ændres nummeret, og browseren henter den igen i stedet for at bruge en gammel kopi. Kør derfor **efter hver ændring** af en `.js`- eller `.css`-fil:

    node stamp.js

og kopiér derefter filerne (også `index.html`) til serveren. `node stamp.js --check` ændrer intet, men fejler, hvis nummeret er forældet; testene (`npm test`) gør det samme.

Selve `index.html` må ikke ligge i cachen længe, ellers ser browseren aldrig de nye numre. Det klarer Apache med revalidering, som stadig er hurtig (svar 304, hvis intet er ændret):

    <FilesMatch "\.html$">
        Header set Cache-Control "no-cache"
    </FilesMatch>

Er `mod_headers` slået til (det bruges allerede til CSP'en), kan det stå i samme vhost.
