# Transport Proxy Mode

Transport proxy mode is for MCP servers whose transport or OAuth background HTTP endpoints do not expose browser CORS for ordinary page JavaScript.

The browser remains the OAuth client:

- Protected Resource Metadata discovery, via the proxy when configured
- Authorization Server Metadata discovery, via the proxy when configured
- Dynamic Client Registration, via the proxy when configured
- PKCE state and verifier handling
- authorization redirect or popup, always opened directly to the provider
- token exchange and refresh, via the proxy when configured
- token storage
- `Authorization: Bearer ...` on MCP requests

The proxy is app-owned plumbing. In the playground it forwards hook-owned MCP transport and OAuth HTTP requests in the direction selected by the UI, while the browser still owns OAuth state, tokens, PKCE, and MCP client behavior.

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

The hook rewrites hook-owned background HTTP to the configured proxy. `x-mcp-target-url` carries the real upstream URL, and diagnostics keep reporting the upstream metadata/token URL separately from the proxy URL.

```txt
POST https://proxy.example.com/mcp-proxy
x-mcp-target-url: https://mcp.stripe.com
authorization: Bearer ...
content-type: application/json
accept: application/json, text/event-stream
mcp-protocol-version: 2025-11-25
```

OAuth metadata discovery uses the same shape with the upstream metadata endpoint as the target:

```txt
GET https://proxy.example.com/mcp-proxy
x-mcp-target-url: https://mcp.airtable.com/.well-known/oauth-authorization-server
accept: application/json
```

Dynamic registration and token requests are also proxied when `transportProxy` is configured. The hook still handles stateless proxy mode before the optional MCP transport SSE `GET` reaches the Worker, so normal stateless MCP traffic is `POST`/`DELETE` plus OAuth `GET`/`POST` requests.

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
  const headers = new Headers(request.headers);
  headers.delete("x-mcp-target-url");

  const upstreamResponse = await fetch(upstreamUrl, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });

  return new Response(upstreamResponse.body, upstreamResponse);
}
```

Some runtimes require `duplex: "half"` when forwarding a streaming request body. If your framework buffers request bodies, forward the buffered body instead.

## Tightening The Proxy

If this becomes production infrastructure, choose the policy you actually want instead of copying the demo route blindly:

- Require `https:` target URLs in production.
- Reject credentials embedded in target URLs.
- Reject loopback, private, link-local, multicast, and other non-public IP ranges after DNS resolution when your runtime exposes that information.
- Forward common MCP and OAuth methods: `GET`, `POST`, `DELETE`, `OPTIONS`, and `HEAD`.
- Forward request bodies unchanged.
- Forward only headers needed by MCP and OAuth, such as `accept`, `authorization`, `content-type`, `last-event-id`, `mcp-protocol-version`, `mcp-session-id`, and OAuth endpoint-specific headers.
- Expose response headers the browser needs, including `www-authenticate`, `mcp-session-id`, `mcp-protocol-version`, and `location` if you ever follow redirects manually.
- Add redirect policy, request and response size limits, timeout handling, and logging that never records bearer tokens.

Provider allowlists are optional product policy, not a protocol requirement. A dynamic MCP proxy should be blocklist-oriented enough to support arbitrary public HTTPS MCP providers.

The hook already omits browser cookies when it sends requests to the proxy. A production proxy should also avoid forwarding any headers that are not needed by MCP or OAuth.

Although the browser owns OAuth, the proxy still sees bearer tokens in transit. Treat it as trusted infrastructure.

## Not Gateway Mode

Transport proxy mode is not backend gateway mode. A gateway owns OAuth tokens, policy, audit logs, approvals, tenant controls, or rate limits. `use-mcp-react` does not implement that model.
