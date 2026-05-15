import assert from "node:assert/strict";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";
import { Buffer } from "node:buffer";
import { chromium } from "playwright";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

const EXTENSION_DIR = resolve("dist/e2e-extension");
const USER_DATA_DIRS = [];

after(() => {
  for (const userDataDir of USER_DATA_DIRS) {
    rmSync(userDataDir, { recursive: true, force: true });
  }
});

describe("Chrome extension OAuth", () => {
  it("uses Chrome Identity redirect URLs with DCR and connects without OAuth configuration", async () => {
    let server;
    let context;
    let extensionId;
    const diagnostics = [];

    try {
      server = await startOAuthMcpServer();
      const launched = await launchExtensionContext();
      context = launched.context;
      extensionId = launched.extensionId;
      const page = await context.newPage();
      page.on("console", (message) =>
        diagnostics.push(`[console:${message.type()}] ${message.text()}`),
      );
      page.on("pageerror", (error) =>
        diagnostics.push(`[pageerror] ${error.stack ?? error.message}`),
      );
      await page.goto(
        `chrome-extension://${extensionId}/client.html?mcpUrl=${encodeURIComponent(server.mcpUrl)}`,
      );

      await page.waitForSelector("#status", { timeout: 20_000 });
      try {
        await page.waitForSelector('#status[data-status="pending_auth"]', { timeout: 20_000 });
      } catch (error) {
        const status = await page
          .locator("#status")
          .textContent()
          .catch(() => "");
        const hookError = await page
          .locator("#error")
          .textContent()
          .catch(() => "");
        const authorizationUrl = await page
          .locator("#authorization-url")
          .textContent()
          .catch(() => "");
        throw new Error(
          [
            error instanceof Error ? error.message : String(error),
            `status=${status}`,
            `error=${hookError}`,
            `authorizationUrl=${authorizationUrl}`,
            ...diagnostics,
          ].join("\n"),
        );
      }
      const authorizationUrl = await page.locator("#authorization-url").textContent();
      assert.ok(authorizationUrl);
      assert.equal(
        new URL(authorizationUrl).searchParams.get("redirect_uri"),
        `https://${extensionId}.chromiumapp.org/`,
      );

      await page.locator("#authorize").click();
      await page.waitForSelector('#status[data-status="ready"]', { timeout: 20_000 });

      assert.match((await page.locator("#tools").textContent()) ?? "", /whoami/u);
      assert.deepEqual(server.registeredRedirectUris, [`https://${extensionId}.chromiumapp.org/`]);
      assert.equal(server.tokenRequestCount, 1);
    } finally {
      await Promise.allSettled([context?.close(), server?.close()]);
    }
  });

  it("keeps the Chrome Identity redirect URI when client metadata tries to override it", async () => {
    let server;
    let context;

    try {
      server = await startOAuthMcpServer();
      const launched = await launchExtensionContext();
      context = launched.context;
      const page = await context.newPage();
      await page.goto(
        `chrome-extension://${launched.extensionId}/client.html?mcpUrl=${encodeURIComponent(
          server.mcpUrl,
        )}&metadataRedirectUri=${encodeURIComponent("https://example.invalid/callback")}`,
      );

      await page.waitForSelector('#status[data-status="pending_auth"]', { timeout: 20_000 });
      await page.locator("#authorize").click();
      await page.waitForSelector('#status[data-status="ready"]', { timeout: 20_000 });

      assert.deepEqual(server.registeredRedirectUris, [
        `https://${launched.extensionId}.chromiumapp.org/`,
      ]);
    } finally {
      await Promise.allSettled([context?.close(), server?.close()]);
    }
  });

  it("accepts Chrome Identity OAuth callback parameters in the fragment", async () => {
    let server;
    let context;

    try {
      server = await startOAuthMcpServer({ callbackParameters: "fragment" });
      const launched = await launchExtensionContext();
      context = launched.context;
      const page = await context.newPage();
      await page.goto(
        `chrome-extension://${launched.extensionId}/client.html?mcpUrl=${encodeURIComponent(server.mcpUrl)}`,
      );

      await page.waitForSelector('#status[data-status="pending_auth"]', { timeout: 20_000 });
      await page.locator("#authorize").click();
      await page.waitForSelector('#status[data-status="ready"]', { timeout: 20_000 });

      assert.equal(server.tokenRequestCount, 1);
    } finally {
      await Promise.allSettled([context?.close(), server?.close()]);
    }
  });

  it("cleans up pending auth when Chrome Identity returns an OAuth error callback", async () => {
    let server;
    let context;

    try {
      server = await startOAuthMcpServer({ authorizationResult: "error" });
      const launched = await launchExtensionContext();
      context = launched.context;
      const page = await context.newPage();
      await page.goto(
        `chrome-extension://${launched.extensionId}/client.html?mcpUrl=${encodeURIComponent(server.mcpUrl)}`,
      );

      await page.waitForSelector('#status[data-status="pending_auth"]', { timeout: 20_000 });
      await page.locator("#authorize").click();
      await page.waitForSelector('#status[data-status="failed"]', { timeout: 20_000 });

      assert.match((await page.locator("#error").textContent()) ?? "", /User denied consent/u);
      assert.equal(server.tokenRequestCount, 0);
    } finally {
      await Promise.allSettled([context?.close(), server?.close()]);
    }
  });

  it("uses an explicit redirect URL instead of Chrome Identity when one is configured", async () => {
    let server;
    let context;

    try {
      const explicitRedirectUrl = "https://example.invalid/oauth/callback";
      server = await startOAuthMcpServer({
        allowedRedirectUriPattern: /^https:\/\/example\.invalid\/oauth\/callback$/u,
      });
      const launched = await launchExtensionContext();
      context = launched.context;
      const page = await context.newPage();
      await page.goto(
        `chrome-extension://${launched.extensionId}/client.html?mcpUrl=${encodeURIComponent(
          server.mcpUrl,
        )}&redirectUrl=${encodeURIComponent(explicitRedirectUrl)}`,
      );

      await page.waitForSelector('#status[data-status="pending_auth"]', { timeout: 20_000 });
      const authorizationUrl = await page.locator("#authorization-url").textContent();
      assert.ok(authorizationUrl);
      assert.equal(new URL(authorizationUrl).searchParams.get("redirect_uri"), explicitRedirectUrl);
      assert.deepEqual(server.registeredRedirectUris, [explicitRedirectUrl]);
    } finally {
      await Promise.allSettled([context?.close(), server?.close()]);
    }
  });

  it("uses a pre-registered client id with the Chrome Identity redirect URL without DCR", async () => {
    let server;
    let context;

    try {
      server = await startOAuthMcpServer({
        omitRegistrationEndpoint: true,
        staticClientId: "pre-registered-extension-client",
      });
      const launched = await launchExtensionContext();
      context = launched.context;
      const page = await context.newPage();
      await page.goto(
        `chrome-extension://${launched.extensionId}/client.html?mcpUrl=${encodeURIComponent(
          server.mcpUrl,
        )}&clientId=${encodeURIComponent("pre-registered-extension-client")}`,
      );

      await page.waitForSelector('#status[data-status="pending_auth"]', { timeout: 20_000 });
      const authorizationUrl = await page.locator("#authorization-url").textContent();
      assert.ok(authorizationUrl);
      assert.equal(
        new URL(authorizationUrl).searchParams.get("redirect_uri"),
        `https://${launched.extensionId}.chromiumapp.org/`,
      );
      assert.equal(
        new URL(authorizationUrl).searchParams.get("client_id"),
        "pre-registered-extension-client",
      );

      await page.locator("#authorize").click();
      await page.waitForSelector('#status[data-status="ready"]', { timeout: 20_000 });

      assert.deepEqual(server.registeredRedirectUris, []);
      assert.equal(server.tokenRequestCount, 1);
    } finally {
      await Promise.allSettled([context?.close(), server?.close()]);
    }
  });

  it("fails pending auth when Chrome Identity returns a callback without state", async () => {
    let server;
    let context;

    try {
      server = await startOAuthMcpServer({ stateResult: "omit" });
      const launched = await launchExtensionContext();
      context = launched.context;
      const page = await context.newPage();
      await page.goto(
        `chrome-extension://${launched.extensionId}/client.html?mcpUrl=${encodeURIComponent(server.mcpUrl)}`,
      );

      await page.waitForSelector('#status[data-status="pending_auth"]', { timeout: 20_000 });
      await page.locator("#authorize").click();
      await page.waitForSelector('#status[data-status="failed"]', { timeout: 20_000 });

      assert.equal(
        (await page.locator("#authorize-result").textContent()) ?? "",
        "missing_oauth_state",
      );
      assert.match((await page.locator("#error").textContent()) ?? "", /state/u);
      assert.equal(server.tokenRequestCount, 0);
    } finally {
      await Promise.allSettled([context?.close(), server?.close()]);
    }
  });

  it("fails pending auth when Chrome Identity returns a callback without an authorization code", async () => {
    let server;
    let context;

    try {
      server = await startOAuthMcpServer({ authorizationResult: "missing_code" });
      const launched = await launchExtensionContext();
      context = launched.context;
      const page = await context.newPage();
      await page.goto(
        `chrome-extension://${launched.extensionId}/client.html?mcpUrl=${encodeURIComponent(server.mcpUrl)}`,
      );

      await page.waitForSelector('#status[data-status="pending_auth"]', { timeout: 20_000 });
      await page.locator("#authorize").click();
      await page.waitForSelector('#status[data-status="failed"]', { timeout: 20_000 });

      assert.equal((await page.locator("#authorize-result").textContent()) ?? "", "failed");
      assert.match((await page.locator("#error").textContent()) ?? "", /authorization code/u);
      assert.equal(server.tokenRequestCount, 0);
    } finally {
      await Promise.allSettled([context?.close(), server?.close()]);
    }
  });

  it("rejects Chrome Identity callbacks with mismatched OAuth state", async () => {
    let server;
    let context;

    try {
      server = await startOAuthMcpServer({ stateResult: "mismatch" });
      const launched = await launchExtensionContext();
      context = launched.context;
      const page = await context.newPage();
      await page.goto(
        `chrome-extension://${launched.extensionId}/client.html?mcpUrl=${encodeURIComponent(server.mcpUrl)}`,
      );

      await page.waitForSelector('#status[data-status="pending_auth"]', { timeout: 20_000 });
      await page.locator("#authorize").click();
      await page.waitForSelector("#authorize-result", { timeout: 20_000 });
      await page.waitForFunction(
        () => document.querySelector("#authorize-result")?.textContent === "oauth_state_mismatch",
      );

      assert.equal(
        (await page.locator("#status").getAttribute("data-status")) ?? "",
        "pending_auth",
      );
      assert.equal(server.tokenRequestCount, 0);
    } finally {
      await Promise.allSettled([context?.close(), server?.close()]);
    }
  });
});

