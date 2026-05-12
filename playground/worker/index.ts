import {
  isBlockedMcpHostname,
  isBlockedMcpIpAddress,
  isMcpIpAddress,
  normalizeMcpHostname,
  playgroundMcpProxyPath,
} from "../src/mcpProxyPolicy.ts";

const maxRequestBodyBytes = 1024 * 1024;
const maxResponseBodyBytes = 8 * 1024 * 1024;
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

    if (target.protocol !== "https:") {
      return textResponse(400, "Only https MCP targets are allowed");
    }

    const targetRejectionReason = publicTargetRejectionReason(target);
    if (targetRejectionReason) {
      return textResponse(403, targetRejectionReason);
    }

    if (request.method === "GET") {
      return textResponse(405, "SSE is not enabled for this stateless playground proxy");
    }

    if (request.method !== "POST") {
      return textResponse(405, "Method not allowed");
    }

    if (!request.headers.get("content-type")?.includes("application/json")) {
      return textResponse(415, "Only JSON-RPC MCP requests are allowed");
    }

    const requestBody = await readRequestBody(request, maxRequestBodyBytes);
    const requestBodyError = validateMcpRequestBody(requestBody);
    if (requestBodyError) {
      return textResponse(400, requestBodyError);
    }

    const upstreamResponse = await fetch(target, {
      body: requestBody.byteLength > 0 ? requestBody : undefined,
      headers: createUpstreamHeaders(request.headers),
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });

    return createProxyResponse(upstreamResponse);
  } catch (cause) {
    if (cause instanceof ProxyRequestError) {
      return textResponse(cause.status, cause.message);
    }

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

    return url;
  } catch {
    return null;
  }
}

function publicTargetRejectionReason(target: URL): string | null {
  const hostname = normalizeMcpHostname(target.hostname);

  if (isBlockedMcpHostname(hostname)) {
    return "Local and private MCP targets are not allowed";
  }

  if (isMcpIpAddress(hostname) && isBlockedMcpIpAddress(hostname)) {
    return "Local and private MCP targets are not allowed";
  }

  return null;
}

function createUpstreamHeaders(requestHeaders: Headers): Headers {
  const headers = new Headers();
  copyHeader(requestHeaders, headers, "authorization");
  copyHeader(requestHeaders, headers, "accept");
  copyHeader(requestHeaders, headers, "content-type");
  copyHeader(requestHeaders, headers, "mcp-protocol-version");
  copyHeader(requestHeaders, headers, "mcp-session-id");

  return headers;
}

function copyHeader(from: Headers, to: Headers, name: string): void {
  const value = from.get(name);
  if (value) {
    to.set(name, value);
  }
}

async function readRequestBody(request: Request, maxBytes: number): Promise<ArrayBuffer> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new ProxyRequestError(413, "MCP proxy request body is too large");
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > maxBytes) {
    throw new ProxyRequestError(413, "MCP proxy request body is too large");
  }

  return body;
}

async function createProxyResponse(upstreamResponse: Response): Promise<Response> {
  const responseHeaders = new Headers();
  copyHeader(upstreamResponse.headers, responseHeaders, "content-type");
  copyHeader(upstreamResponse.headers, responseHeaders, "www-authenticate");
  copyHeader(upstreamResponse.headers, responseHeaders, "mcp-session-id");
  copyHeader(upstreamResponse.headers, responseHeaders, "mcp-protocol-version");

  if (!upstreamResponse.body) {
    return new Response(null, {
      headers: responseHeaders,
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
    });
  }

  const responseBody = await readResponseBody(upstreamResponse, maxResponseBodyBytes);

  return new Response(responseBody, {
    headers: responseHeaders,
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
  });
}

async function readResponseBody(response: Response, maxBytes: number): Promise<ArrayBuffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new ProxyRequestError(502, "MCP proxy response body is too large");
  }

  const body = await response.arrayBuffer();
  if (body.byteLength > maxBytes) {
    throw new ProxyRequestError(502, "MCP proxy response body is too large");
  }

  return body;
}

function validateMcpRequestBody(body: ArrayBuffer): string | null {
  const parsed = parseJson(body);
  if (parsed === undefined) {
    return "MCP proxy request body must be valid JSON";
  }

  const messages = Array.isArray(parsed) ? parsed : [parsed];
  if (messages.length === 0) {
    return "JSON-RPC batch must not be empty";
  }

  for (const message of messages) {
    const messageError = validateMcpMessage(message);
    if (messageError) {
      return messageError;
    }
  }

  return null;
}

function parseJson(body: ArrayBuffer): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    return undefined;
  }
}

function validateMcpMessage(message: unknown): string | null {
  if (!isRecord(message)) {
    return "MCP proxy request body must contain JSON-RPC objects";
  }

  if (message.jsonrpc !== "2.0") {
    return "MCP proxy request body must use JSON-RPC 2.0";
  }

  if ("method" in message) {
    return typeof message.method === "string" && isAllowedMcpMethod(message.method)
      ? null
      : "MCP proxy request body contains an unsupported method";
  }

  if ("id" in message && ("result" in message || "error" in message)) {
    return null;
  }

  return "MCP proxy request body must contain an MCP method";
}

function isAllowedMcpMethod(method: string): boolean {
  return (
    method === "initialize" ||
    method === "ping" ||
    method.startsWith("tools/") ||
    method.startsWith("resources/") ||
    method.startsWith("prompts/") ||
    method.startsWith("completion/") ||
    method.startsWith("logging/") ||
    method.startsWith("notifications/")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class ProxyRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function textResponse(status: number, body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
    status,
  });
}
