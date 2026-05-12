# opensrc Sources

These sources were fetched with the repo-local `opensrc` dependency:

```bash
vp exec opensrc fetch \
  @modelcontextprotocol/sdk \
  @ai-sdk/mcp \
  vitest-browser-react \
  msw \
  @vitest/browser \
  github:modelcontextprotocol/use-mcp \
  github:modelcontextprotocol/inspector \
  github:vercel/ai \
  github:wevm/wagmi \
  github:TanStack/query \
  github:vercel/swr \
  github:pmndrs/zustand \
  github:vercel-labs/opensrc
```

Resolve authoritative cache paths with `vp exec opensrc path <package-or-repo>`. The exact directories are machine-local and should not be committed as absolute paths.

- `@modelcontextprotocol/sdk@1.29.0`
- `@ai-sdk/mcp@1.0.41`
- `vitest-browser-react@2.2.0`
- `msw@2.14.5`
- `@vitest/browser@4.1.5`
- `github:modelcontextprotocol/use-mcp`
- `github:modelcontextprotocol/inspector`
- `github:vercel/ai`
- `github:wevm/wagmi`
- `github:TanStack/query`
- `github:vercel/swr`
- `github:pmndrs/zustand`
- `github:vercel-labs/opensrc`

Use `opensrc` cache paths for full-source reading. The old `docs/reference/prior-art/` snapshot directory was intentionally removed.
