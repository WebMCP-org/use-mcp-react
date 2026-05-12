import { lookup } from "node:dns/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import {
  isBlockedMcpHostname,
  isBlockedMcpIpAddress,
  isMcpIpAddress,
  normalizeMcpHostname,
  playgroundMcpProxyPath,
} from "./src/mcpProxyPolicy.ts";

const maxRequestBodyBytes = 1024 * 1024;
const maxResponseBodyBytes = 8 * 1024 * 1024;

export default defineConfig({
  plugins: [react(), mcpTransportProxyPlugin()],
});

function mcpTransportProxyPlugin() {
  return {
    name: "use-mcp-react-playground-mcp-proxy",
    configureServer(server: {
      middlewares: {
        use: (
          handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void,
        ) => void;
      };
    }) {
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url ?? "/", "http://localhost").pathname;
        if (path !== playgroundMcpProxyPath) {
          next();
          return;
        }

        void handleProxyRequest(request, response);
      });
    },
  };
}

async function handleProxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const target = normalizeProxyTarget(singleHeaderValue(request.headers["x-mcp-target-url"]));
    if (!target) {
      sendText(response, 400, "Missing or invalid x-mcp-target-url");
      return;
    }

    if (target.protocol !== "https:") {
      sendText(response, 400, "Only https MCP targets are allowed");
      return;
    }

    const targetRejectionReason = await publicTargetRejectionReason(target);
    if (targetRejectionReason) {
      sendText(response, 403, targetRejectionReason);
      return;
    }

    if (request.method === "GET") {
      sendText(response, 405, "SSE is not enabled for this stateless playground proxy");
      return;
    }

    if (request.method !== "POST") {
      sendText(response, 405, "Method not allowed");
      return;
    }

    if (!singleHeaderValue(request.headers["content-type"])?.includes("application/json")) {
      sendText(response, 415, "Only JSON-RPC MCP requests are allowed");
      return;
    }

    const requestBody = await readRequestBody(request, maxRequestBodyBytes);
    const requestBodyError = validateMcpRequestBody(requestBody);
    if (requestBodyError) {
      sendText(response, 400, requestBodyError);
      return;
    }

    const upstreamHeaders = new Headers();
    copyIncomingHeader(request, upstreamHeaders, "authorization");
    copyIncomingHeader(request, upstreamHeaders, "accept");
    copyIncomingHeader(request, upstreamHeaders, "content-type");
    copyIncomingHeader(request, upstreamHeaders, "mcp-protocol-version");
    copyIncomingHeader(request, upstreamHeaders, "mcp-session-id");

    const upstreamResponse = await fetch(target, {
      body: requestBody.length > 0 ? new Uint8Array(requestBody) : undefined,
      headers: upstreamHeaders,
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    const responseBody = await readResponseBody(upstreamResponse, maxResponseBodyBytes);

    response.statusCode = upstreamResponse.status;
    response.statusMessage = upstreamResponse.statusText;
    copyResponseHeader(upstreamResponse.headers, response, "content-type");
    copyResponseHeader(upstreamResponse.headers, response, "www-authenticate");
    copyResponseHeader(upstreamResponse.headers, response, "mcp-session-id");
    copyResponseHeader(upstreamResponse.headers, response, "mcp-protocol-version");
    response.end(responseBody);
  } catch (cause) {
    if (cause instanceof ProxyRequestError) {
      sendText(response, cause.status, cause.message);
      return;
    }

    sendText(response, 502, cause instanceof Error ? cause.message : "MCP proxy request failed");
  }
}

function normalizeProxyTarget(target: string | undefined): URL | null {
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

async function publicTargetRejectionReason(target: URL): Promise<string | null> {
  const hostname = normalizeMcpHostname(target.hostname);

  if (isBlockedMcpHostname(hostname)) {
    return "Local and private MCP targets are not allowed";
  }

  if (isMcpIpAddress(hostname)) {
    return isBlockedMcpIpAddress(hostname) ? "Local and private MCP targets are not allowed" : null;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    return "MCP target hostname could not be resolved";
  }

  return addresses.some((address) => isBlockedMcpIpAddress(address.address))
    ? "Local and private MCP targets are not allowed"
    : null;
}

function singleHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function copyIncomingHeader(request: IncomingMessage, headers: Headers, name: string): void {
  const value = singleHeaderValue(request.headers[name]);
  if (value) {
    headers.set(name, value);
  }
}

function copyResponseHeader(headers: Headers, response: ServerResponse, name: string): void {
  const value = headers.get(name);
  if (value) {
    response.setHeader(name, value);
  }
}

function readRequestBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > maxBytes) {
        reject(new ProxyRequestError(413, "MCP proxy request body is too large"));
        request.destroy();
        return;
      }

      chunks.push(buffer);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function readResponseBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      return Buffer.concat(chunks);
    }

    const buffer = Buffer.from(value);
    size += buffer.byteLength;
    if (size > maxBytes) {
      throw new ProxyRequestError(502, "MCP proxy response body is too large");
    }

    chunks.push(buffer);
  }
}

function validateMcpRequestBody(body: Buffer): string | null {
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

function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
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

function sendText(response: ServerResponse, status: number, body: string): void {
  response.statusCode = status;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(body);
}
