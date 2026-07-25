import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const outputRoot = new URL("../dist/", import.meta.url);

test("static build contains the browser host and WebAssembly artifacts", async () => {
  const expectedFiles = [
    "index.html",
    "styles.css",
    "app.js",
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
  const app = await readFile(new URL("app.js", outputRoot), "utf8");

  assert.match(html, /href="\.\/styles\.css"/);
  assert.match(html, /src="\.\/app\.js"/);
  assert.match(app, /import\("\.\/wasm\/game_rules\.mjs"\)/);
  assert.match(app, /fetch\("\.\/levels\/hardening-run\.json"\)/);
  assert.doesNotMatch(html, /(?:href|src)="\//);
});

test("site renders the engine's expanded board state", async () => {
  const html = await readFile(new URL("index.html", outputRoot), "utf8");
  const app = await readFile(new URL("app.js", outputRoot), "utf8");

  assert.match(html, /Ramp \(downhill\)/);
  assert.match(app, /cell\.lowDirection/);
  assert.match(app, /groupByCoordinate\(state\.entities\)/);
  assert.match(app, /state\.activeSwitchColors/);
  assert.match(app, /state\.openDoorCoordinates/);
  assert.match(app, /state\.armedBarrelIds/);
  assert.match(app, /cell\.lowElevation/);
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
  const app = await readFile(new URL("app.js", outputRoot), "utf8");

  assert.match(html, /id="rewind"/);
  assert.match(html, /id="restart"/);
  assert.match(html, /→ ↑ → → → → ↑ → → → ↑ ↑ →/);
  assert.match(app, /engine\.rewind\(\)/);
  assert.match(app, /engine\.loadLevel\(level\)/);
  assert.match(app, /result\.ticks\.flatMap/);
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
