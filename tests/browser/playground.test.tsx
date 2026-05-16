import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../../playground/src/main.tsx";
import { MCP_OAUTH_CALLBACK_CHANNEL } from "../../src/index.ts";
import { worker } from "./setup.js";
import { createOAuthMcpTestServer } from "./support/oauthMcpServer.js";

describe("playground", () => {
  it("offers Postman as the hosted remote OAuth preset", async () => {
    await render(<App />);

    await page.getByRole("button", { name: /Postman/ }).click();

    await expect
      .element(page.getByLabelText("MCP URL"))
      .toHaveValue("https://mcp.postman.com/code");
    expect(document.body.textContent).toContain(
      "Postman is a hosted remote MCP server with OAuth metadata, DCR, and PKCE.",
    );
    expect(document.body.textContent).not.toContain("mcp.canva.com");
  });

  it("shows only the actions that make sense for the current connection state", async () => {
    const server = createOAuthMcpTestServer({
      randomResponseDelay: { maxMs: 60, seed: 53 },
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    await render(<App />);
    await page.getByLabelText("MCP URL").fill(server.mcpUrl);

    expect(actionBarText()).toContain("Connect");
    expect(actionBarText()).not.toContain("Disconnect");
    expect(actionBarText()).not.toContain("Reconnect");
    expect(actionBarText()).not.toContain("Reauthorize");

    await page.getByRole("button", { exact: true, name: "Connect" }).click();

    await waitForVerdict("OAuth required");

    await expect
      .element(page.getByRole("button", { exact: true, name: "Authorize with OAuth" }))
      .toBeVisible();

    await completeOAuthAuthorization(server);

    await waitForProofStatus("Ready");

    expect(proofActionsText()).toContain("Reconnect");
    expect(proofActionsText()).toContain("Reauthorize");
    expect(proofActionsText()).toContain("Forget");
  });

  it("shows a retry action and the server error after a post-auth transport failure", async () => {
    const server = createOAuthMcpTestServer({
      failInitializedNotification: true,
      randomResponseDelay: { maxMs: 60, seed: 67 },
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    await render(<App />);
    await page.getByLabelText("MCP URL").fill(server.mcpUrl);
    await page.getByRole("button", { exact: true, name: "Connect" }).click();

    await waitForVerdict("OAuth required");
    await completeOAuthAuthorization(server);

    await vi.waitFor(() => {
      expect(document.querySelector(".render-failed")?.textContent).toContain("Connection failed");
    });

    expect(document.body.textContent).toContain("Invalid request method for existing session");
    await expect.element(page.getByRole("button", { exact: true, name: "Connect" })).toBeEnabled();
  });

  it("requires a bearer token before connecting and renders tools after token auth", async () => {
    const server = createOAuthMcpTestServer({
      acceptedBearerTokens: [
        {
          clientId: "firecrawl-test-client",
          resource: `${window.location.origin}/mcp`,
          scope: "mcp:tools",
          token: "fc-test-token",
        },
      ],
      advertiseOAuth: false,
      randomResponseDelay: { maxMs: 60, seed: 41 },
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    await render(<App />);

    await page.getByRole("button", { name: /Firecrawl/ }).click();
    await page.getByLabelText("MCP URL").fill(server.mcpUrl);

    const connectButton = page.getByRole("button", { exact: true, name: "Connect" });
    await expect.element(connectButton).toBeDisabled();

    await page.getByLabelText("Bearer token").fill("fc-test-token");
    await expect.element(connectButton).toBeEnabled();
    await connectButton.click();

    await waitForProofStatus("Ready");

    expect(document.querySelector(".catalog-column")?.textContent).toContain("whoami");
  });

  it("shows loaded tools and a partial catalog warning when one catalog call fails", async () => {
    const server = createOAuthMcpTestServer({
      failCatalogMethods: ["prompts/list"],
      randomResponseDelay: { maxMs: 60, seed: 29 },
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    await render(<App />);

    await page.getByLabelText("MCP URL").fill(server.mcpUrl);
    await page.getByRole("button", { exact: true, name: "Connect" }).click();

    await waitForProofStatus("Ready");

    expect(document.querySelector(".proof-facts")?.textContent).toContain(
      "partial — some lists failed",
    );
    expect(document.querySelector(".catalog-column")?.textContent).toContain("whoami");
  });

  it("shows a setup recommendation and selectable tools after no-auth hydration", async () => {
    const server = createOAuthMcpTestServer({
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    await render(<App />);

    expect(document.body.textContent).toContain(
      "Pick a preset or paste an MCP URL above to detect the auth requirement.",
    );

    await page.getByLabelText("MCP URL").fill(server.mcpUrl);
    await page.getByRole("button", { exact: true, name: "Connect" }).click();

    await waitForProofStatus("Ready");

    await expect
      .element(page.getByRole("region", { name: "Connection proof of life" }))
      .toBeVisible();
    expect(document.querySelector(".catalog-column")?.textContent).toContain("whoami");
  });

  it("renders MCP Apps advertised by a connected remote server", async () => {
    const appMessages: unknown[] = [];
    const appMessageListener = (event: MessageEvent) => {
      if (event.data?.type === "playground-mcp-app-ready") {
        appMessages.push(event.data);
      }
    };
    window.addEventListener("message", appMessageListener);

    const server = createOAuthMcpTestServer({
      appResources: [
        {
          html: `
            <script>
              let initialized = false;

              window.addEventListener("message", (event) => {
                if (event.data?.id === 1 && !initialized) {
                  initialized = true;
                  window.parent.postMessage({
                    jsonrpc: "2.0",
                    method: "ui/notifications/initialized"
                  }, "*");
                  window.parent.postMessage({ type: "playground-mcp-app-ready" }, "*");
                }
              });

              window.setInterval(() => {
                if (initialized) return;
                window.parent.postMessage({
                  id: 1,
                  jsonrpc: "2.0",
                  method: "ui/initialize",
                  params: {
                    appCapabilities: {},
                    appInfo: { name: "playground-app", version: "0.0.0" },
                    protocolVersion: "2026-01-26"
                  }
                }, "*");
              }, 20);
            </script>
          `,
          uri: "ui://weather/playground-app.html",
        },
      ],
      requireAuth: false,
      transportMode: "stateless",
    });
    server.registerTool("show-weather-dashboard", {
      metadata: {
        ui: {
          resourceUri: "ui://weather/playground-app.html",
        },
      },
    });
    worker.use(...server.handlers);

    try {
      await render(<App />);

      await page.getByLabelText("MCP URL").fill(server.mcpUrl);
      await page.getByRole("button", { exact: true, name: "Connect" }).click();

      await waitForProofStatus("Ready");

      await expect.element(page.getByRole("region", { name: "MCP Apps" })).toBeVisible();
      await vi.waitFor(() => {
        const iframe = document.querySelector<HTMLIFrameElement>(
          'iframe[title="show-weather-dashboard MCP App"]',
        );
        expect(iframe?.getAttribute("src")).toMatch(/^data:text\/html/);
      });
      await vi.waitFor(() => {
        expect(appMessages).toContainEqual({ type: "playground-mcp-app-ready" });
      });
    } finally {
      window.removeEventListener("message", appMessageListener);
    }
  });

  it("shows auth-specific setup recommendations", async () => {
    const server = createOAuthMcpTestServer({
      advertiseOAuth: false,
      randomResponseDelay: { maxMs: 60, seed: 43 },
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    await render(<App />);

    await page.getByRole("button", { name: /Firecrawl/ }).click();
    await expect.element(page.getByLabelText("Bearer token")).toBeVisible();

    await page.getByRole("button", { name: /DeepWiki/ }).click();
    await page.getByLabelText("MCP URL").fill(server.mcpUrl);
    await page.getByRole("button", { exact: true, name: "Connect" }).click();

    await waitForVerdict("Bearer token required");

    expect(document.querySelector(".render-card")?.textContent).toContain("API key / Bearer token");
  });

  it("tries the Gmail preset before asking for an OAuth client id", async () => {
    const server = createOAuthMcpTestServer({
      dynamicClientRegistration: false,
      randomResponseDelay: { maxMs: 60, seed: 31 },
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    await render(<App />);

    await page.getByRole("button", { name: /Gmail MCP/ }).click();
    await page.getByLabelText("MCP URL").fill(server.mcpUrl);

    const connectButton = page.getByRole("button", { exact: true, name: "Connect" });
    await expect.element(connectButton).toBeEnabled();
    await connectButton.click();

    await waitForVerdict("Manual OAuth client id");

    const renderCardText = document.querySelector(".render-card")?.textContent ?? "";
    expect(renderCardText).toContain("OAuth client id");
    expect(renderCardText).not.toContain("client secret");
  });

  it("labels pre-registered client id OAuth without calling it CIMD", async () => {
    const server = createOAuthMcpTestServer({
      dynamicClientRegistration: false,
      preRegisteredClients: [createPreRegisteredClient("playground-manual-client")],
      randomResponseDelay: { maxMs: 60, seed: 37 },
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    await render(<App />);

    await page.getByLabelText("MCP URL").fill(server.mcpUrl);

    const authModeSelect = document.querySelector(".override select") as HTMLSelectElement | null;
    expect(authModeSelect).not.toBeNull();
    authModeSelect!.value = "manual-oauth";
    authModeSelect!.dispatchEvent(new Event("change", { bubbles: true }));

    await page.getByRole("textbox", { name: "OAuth client id" }).fill("playground-manual-client");
    await page.getByRole("button", { exact: true, name: "Connect" }).click();

    await waitForVerdict("OAuth required");

    const renderCardText = document.querySelector(".render-card")?.textContent ?? "";
    expect(renderCardText).toContain("pre-registered client id");
    expect(renderCardText).not.toContain("CIMD handles");
  });

  it("loads tools into the visible catalog after an OAuth callback", async () => {
    const server = createOAuthMcpTestServer({
      randomResponseDelay: { maxMs: 60, seed: 17 },
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    await render(<App />);

    await page.getByLabelText("MCP URL").fill(server.mcpUrl);
    await page.getByRole("button", { exact: true, name: "Connect" }).click();

    await waitForVerdict("OAuth required");
    await completeOAuthAuthorization(server);
    await waitForProofStatus("Ready");

    expect(document.querySelector(".catalog-column")?.textContent).toContain("whoami");
  });

  it("shows a Linear-style invalid approval and retries without rotating the DCR client", async () => {
    const server = createOAuthMcpTestServer({
      clientMetadataDocument: true,
      protectedResource: window.location.origin,
      randomResponseDelay: { maxMs: 60, seed: 83 },
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    await render(<App />);

    await page.getByLabelText("MCP URL").fill(server.mcpUrl);
    await page.getByRole("button", { exact: true, name: "Connect" }).click();

    await waitForVerdict("OAuth required");

    const firstAuthorizationUrl = await openOAuthAuthorizationUrl();
    const firstClientId = firstAuthorizationUrl.searchParams.get("client_id");
    expect(firstClientId).toBe("client-1");
    expect(firstAuthorizationUrl.searchParams.get("resource")).toBe(`${window.location.origin}/`);

    postOAuthCallback({
      error: "invalid_approval",
      errorDescription: "Invalid approval",
      state: firstAuthorizationUrl.searchParams.get("state"),
    });

    await vi.waitFor(() => {
      expect(document.querySelector(".render-failed")?.textContent).toContain("Invalid approval");
    });
    expect(document.body.textContent).toContain("Invalid approval");
    expect(registerRequestCount(server.requestLog)).toBe(1);
    expect(tokenRequestCount(server.requestLog)).toBe(0);

    await page.getByRole("button", { exact: true, name: "Connect" }).click();
    await waitForVerdict("OAuth required");

    const retryAuthorizationUrl = await openOAuthAuthorizationUrl();
    expect(retryAuthorizationUrl.searchParams.get("client_id")).toBe(firstClientId);
    expect(retryAuthorizationUrl.searchParams.get("resource")).toBe(`${window.location.origin}/`);

    const code = server.authorize(retryAuthorizationUrl);
    postOAuthCallback({
      code,
      state: retryAuthorizationUrl.searchParams.get("state"),
    });

    await waitForProofStatus("Ready");

    expect(registerRequestCount(server.requestLog)).toBe(1);
    expect(tokenRequestCount(server.requestLog)).toBe(1);
    expect(document.querySelector(".catalog-column")?.textContent).toContain("whoami");
  });

  it("keeps stored OAuth tokens when switching presets away and back", async () => {
    const server = createOAuthMcpTestServer({
      randomResponseDelay: { maxMs: 60, seed: 71 },
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    await render(<App />);

    await page.getByLabelText("MCP URL").fill(server.mcpUrl);
    await page.getByRole("button", { exact: true, name: "Connect" }).click();

    await waitForVerdict("OAuth required");
    await completeOAuthAuthorization(server);
    await waitForProofStatus("Ready");

    const tokenRequests = tokenRequestCount(server.requestLog);
    const registrationRequests = registerRequestCount(server.requestLog);

    await page.getByRole("button", { exact: true, name: "Linear OAuth" }).click();
    await vi.waitFor(() => {
      expect((document.querySelector("#mcp-url") as HTMLInputElement | null)?.value).toBe(
        "https://mcp.linear.app/mcp",
      );
    });

    await page.getByLabelText("MCP URL").fill(server.mcpUrl);
    await page.getByRole("button", { exact: true, name: "Connect" }).click();

    await waitForProofStatus("Ready");

    expect(tokenRequestCount(server.requestLog)).toBe(tokenRequests);
    expect(registerRequestCount(server.requestLog)).toBe(registrationRequests);
    expect(document.querySelector(".catalog-column")?.textContent).toContain("whoami");
  });
});

function actionBarText(): string {
  return document.querySelector(".url-bar")?.textContent ?? "";
}

function proofActionsText(): string {
  return document.querySelector(".proof-actions")?.textContent ?? "";
}

async function waitForProofStatus(status: string): Promise<void> {
  await vi.waitFor(() => {
    expect(document.querySelector(".proof-facts")?.textContent).toContain(status);
  });
}

async function waitForVerdict(title: string): Promise<void> {
  await vi.waitFor(() => {
    expect(document.querySelector(".verdict-card")?.textContent).toContain(title);
  });
}

async function completeOAuthAuthorization(
  server: ReturnType<typeof createOAuthMcpTestServer>,
): Promise<void> {
  const authorizationUrl = await openOAuthAuthorizationUrl();
  const code = server.authorize(authorizationUrl);
  postOAuthCallback({
    code,
    state: authorizationUrl.searchParams.get("state"),
  });
}

async function openOAuthAuthorizationUrl(): Promise<URL> {
  const originalOpen = window.open;
  const popup = {
    closed: false,
    focus: () => {},
    location: { href: "about:blank" },
  } as unknown as Window;

  window.open = ((url?: string | URL) => {
    popup.location.href = url ? String(url) : "about:blank";
    return popup;
  }) as typeof window.open;

  try {
    await page.getByRole("button", { exact: true, name: "Authorize with OAuth" }).click();

    await vi.waitFor(() => {
      expect(popup.location.href).toContain("/authorize");
    });

    return new URL(popup.location.href);
  } finally {
    window.open = originalOpen;
  }
}

function postOAuthCallback(message: {
  code?: string;
  error?: string;
  errorDescription?: string;
  state?: string | null;
}): void {
  const channel = new BroadcastChannel(MCP_OAUTH_CALLBACK_CHANNEL);
  channel.postMessage({
    ...message,
    type: "use-mcp-react:oauth-callback",
  });
  channel.close();
}

function registerRequestCount(requestLog: Array<{ method: string; pathname: string }>): number {
  return requestLog.filter((entry) => entry.method === "POST" && entry.pathname === "/register")
    .length;
}

function tokenRequestCount(requestLog: Array<{ method: string; pathname: string }>): number {
  return requestLog.filter((entry) => entry.method === "POST" && entry.pathname === "/token")
    .length;
}

function createPreRegisteredClient(clientId: string) {
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: "Playground manual client",
    grant_types: ["authorization_code", "refresh_token"],
    redirect_uris: [`${window.location.origin}/oauth/callback`],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}
