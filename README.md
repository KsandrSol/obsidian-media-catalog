# Movie and book catalog

A local movie and book library for Obsidian using the built-in Bases plugin. Open the library, switch between movies and books, and use Add above the embedded catalog to search by title and choose a specific movie or book edition. Cards are ordinary Markdown notes and catalogs are ordinary Base files, usable without this plugin.

## Version 0.2.0

- One library tab with movies, books and an Add button above native Bases.
- Live title search after two characters, with an optional movie year. Existing local cards appear before remote results.
- TMDB movie lookup, Open Library book editions and optional Google Books.
- Configurable note folders and Base paths. Create a missing catalog explicitly from the library; existing catalog files are never replaced.
- Duplicate detection by source IDs, movie IDs and validated ISBN-10/13. Ambiguous titles require confirmation for a different edition.
- A `media-catalog` Markdown code block adds the same catalog and button to any note.

Enable the built-in Bases plugin. Run the command Открыть кино и книги (Open movies and books), or use the library icon. The interface is currently in Russian. Configure the note folders and Base files in the plugin settings before adding items. Paths are relative to the vault; changing a path does not move existing data. The defaults retain the original Areas/Личное catalog layout and can be changed for any vault.

To embed movies in a note:

````markdown
```media-catalog
film
```
````

For books use `book` instead of `film`. The standard Base filters, views and sorting remain available in the embedded Base. Use Open Base file to edit the native catalog directly. The plugin does not patch the native Base toolbar.

## Installation and update

This is a development pre-release, not yet listed in the Obsidian Community directory. Download the runtime files or the install ZIP from the repository's GitHub Releases. Close plugin dialogs, disable the old plugin, back up the three runtime files, and replace main.js, manifest.json and styles.css in the existing ksandr-media-picker plugin folder with the release files. Enable the plugin again. The ID is unchanged from 0.1.x, so local API credentials remain available. A restart may be needed. Roll back by restoring the old three files. The update itself does not migrate or modify notes, catalogs or plugin credentials.

## Accounts, network and privacy

Movie search requires your own TMDB API Read Access Token. Open Library search does not require an account. Google Books is optional and requires your own API key. No payments to this plugin are required. External providers have their own terms and limits.

Search sends your query and selected source IDs to api.themoviedb.org, openlibrary.org and, when a Google key is configured, www.googleapis.com. Credentials are sent only to their provider. Poster and book-cover URLs can load images from image.tmdb.org, covers.openlibrary.org, Google image services and provider-supplied HTTPS image hosts. Remote images displayed through Bases use the host application's image loading behavior.

Personal ratings, reviews, reading status and highlight text are not transmitted. No telemetry, advertising, external filesystem access, self-update or third-party plugin installation is included. Catalog path settings use the standard plugin data store. Credentials use device-local browser storage rather than vault files, must be entered separately on desktop and mobile, and are not encrypted against other plugins with access to the application's JavaScript environment.

This product uses the TMDB API but is not endorsed or certified by TMDB. Movie metadata and images are supplied by TMDB. Each imported card links to its provider. Public release still requires adding an approved TMDB logo to the credits interface and checking the provider's attribution requirements.

## Data preservation and limits

Existing cards and Base files are never overwritten by this version. Adding a duplicate opens the existing card. Creating a missing catalog only creates a new Base file and missing folders. The plugin does not refresh metadata, edit personal fields, import Kindle clippings or perform rollback of note edits yet. The separate server catalog tool remains responsible for those workflows. Kindle and safe metadata refresh are planned for a later release.

Unit tests use a DOM/API test double, including browser-like native timer receiver checks. Desktop and mobile native Base rendering and real authenticated provider calls must be checked in Obsidian before submission. A development package is not evidence of acceptance by the community directory.

## Development

Requires Node.js and the yaml development dependency. Install dependencies, run `npm test`, then `npm run build`. Runtime uses only Obsidian's API; no runtime packages or bundler are needed. Source is in src/main.js, generated main.js belongs in the release assets. Tests contain synthetic fixtures and no personal vault data.

See PUBLISHING.md for the current submission steps and pending checks. The code is licensed under MIT; provider content and marks remain subject to their respective terms.
