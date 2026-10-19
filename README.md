# Movie and book catalog

A local movie and book library for Obsidian using the built-in Bases plugin. Open the library, switch between movies and books, and use Add above the embedded catalog to search by title and choose a specific movie or book edition. Cards are ordinary Markdown notes and catalogs are ordinary Base files, usable without this plugin.

## Version 0.6.0

- Optional TaskNotes integration: create or attach a task, navigate both directions, and explicitly start/stop time tracking.
- Open a note by its cover, title or Open note button; it opens in a new tab so the library remains available.
- One library tab with explicit Cards, Table and Kanban buttons, movies/books tabs and Add above the catalog.
- Cards show a poster or cover, title, author/director, year, synopsis and a status selector. Failed images show a readable placeholder.
- Kanban groups items by status. Drag a card to change status on desktop, or use its selector on desktop and mobile.
- Status changes do not create backup files. Undo restores the last status change in the current plugin session, preserving later edits to other fields and the body. It refuses to undo over a later status change or a replaced note. Undo is kept in memory and is lost when the plugin restarts.
- Russian and English interface translations, automatic app-language detection with English fallback, and a separate configurable TMDB metadata locale. Book edition language is preserved from its source. Titles, existing reviews and descriptions are not machine-translated.
- Live title search after two characters, with an optional movie year. Existing local cards appear before remote results.
- Books use Chitai-Gorod first, Open Library as fallback, and Google Books only with a key. Movie sources include kinopoiskapiunofficial.tech (own API key), TMDB and keyless Wikidata. Choose a provider in settings or override it in Add / Scan dialogs. Provider failures are shown while available providers continue. Successful searches have a bounded five-minute cache.
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

The queue searches one note at a time as you review it; it does not launch a burst of requests for the whole folder. Edit the query and click Find matches, select a result, inspect the proposed empty fields and click Fill empty fields, or Skip. Wikidata supplies structured film metadata and a short entity description, not a full synopsis; linked Wikipedia articles supply images when available, with matching Wikidata identity checked before use; only recognized film classes are offered. Open Library searches the title phrase first and falls back to a broader query, prioritizes the metadata language, and accepts edition references even when the nested edition response is absent. It supplies specific editions, which may omit recent or local titles. Existing metadata is kept, except recognized template placeholders (Название книги, Автор, YYYY) and external cover URLs replaced with local attachments. Filled authors are preserved; authors are taken only from author links and JSON-LD, never inferred from descriptions. Text, file names, personal ratings, dates, statuses, tags and highlights are unchanged. The default provider preference is synchronized in plugin settings; API credentials are device-local, so Automatic can choose different providers on different devices.

Each accepted update keeps the original text in memory and atomically fills empty frontmatter fields. A changed note is rejected instead of applying a stale preview. Undo last metadata update restores the last accepted file in the current session only if it has not been edited since. Undo is unavailable after restarting or after subsequent edits. The review queue is session-local; closing it stops progression and a new scan starts a new queue. Search results are not written unless you accept a preview.

## TaskNotes integration

TaskNotes is optional and must already be installed and enabled with Runtime API v1, tasks.read and tasks.write capabilities. The integration uses TaskNotes' documented in-process API; no HTTP server, API token or companion plugin installation is needed. Unsupported versions show a message; the catalog remains usable. The runtime API is documented at https://tasknotes.dev/obsidian/javascript-api/.

In Cards or Kanban click Add to task. From an ordinary movie/book note, including one opened from native Table, run Add the open media note to TaskNotes. The dialog offers a task title, an optional scheduled date, existing linked tasks and a search of existing tasks. Create task uses TaskNotes' own creation service, folder, templates, default status and priority. The task body contains a link to the movie/book note. Attach an existing task adds that link to its body without replacing existing text, frontmatter or personal settings.

The media note stores a media_catalog_tasks list of ordinary wiki links and shows buttons to open them. Obsidian's link resolver is used to find renamed tasks when the vault updates its links. A task already linked through this property or a full-path source link in its body is reused instead of duplicated. Select Create a separate task or session to intentionally create another reading/viewing session. Completing a session does not automatically complete the book or film; the integration subscribes to no task-status automation.

Start now explicitly starts TaskNotes time tracking and opens the task. Stop timer explicitly stops that task's timer. Starting an already active task is a no-op; if another task timer is running, stop it in TaskNotes first. Timer actions are hidden when the required time.read / time.write APIs are unavailable. The integration does not set task or media statuses to guessed values.

Before linking, original contents of all files that will change are kept in memory. Two-file updates check for stale contents and roll back the first change if the second fails; a concurrent edit is never overwritten during rollback. Undo last task link restores the last association's changed files only if none have been edited since. For a newly created task, undo restores the media note's added backlink and keeps the task, including its original source link. It never deletes tasks. Timer start/stop validates the task note without creating backup files. If task creation succeeds but its backlink cannot be saved, the task is opened with a notice; reattaching recovers it without creating a duplicate.

The media plugin sends task operations only to TaskNotes inside Obsidian; task text is not sent to metadata providers. TaskNotes remains responsible for its own configured calendar or other integrations. Existing user properties, personal ratings, reading/viewing statuses and note bodies are retained except for explicitly added links. If media_catalog_tasks already contains an incompatible manual value, linking refuses to replace it. Automatic undo lasts for the current plugin session; no backup notes are created. Runtime integration tests use an API test double; real desktop/mobile TaskNotes behavior still needs checking on devices.

## Installation and update

This is a development pre-release, not yet listed in the Obsidian Community directory. Download the runtime files or the install ZIP from the repository's GitHub Releases. Close plugin dialogs, disable the old plugin, back up the three runtime files, and replace main.js, manifest.json and styles.css in the existing ksandr-media-picker plugin folder with the release files. Enable the plugin again. The ID is unchanged from 0.1.x, so local API credentials remain available. A restart may be needed. Roll back by restoring the old three files. The update itself does not migrate or modify notes, catalogs or plugin credentials.

