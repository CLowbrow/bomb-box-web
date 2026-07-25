# Bomb Box playable web test surface

This repository builds a deliberately low-fi, playable browser host for the
puzzle game's C++ rules engine. The finished output is a dependency-free static
site, including the generated WebAssembly module, under `dist/`.

The game title is temporary. Technical names intentionally follow the
title-independent `game_rules` naming used by the engine submodule.

## Requirements

- Node.js 20 or newer
- CMake 3.25 or newer
- Ninja
- Emscripten available through `emcmake`
- the `bomb-box-state` Git submodule initialized

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

No package install is required: the root project has no runtime or development
dependencies. The build intentionally performs no bundling or minification. It
configures the submodule's `wasm-debug` preset, builds `game_rules_wasm`, and
copies the module alongside the files in `site/`.

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
terminal exit, exact rewind, and branching after rewind. The board renders
stacked entities, elevation, bidirectional ramps at their half-step center
heights, and all current fixture types.

Arrow keys, WASD, and the on-screen controls submit authoritative moves;
Backspace, Z, and the Rewind button use the engine's resolved-state history.
Restart reloads the authored level and clears history. The last-turn feed shows
the semantic events and derived ticks returned by the engine rather than
reconstructing rules state in the browser.
