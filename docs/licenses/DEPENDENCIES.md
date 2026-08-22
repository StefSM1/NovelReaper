# Dependency and font notices

NovelReaper v1 currently pins its Phase 0/1 dependencies in `package.json` and its
resolved dependency graph in `package-lock.json`.

## Electron and Electron Forge

- Electron 43.4.1 - MIT License.
- Electron Forge 7.11.2 packages - MIT License.
- `@electron/fuses` 1.8.0 - MIT License. This is the newest 1.x patch compatible
  with Electron Forge 7.11.2's declared peer range.

The supported Electron patch must be reviewed again before a public build because
it carries Chromium and Node.js security updates.

## React and validation

- React and React DOM 19.2.8 - MIT License.
- Zod 4.4.3 - MIT License.

## Browser preview tooling

- Vite 8.2.2 - MIT License.
- `@vitejs/plugin-react` 6.1.0 - MIT License.

These are development dependencies for the browser preview. Electron Forge remains NovelReaper's
planned Windows packager.

## Offline reading fonts

The following Fontsource packages are pinned at 5.3.0 and licensed under the SIL
Open Font License 1.1:

- Literata
- Lora
- Merriweather
- Source Serif 4
- Atkinson Hyperlegible

Fontsource package metadata and the installed package license files are the source
of the distribution notices. Only the weights actually imported by NovelReaper are
bundled into application assets.

## EPUB engine

- Foliate-js - MIT License, pinned to commit
  `78914aef4466eb960965702401634c2cb348e9b1` through the exact archive and integrity entry in
  `package-lock.json`.
- Foliate-js vendors zip.js for archive reading; its installed license notice is BSD-3-Clause.

The upstream project has no stable release and documents scripted EPUB content as unsupported and
unsafe in its same-origin blob iframe design. Browser Phase B2 uses Foliate's EPUB parser and
resource loader behind NovelReaper's reader contract, but renders sanitized chapters in a
project-owned `srcdoc` frame whose sandbox omits script permission entirely. It also blocks outbound
book resources. Upstream:
<https://github.com/johnfactotum/foliate-js>.
