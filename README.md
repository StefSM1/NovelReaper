# NovelReaper

NovelReaper is a calm, local-first EPUB reader. The responsive web version is the current
delivery target; Windows Electron packaging is paused.

## Browser preview

Requirements: Node.js 22.12 or newer and npm.

```powershell
npm install
npm run web
```

Open <http://127.0.0.1:5173>. Keep using the same browser, hostname, and port: browser
storage belongs to that exact address. If you previously read at `localhost:5174`, keep
that address and run `npm run web -- --port 5174` to retain access to the old progress.
The server now fails clearly if its port is occupied instead of silently changing ports.

The browser reader provides a local Library, parses EPUB 2/3
metadata and contents through the pinned Foliate adapter, and renders one reflowable chapter at a
time in continuous-scroll Strict mode. Contents, internal links, Previous, Next, and Finish all use
one serialized navigation path with explicit completion rules. Light/Dark themes, five offline
fonts, font size, line spacing, page width, Focus mode, fullscreen, and the virtualized Contents rail
are functional and persist where browser storage permits.

## Local library and progress

Import a volume with **Open EPUB** once. NovelReaper saves a compressed EPUB copy and its
metadata in your browser's IndexedDB. Next time, click **Resume** in Library to restore the
last chapter and reading position without selecting the file again. Library cards show the last
read section. SHA-256 fingerprints identify the exact file even after renaming; another edition
is kept separate. Only the active chapter is rendered, not the entire novel.

Use **Rename** on a Library card to give a volume a custom name, then **Save** (or
**Cancel** to keep the old name). The name appears in Library and above Contents,
and survives reopening. This changes local metadata only: the original EPUB title,
file, and reading progress remain unchanged. Names can contain 1–300 characters.

Existing library cards need one file reselection to obtain a local copy. Existing progress is
restored when that file still matches its old name, size, and modification time; old saves are
retained. Preferences and progress remain local JSON records in `localStorage`. Removing a
saved book deletes its local copy/card, but keeps progress and never changes the original file.

There are no profiles, passwords, upload endpoints, sync service, or cloud storage. A storage
failure offers session-only reading with a warning instead of claiming the book was saved.
The library supports up to 100 books, with a 512 MiB input limit per file; actual capacity depends
on the browser's storage quota. Keep original EPUBs: clearing site data, private browsing, or
storage eviction may remove saved data. Another browser, address, or device has its own library.
Do not treat browser storage as a backup.

EPUB scripts, event handlers, and active embeds remain disabled. Strict blocks remote book
resources; Balanced permits passive HTTPS images, media, fonts, and styles. Trusted is a locked,
non-functional future option.
DRM and fixed-layout/comic EPUBs are outside the v1 scope.

## Checks

```powershell
npm run lint
npm run typecheck
npm run test
npm run web:test
npm run web:build
npm run web:test:e2e
```

The browser end-to-end tests build the production website and run against a temporary preview
on port 4177, which must be free. Playwright starts and stops that server; it never reuses a
personal development server. Install Playwright Chromium with `npx playwright install chromium`,
or use an installed Edge browser in PowerShell with
`$env:NOVELREAPER_TEST_BROWSER_CHANNEL = 'msedge'` before running the command.

## Later: phone use

After the local-PC workflow is approved, the same static reader can be hosted on Vercel
(`npm run web:build`, output `dist/browser-preview`). Import your copied EPUBs on the phone;
its library/progress will be independent. Your PC does not need to serve files or remain on.
Deploying to Vercel does not move localhost browser data to the hosted address. Do not deploy
your personal EPUBs. No deployment or automatic synchronization is implemented by this change.

The current app still needs the local static/dev server running to load or reload its interface.
Full offline startup needs an application-shell cache/service worker, which is deferred along
with broader B6 approval and real-device/security/performance checks. No desktop packaging is
required for this workflow.
