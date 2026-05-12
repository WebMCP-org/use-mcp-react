# opensrc

Use Vercel Labs `opensrc` whenever dependency or OSS reference implementation source is needed. Do not clone repos by hand for source lookup.

```bash
vp exec opensrc fetch @modelcontextprotocol/sdk
vp exec opensrc path @modelcontextprotocol/sdk
vp exec opensrc path github:modelcontextprotocol/use-mcp
```

`opensrc path` prints the local cache directory. Search from that command output instead of committing machine-specific cache paths.
