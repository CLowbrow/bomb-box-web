# Bomb Box

Bomb Box is a small turn-based puzzle game about pushing boxes, dropping explosive barrels, opening
color-coded doors, and finding the exit. This repository contains the browser game and its level
editor; the C++ rules engine lives in the `bomb-box-state` submodule and is compiled to WebAssembly.

The name is still temporary, so internal engine APIs use the title-independent `game_rules` name.

## Run it locally

You will need Node.js 22.12+, CMake 3.25+, Ninja, and Emscripten (`emcmake`). Then:

```sh
git submodule update --init --recursive
npm ci
npm start
```

Open <http://localhost:4173> to play or <http://localhost:4173/editor/> to create a level. The
editor validates levels with the same rules engine used by the game and can hand a valid draft
directly to the game for playtesting. Use the arrow keys or WASD to move, Backspace or Z to rewind,
and R to restart.

Useful commands:

- `npm run build` — build the WebAssembly engine and static site into `dist/`
- `npm run serve` — serve the existing `dist/` directory
- `npm run dev` — build the engine, then start Vite for web development
- `npm test` — build everything and run unit, engine-contract, and site tests
- `npm run clean` — remove generated build output

## How it fits together

The browser sends moves to the rules engine and renders the authoritative states it returns. Game
rules are not reimplemented in the UI. The editor follows the same boundary: it owns the authoring
experience, while the engine owns level decoding and validation.

- `site/app.js` and `site/game/` contain the playable host and Three.js presentation.
- `site/editor/` contains the Preact level editor.
- `site/levels/canned/` contains the levels shown in the game, ordered by filename.
- `bomb-box-state/` is the engine submodule and WebAssembly adapter.
- `tests/` covers browser behavior and the generated site.
- `docs/level-editor-development.md` describes the editor's data and interaction contracts.
- `scripts/` and `vite.config.ts` define the build; `dist/` is generated output.

To add a playable level, put a version 1 JSON file in `site/levels/canned/`. Its numeric prefix sets
its position in the picker and is omitted from the displayed name—for example,
`03-chain-reaction.json` becomes “Chain Reaction.”

## Deployment

`.github/workflows/pages.yml` builds and publishes `dist/` to GitHub Pages on pushes to `main` (or
when run manually). Configure Pages to use **GitHub Actions**. If the engine submodule is private,
add a `SUBMODULE_TOKEN` repository secret with read access to it.
