import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

await rm(new URL("dist/", `file://${projectRoot}`), { recursive: true, force: true });
