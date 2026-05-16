# use-mcp-react playground

Run locally:

```bash
vp run playground
```

The playground is a single-screen live demo of the library's actual pitch: paste any Streamable HTTP MCP URL and watch the hook **infer the auth scheme and recommend the input UI** you should render to your user. Once connected, the playground also turns advertised tool input schemas into callable forms.

## What the demo shows

1. **URL bar + preset pills.** Paste a URL or pick a preset.
2. **Transport proxy toggle.** Compare the proxy server route with direct browser transport. Turning it off is useful for demonstrating CORS failures on servers such as Stripe.
3. **Client ID Metadata Document toggle.** Publish or withhold `/.well-known/oauth-client-metadata.json` so you can compare CIMD with the server's default registration path.
4. **Discovery timeline.** Each phase of the hook's probing lights up as it happens: endpoint reach → no-auth probe → resource metadata → authorization server → registration strategy.
5. **Inference verdict, "Render this" UI, and the React code branch.** Three equal-weight cards. The middle card is a live, working input form — clicking the OAuth button or submitting the bearer/client-id form actually drives the connection.
6. **Proof of life + tool calls.** Once `mcp.status === "ready"`, the server identity, capabilities, catalog counts/listings, and a schema-driven tool call form appear.
7. **MCP Apps rendering.** If a connected server advertises tool UI resources through MCP Apps metadata, the playground renders the upstream `ui://` resource with `McpAppView`.

## Bundled presets

Remote presets use the app-owned transport proxy at `/api/mcp-proxy` for MCP transport requests.
OAuth discovery, DCR, token exchange, and token refresh still run directly in the browser.

The deployed playground ships that proxy server route next to the React SPA. This is the pattern to copy when a server's MCP transport endpoint does not expose browser CORS. Stripe is the clearest preset: OAuth still happens in the browser, but Stripe's MCP transport POSTs go through `/api/mcp-proxy`.

The playground also serves a Client ID Metadata Document at `/.well-known/oauth-client-metadata.json`. The document includes `client_id` equal to that full metadata URL, which authorization servers require when they validate URL-based client ids. Turn the CIMD toggle on to pass that URL as `oauth.clientMetadataUrl`, so authorization servers that advertise Client ID Metadata Document support can use the document URL as the public OAuth client id instead of dynamic registration. Turn it off to compare the fallback registration behavior.

| Preset               | URL                                | Expected verdict                                                                      |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| Excalidraw           | `https://mcp.excalidraw.com`       | `authRequirement = null`; advertises `create_view` as an MCP Apps UI resource         |
| Postman              | `https://mcp.postman.com/code`     | `type: "oauth"` through `/api/mcp-proxy`; supports OAuth metadata, DCR, and PKCE      |
| DeepWiki             | `https://mcp.deepwiki.com/mcp`     | `authRequirement = null` through `/api/mcp-proxy`                                     |
| Linear               | `https://mcp.linear.app/mcp`       | `type: "oauth"` through `/api/mcp-proxy`; toggle CIMD on to use the metadata document |
| Firecrawl            | `https://mcp.firecrawl.dev/v2/mcp` | `type: "bearer"` through `/api/mcp-proxy`                                             |
| Stripe               | `https://mcp.stripe.com`           | `type: "oauth"` through `/api/mcp-proxy`                                              |
| Gmail MCP (template) | `http://localhost:3000/mcp`        | Auto-detects first, then `type: "manual_oauth_client"` if registration is unavailable |

The OAuth callback handler is mounted at `/oauth/callback`.

## Override disclosure

The collapsed "Override detected auth (advanced)" section forces a specific `authMode` (Auto / Bearer / Manual OAuth client id) — useful for testing against a server whose metadata you already know, or for supplying a bearer token up front so the hook skips OAuth discovery.

The remote presets use transport proxy mode. The browser still owns OAuth; the local dev proxy forwards requests to the target in `x-mcp-target-url`.

The playground proxy is upstream-agnostic and dynamic. The UI only enables it for public `https:` MCP targets, and the Worker is otherwise a pass-through demo route.

The proxy route is app-owned configuration, not end-user input. The playground passes `/api/mcp-proxy` for public HTTPS MCP URLs and leaves local or non-HTTPS development URLs direct.

## Proxy implementation

- Worker source: [`playground/worker/index.ts`](https://github.com/WebMCP-org/use-mcp-react/blob/main/playground/worker/index.ts)
- Vite/Cloudflare setup: [`playground/vite.config.ts`](https://github.com/WebMCP-org/use-mcp-react/blob/main/playground/vite.config.ts)
- Wrangler config: [`playground/wrangler.jsonc`](https://github.com/WebMCP-org/use-mcp-react/blob/main/playground/wrangler.jsonc)
- Proxy setup docs: [`docs/reference/transport-proxy-mode.md`](https://github.com/WebMCP-org/use-mcp-react/blob/main/docs/reference/transport-proxy-mode.md)
- Client ID Metadata Document: `/.well-known/oauth-client-metadata.json`

Run the same shape locally with `vp run playground`; deploy it with `vp run use-mcp-react-playground#deploy`.

## Sources

- DeepWiki MCP: https://mcp.deepwiki.com/mcp
- Excalidraw MCP App: https://mcpapp-store.com/apps/excalidraw-mcp
- Postman MCP: https://learning.postman.com/docs/developer/postman-api/postman-mcp-server/postman-mcp-remote-server/
- Official MCP example remote server: https://github.com/modelcontextprotocol/example-remote-server
- Linear MCP: https://linear.app/docs/mcp
- Stripe MCP: https://docs.stripe.com/mcp
- Firecrawl MCP: https://docs.firecrawl.dev/mcp
- Google OAuth web apps: https://developers.google.com/identity/protocols/oauth2/web-server
- Gmail scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
