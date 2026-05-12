# Reference Material

This directory is for source lookup instructions and durable notes that future agents can read without rediscovering context.

## Source Fetching

Use Vercel Labs `opensrc` as the default source fetcher. It is installed as a repo dev dependency, so run it through Vite+:

```bash
vp exec opensrc fetch <package-or-repo>
vp exec opensrc path <package-or-repo>
```

See `opensrc-sources.md` for the source packages and repositories this project commonly inspects.

## Prior Art Source

Read these via `opensrc` before implementing the library:

```bash
sed -n '1,260p' "$(vp exec opensrc path @modelcontextprotocol/sdk)/src/client/auth.ts"
sed -n '1,260p' "$(vp exec opensrc path @modelcontextprotocol/sdk)/src/client/streamableHttp.ts"
sed -n '1,220p' "$(vp exec opensrc path @modelcontextprotocol/sdk)/src/shared/auth.ts"
sed -n '1,260p' "$(vp exec opensrc path github:modelcontextprotocol/use-mcp)/src/auth/browser-provider.ts"
sed -n '1,220p' "$(vp exec opensrc path github:modelcontextprotocol/use-mcp)/src/auth/callback.ts"
sed -n '1,260p' "$(vp exec opensrc path github:modelcontextprotocol/use-mcp)/src/react/useMcp.ts"
sed -n '1,260p' "$(vp exec opensrc path github:modelcontextprotocol/inspector)/client/src/lib/auth.ts"
sed -n '1,260p' "$(vp exec opensrc path github:modelcontextprotocol/inspector)/client/src/lib/oauth-state-machine.ts"
sed -n '1,260p' "$(vp exec opensrc path @ai-sdk/mcp)/src/tool/oauth.ts"
sed -n '1,260p' "$(vp exec opensrc path @ai-sdk/mcp)/src/tool/mcp-client.ts"
```

The `docs/reference/prior-art/` source snapshot directory was intentionally removed. `opensrc` cache paths are the source of truth.

## Durable Notes

- `oauth-mcp-msw-test-server.md` captures the recommended design for testing OAuth-protected MCP servers with MSW, the MCP TypeScript SDK, and Vitest Browser Mode.
- `transport-proxy-mode.md` documents the app-owned transport proxy model.
- `sdk-resource-metadata-url-loss.md` documents the SDK diagnostic workaround kept in `src/index.ts`.
