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

## Planned EPUB engine

Foliate-js is not integrated during Browser Phase B1. Phase B2 will pin and audit commit
`78914aef4466eb960965702401634c2cb348e9b1` before any code is vendored or bundled.
Its upstream repository is <https://github.com/johnfactotum/foliate-js>.
