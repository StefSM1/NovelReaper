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

Open <http://127.0.0.1:5173>. Browser Phase B3 selects and validates a local EPUB, parses EPUB 2/3
metadata and contents through the pinned Foliate adapter, and renders one reflowable chapter at a
time in continuous-scroll Strict mode. Contents, internal links, Previous, Next, and Finish all use
one serialized navigation path with explicit completion rules.

The selected `File` remains in the active browser tab only. NovelReaper stores only bounded
display metadata and bounded reading progress in browser storage, so the book must be selected
again after a refresh. Reselecting the same name, size, and modification time restores its saved
chapter and logical locator; the original EPUB is never copied into browser storage.
EPUB scripts, event handlers, active embeds, and outbound book requests are disabled in this phase.
DRM and fixed-layout/comic EPUBs are outside the v1 scope.

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
