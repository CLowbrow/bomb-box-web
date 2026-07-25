# Level editor development

## Product boundary

The level editor is a separate browser application at `editor/`. It authors version 1
`game-rules-level` documents but does not simulate or render gameplay. The rules engine remains the
authority for format and structural validation. Playtest writes a validated level to a versioned
same-origin handoff record and opens the normal game page, whose renderer remains replaceable.

The editor is desktop- and tablet-first, supports boards up to 64 by 64, and edits one cell at a
time. A copied cell includes its terrain, fixture, and complete entity column. Version 1 has no
void terrain, so removing terrain resets a cell to flat elevation zero.

## Runtime architecture

- Preact renders declarative components. Components dispatch typed actions and never mutate the
  level directly.
- One reducer owns the current document, selected coordinate/entity, active tool, clipboard, and a
  bounded 100-entry undo/redo history. Immutable record updates provide structural sharing without
  a second state library.
- The authoring model is normalized for coordinate lookup. Serialization creates the engine's
  arrays in canonical spatial and stack order; entity identifiers remain decimal strings.
- A dedicated WebAssembly engine instance receives serialized snapshots after committed edits.
  Its `loadLevel` response supplies authoritative issues. The editor never replaces authored
  heights with the stabilized state returned by a successful load.
- Browser storage is intentionally a device-local recovery mechanism. It is not a hosted level
  library or authoritative persistence service.

## Storage and handoff contracts

`game-rules-editor:draft:v1` stores a `DraftEnvelopeV1` containing `envelopeVersion: 1`, display
name, saved timestamp, and the authored level. Valid and invalid drafts are recoverable; history is
not persisted.

`game-rules:playtest:v1` stores a `PlaytestEnvelopeV1` containing `envelopeVersion: 1`, display
name, saved timestamp, and an engine-accepted level. The editor then opens the main page with
`?levelSource=editor`. A renderer only depends on the level-source adapter, so replacing the
current DOM board with three.js does not couple gameplay to editor code.

## Interaction rules

- Grid arrow keys move the roving selection in screen space. Enter or Space applies the active
  tool. Delete removes the selected entity, otherwise the fixture, otherwise resets terrain.
- Player placement relocates the first existing player and preserves its ID. Box and barrel tools
  allocate the smallest unused positive uint64 ID and place at the current stack top.
- The inspector exposes exact flat elevation, ramp low direction/elevation, fixture color, entity
  type, decimal ID, and signed `bottomHalfSteps`. Invalid intermediate values remain editable.
- Cell paste replaces the destination terrain, fixture, and entity column. Boxes and barrels get
  fresh IDs; a copied player relocates the existing player. Absolute entity heights are preserved.
- Each tool use, paste, delete, resize, or committed inspector field is one undo step. Text inputs
  commit on change/blur rather than recording each keystroke.

## Validation and file workflow

UI-created documents always have the version 1 JSON shape. Cross-entry rules—including complete
coverage, ramp endpoints, stack overlap, player count, fixture placement, and exit occupancy—come
from `loadLevel`. Issues are attached to coordinates when the response supplies one. Playtest,
download, and copy-JSON remain disabled until the engine accepts the draft.

Raw imports go through the engine decoder before replacing the document. Syntax/shape failures are
reported and preserve the current draft. Shape-correct `invalid_level` documents may be opened for
repair. Export uses two-space UTF-8 JSON, deterministic arrays, and one trailing newline; editor
metadata is excluded.

## Build and verification

`npm run build` builds the WebAssembly engine, then Vite's game and editor HTML entries, and copies
the generated module and authored sample levels into `dist/`. `npm test` additionally runs editor
unit/component tests, the cross-adapter WebAssembly contract corpus, and static-site integration
tests. GitHub Pages CI installs the locked dependencies under Node 22 before verification.

Implementation milestones are: typed foundation and build; authoring workspace; validation,
persistence, and files; external playtest handoff and responsive/accessibility hardening. Each
milestone must keep the full suite passing.
