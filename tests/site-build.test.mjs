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
    "levels/walkway.json",
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
  assert.match(app, /fetch\("\.\/levels\/walkway\.json"\)/);
  assert.doesNotMatch(html, /(?:href|src)="\//);
});

test("site renders each ramp's downhill orientation", async () => {
  const html = await readFile(new URL("index.html", outputRoot), "utf8");
  const app = await readFile(new URL("app.js", outputRoot), "utf8");

  assert.match(html, /Ramp \(downhill\)/);
  assert.match(app, /cell\.lowDirection/);
  assert.match(app, /descending \$\{cell\.lowDirection\}/);
});

test("authored browser level matches the engine contract fixture", async () => {
  const builtLevel = JSON.parse(await readFile(new URL("levels/walkway.json", outputRoot), "utf8"));
  const contractPath = fileURLToPath(
    new URL("../bomb-box-state/tests/contracts/browser_vertical_slice/v1/level.json", import.meta.url),
  );
  const contractLevel = JSON.parse(await readFile(contractPath, "utf8"));

  assert.deepEqual(builtLevel, contractLevel);
});