async function launchExtensionContext() {
  const userDataDir = mkdtempSync(resolve(tmpdir(), "use-mcp-react-extension-"));
  USER_DATA_DIRS.push(userDataDir);

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
  });
  const serviceWorker =
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(serviceWorker.url()).host;

  return { context, extensionId };
}

async function startOAuthMcpServer(options = {}) {
  const allowedRedirectUriPattern =
    options.allowedRedirectUriPattern ?? /^https:\/\/[a-p]{32}\.chromiumapp\.org\/$/u;
  const callbackParameters = options.callbackParameters ?? "query";
  const authorizationResult = options.authorizationResult ?? "code";
  const stateResult = options.stateResult ?? "original";
  const clients = new Map();
  const authorizationCodes = new Map();
  const accessTokens = new Map();
  const registeredRedirectUris = [];
  let tokenRequestCount = 0;

  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url ?? "/", origin);
      if (incoming.method === "OPTIONS") {
        await writeResponse(outgoing, new Response(null, { headers: corsHeaders() }));
        return;
      }

      if (url.pathname === "/mcp") {
        await writeResponse(outgoing, await handleMcpRequest(toWebRequest(incoming, origin)));
        return;
      }

      if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
        await writeResponse(
          outgoing,
          json({
            authorization_servers: [origin],
            bearer_methods_supported: ["header"],
            resource: `${origin}/mcp`,
            resource_name: "Chrome Identity MCP e2e server",
            scopes_supported: ["mcp:tools"],
          }),
        );
        return;
      }

      if (url.pathname === "/.well-known/oauth-authorization-server") {
        await writeResponse(
          outgoing,
          json({
            issuer: origin,
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${origin}/token`,
            ...(options.omitRegistrationEndpoint
              ? {}
              : { registration_endpoint: `${origin}/register` }),
            response_types_supported: ["code"],
            grant_types_supported: ["authorization_code", "refresh_token"],
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["none"],
            scopes_supported: ["mcp:tools"],
          }),
        );
        return;
      }

      if (url.pathname === "/register" && incoming.method === "POST") {
        const metadata = JSON.parse(await readIncomingBody(incoming));
        const redirectUris = Array.isArray(metadata.redirect_uris) ? metadata.redirect_uris : [];
        assert.deepEqual(
          redirectUris.map(String),
          redirectUris.filter((redirectUri) => allowedRedirectUriPattern.test(String(redirectUri))),
        );
        const clientId = `client-${clients.size + 1}`;
        clients.set(clientId, { ...metadata, client_id: clientId });
        registeredRedirectUris.push(...redirectUris.map(String));
        await writeResponse(outgoing, json({ ...metadata, client_id: clientId }, { status: 201 }));
        return;
      }

      if (url.pathname === "/authorize") {
        const clientId = url.searchParams.get("client_id");
        const redirectUri = url.searchParams.get("redirect_uri");
        const resource = url.searchParams.get("resource");
        const codeChallenge = url.searchParams.get("code_challenge");
        const state = url.searchParams.get("state");
        const client =
          clientId && clients.has(clientId)
            ? clients.get(clientId)
            : clientId === options.staticClientId
              ? { client_id: clientId, redirect_uris: [redirectUri] }
              : undefined;
        if (
          !clientId ||
          !client ||
          !redirectUri ||
          !client.redirect_uris.includes(redirectUri) ||
          !resource ||
          resource !== `${origin}/mcp` ||
          !codeChallenge
        ) {
          await writeResponse(
            outgoing,
            json({ error: "invalid_authorization_request" }, { status: 400 }),
          );
          return;
        }
        const callbackUrl = new URL(redirectUri);
        const responseParameters = new URLSearchParams();
        if (authorizationResult === "error") {
          responseParameters.set("error", "access_denied");
          responseParameters.set("error_description", "User denied consent");
        } else if (authorizationResult !== "missing_code") {
          const code = `code-${authorizationCodes.size + 1}`;
          authorizationCodes.set(code, {
            clientId,
            codeChallenge,
            redirectUri,
            resource,
            scope: url.searchParams.get("scope") ?? "mcp:tools",
          });
          responseParameters.set("code", code);
        }
        if (stateResult === "mismatch") {
          responseParameters.set("state", "wrong-state");
        } else if (stateResult !== "omit" && state) {
          responseParameters.set("state", state);
        }
        writeOAuthCallbackParameters(callbackUrl, responseParameters, callbackParameters);
        await writeResponse(
          outgoing,
          new Response(null, {
            headers: { ...corsHeaders(), location: callbackUrl.toString() },
            status: 302,
          }),
        );
        return;
      }

      if (url.pathname === "/token" && incoming.method === "POST") {
        tokenRequestCount += 1;
        const body = new URLSearchParams(await readIncomingBody(incoming));
        const code = body.get("code");
        const authorizationCode = code ? authorizationCodes.get(code) : undefined;
        if (
          body.get("grant_type") !== "authorization_code" ||
          !authorizationCode ||
          authorizationCode.clientId !== body.get("client_id") ||
          authorizationCode.redirectUri !== body.get("redirect_uri") ||
          authorizationCode.resource !== body.get("resource") ||
          (await createS256CodeChallenge(body.get("code_verifier") ?? "")) !==
            authorizationCode.codeChallenge
        ) {
          await writeResponse(outgoing, json({ error: "invalid_grant" }, { status: 400 }));
          return;
        }
        authorizationCodes.delete(code);
        const token = `access-token-${accessTokens.size + 1}`;
        accessTokens.set(token, authorizationCode);
        await writeResponse(
          outgoing,
          json({
            access_token: token,
            token_type: "Bearer",
            expires_in: 3600,
            scope: authorizationCode.scope,
          }),
        );
        return;
      }

      await writeResponse(outgoing, json({ error: "not_found" }, { status: 404 }));
    } catch (error) {
      await writeResponse(
        outgoing,
        json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }),
      );
    }
  });

  await new Promise((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });

  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  const mcpUrl = `${origin}/mcp`;

  async function handleMcpRequest(request) {
    const authorization = request.headers.get("authorization");
    const token = authorization?.match(/^Bearer (?<token>.+)$/u)?.groups?.token;
    const authInfo =
      token && accessTokens.has(token)
        ? {
            token,
            clientId: accessTokens.get(token).clientId,
            scopes: ["mcp:tools"],
            resource: new URL(mcpUrl),
          }
        : undefined;

    if (!authInfo) {
      return new Response("Unauthorized", {
        headers: {
          ...corsHeaders(),
          "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="mcp:tools"`,
        },
        status: 401,
      });
    }

    const mcpServer = new McpServer(
      { name: "chrome-identity-e2e", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    mcpServer.registerTool("whoami", {}, (extra) => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            clientId: extra.authInfo?.clientId,
          }),
        },
      ],
    }));

    const transport = new WebStandardStreamableHTTPServerTransport();
    await mcpServer.connect(transport);
    return withCors(await transport.handleRequest(request, { authInfo }));
  }

  return {
    get registeredRedirectUris() {
      return registeredRedirectUris;
    },
    get tokenRequestCount() {
      return tokenRequestCount;
    },
    mcpUrl,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      }),
  };
}

function toWebRequest(incoming, origin) {
  return new Request(new URL(incoming.url ?? "/", origin), {
    body: incoming.method === "GET" || incoming.method === "HEAD" ? undefined : incoming,
    duplex: "half",
    headers: incoming.headers,
    method: incoming.method,
  });
}

async function readIncomingBody(incoming) {
  const chunks = [];
  for await (const chunk of incoming) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function json(body, init = {}) {
  return withCors(
    Response.json(body, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...init.headers,
      },
    }),
  );
}

function withCors(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders())) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function corsHeaders() {
  return {
    "access-control-allow-headers": "authorization,content-type,mcp-protocol-version",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "mcp-session-id,www-authenticate",
  };
}

function writeOAuthCallbackParameters(callbackUrl, parameters, location) {
  if (location === "fragment") {
    callbackUrl.hash = parameters.toString();
    return;
  }

  callbackUrl.search = parameters.toString();
}

async function writeResponse(outgoing, response) {
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) {
    outgoing.end();
    return;
  }
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    outgoing.write(value);
  }
  outgoing.end();
}

async function createS256CodeChallenge(codeVerifier) {
  const bytes = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const binary = String.fromCharCode(...new Uint8Array(digest));

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
