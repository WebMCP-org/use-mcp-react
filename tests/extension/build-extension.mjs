import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const outDir = resolve("dist/e2e-extension");
const sourceDir = resolve("tests/extension/extension");

mkdirSync(outDir, { recursive: true });
cpSync(resolve(sourceDir, "manifest.json"), resolve(outDir, "manifest.json"));
cpSync(resolve(sourceDir, "client.html"), resolve(outDir, "client.html"));

await build({
  bundle: true,
  entryPoints: [resolve(sourceDir, "client.tsx")],
  format: "esm",
  jsx: "automatic",
  outfile: resolve(outDir, "client.mjs"),
  platform: "browser",
  sourcemap: "inline",
  target: "es2022",
});

await build({
  bundle: true,
  entryPoints: [resolve(sourceDir, "background.ts")],
  format: "esm",
  outfile: resolve(outDir, "background.mjs"),
  platform: "browser",
  sourcemap: "inline",
  target: "es2022",
});
