---
name: opensrc
description: Fetch dependency source code to give AI agents deeper implementation context. Use when the agent needs to understand how a library works internally, read source code for a package, fetch implementation details for a dependency, or explore how an npm/PyPI/crates.io package is built.
allowed-tools: Bash(vp exec opensrc:*)
---

# Source Code Fetching with opensrc

Use the repo-local `opensrc` dev dependency through Vite+:

```bash
vp exec opensrc fetch <package-or-repo>
vp exec opensrc path <package-or-repo>
rg "pattern" "$(vp exec opensrc path <package-or-repo>)"
```

Prefer `fetch` when setting up context and `path` when reading or searching source.

Examples:

```bash
vp exec opensrc fetch @modelcontextprotocol/sdk @ai-sdk/mcp
vp exec opensrc fetch github:modelcontextprotocol/use-mcp github:modelcontextprotocol/inspector
rg "client_id_metadata_document_supported" "$(vp exec opensrc path @modelcontextprotocol/sdk)"
```

Cached source lives under `~/.opensrc/`. Do not vendor whole upstream repos into this project. If a file is copied into `docs/reference/prior-art/`, treat it as a curated snapshot and record the authoritative `opensrc` source path in `docs/reference/opensrc-sources.md`.
