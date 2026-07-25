import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const outputRoot = new URL("../dist/", import.meta.url);

test("static build contains the browser host and WebAssembly artifacts", async () => {
  const expectedFiles = [
    "index.html",
    "editor/index.html",
    "levels/hardening-run.json",
    "wasm/game_rules.mjs",
    "wasm/game_rules.wasm",
  ];

  for (const file of expectedFiles) {
    const metadata = await stat(new URL(file, outputRoot));
    assert.equal(metadata.isFile(), true, `${file} should be a file`);
    assert.ok(metadata.size > 0, `${file} should not be empty`);
  }
});

test("site uses repository-path-safe relative asset URLs", async () => {
  const html = await readFile(new URL("index.html", outputRoot), "utf8");
  const editorHtml = await readFile(new URL("editor/index.html", outputRoot), "utf8");

  assert.match(html, /src="\.\/assets\/game-/);
  assert.match(editorHtml, /src="\.\.\/assets\/editor-/);
  assert.doesNotMatch(`${html}\n${editorHtml}`, /(?:href|src)="\//);
});

test("site renders the engine's expanded board state through Three.js", async () => {
  const html = await readFile(new URL("index.html", outputRoot), "utf8");
  const app = await builtAsset("game-", ".js");
  const editor = await builtAsset("editor-", ".js");
  const threeView = await readFile(new URL("../site/game/three-view.js", import.meta.url), "utf8");

  assert.match(html, /Ramp \(bidirectional\)/);
  assert.match(html, /role="img" aria-label="Loading three-dimensional game board"/);
  assert.match(app, /WebGLRenderer/);
  assert.match(threeView, /new THREE\.PerspectiveCamera/);
  assert.doesNotMatch(threeView, /new THREE\.OrthographicCamera/);
  assert.match(app, /InstancedMesh/);
  assert.match(app, /levelHeight: 0\.65/);
  assert.match(app, /halfStep: 0\.325/);
  assert.match(app, /tick\.stateAfter/);
  assert.doesNotMatch(app, /role", "gridcell"/);
  assert.doesNotMatch(editor, /WebGLRenderer/);
});

test("expanded browser level preserves the engine hardening core", async () => {
  const builtLevel = JSON.parse(
    await readFile(new URL("levels/hardening-run.json", outputRoot), "utf8"),
  );
  const contractPath = fileURLToPath(
    new URL(
      "../bomb-box-state/tests/contracts/engine_hardening/v1/rewind-stress-level.json",
      import.meta.url,
    ),
  );
  const contractLevel = JSON.parse(await readFile(contractPath, "utf8"));

  assert.deepEqual(builtLevel.entities.slice(0, contractLevel.entities.length), contractLevel.entities);
  assert.deepEqual(builtLevel.fixtures.slice(0, 2), contractLevel.fixtures.slice(0, 2));
  assert.deepEqual(
    builtLevel.cells.filter(({ coordinate }) => coordinate.x <= 6 && coordinate.y <= 1),
    contractLevel.cells.filter(({ coordinate }) => coordinate.y <= 1),
  );
});

test("playable hardening surface includes recovery and a verified route", async () => {
  const html = await readFile(new URL("index.html", outputRoot), "utf8");
  const app = await builtAsset("game-", ".js");

  assert.match(html, /id="rewind"/);
  assert.match(html, /id="restart"/);
  assert.match(html, /→ ↑ → → → → ↑ → → → ↑ ↑ →/);
  assert.match(app, /engine\.rewind\(\)/);
  assert.match(app, /engine\.loadLevel\(level\)/);
  assert.match(app, /result\.ticks\.flatMap/);
  assert.match(app, /Resolving tick/);
  assert.match(app, /prefers-reduced-motion/);
});

test("level editor ships as a separate multi-page application", async () => {
  const html = await readFile(new URL("editor/index.html", outputRoot), "utf8");
  const app = await builtAsset("editor-", ".js");
  const gameHtml = await readFile(new URL("index.html", outputRoot), "utf8");

  assert.match(html, /<title>Level Editor<\/title>/);
  assert.match(gameHtml, /href="\.\/editor\/"/);
  assert.match(app, /Level Editor/);
  assert.match(app, /Copy cell/);
  assert.match(app, /Paste cell/);
  assert.match(app, /bottomHalfSteps/);
  assert.match(app, /game-rules-editor:draft:v1/);
  assert.match(app, /game-rules:playtest:v1/);
});

test("game bundle implements the versioned editor playtest source", async () => {
  const app = await builtAsset("game-", ".js");

  assert.match(app, /levelSource/);
  assert.match(app, /game-rules:playtest:v1/);
  assert.match(app, /No compatible editor playtest is available/);
  assert.match(app, /solutionElement\.hidden = true/);
  assert.match(app, /new URL\(`\.\/wasm\/\$\{file\}`, document\.baseURI\)/);
});

test("expanded route walks on a box, pushes a box, traverses the ramp, and wins", async () => {
  const level = JSON.parse(
    await readFile(new URL("levels/hardening-run.json", outputRoot), "utf8"),
  );
  const { default: createGameRulesModule } = await import(
    new URL("wasm/game_rules.mjs", outputRoot)
  );
  const module = await createGameRulesModule();
  const engine = module.gameRules.createEngine();

  try {
    const loaded = engine.loadLevel(level);
    assert.equal(loaded.status, "loaded");

    const route = [
      "east", "north", "east", "east", "east", "east", "north",
      "east", "east", "east", "north", "north", "east",
    ];
    const results = route.map((direction) => engine.move(direction));
    assert.equal(results.every((result) => result.accepted), true);

    const bridgeState = results[7].state.entities.filter(
      ({ coordinate }) => coordinate.x === 6 && coordinate.y === 2,
    );
    assert.deepEqual(
      bridgeState.map(({ id, bottomHalfSteps }) => ({ id, bottomHalfSteps })),
      [
        { id: "10", bottomHalfSteps: 2 },
        { id: "1", bottomHalfSteps: 4 },
      ],
    );

    const pushEvents = results[9].ticks.flatMap(({ events }) => events);
    assert.equal(pushEvents.some((event) =>
      event.type === "entityMoved"
        && event.entityId === "11"
        && event.cause === "player"
        && event.to.x === 9
        && event.to.y === 2), true);

    const rampEntry = results[10].state.entities.find(({ id }) => id === "1");
    assert.deepEqual(
      { coordinate: rampEntry.coordinate, bottomHalfSteps: rampEntry.bottomHalfSteps },
      { coordinate: { x: 8, y: 3 }, bottomHalfSteps: 5 },
    );
    const rampExit = results[11].state.entities.find(({ id }) => id === "1");
    assert.deepEqual(
      { coordinate: rampExit.coordinate, bottomHalfSteps: rampExit.bottomHalfSteps },
      { coordinate: { x: 8, y: 4 }, bottomHalfSteps: 6 },
    );

    assert.equal(results.at(-1).outcome, "won");
    assert.equal(engine.rewind().state.outcome, "ongoing");
  } finally {
    engine.destroy();
  }
});

async function builtAsset(prefix, suffix) {
  const names = await readdir(new URL("assets/", outputRoot));
  const name = names.find((entry) => entry.startsWith(prefix) && entry.endsWith(suffix));
  assert.ok(name, `expected an ${prefix}*${suffix} asset`);
  return readFile(new URL(`assets/${name}`, outputRoot), "utf8");
}
