import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: "inherit",
    ...options,
  });
}

const packOutput = execFileSync("npm", ["pack", "--json", "--ignore-scripts"], {
  encoding: "utf8",
});
const [{ filename }] = JSON.parse(packOutput);
const tempDir = mkdtempSync(join(tmpdir(), "use-mcp-react-consumer-"));
const tarballPath = join(tempDir, "package.tgz");

copyFileSync(filename, tarballPath);
unlinkSync(filename);
run("npm", ["init", "-y"], { cwd: tempDir });
run(
  "npm",
  [
    "install",
    "--ignore-scripts",
    "./package.tgz",
    "react@19",
    "@types/react@19",
    "@modelcontextprotocol/sdk@1",
  ],
  {
    cwd: tempDir,
  },
);
run(
  "node",
  [
    "--input-type=module",
    "-e",
    "import('use-mcp-react').then((m) => { if (typeof m.useMcp !== 'function') throw new Error('Missing useMcp export'); if (typeof m.McpOAuthCallback !== 'function') throw new Error('Missing McpOAuthCallback export'); if (typeof m.handleMcpOAuthCallback !== 'function') throw new Error('Missing handleMcpOAuthCallback export') })",
  ],
  { cwd: tempDir },
);

writeFileSync(
  join(tempDir, "index.ts"),
  [
    'import { useMcp, type UseMcpOptions, type UseMcpResult } from "use-mcp-react";',
    "",
    "const options: UseMcpOptions = { enabled: false, storage: false, url: null };",
    "const hook: (options: UseMcpOptions) => UseMcpResult = useMcp;",
    "console.log(Boolean(options) && Boolean(hook));",
    "",
  ].join("\n"),
);
run("npm", ["install", "--ignore-scripts", "--save-dev", "typescript@6"], { cwd: tempDir });
run(
  "npx",
  [
    "tsc",
    "--module",
    "nodenext",
    "--moduleResolution",
    "nodenext",
    "--target",
    "es2022",
    "--strict",
    "--noEmit",
    "index.ts",
  ],
  { cwd: tempDir },
);

console.log(`Packed consumer verified in ${tempDir}.`);
