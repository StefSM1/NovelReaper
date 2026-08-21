# NovelReaper

NovelReaper is a calm, local-first EPUB reader for Windows. Development currently uses a
browser preview so the shared reading experience can be built and tested before Electron
packaging resumes.

## Browser preview

Requirements: Node.js 22.12 or newer and npm.

```powershell
npm install
npm run web
```

Open <http://127.0.0.1:5173>. Browser Phase B1 can select and validate a local EPUB file.
EPUB parsing, the table of contents, and chapter rendering arrive in Phase B2.

The selected `File` remains in the active browser tab only. NovelReaper stores only bounded
display metadata in browser storage, so the book must be selected again after a refresh.

## Checks

```powershell
npm run lint
npm run typecheck
npm run test
npm run web:test
npm run web:build
```

Electron remains the Windows shipping target. Its packaging path is intentionally parked while
the browser phases establish the core reader, state model, and approved warm-editorial UI.
