# Movie and book catalog

A local movie and book library for Obsidian using the built-in Bases plugin. Open the library, switch between movies and books, and use Add above the embedded catalog to search by title and choose a specific movie or book edition. Cards are ordinary Markdown notes and catalogs are ordinary Base files, usable without this plugin.

## Version 0.4.0

- Open a note by its cover, title or Open note button; it opens in a new tab so the library remains available.
- One library tab with explicit Cards, Table and Kanban buttons, movies/books tabs and Add above the catalog.
- Cards show a poster or cover, title, author/director, year, synopsis and a status selector. Failed images show a readable placeholder.
- Kanban groups items by status. Drag a card to change status on desktop, or use its selector on desktop and mobile.
- Every status change creates a full original-note backup in Media catalog backups. Undo restores the last status change in the current plugin session, preserving later edits to other fields and the body. It refuses to undo over a later status change or a replaced note. Backups remain after restarting the app; automatic Undo does not.
- Russian and English interface translations, automatic app-language detection with English fallback, and a separate configurable TMDB metadata locale. Book edition language is preserved from its source. Titles, existing reviews and descriptions are not machine-translated.
- Live title search after two characters, with an optional movie year. Existing local cards appear before remote results.
- Keyless movie lookup via Wikidata and keyless book editions via Open Library. Optional TMDB and Google Books keys enable additional providers; Automatic puts their results first. Choose a provider in settings or override it in Add / Scan dialogs. Provider failures are shown while available providers continue. Successful searches have a bounded five-minute cache.
- Configurable note folders and Base paths. Create a missing catalog explicitly from the library; existing catalog files are never replaced.
- Duplicate detection by source IDs, movie IDs and validated ISBN-10/13. Ambiguous titles require confirmation for a different edition.
- A `media-catalog` Markdown code block adds the same catalog and button to any note.

Enable the built-in Bases plugin for Table view. Run Open movies and books (Открыть кино и книги), or use the library icon. Set Interface language to Automatic, Русский or English. Set Movie metadata language independently, for example en-US, ru-RU or de-DE; the default follows the app language where supported. Other interface languages currently use English.

Configure the note folders and Base files before adding items. Paths are relative to the vault; changing a path does not move existing data. Existing Areas/Личное catalogs are retained. New English-interface vaults default to Media/Movies and Media/Books.

Cards and Kanban show movie/book notes in the configured folders; they do not evaluate custom native Base filters. Table embeds the existing native table view by its name, retaining its filters, properties and sorting. Existing Base files are not rewritten or translated. Newly created Bases have localized Cards, Table and status views. Use Open Base file to edit the original native catalog directly.

The five status groups are Planned, Watching/Reading, Watched/Read, On hold and Dropped. Unknown custom statuses are kept in Other statuses. Existing Russian and English status values are recognized without bulk migration. New catalogs use stable status codes; old Russian Base filters retain compatible Russian values when adding or moving cards. Changing status changes only the status field; dates and personal ratings remain manual.

To embed movies in a note:

````markdown
```media-catalog
film
```
````

For books use `book` instead of `film`. The block includes the same Cards, Table and Kanban controls. The plugin does not patch the native Base toolbar.

## Scan existing notes

Click Scan folder beside Add in either catalog, or run Scan movie folder / Scan book folder. Enter a vault-relative folder, optionally include subfolders, choose a provider and click Build queue. Only Markdown notes in that folder are read; backups, notes with another type and malformed YAML are excluded. Untyped notes are eligible. Search uses title or filename, movie year, and book author or ISBN if available. It sends no body text or personal review/highlights.

The queue searches one note at a time as you review it; it does not launch a burst of requests for the whole folder. Edit the query and click Find matches, select a result, inspect the proposed empty fields and click Fill empty fields, or Skip. Wikidata supplies structured film metadata and a short entity description, not a full synopsis or guaranteed poster; only recognized film classes are offered. Open Library supplies specific editions, which may omit recent or local titles. Existing values, including manually corrected metadata, are always kept; this version has no replace-filled-fields option. Text, file names, personal ratings, dates, statuses, tags and highlights are unchanged. The default provider preference is synchronized in plugin settings; API credentials are device-local, so Automatic can choose different providers on different devices.

Each accepted update first creates an exact original-note backup in Media catalog backups, then atomically fills the empty frontmatter fields. A changed note is rejected instead of applying a stale preview. Undo last metadata update restores the last accepted file in the current session only if it has not been edited since. After restarting or later editing, inspect the backup and restore the needed fields manually. The review queue is session-local; closing it stops progression and a new scan starts a new queue. Search results are not written unless you accept a preview.

## Installation and update

This is a development pre-release, not yet listed in the Obsidian Community directory. Download the runtime files or the install ZIP from the repository's GitHub Releases. Close plugin dialogs, disable the old plugin, back up the three runtime files, and replace main.js, manifest.json and styles.css in the existing ksandr-media-picker plugin folder with the release files. Enable the plugin again. The ID is unchanged from 0.1.x, so local API credentials remain available. A restart may be needed. Roll back by restoring the old three files. The update itself does not migrate or modify notes, catalogs or plugin credentials.

## Accounts, network and privacy

Movie search works without a key via Wikidata; TMDB optionally uses your own API Read Access Token. Open Library book search does not require an account. Google Books is optional and requires your own API key. No payments to this plugin are required. External providers have their own terms and limits.

Search sends title/author queries, year, ISBN and selected source IDs to selected providers at www.wikidata.org, openlibrary.org, api.themoviedb.org and www.googleapis.com. Credentials are sent only to their provider. Poster and book-cover URLs can load images from image.tmdb.org, covers.openlibrary.org, Google image services and provider-supplied HTTPS image hosts. Remote images displayed through Bases use the host application's image loading behavior.

Personal ratings, reviews, reading status and highlight text are not transmitted. No telemetry, advertising, external filesystem access, self-update or third-party plugin installation is included. Catalog path settings use the standard plugin data store. Credentials use device-local browser storage rather than vault files, must be entered separately on desktop and mobile, and are not encrypted against other plugins with access to the application's JavaScript environment.

This product uses the TMDB API but is not endorsed or certified by TMDB. Movie metadata and images are supplied by TMDB. Each imported card links to its provider. Public release still requires adding an approved TMDB logo to the credits interface and checking the provider's attribution requirements.

## Data preservation and limits

Adding a duplicate opens the existing card. Existing Base files are never overwritten. Creating a missing catalog only creates a new Base file and missing folders. A status change is an explicit user action, backed up before FileManager.processFrontMatter updates that field. Reviews, highlights, custom properties and other personal fields are retained. Folder scanning fills only empty metadata fields after explicit selection and preview. Kindle clipping import is not included in the plugin yet; the separate server tool remains responsible for that workflow.

Unit tests use a DOM/API test double, including browser-like native timer receiver checks. Desktop and mobile native Base rendering and real authenticated provider calls must be checked in Obsidian before submission. A development package is not evidence of acceptance by the community directory.

## Development

Requires Node.js and the yaml development dependency. Install dependencies, run `npm test`, then `npm run build`. Runtime uses only Obsidian's API; no runtime packages or bundler are needed. Source is in src/main.js, generated main.js belongs in the release assets. Tests contain synthetic fixtures and no personal vault data.

See PUBLISHING.md for the current submission steps and pending checks. The code is licensed under MIT; provider content and marks remain subject to their respective terms.
