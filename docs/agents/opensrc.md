# opensrc

Use Vercel Labs `opensrc` whenever future work needs dependency or OSS reference implementation source. Do not start by cloning repos by hand.

The command pattern is:

```bash
vp exec opensrc fetch @modelcontextprotocol/sdk
vp exec opensrc path @modelcontextprotocol/sdk
vp exec opensrc path github:modelcontextprotocol/use-mcp
```

`opensrc path` prints the cached source directory. Search or copy from that path, and record the source path in `docs/reference/README.md` when adding snapshots.

The upstream opensrc skill is cached at:

`/Users/alexmnahas/.opensrc/repos/github.com/vercel-labs/opensrc/main/skills/opensrc/SKILL.md`

This repo also has a local skill wrapper at `.agents/skills/opensrc/SKILL.md`.
