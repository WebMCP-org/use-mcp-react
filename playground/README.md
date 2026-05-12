# use-mcp-react playground

Run locally:

```bash
vp run playground
```

The playground is a single-screen live demo of the library's actual pitch: paste any Streamable HTTP MCP URL and watch the hook **infer the auth scheme and recommend the input UI** you should render to your user. Tool invocation is not demoed — that's `@modelcontextprotocol/sdk`'s job.

## What the demo shows

1. **URL bar + preset pills.** Paste a URL or pick a preset.
2. **Discovery timeline.** Each phase of the hook's probing lights up as it happens: endpoint reach → no-auth probe → resource metadata → authorization server → registration strategy.
3. **Inference verdict, "Render this" UI, and the React code branch.** Three equal-weight cards. The middle card is a live, working input form — clicking the OAuth button or submitting the bearer/client-id form actually drives the connection.
4. **Proof of life.** Once `mcp.status === "ready"`, the server identity, capabilities, and catalog counts/listings appear. No invocation UI.

## Bundled presets

Remote presets use the app-owned transport proxy at `/api/mcp-proxy` for MCP transport requests.
OAuth discovery, DCR, token exchange, and token refresh still run directly in the browser.

| Preset               | URL                                | Expected verdict                                                                      |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| DeepWiki             | `https://mcp.deepwiki.com/mcp`     | `authRequirement = null` through `/api/mcp-proxy`                                     |
| Linear               | `https://mcp.linear.app/mcp`       | `type: "oauth"`, DCR = true through `/api/mcp-proxy`                                  |
| Firecrawl            | `https://mcp.firecrawl.dev/v2/mcp` | `type: "bearer"` through `/api/mcp-proxy`                                             |
| Recraft              | `https://mcp.recraft.ai/mcp`       | `type: "oauth"` through `/api/mcp-proxy`                                              |
| Stripe               | `https://mcp.stripe.com`           | `type: "oauth"` through `/api/mcp-proxy`                                              |
| Gmail MCP (template) | `http://localhost:3000/mcp`        | Auto-detects first, then `type: "manual_oauth_client"` if registration is unavailable |

The OAuth callback handler is mounted at `/oauth/callback`.

## Override disclosure

The collapsed "Override detected auth (advanced)" section forces a specific `authMode` (Auto / Bearer / Manual OAuth client id) — useful for testing against a server whose metadata you already know, or for supplying a bearer token up front so the hook skips OAuth discovery.

The remote presets use transport proxy mode. The browser still owns OAuth; the local dev proxy only forwards MCP transport `POST` requests to the target in `x-mcp-target-url`.

The playground proxy is upstream-agnostic and dynamic. It accepts public `https:` MCP targets, blocks local/private targets, requires stateless JSON-RPC `POST` bodies, and forwards only MCP-relevant headers.

The proxy route is app-owned configuration, not end-user input. The playground passes `/api/mcp-proxy` for public HTTPS MCP URLs and leaves local or non-HTTPS development URLs direct.

## Sources

- DeepWiki MCP: https://mcp.deepwiki.com/mcp
- Official MCP example remote server: https://github.com/modelcontextprotocol/example-remote-server
- Linear MCP: https://linear.app/docs/mcp
- Recraft MCP: https://www.recraft.ai/docs/mcp-reference/remote-server
- Stripe MCP: https://docs.stripe.com/mcp
- Firecrawl MCP: https://docs.firecrawl.dev/mcp
- Google OAuth web apps: https://developers.google.com/identity/protocols/oauth2/web-server
- Gmail scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
