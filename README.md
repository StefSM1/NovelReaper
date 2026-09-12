# NovelReaper

NovelReaper is a calm, local-first EPUB reader. The responsive web version is the current
delivery target; Windows Electron packaging is paused.

## Browser preview

Requirements: Node.js 22.12 or newer and npm.

```powershell
npm install
npm run web
```

Open <http://127.0.0.1:5173>. The browser reader provides a local preview Library, parses EPUB 2/3
metadata and contents through the pinned Foliate adapter, and renders one reflowable chapter at a
time in continuous-scroll Strict mode. Contents, internal links, Previous, Next, and Finish all use
one serialized navigation path with explicit completion rules. Light/Dark themes, five offline
fonts, font size, line spacing, page width, Focus mode, fullscreen, and the virtualized Contents rail
are functional and persist where browser storage permits.

The selected `File` remains in the active browser tab only. NovelReaper stores only bounded
display metadata, reader preferences, and bounded reading progress in browser storage, so a book
must be selected again after browser file access expires. Reselecting the same name, size, and
modification time restores its saved chapter and logical locator; the original EPUB is never copied
into browser storage.
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

B6 approval, full real-device/security/performance checks, and the hosted-web completion track
remain open. Persistent EPUB storage, profiles, and cross-device synchronization are not yet
implemented; the current preview still requires file reselection after reload.
