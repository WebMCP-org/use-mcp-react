# Transport Proxy Mode

Transport proxy mode is for MCP servers whose OAuth and discovery endpoints work in the browser, but whose MCP transport endpoint does not expose CORS for ordinary page JavaScript.

The browser remains the OAuth client:

- Protected Resource Metadata discovery
- Authorization Server Metadata discovery
- Dynamic Client Registration
- PKCE state and verifier handling
- authorization redirect or popup
- token exchange and refresh
- token storage
- `Authorization: Bearer ...` on MCP requests

The proxy is app-owned plumbing. In the playground it forwards stateless MCP transport requests in the direction selected by the UI, while the browser still owns OAuth and all MCP client behavior.

The repository playground includes a concrete proxy server route implementation:

- Worker source: [`playground/worker/index.ts`](https://github.com/WebMCP-org/use-mcp-react/blob/main/playground/worker/index.ts)
- Cloudflare Vite config: [`playground/vite.config.ts`](https://github.com/WebMCP-org/use-mcp-react/blob/main/playground/vite.config.ts)
- Wrangler config: [`playground/wrangler.jsonc`](https://github.com/WebMCP-org/use-mcp-react/blob/main/playground/wrangler.jsonc)

That same Worker also serves the playground Client ID Metadata Document at `/.well-known/oauth-client-metadata.json`; it is separate from the transport proxy route.

```tsx
const mcp = useMcp({
  url: userEnteredMcpUrl,
  transportProxy: "https://proxy.example.com/mcp-proxy",
});
```

The proxy URL is app-owned configuration. It may be a same-origin route or an absolute cross-origin URL when that proxy exposes browser CORS for your app. End users should enter MCP server URLs, not proxy URLs.

`url` is still the logical upstream MCP URL. Do not replace it with the proxy URL. OAuth Resource Indicator validation and token audience checks need the real MCP protected resource, not your app's proxy route.

## Request Shape

The hook rewrites only requests whose URL exactly matches the logical MCP endpoint, ignoring the URL hash. OAuth metadata, registration, token, and refresh requests stay direct.

```txt
POST https://proxy.example.com/mcp-proxy
x-mcp-target-url: https://mcp.stripe.com
authorization: Bearer ...
content-type: application/json
accept: application/json, text/event-stream
mcp-protocol-version: 2025-11-25
```

The playground proxy forwards whatever request the hook sends to the configured target. In normal use that means MCP transport `POST`s, because the hook handles stateless proxy mode before an SSE `GET` reaches the Worker.

## Loose Demo Proxy

The playground Worker is intentionally small. It is not trying to teach a complete proxy security model; it gives browser apps a route when an MCP server does not expose browser CORS.

This is the shape:

```ts
export async function handleMcpProxy(request: Request): Promise<Response> {
  const target = request.headers.get("x-mcp-target-url");
  if (!target) {
    return new Response("Missing x-mcp-target-url", { status: 400 });
  }

  const upstreamUrl = new URL(target);
  const upstreamResponse = await fetch(upstreamUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });

  return new Response(upstreamResponse.body, upstreamResponse);
}
```

Some runtimes require `duplex: "half"` when forwarding a streaming request body. If your framework buffers request bodies, forward the buffered body instead.

## Tightening The Proxy

If this becomes production infrastructure, choose the policy you actually want instead of copying the demo route blindly:

- Whitelist the MCP servers your app supports.
- Or run the MCP TypeScript SDK server-side and validate requests and responses as MCP traffic before forwarding.
- Or keep a dynamic proxy, but add the normal controls for your runtime: target policy, DNS/private-network checks, redirect policy, request and response size limits, timeout handling, and logging that never records bearer tokens.

The hook already omits browser cookies when it sends requests to the proxy. A production proxy should also avoid forwarding any headers that are not needed by MCP transport.

Although the browser owns OAuth, the proxy still sees bearer tokens in transit. Treat it as trusted infrastructure.

## Not Gateway Mode

Transport proxy mode is not backend gateway mode. A gateway owns OAuth tokens, policy, audit logs, approvals, tenant controls, or rate limits. `use-mcp-react` does not implement that model.
