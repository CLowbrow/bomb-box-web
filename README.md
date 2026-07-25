# Bomb Box web host and level editor

This repository builds a deliberately low-fi, playable browser host and a separate precision level
editor for the puzzle game's C++ rules engine. The finished static output, including the generated
WebAssembly module, is written under `dist/`.

The game title is temporary. Technical names intentionally follow the
title-independent `game_rules` naming used by the engine submodule.

## Requirements

- Node.js 22.12 or newer
- CMake 3.25 or newer
- Ninja
- Emscripten available through `emcmake`
- the `bomb-box-state` Git submodule initialized

Install the locked web dependencies once:

```sh
npm ci
```

After cloning, initialize the submodule once:

```sh
git submodule update --init --recursive
```

## Build and run

Generate the complete static site:

```sh
npm run build
```

Serve the generated files locally at `http://localhost:4173`:

```sh
npm run serve
```

Or build and serve in one command:

```sh
npm start
```

Run the engine's complete WebAssembly contract corpus and verify the static output:

```sh
npm test
```

The build configures the submodule's `wasm-debug` preset, builds `game_rules_wasm`, then uses Vite
to produce the game and editor pages. The output remains ordinary static files with repository-path
safe relative asset URLs.

## Level editor

Open `http://localhost:4173/editor/` after building and serving. The editor supports complete
version 1 grids up to 64×64, flat and ramp terrain, exact entity half-step heights, stacks, every
entity and fixture type, colored doors and switches, multiple exits, cell-bundle copy/paste,
undo/redo, device-local autosave, JSON import/export, and authoritative WebAssembly validation.

Playtest is deliberately external to the editor: it stores the latest validated level in a
versioned same-origin handoff and opens the normal game page. See
[`docs/level-editor-development.md`](docs/level-editor-development.md) for the architecture and
interaction contract.

## GitHub Pages

The workflow in `.github/workflows/pages.yml` builds and publishes `dist/` on
every push to `main`, and can also be run manually. In the GitHub repository,
select **Settings → Pages → Build and deployment → Source: GitHub Actions** once.

If `bomb-box-state` is private, add a repository secret named
`SUBMODULE_TOKEN` containing a fine-grained token with read access to that
repository. Public submodules need no additional secret.

All browser asset paths are relative, so the output works both at a custom
domain and under a repository path such as `https://example.github.io/repo/`.

## Playable level

The page loads the real WebAssembly engine and expands the engine-hardening
rewind stress level into a thirteen-turn puzzle. Its route exercises pushing,
falling, barrel arming and chained explosions, a color switch and door, walking
on a box above a lowered floor, a second box push, two-step ramp traversal, a
terminal exit, exact rewind, and branching after rewind. The playable board uses
a fixed, screen-aligned orthographic Three.js view. It renders grey terrain as
solid, subtly segmented columns from a shared half-step baseline, with oriented
ramps, compressed-height stacks, simple player/box/barrel geometry,
all current fixture types, and an animated abstract water shader beneath the level. Horizontal cells use
one scene unit while each
logical entity or elevation level uses 0.65 scene units, preserving exact
half-step and stack relationships without making boxes look cubic.

Each accepted command still resolves atomically in the rules engine. The
browser presents the returned authoritative tick snapshots in order, animating
ID-matched movement, fixture changes, arming, and explosions for 500
milliseconds per tick before enabling player input again. Rewind is shown as
one equivalent transition, and reduced-motion preferences skip animation
timing.

Arrow keys, WASD, and the on-screen controls submit authoritative moves;
Backspace, Z, and the Rewind button use the engine's resolved-state history.
Restart reloads the authored level and clears history. The last-turn feed shows
the semantic events and derived ticks returned by the engine rather than
reconstructing rules state in the browser.
