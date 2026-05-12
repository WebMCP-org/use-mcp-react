import { execFileSync } from "node:child_process";

const allowedPaths = new Set([
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "PRIVACY.md",
  "README.md",
  "SECURITY.md",
  "SUPPORT.md",
  "dist/index.d.mts",
  "dist/index.mjs",
  "package.json",
]);

const forbiddenPatterns = [
  /(^|\/)\.env($|\.)/,
  /(^|\/)\.npmrc$/,
  /(^|\/)\.vitest-attachments\//,
  /(^|\/)\.playwright-mcp\//,
  /(^|\/)docs\/reference\/oauth-specs\//,
  /(^|\/)playground\//,
  /(^|\/)public\//,
  /(^|\/)src\//,
  /(^|\/)tests\//,
  /(^|\/).*\.map$/,
  /(^|\/).*\.pem$/,
  /(^|\/).*\.key$/,
];

const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  encoding: "utf8",
});
const [{ files }] = JSON.parse(output);
const paths = files.map((file) => file.path).sort();

const unexpected = paths.filter((path) => !allowedPaths.has(path));
const missing = [...allowedPaths].filter((path) => !paths.includes(path));
const forbidden = paths.filter((path) => forbiddenPatterns.some((pattern) => pattern.test(path)));

if (unexpected.length || missing.length || forbidden.length) {
  console.error("Packed package file list is not release-safe.");
  if (unexpected.length) {
    console.error("Unexpected files:", unexpected.join(", "));
  }
  if (missing.length) {
    console.error("Missing files:", missing.join(", "));
  }
  if (forbidden.length) {
    console.error("Forbidden files:", forbidden.join(", "));
  }
  process.exit(1);
}

console.log(`Packed package file list verified (${paths.length} files).`);
