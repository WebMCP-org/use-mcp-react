# Reference Material

This directory is for source lookup instructions and local spec snapshots that future agents can read without rediscovering context.

## Source Fetching

Use Vercel Labs `opensrc` as the default source fetcher. It is installed as a repo dev dependency, so run it through Vite+:

```bash
vp exec opensrc fetch <package-or-repo>
vp exec opensrc path <package-or-repo>
```

See `opensrc-sources.md` for the exact cache paths already fetched for this repo.

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

## Research Notes

- `oauth-mcp-msw-test-server.md` captures the research and recommended design for testing OAuth-protected MCP servers with MSW, the MCP TypeScript SDK, and Vitest Browser Mode.
- `react-hook-auth-triage.md` captures the proposed hook-only React API, auth inference order, runtime URL behavior, popup callback model, and auth requirement diagnosis.

## OAuth Specs

The OAuth/MCP specs are mirrored as HTML under `oauth-specs/` for offline lookup:

- MCP authorization 2025-11-25
- MCP authorization 2025-06-18
- RFC 7591 Dynamic Client Registration
- RFC 7636 PKCE
- RFC 8414 Authorization Server Metadata
- RFC 8707 Resource Indicators
- RFC 9728 Protected Resource Metadata
- OAuth 2.1 draft
- Client ID Metadata Document draft
