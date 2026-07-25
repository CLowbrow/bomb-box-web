import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: "site",
  base: "./",
  publicDir: false,
  plugins: [
    preact(),
    {
      name: "serve-generated-game-rules-wasm",
      configureServer(server) {
        const wasmRoot = resolve(import.meta.dirname, "bomb-box-state/out/build/wasm-debug/wasm");
        server.middlewares.use("/wasm/", async (request, response, next) => {
          const filename = basename(new URL(request.url ?? "", "http://localhost").pathname);
          if (filename !== "game_rules.mjs" && filename !== "game_rules.wasm") {
            next();
            return;
          }
          try {
            const path = resolve(wasmRoot, filename);
            const metadata = await stat(path);
            response.writeHead(200, {
              "Content-Type": filename.endsWith(".wasm") ? "application/wasm" : "text/javascript; charset=utf-8",
              "Content-Length": metadata.size,
            });
            createReadStream(path).pipe(response);
          } catch {
            next();
          }
        });
      },
    },
  ],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: {
        game: resolve(import.meta.dirname, "site/index.html"),
        editor: resolve(import.meta.dirname, "site/editor/index.html"),
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["../tests/**/*.test.ts", "../tests/**/*.test.tsx"],
    restoreMocks: true,
  },
});
