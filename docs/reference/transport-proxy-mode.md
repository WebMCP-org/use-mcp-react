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

The proxy only forwards stateless MCP transport requests to public HTTPS upstream targets that pass its MCP target policy. A dynamic proxy does not need an exact list of MCP servers ahead of time; it applies that policy to each browser request.

```tsx
const mcp = useMcp({
  url: userEnteredMcpUrl,
  transportProxy: "/api/mcp-proxy",
});
```

The proxy URL is app-owned configuration. End users should enter MCP server URLs, not proxy URLs.

`url` is still the logical upstream MCP URL. Do not replace it with the proxy URL. OAuth Resource Indicator validation and token audience checks need the real MCP protected resource, not your app's proxy route.

## Request Shape

The hook rewrites only requests whose URL exactly matches the logical MCP endpoint, ignoring the URL hash. OAuth metadata, registration, token, and refresh requests stay direct.

```txt
POST /api/mcp-proxy
x-mcp-target-url: https://mcp.stripe.com
authorization: Bearer ...
content-type: application/json
accept: application/json, text/event-stream
mcp-protocol-version: 2025-11-25
```

For a stateless proxy, support `POST` and return `405 Method Not Allowed` for `GET` unless you intentionally support SSE streaming.

## Backend Recipe

This is framework-neutral Fetch API style pseudocode. The helper functions are part of the proxy contract, not optional polish: production code should implement size-limited body reads, DNS/private-network checks, redirect validation, and response limits in the concrete runtime it uses.

```ts
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export async function handleMcpProxy(request: Request): Promise<Response> {
  const target = request.headers.get("x-mcp-target-url");
  if (!target) {
    return new Response("Missing x-mcp-target-url", { status: 400 });
  }

  const upstreamUrl = new URL(target);
  if (upstreamUrl.protocol !== "https:") {
    return new Response("Only https targets are allowed", { status: 400 });
  }

  if (!(await isPublicTarget(upstreamUrl))) {
    return new Response("Local and private targets are not allowed", { status: 403 });
  }

  if (request.method === "GET") {
    return new Response("SSE not enabled for this proxy", { status: 405 });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!request.headers.get("content-type")?.includes("application/json")) {
    return new Response("Only JSON-RPC MCP requests are allowed", { status: 415 });
  }

  const body = await readTextWithLimit(request, MAX_REQUEST_BYTES);
  if (!isMcpJsonRpcBody(body)) {
    return new Response("Request is not MCP JSON-RPC", { status: 400 });
  }

  const upstreamHeaders = new Headers();
  copyHeader(request.headers, upstreamHeaders, "authorization");
  copyHeader(request.headers, upstreamHeaders, "accept");
  copyHeader(request.headers, upstreamHeaders, "content-type");
  copyHeader(request.headers, upstreamHeaders, "mcp-protocol-version");
  copyHeader(request.headers, upstreamHeaders, "mcp-session-id");

  const upstreamResponse = await fetch(upstreamUrl, {
    method: "POST",
    headers: upstreamHeaders,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const responseBody = await readBodyWithLimit(upstreamResponse, MAX_RESPONSE_BYTES);

  const responseHeaders = new Headers();
  copyHeader(upstreamResponse.headers, responseHeaders, "content-type");
  copyHeader(upstreamResponse.headers, responseHeaders, "www-authenticate");
  copyHeader(upstreamResponse.headers, responseHeaders, "mcp-session-id");
  copyHeader(upstreamResponse.headers, responseHeaders, "mcp-protocol-version");

  return new Response(responseBody, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders,
  });
}

async function isPublicTarget(url: URL): Promise<boolean> {
  // Resolve DNS and reject localhost, private IP ranges, link-local ranges,
  // and cloud metadata addresses. Validate every redirect target if you
  // choose to follow redirects. In production, avoid DNS rebinding by pinning
  // the validated resolution into the outbound connection or by using a
  // network egress layer that enforces the same private-network block.
  return url.protocol === "https:" && !isLocalOrPrivateHost(url.hostname);
}

async function readTextWithLimit(request: Request, maxBytes: number): Promise<string> {
  // Read the request stream while counting bytes. Return 413 when maxBytes is exceeded.
  throw new Error("Implement request body size limit for your runtime.");
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
  // Read or stream the upstream response while counting bytes. Abort when maxBytes is exceeded.
  throw new Error("Implement response body size limit for your runtime.");
}

function isMcpJsonRpcBody(body: string): boolean {
  try {
    const parsed = JSON.parse(body);
    const messages = Array.isArray(parsed) ? parsed : [parsed];

    return messages.length > 0 && messages.every((message) => {
      if (!message || message.jsonrpc !== "2.0") return false;
      if (typeof message.method !== "string") return false;

      return (
        message.method === "initialize" ||
        message.method === "ping" ||
        message.method.startsWith("tools/") ||
        message.method.startsWith("resources/") ||
        message.method.startsWith("prompts/") ||
        message.method.startsWith("completion/") ||
        message.method.startsWith("logging/") ||
        message.method.startsWith("notifications/")
      );
    });
  } catch {
    return false;
  }
}

function copyHeader(from: Headers, to: Headers, name: string): void {
  const value = from.get(name);
  if (value) {
    to.set(name, value);
  }
}
```

Some runtimes require `duplex: "half"` when forwarding a streaming request body. If your framework buffers request bodies, forward the buffered body instead.

## Security Checklist

- Do not implement raw arbitrary forwarding. Require public HTTPS MCP targets and MCP-shaped JSON-RPC bodies.
- Only allow `https:` upstream targets in production.
- Resolve DNS and block localhost, private, link-local, and metadata IP ranges.
- Disable redirects or validate every redirect target before following it.
- Cap request body size.
- Cap response size or stream with limits.
- Set an upstream timeout.
- Do not forward browser cookies upstream.
- Do not log `Authorization`.
- Strip hop-by-hop headers such as `connection`, `transfer-encoding`, and stale `content-length`.
- Log target host, method, status, duration, and request id.

Although the browser owns OAuth, the proxy still sees bearer tokens in transit. Treat it as trusted infrastructure.

## Not Gateway Mode

Transport proxy mode is not backend gateway mode. A gateway owns OAuth tokens, policy, audit logs, approvals, tenant controls, or rate limits. `use-mcp-react` does not implement that model.
