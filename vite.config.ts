import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import { playwright } from "vite-plus/test/browser-playwright";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { Plugin } from "vite-plus";
import { isBlockedMcpHostname, playgroundMcpProxyPath } from "./playground/src/mcpProxyPolicy.ts";

const ignoredGeneratedAndReferenceFiles = [
  ".agents/**",
  "dist/**",
  "docs/reference/**",
  "node_modules/**",
  "playground/.wrangler/**",
  "playground/dist/**",
  "playground/worker-configuration.d.ts",
];

export default defineConfig({
  plugins: [react(), playgroundMcpTransportProxyPlugin()],
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    dts: {
      tsgo: true,
    },
    entry: ["src/index.ts", "src/apps.ts"],
    exports: true,
  },
  lint: {
    ignorePatterns: ignoredGeneratedAndReferenceFiles,
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: ignoredGeneratedAndReferenceFiles,
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["docs/reference/**", "node_modules/**", "dist/**"],
    fileParallelism: false,
    setupFiles: ["./tests/browser/setup.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
  },
  optimizeDeps: {
    include: [
      "@modelcontextprotocol/ext-apps/app-bridge",
      "@modelcontextprotocol/sdk/client/auth.js",
      "@modelcontextprotocol/sdk/client/index.js",
      "@modelcontextprotocol/sdk/client/streamableHttp.js",
      "@modelcontextprotocol/sdk/server/mcp.js",
      "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js",
      "@modelcontextprotocol/sdk/types.js",
      "react-dom/client",
    ],
  },
});

function playgroundMcpTransportProxyPlugin(): Plugin {
  return {
    name: "playground-mcp-transport-proxy",
    configureServer(server) {
      server.middlewares.use(playgroundMcpProxyPath, async (request, response) => {
        await proxyMcpTransportRequest(request, response);
      });
    },
  };
}

async function proxyMcpTransportRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const targetUrl = readProxyTargetUrl(request);
  if (!targetUrl) {
    response.writeHead(400, { "content-type": "text/plain" });
    response.end("Invalid x-mcp-target-url");
    return;
  }

  try {
    const body = await readProxyRequestBody(request);
    const upstreamResponse = await fetch(targetUrl, {
      ...(body ? { body: bufferToArrayBuffer(body) } : {}),
      headers: createProxyRequestHeaders(request),
      method: request.method,
    });

    response.statusCode = upstreamResponse.status;
    upstreamResponse.headers.forEach((value, key) => {
      if (!isHopByHopHeader(key)) {
        response.setHeader(key, value);
      }
    });

    if (!upstreamResponse.body) {
      response.end();
      return;
    }

    Readable.fromWeb(upstreamResponse.body as unknown as NodeReadableStream<Uint8Array>).pipe(
      response,
    );
  } catch (cause) {
    response.writeHead(502, { "content-type": "text/plain" });
    response.end(cause instanceof Error ? cause.message : String(cause));
  }
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function readProxyTargetUrl(request: IncomingMessage): URL | null {
  const value = request.headers["x-mcp-target-url"];
  if (Array.isArray(value) || !value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || isBlockedMcpHostname(url.hostname)) {
      return null;
    }

    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function createProxyRequestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    const normalizedName = name.toLowerCase();
    if (
      isHopByHopHeader(name) ||
      normalizedName === "cookie" ||
      normalizedName === "host" ||
      normalizedName === "x-mcp-target-url"
    ) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
      continue;
    }
    if (value !== undefined) {
      headers.set(name, value);
    }
  }

  return headers;
}

async function readProxyRequestBody(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks);
}

function isHopByHopHeader(name: string): boolean {
  return (
    name.toLowerCase() === "connection" ||
    name.toLowerCase() === "keep-alive" ||
    name.toLowerCase() === "proxy-authenticate" ||
    name.toLowerCase() === "proxy-authorization" ||
    name.toLowerCase() === "te" ||
    name.toLowerCase() === "trailer" ||
    name.toLowerCase() === "transfer-encoding" ||
    name.toLowerCase() === "upgrade"
  );
}
