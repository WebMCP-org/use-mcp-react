import { isBlockedMcpHostname, playgroundMcpProxyPath } from "../src/mcpProxyPolicy.ts";

const clientMetadataDocumentPath = "/.well-known/oauth-client-metadata.json";

export default {
  async fetch(request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === clientMetadataDocumentPath) {
      return handleClientMetadataDocument(request, url);
    }

    if (url.pathname !== playgroundMcpProxyPath) {
      return new Response("Not found", { status: 404 });
    }

    return handleProxyRequest(request);
  },
} satisfies { fetch(request: Request): Promise<Response> };

function handleClientMetadataDocument(request: Request, url: URL): Response {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return textResponse(405, "Method not allowed");
  }

  const metadata = {
    client_id: `${url.origin}${clientMetadataDocumentPath}`,
    client_name: "use-mcp-react playground",
    client_uri: url.origin,
    grant_types: ["authorization_code", "refresh_token"],
    redirect_uris: [`${url.origin}/oauth/callback`],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
  const headers = new Headers({
    "cache-control": "public, max-age=300",
    "content-type": "application/json; charset=utf-8",
  });

  return new Response(request.method === "HEAD" ? null : JSON.stringify(metadata), { headers });
}

async function handleProxyRequest(request: Request): Promise<Response> {
  try {
    const target = normalizeProxyTarget(request.headers.get("x-mcp-target-url"));
    if (!target) {
      return textResponse(400, "Missing or invalid x-mcp-target-url");
    }

    const headers = new Headers(request.headers);
    headers.delete("x-mcp-target-url");
    const upstreamResponse = await fetch(target, {
      ...(request.method === "GET" || request.method === "HEAD" ? {} : { body: request.body }),
      headers,
      method: request.method,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });

    const response = new Response(upstreamResponse.body, upstreamResponse);
    response.headers.set("cache-control", "no-store");
    appendVaryHeader(response.headers, "x-mcp-target-url");

    return response;
  } catch (cause) {
    return textResponse(502, cause instanceof Error ? cause.message : "MCP proxy request failed");
  }
}

function normalizeProxyTarget(target: string | null): URL | null {
  if (!target) {
    return null;
  }

  try {
    const url = new URL(target);
    url.hash = "";
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      isBlockedMcpHostname(url.hostname)
    ) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

function textResponse(status: number, body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
    status,
  });
}

function appendVaryHeader(headers: Headers, value: string): void {
  const existing = headers.get("vary");
  if (!existing) {
    headers.set("vary", value);
    return;
  }

  if (existing === "*") {
    return;
  }

  const existingValues = existing.split(",").map((item) => item.trim().toLowerCase());
  if (!existingValues.includes(value.toLowerCase())) {
    headers.set("vary", `${existing}, ${value}`);
  }
}