## Accounts, network and privacy

Movie search uses your own kinopoiskapiunofficial.tech key, optional TMDB token, or Wikidata without a key. Chitai-Gorod and Open Library book searches do not require an account. Google Books is optional and requires your own API key. No payments to this plugin are required. External providers have their own terms and limits.

Search sends title/author queries, year, ISBN and selected source IDs to selected providers at www.wikidata.org, openlibrary.org, api.themoviedb.org and www.googleapis.com. Credentials are sent only to their provider. Poster and book-cover URLs can load images from image.tmdb.org, covers.openlibrary.org, Google image services and provider-supplied HTTPS image hosts. Remote images displayed through Bases use the host application's image loading behavior.

Personal ratings, reviews, reading status and highlight text are not transmitted. No telemetry, advertising, external filesystem access, self-update or third-party plugin installation is included. Catalog path settings use the standard plugin data store. Credentials use device-local browser storage rather than vault files, must be entered separately on desktop and mobile, and are not encrypted against other plugins with access to the application's JavaScript environment.

This product uses the TMDB API but is not endorsed or certified by TMDB. Movie metadata and images are supplied by TMDB. Each imported card links to its provider. Public release still requires adding an approved TMDB logo to the credits interface and checking the provider's attribution requirements.

## Data preservation and limits

Adding a duplicate opens the existing card. Existing Base files are never overwritten. Creating a missing catalog only creates a new Base file and missing folders. A status change is an explicit user action, backed up before FileManager.processFrontMatter updates that field. Reviews, highlights, custom properties and other personal fields are retained. Folder scanning fills only empty metadata fields after explicit selection and preview. Kindle clipping import is not included in the plugin yet; the separate server tool remains responsible for that workflow.

Unit tests use a DOM/API test double, including browser-like native timer receiver checks. Desktop and mobile native Base rendering and real authenticated provider calls must be checked in Obsidian before submission. A development package is not evidence of acceptance by the community directory.

## Development

Requires Node.js and the yaml development dependency. Install dependencies, run `npm test`, then `npm run build`. Runtime uses only Obsidian's API; no runtime packages or bundler are needed. Source is in src/main.js, generated main.js belongs in the release assets. Tests contain synthetic fixtures and no personal vault data.

See PUBLISHING.md for the current submission steps and pending checks. The code is licensed under MIT; provider content and marks remain subject to their respective terms.

### 0.5.1 fixes

Scan and TaskNotes dialogs manage their own loaded Components because Modal is not a Component. Scanning remains skippable during network requests and ignores generic template titles when constructing queries. Empty queues show a folder/type explanation. Tests model the actual Modal API without inherited Component methods. Keyless movie imports request the linked Wikipedia image when available; an unavailable image does not block metadata. Existing filled cover fields are preserved.

## Core changes in 0.6.0

Book scanning tries valid ISBNs, then title with author, then title alone. Wiki-link authors are cleaned for search. Template placeholders are treated as empty metadata. Open Library authors can come from the work when absent from the edition. Chitai-Gorod search, detail and cover requests use Obsidian requestUrl with at least 1050 ms between requests; no new dependencies are installed. Its HTML can change; failures fall back to Open Library in Automatic mode.

New cards use tags кино / книга and Russian statuses: хочу посмотреть / смотрю / просмотрено / на паузе / брошено for films, хочу прочитать / читаю / прочитано / на паузе / брошено for books. UI language does not change stored statuses. Existing cards are not migrated automatically.

Cover downloads happen only when saving. They are saved under the configured movie or book folder, in its Обложки subfolder (by default Areas/Личное/Кино/Обложки/ or Areas/Личное/Книги/Обложки/) and cover stores a quoted wiki link. Bases views with image: note.cover support this attachment format. Chitai-Gorod images request 304×438 first, then smaller sizes if needed; accepted files are limited to 150 KiB. Image signatures determine the saved extension, including AVIF when the image server returns it for a .jpg URL. Cover failures do not block saving metadata: new cards get an empty cover; scans preserve the previous cover value. A warning invites the user to retry. No new remote cover URL is stored as a fallback. Existing local cover links are preserved. Undo restores the card; it keeps downloaded attachments. Old Media catalog backups files are not deleted automatically.

Enter the Kinopoisk key in plugin settings on each device, just like TMDB. It stays in device-local storage, not data.json. Server live checks use KINOPOISK_API_KEY. Updating the plugin replaces main.js, manifest.json and styles.css; preserve data.json.

Live source checks: node scripts/check-live.cjs and node scripts/check-live-films.cjs (the latter uses Kinopoisk when KINOPOISK_API_KEY is set, otherwise Wikidata). They read the acceptance cards and save evidence only under ignored checks/. They do not prove desktop/mobile Obsidian rendering; final acceptance is performed on the Mac.

## Personal ratings and reviews in 0.7.0

Use **Rate** from the command palette with an open film/book note (desktop or mobile), or the **Rate** button on a catalog card or Kanban item. Choose an integer from 1 to 10 or Not rated, enter a single-line review, and save. The plugin updates only `rating` and `review` through `FileManager.processFrontMatter`; stale personal edits are rejected. Both fields appear on catalog cards and remain protected during metadata filling. New Base templates include My review in every view with My rating; existing bases are left for their owner to update.

The installation archive is `ksandr-media-picker-0.7.0.zip` and contains only `ksandr-media-picker/` with `main.js`, `manifest.json`, and `styles.css`. `INSTALL-0.7.0.md` is distributed separately beside it. Keep the installed `data.json` when replacing the three plugin files.
