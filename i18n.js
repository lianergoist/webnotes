/* i18n.js - tekster på dansk (standard), engelsk, tysk, spansk og fransk.
 *
 * Appens navn er "WebNotes" på alle sprog (appTitle og back).
 *
 * Tilføj et sprog ved at lægge en ny tabel i MESSAGES og en række i LANGS. Alle sprog skal have
 * præcis de samme nøgler og de samme {pladsholdere}; selvtesten fanger forskelle.
 * Virker både som <script> i browseren (window.I18n) og som require() i Node. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.I18n = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEFAULT = "da";

  var LANGS = {
    da: { name: "Dansk", locale: "da-DK" },
    en: { name: "English", locale: "en-GB" },
    de: { name: "Deutsch", locale: "de-DE" },
    es: { name: "Español", locale: "es-ES" },
    fr: { name: "Français", locale: "fr-FR" },
  };

  var MESSAGES = {
    da: {
      appTitle: "WebNotes",
      newNote: "Ny note",
      search: "Søg i noter",
      collectionLabel: "Samling",
      back: "WebNotes",
      deleteNote: "Slet note",
      menuLabel: "Mere",
      close: "Luk",
      titleField: "Titel",
      tagsPlaceholder: "Tilføj tags, adskilt med komma",
      tagsLabel: "Tags",
      bodyPlaceholder: "Skriv her",
      bodyLabel: "Notetekst",
      langLabel: "Sprog / Language",

      untitled: "Uden titel",
      noDate: "Uden dato",
      today: "I dag",
      yesterday: "I går",
      last7: "Seneste 7 dage",
      emptyNone: "Ingen noter endnu. Tryk på Ny note for at skrive den første.",
      emptyNoMatch: "Ingen noter matcher søgningen.",
      modified: "Ændret {time}",

      statusLoading: "Henter",
      statusSaved: "Gemt",
      statusNotSaved: "Ikke gemt",
      statusOffline: "Offline",

      loginRequired: "Du er ikke logget ind. Log ind igen for at se og gemme dine noter.",
      login: "Log ind",
      logout: "Log ud",
      loggedOut: "Du er logget ud. Er det en delt computer, så luk også browseren.",
      networkDown: "Kan ikke nå serveren. Dine ændringer gemmes igen, så snart forbindelsen er tilbage.",
      somethingWrong: "Noget gik galt: {detail}",
      notSavedYet: "Noten er ikke gemt endnu. Vent et øjeblik, og prøv igen.",
      recreated: "Noten var slettet et andet sted. Den er oprettet igen med dine ændringer.",
      conflictMark: "(konflikt)",
      conflictBanner: 'Noten blev ændret et andet sted. Din version er gemt som en ny note med "{mark}" i titlen.',
      deleteConfirm: 'Slet noten "{title}"?',
      deleteConflict: "Noten blev ændret et andet sted og er ikke slettet. Se den nye version, og slet igen, hvis du stadig vil.",
      deleted: "Noten er slettet.",
      deletedElsewhere: "Noten blev slettet et andet sted.",

      noCollection: "Der er ingen samling til noter på serveren endnu.",
      createCollectionBtn: "Opret samling",
      newCollectionOption: "Ny samling…",
      newCollectionPrompt: "Navn på den nye samling",
      collectionExists: 'Der findes allerede en samling der hedder "{name}". Vælg et andet navn.',
      collectionCreated: 'Samlingen "{name}" er oprettet.',

      "err.bad_xml": "Ugyldigt svar fra serveren.",
      "err.no_principal": "Kunne ikke finde din bruger på serveren.",
      "err.no_etag": "Serveren svarede uden versionsmærke (etag).",
      "err.no_free_address": "Kunne ikke finde en ledig adresse til samlingen.",
      "err.exists": "Noten findes allerede.",
      "err.recreate_failed": "Noten kunne ikke oprettes igen.",
      toolbarLabel: "Værktøjer til noten",
      modeEdit: "Skriv",
      modePreview: "Vis",
      fmtBold: "Fed (Ctrl+B)",
      fmtItalic: "Kursiv (Ctrl+I)",
      fmtHeading: "Overskrift",
      fmtLink: "Link (Ctrl+K)",
      fmtBullets: "Punktliste",
      fmtNumbers: "Nummereret liste",
      fmtTodo: "Opgaveliste",
      fmtOutdent: "Ryk tilbage",
      fmtIndent: "Ryk ind",
      fmtQuote: "Citat",
      fmtCode: "Kode",
      linkText: "tekst",
      importFiles: "Importér",
      importTitle: "Importér .md- eller .txt-filer som nye noter",
      exportMd: "Eksportér .md",
      exportTxt: "Eksportér .txt",
      previewEmpty: "Der er ikke skrevet noget endnu.",
      imported: "{count} noter importeret.",
      importedOne: "1 note importeret.",
      importSkipped: "{name} blev ikke importeret (ikke tekst, eller over 1 MB).",
    },

    en: {
      appTitle: "WebNotes",
      newNote: "New note",
      search: "Search notes",
      collectionLabel: "Collection",
      back: "WebNotes",
      deleteNote: "Delete note",
      menuLabel: "More",
      close: "Close",
      titleField: "Title",
      tagsPlaceholder: "Add tags, separated by commas",
      tagsLabel: "Tags",
      bodyPlaceholder: "Write here",
      bodyLabel: "Note text",
      langLabel: "Sprog / Language",

      untitled: "Untitled",
      noDate: "No date",
      today: "Today",
      yesterday: "Yesterday",
      last7: "Last 7 days",
      emptyNone: "No notes yet. Select New note to write the first one.",
      emptyNoMatch: "No notes match your search.",
      modified: "Modified {time}",

      statusLoading: "Loading",
      statusSaved: "Saved",
      statusNotSaved: "Not saved",
      statusOffline: "Offline",

      loginRequired: "You're not signed in. Sign in again to view and save your notes.",
      login: "Sign in",
      logout: "Sign out",
      loggedOut: "You're signed out. On a shared computer, close the browser as well.",
      networkDown: "Can't reach the server. Your changes will be saved again as soon as the connection is back.",
      somethingWrong: "Something went wrong: {detail}",
      notSavedYet: "The note hasn't been saved yet. Wait a moment and try again.",
      recreated: "The note was deleted elsewhere. It has been created again with your changes.",
      conflictMark: "(conflict)",
      conflictBanner: 'The note was changed elsewhere. Your version has been saved as a new note with "{mark}" in the title.',
      deleteConfirm: 'Delete the note "{title}"?',
      deleteConflict: "The note was changed elsewhere and hasn't been deleted. Check the new version, and delete it again if you still want to.",
      deleted: "Note deleted.",
      deletedElsewhere: "The note was deleted elsewhere.",

      noCollection: "There's no notes collection on the server yet.",
      createCollectionBtn: "Create collection",
      newCollectionOption: "New collection…",
      newCollectionPrompt: "Name of the new collection",
      collectionExists: 'A collection named "{name}" already exists. Choose another name.',
      collectionCreated: 'Collection "{name}" created.',

      "err.bad_xml": "Invalid response from the server.",
      "err.no_principal": "Couldn't find your account on the server.",
      "err.no_etag": "The server replied without a version tag (etag).",
      "err.no_free_address": "Couldn't find a free address for the collection.",
      "err.exists": "The note already exists.",
      "err.recreate_failed": "The note couldn't be created again.",
      toolbarLabel: "Note tools",
      modeEdit: "Write",
      modePreview: "Preview",
      fmtBold: "Bold (Ctrl+B)",
      fmtItalic: "Italic (Ctrl+I)",
      fmtHeading: "Heading",
      fmtLink: "Link (Ctrl+K)",
      fmtBullets: "Bulleted list",
      fmtNumbers: "Numbered list",
      fmtTodo: "Task list",
      fmtOutdent: "Outdent",
      fmtIndent: "Indent",
      fmtQuote: "Quote",
      fmtCode: "Code",
      linkText: "text",
      importFiles: "Import",
      importTitle: "Import .md or .txt files as new notes",
      exportMd: "Export .md",
      exportTxt: "Export .txt",
      previewEmpty: "Nothing has been written yet.",
      imported: "{count} notes imported.",
      importedOne: "1 note imported.",
      importSkipped: "{name} was not imported (not text, or over 1 MB).",
    },

    de: {
      appTitle: "WebNotes",
      newNote: "Neue Notiz",
      search: "Notizen durchsuchen",
      collectionLabel: "Sammlung",
      back: "WebNotes",
      deleteNote: "Notiz löschen",
      menuLabel: "Mehr",
      close: "Schließen",
      titleField: "Titel",
      tagsPlaceholder: "Tags hinzufügen, durch Komma getrennt",
      tagsLabel: "Tags",
      bodyPlaceholder: "Hier schreiben",
      bodyLabel: "Notiztext",
      langLabel: "Sprache / Language",

      untitled: "Ohne Titel",
      noDate: "Ohne Datum",
      today: "Heute",
      yesterday: "Gestern",
      last7: "Letzte 7 Tage",
      emptyNone: "Noch keine Notizen. Tippe auf Neue Notiz, um die erste zu schreiben.",
      emptyNoMatch: "Keine Notizen passen zur Suche.",
      modified: "Geändert {time}",

      statusLoading: "Wird geladen",
      statusSaved: "Gespeichert",
      statusNotSaved: "Nicht gespeichert",
      statusOffline: "Offline",

      loginRequired: "Du bist nicht angemeldet. Melde dich erneut an, um deine Notizen zu sehen und zu speichern.",
      login: "Anmelden",
      logout: "Abmelden",
      loggedOut: "Du bist abgemeldet. Schließe auf einem gemeinsam genutzten Computer auch den Browser.",
      networkDown: "Der Server ist nicht erreichbar. Deine Änderungen werden gespeichert, sobald die Verbindung wieder da ist.",
      somethingWrong: "Etwas ist schiefgelaufen: {detail}",
      notSavedYet: "Die Notiz ist noch nicht gespeichert. Warte einen Moment und versuche es erneut.",
      recreated: "Die Notiz wurde an anderer Stelle gelöscht. Sie wurde mit deinen Änderungen neu angelegt.",
      conflictMark: "(Konflikt)",
      conflictBanner: 'Die Notiz wurde an anderer Stelle geändert. Deine Version wurde als neue Notiz mit "{mark}" im Titel gespeichert.',
      deleteConfirm: 'Notiz "{title}" löschen?',
      deleteConflict: "Die Notiz wurde an anderer Stelle geändert und nicht gelöscht. Sieh dir die neue Version an und lösche sie erneut, wenn du willst.",
      deleted: "Notiz gelöscht.",
      deletedElsewhere: "Die Notiz wurde an anderer Stelle gelöscht.",

      noCollection: "Auf dem Server gibt es noch keine Sammlung für Notizen.",
      createCollectionBtn: "Sammlung anlegen",
      newCollectionOption: "Neue Sammlung…",
      newCollectionPrompt: "Name der neuen Sammlung",
      collectionExists: 'Es gibt bereits eine Sammlung namens "{name}". Wähle einen anderen Namen.',
      collectionCreated: 'Sammlung "{name}" angelegt.',

      "err.bad_xml": "Ungültige Antwort vom Server.",
      "err.no_principal": "Dein Benutzer wurde auf dem Server nicht gefunden.",
      "err.no_etag": "Der Server hat ohne Versionskennung (ETag) geantwortet.",
      "err.no_free_address": "Es wurde keine freie Adresse für die Sammlung gefunden.",
      "err.exists": "Die Notiz existiert bereits.",
      "err.recreate_failed": "Die Notiz konnte nicht neu angelegt werden.",
      toolbarLabel: "Werkzeuge für die Notiz",
      modeEdit: "Schreiben",
      modePreview: "Ansehen",
      fmtBold: "Fett (Strg+B)",
      fmtItalic: "Kursiv (Strg+I)",
      fmtHeading: "Überschrift",
      fmtLink: "Link (Strg+K)",
      fmtBullets: "Aufzählung",
      fmtNumbers: "Nummerierte Liste",
      fmtTodo: "Aufgabenliste",
      fmtOutdent: "Ausrücken",
      fmtIndent: "Einrücken",
      fmtQuote: "Zitat",
      fmtCode: "Code",
      linkText: "Text",
      importFiles: "Importieren",
      importTitle: ".md- oder .txt-Dateien als neue Notizen importieren",
      exportMd: "Als .md exportieren",
      exportTxt: "Als .txt exportieren",
      previewEmpty: "Hier steht noch nichts.",
      imported: "{count} Notizen importiert.",
      importedOne: "1 Notiz importiert.",
      importSkipped: "{name} wurde nicht importiert (kein Text oder größer als 1 MB).",
    },

    es: {
      appTitle: "WebNotes",
      newNote: "Nueva nota",
      search: "Buscar notas",
      collectionLabel: "Colección",
      back: "WebNotes",
      deleteNote: "Eliminar nota",
      menuLabel: "Más",
      close: "Cerrar",
      titleField: "Título",
      tagsPlaceholder: "Añade etiquetas separadas por comas",
      tagsLabel: "Etiquetas",
      bodyPlaceholder: "Escribe aquí",
      bodyLabel: "Texto de la nota",
      langLabel: "Idioma / Language",

      untitled: "Sin título",
      noDate: "Sin fecha",
      today: "Hoy",
      yesterday: "Ayer",
      last7: "Últimos 7 días",
      emptyNone: "Aún no hay notas. Pulsa Nueva nota para escribir la primera.",
      emptyNoMatch: "Ninguna nota coincide con la búsqueda.",
      modified: "Modificada {time}",

      statusLoading: "Cargando",
      statusSaved: "Guardada",
      statusNotSaved: "Sin guardar",
      statusOffline: "Sin conexión",

      loginRequired: "No has iniciado sesión. Vuelve a iniciar sesión para ver y guardar tus notas.",
      login: "Iniciar sesión",
      logout: "Cerrar sesión",
      loggedOut: "Has cerrado sesión. En un ordenador compartido, cierra también el navegador.",
      networkDown: "No se puede conectar con el servidor. Tus cambios se guardarán en cuanto vuelva la conexión.",
      somethingWrong: "Algo ha salido mal: {detail}",
      notSavedYet: "La nota aún no se ha guardado. Espera un momento y vuelve a intentarlo.",
      recreated: "La nota se eliminó en otro lugar. Se ha vuelto a crear con tus cambios.",
      conflictMark: "(conflicto)",
      conflictBanner: 'La nota se modificó en otro lugar. Tu versión se ha guardado como una nota nueva con "{mark}" en el título.',
      deleteConfirm: '¿Eliminar la nota "{title}"?',
      deleteConflict: "La nota se modificó en otro lugar y no se ha eliminado. Revisa la nueva versión y vuelve a eliminarla si aún quieres.",
      deleted: "Nota eliminada.",
      deletedElsewhere: "La nota se eliminó en otro lugar.",

      noCollection: "Todavía no hay ninguna colección de notas en el servidor.",
      createCollectionBtn: "Crear colección",
      newCollectionOption: "Nueva colección…",
      newCollectionPrompt: "Nombre de la nueva colección",
      collectionExists: 'Ya existe una colección llamada "{name}". Elige otro nombre.',
      collectionCreated: 'Colección "{name}" creada.',

      "err.bad_xml": "Respuesta no válida del servidor.",
      "err.no_principal": "No se ha encontrado tu usuario en el servidor.",
      "err.no_etag": "El servidor respondió sin etiqueta de versión (etag).",
      "err.no_free_address": "No se ha encontrado una dirección libre para la colección.",
      "err.exists": "La nota ya existe.",
      "err.recreate_failed": "No se ha podido volver a crear la nota.",
      toolbarLabel: "Herramientas de la nota",
      modeEdit: "Escribir",
      modePreview: "Ver",
      fmtBold: "Negrita (Ctrl+B)",
      fmtItalic: "Cursiva (Ctrl+I)",
      fmtHeading: "Encabezado",
      fmtLink: "Enlace (Ctrl+K)",
      fmtBullets: "Lista con viñetas",
      fmtNumbers: "Lista numerada",
      fmtTodo: "Lista de tareas",
      fmtOutdent: "Reducir sangría",
      fmtIndent: "Aumentar sangría",
      fmtQuote: "Cita",
      fmtCode: "Código",
      linkText: "texto",
      importFiles: "Importar",
      importTitle: "Importar archivos .md o .txt como notas nuevas",
      exportMd: "Exportar .md",
      exportTxt: "Exportar .txt",
      previewEmpty: "Todavía no hay nada escrito.",
      imported: "{count} notas importadas.",
      importedOne: "1 nota importada.",
      importSkipped: "{name} no se ha importado (no es texto o supera 1 MB).",
    },

    fr: {
      appTitle: "WebNotes",
      newNote: "Nouvelle note",
      search: "Rechercher dans les notes",
      collectionLabel: "Collection",
      back: "WebNotes",
      deleteNote: "Supprimer la note",
      menuLabel: "Plus",
      close: "Fermer",
      titleField: "Titre",
      tagsPlaceholder: "Ajouter des étiquettes, séparées par des virgules",
      tagsLabel: "Étiquettes",
      bodyPlaceholder: "Écrivez ici",
      bodyLabel: "Texte de la note",
      langLabel: "Langue / Language",

      untitled: "Sans titre",
      noDate: "Sans date",
      today: "Aujourd’hui",
      yesterday: "Hier",
      last7: "7 derniers jours",
      emptyNone: "Aucune note pour l’instant. Appuyez sur Nouvelle note pour écrire la première.",
      emptyNoMatch: "Aucune note ne correspond à la recherche.",
      modified: "Modifiée {time}",

      statusLoading: "Chargement",
      statusSaved: "Enregistrée",
      statusNotSaved: "Non enregistrée",
      statusOffline: "Hors ligne",

      loginRequired: "Vous n’êtes pas connecté. Reconnectez-vous pour voir et enregistrer vos notes.",
      login: "Se connecter",
      logout: "Se déconnecter",
      loggedOut: "Vous êtes déconnecté. Sur un ordinateur partagé, fermez aussi le navigateur.",
      networkDown: "Impossible de joindre le serveur. Vos modifications seront enregistrées dès le retour de la connexion.",
      somethingWrong: "Une erreur s’est produite : {detail}",
      notSavedYet: "La note n’est pas encore enregistrée. Patientez un instant, puis réessayez.",
      recreated: "La note avait été supprimée ailleurs. Elle a été recréée avec vos modifications.",
      conflictMark: "(conflit)",
      conflictBanner: "La note a été modifiée ailleurs. Votre version a été enregistrée comme nouvelle note avec « {mark} » dans le titre.",
      deleteConfirm: "Supprimer la note « {title} » ?",
      deleteConflict: "La note a été modifiée ailleurs et n’a pas été supprimée. Consultez la nouvelle version, puis supprimez-la à nouveau si vous le souhaitez toujours.",
      deleted: "Note supprimée.",
      deletedElsewhere: "La note a été supprimée ailleurs.",

      noCollection: "Il n’y a pas encore de collection de notes sur le serveur.",
      createCollectionBtn: "Créer une collection",
      newCollectionOption: "Nouvelle collection…",
      newCollectionPrompt: "Nom de la nouvelle collection",
      collectionExists: "Une collection nommée « {name} » existe déjà. Choisissez un autre nom.",
      collectionCreated: "La collection « {name} » a été créée.",

      "err.bad_xml": "Réponse du serveur non valide.",
      "err.no_principal": "Votre compte est introuvable sur le serveur.",
      "err.no_etag": "Le serveur a répondu sans marqueur de version (etag).",
      "err.no_free_address": "Aucune adresse libre n’a été trouvée pour la collection.",
      "err.exists": "La note existe déjà.",
      "err.recreate_failed": "La note n’a pas pu être recréée.",
      toolbarLabel: "Outils de la note",
      modeEdit: "Écrire",
      modePreview: "Aperçu",
      fmtBold: "Gras (Ctrl+B)",
      fmtItalic: "Italique (Ctrl+I)",
      fmtHeading: "Titre de section",
      fmtLink: "Lien (Ctrl+K)",
      fmtBullets: "Liste à puces",
      fmtNumbers: "Liste numérotée",
      fmtTodo: "Liste de tâches",
      fmtOutdent: "Diminuer le retrait",
      fmtIndent: "Augmenter le retrait",
      fmtQuote: "Citation",
      fmtCode: "Code",
      linkText: "texte",
      importFiles: "Importer",
      importTitle: "Importer des fichiers .md ou .txt comme nouvelles notes",
      exportMd: "Exporter en .md",
      exportTxt: "Exporter en .txt",
      previewEmpty: "Rien n’a encore été écrit.",
      imported: "{count} notes importées.",
      importedOne: "1 note importée.",
      importSkipped: "{name} n’a pas été importé (pas du texte, ou plus de 1 Mo).",
    },
  };

  var current = DEFAULT;

  // Slår en tekst op. {navn} i teksten erstattes af params.navn. Mangler nøglen i det valgte sprog,
  // bruges standardsproget; mangler den helt, vises selve nøglen (så fejlen er til at få øje på).
  function t(key, params) {
    var s = MESSAGES[current][key];
    if (s === undefined) s = MESSAGES[DEFAULT][key];
    if (s === undefined) return key;
    return s.replace(/\{(\w+)\}/g, function (m, k) {
      return params && params[k] !== undefined ? String(params[k]) : m;
    });
  }

  // false (og uændret sprog) hvis koden ikke findes
  function setLang(code) {
    if (typeof code !== "string" || !Object.prototype.hasOwnProperty.call(LANGS, code)) return false;
    current = code;
    return true;
  }

  function getLang() { return current; }
  function locale() { return LANGS[current].locale; }
  function languages() {
    return Object.keys(LANGS).map(function (code) { return { code: code, name: LANGS[code].name }; });
  }
  function messages(code) { return MESSAGES[code]; }

  // Oversætter de elementer i siden, der er mærket med data-i18n, data-i18n-placeholder, data-i18n-aria-label og data-i18n-title.
  function apply(doc) {
    doc.documentElement.lang = current;
    doc.title = t("appTitle");
    var map = [["data-i18n", null], ["data-i18n-placeholder", "placeholder"], ["data-i18n-aria-label", "aria-label"], ["data-i18n-title", "title"]];
    map.forEach(function (m) {
      Array.prototype.forEach.call(doc.querySelectorAll("[" + m[0] + "]"), function (el) {
        var text = t(el.getAttribute(m[0]));
        if (m[1]) el.setAttribute(m[1], text); else el.textContent = text;
      });
    });
  }

  return { DEFAULT: DEFAULT, t: t, setLang: setLang, getLang: getLang, locale: locale,
    languages: languages, messages: messages, apply: apply };
});
