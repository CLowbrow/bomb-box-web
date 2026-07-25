import { access, cp, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const stateRoot = fileURLToPath(new URL("../bomb-box-state/", import.meta.url));
const siteRoot = fileURLToPath(new URL("../site/", import.meta.url));
const outputRoot = fileURLToPath(new URL("../dist/", import.meta.url));
const wasmBuildRoot = fileURLToPath(
  new URL("../bomb-box-state/out/build/wasm-debug/wasm/", import.meta.url),
);

async function requireFile(path, message) {
  try {
    await access(path);
  } catch {
    throw new Error(message);
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error?.code === "ENOENT") {
    throw new Error(`Required command not found: ${command}`);
  }
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

await requireFile(
  new URL("CMakePresets.json", `file://${stateRoot}`),
  "The bomb-box-state submodule is missing. Run: git submodule update --init --recursive",
);

run("emcmake", ["cmake", "--preset", "wasm-debug"], stateRoot);
run("cmake", ["--build", "--preset", "wasm-debug", "--target", "game_rules_wasm"], stateRoot);

await build({ configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)) });
await mkdir(new URL("wasm/", `file://${outputRoot}`), { recursive: true });
await cp(new URL("levels/", `file://${siteRoot}`), new URL("levels/", `file://${outputRoot}`), {
  recursive: true,
});

for (const artifact of ["game_rules.mjs", "game_rules.wasm"]) {
  const source = new URL(artifact, `file://${wasmBuildRoot}`);
  await requireFile(source, `Expected WebAssembly build artifact is missing: ${artifact}`);
  await cp(source, new URL(`wasm/${artifact}`, `file://${outputRoot}`));
}

console.log(`Static site generated in ${outputRoot}`);
