import { StrictMode, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  handleMcpOAuthCallback,
  McpOAuthCallback,
  MCP_OAUTH_CALLBACK_CHANNEL,
  useMcp,
} from "../../src/index.ts";
import { createMcpAppClientCapabilities, McpAppView, readMcpAppResource } from "../../src/apps.ts";
import { worker } from "./setup.js";
import { renderHookProbe } from "./support/renderHookProbe.js";
import { createOAuthMcpTestServer, type OAuthMcpTestServer } from "./support/oauthMcpServer.js";

describe("useMcp", () => {
  it("publishes OAuth callback parameters through BroadcastChannel", async () => {
    const originalUrl = window.location.href;
    const callbackUrl = new URL("/oauth/callback", window.location.origin);
    callbackUrl.searchParams.set("code", "callback-code");
    callbackUrl.searchParams.set("state", "callback-state");
    window.history.pushState(null, "", callbackUrl);

    const messages: unknown[] = [];
    const channel = new BroadcastChannel(MCP_OAUTH_CALLBACK_CHANNEL);
    channel.onmessage = (event) => {
      messages.push(event.data);
    };

    try {
      const result = handleMcpOAuthCallback({ closeWindow: false });

      await vi.waitFor(() => {
        expect(messages).toContainEqual({
          code: "callback-code",
          state: "callback-state",
          type: "use-mcp-react:oauth-callback",
        });
      });
      expect(result).toEqual({
        closeWindow: false,
        message: {
          code: "callback-code",
          state: "callback-state",
          type: "use-mcp-react:oauth-callback",
        },
      });
    } finally {
      channel.close();
      window.history.pushState(null, "", originalUrl);
    }
  });

  it("publishes OAuth callback parameters once when mounted in StrictMode", async () => {
    const originalUrl = window.location.href;
    const originalClose = window.close;
    const callbackUrl = new URL("/oauth/callback", window.location.origin);
    callbackUrl.searchParams.set("code", "callback-code");
    callbackUrl.searchParams.set("state", "callback-state");
    window.history.pushState(null, "", callbackUrl);

    const messages: unknown[] = [];
    const closeCalls: unknown[] = [];
    const channel = new BroadcastChannel(MCP_OAUTH_CALLBACK_CHANNEL);
    channel.onmessage = (event) => {
      messages.push(event.data);
    };
    window.close = (() => {
      closeCalls.push(null);
    }) as typeof window.close;

    try {
      await render(
        <StrictMode>
          <McpOAuthCallback />
        </StrictMode>,
      );

      await vi.waitFor(() => {
        expect(messages.length).toBeGreaterThan(0);
      });
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 80);
      });

      expect(messages).toEqual([
        {
          code: "callback-code",
          state: "callback-state",
          type: "use-mcp-react:oauth-callback",
        },
      ]);
      expect(closeCalls).toHaveLength(1);
    } finally {
      window.close = originalClose;
      channel.close();
      window.history.pushState(null, "", originalUrl);
    }
  });

  it("renders OAuth callback error descriptions without closing the popup", async () => {
    const originalUrl = window.location.href;
    const originalClose = window.close;
    const callbackUrl = new URL("/oauth/callback", window.location.origin);
    callbackUrl.searchParams.set("error", "invalid_approval");
    callbackUrl.searchParams.set("error_description", "Invalid approval");
    callbackUrl.searchParams.set("state", "callback-state");
    window.history.pushState(null, "", callbackUrl);

    const messages: unknown[] = [];
    const closeCalls: unknown[] = [];
    const channel = new BroadcastChannel(MCP_OAUTH_CALLBACK_CHANNEL);
    channel.onmessage = (event) => {
      messages.push(event.data);
    };
    window.close = (() => {
      closeCalls.push(null);
    }) as typeof window.close;

    try {
      await render(<McpOAuthCallback />);

      await vi.waitFor(() => {
        expect(document.body.textContent).toContain("Invalid approval");
      });
      await vi.waitFor(() => {
        expect(messages).toContainEqual({
          error: "invalid_approval",
          errorDescription: "Invalid approval",
          state: "callback-state",
          type: "use-mcp-react:oauth-callback",
        });
      });
      expect(closeCalls).toHaveLength(0);
    } finally {
      window.close = originalClose;
      channel.close();
      window.history.pushState(null, "", originalUrl);
    }
  });

  it("stays idle with empty catalogs and no network requests when the URL is undefined", async () => {
    const server = createOAuthMcpTestServer({
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: undefined }),
      (mcp) => ({
        status: mcp.status,
        tools: mcp.tools.length,
        resources: mcp.resources.length,
        resourceTemplates: mcp.resourceTemplates.length,
        prompts: mcp.prompts.length,
      }),
    );

    expect(probe.result.current.status).toBe("idle");
    expect(probe.result.current.authRequirement).toBeNull();
    expect(probe.result.current.authorizationUrl).toBeNull();
    expect(probe.result.current.error).toBeNull();
    expect(probe.result.current.client).toBeNull();
    expect(probe.result.current.transport).toBeNull();
    expect(probe.result.current.serverCapabilities).toBeNull();
    expect(probe.result.current.serverVersion).toBeNull();
    expect(probe.result.current.serverProfile).toBeNull();
    expect(probe.result.current.tools).toEqual([]);
    expect(probe.result.current.resources).toEqual([]);
    expect(probe.result.current.resourceTemplates).toEqual([]);
    expect(probe.result.current.prompts).toEqual([]);
    expect(probe.result.current.connect).toEqual(expect.any(Function));
    expect(probe.result.current.disconnect).toEqual(expect.any(Function));
    expect(probe.result.current.reconnect).toEqual(expect.any(Function));
    expect(probe.result.current.reauthorize).toEqual(expect.any(Function));
    expect(probe.result.current.forget).toEqual(expect.any(Function));
    expect(probe.result.current.authorize).toEqual(expect.any(Function));
    expect(probe.result.current.finishAuthorization).toEqual(expect.any(Function));
    expect(probe.snapshots()).toContainEqual({
      status: "idle",
      tools: 0,
      resources: 0,
      resourceTemplates: 0,
      prompts: 0,
    });
    expect(server.requestLog).toEqual([]);

    await probe.unmount();
  });

  it("auto-connects to a no-auth stateless MCP server and loads the full catalog", async () => {
    const server = createOAuthMcpTestServer({
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        catalogStatus: mcp.catalogStatus,
        promptNames: mcp.prompts.map((prompt) => prompt.name),
        resourceTemplateUris: mcp.resourceTemplates.map((template) => template.uriTemplate),
        resourceUris: mcp.resources.map((resource) => resource.uri),
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(probe.result.current.authRequirement).toBeNull();
    expect(probe.result.current.authorizationUrl).toBeNull();
    expect(probe.result.current.catalogStatus).toBe("ready");
    expect(probe.result.current.catalogErrors).toEqual({});
    expect(probe.result.current.error).toBeNull();
    expect(probe.result.current.client).toBeInstanceOf(Client);
    expect(probe.result.current.transport).toBeInstanceOf(StreamableHTTPClientTransport);
    expect(probe.result.current.transport?.sessionId).toBeUndefined();
    expect(probe.result.current.serverVersion).toMatchObject({
      name: "msw-oauth-mcp-test-server",
      version: "0.0.0",
    });
    expect(probe.result.current.serverCapabilities).toMatchObject({
      prompts: { listChanged: true },
      resources: { listChanged: true },
      tools: { listChanged: true },
    });
    expect(probe.result.current.serverProfile).toMatchObject({
      url: server.mcpUrl,
      auth: { mode: "none" },
      catalog: {
        prompts: { complete: true, items: [{ name: "summarize-profile" }] },
        resourceTemplates: {
          complete: true,
          items: [{ uriTemplate: "mcp-test://profiles/{profileId}" }],
        },
        resources: {
          complete: true,
          items: expect.arrayContaining([
            expect.objectContaining({ uri: "mcp-test://profile" }),
            expect.objectContaining({ uri: "mcp-test://profiles/current" }),
          ]),
        },
        tools: { complete: true, items: [{ name: "whoami" }] },
      },
      initialize: {
        capabilities: {
          prompts: { listChanged: true },
          resources: { listChanged: true },
          tools: { listChanged: true },
        },
        serverInfo: {
          name: "msw-oauth-mcp-test-server",
          version: "0.0.0",
        },
      },
      transport: {
        endpoint: server.mcpUrl,
        kind: "streamable-http",
        sessionMode: "stateless",
      },
    });
    expect(probe.result.current.serverProfile?.initialize?.protocolVersion).toEqual(
      expect.any(String),
    );
    expect(probe.result.current.serverProfile?.transport.protocolVersion).toEqual(
      probe.result.current.serverProfile?.initialize?.protocolVersion,
    );
    expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");
    expect(probe.result.current.resources.map((resource) => resource.uri)).toEqual(
      expect.arrayContaining(["mcp-test://profile", "mcp-test://profiles/current"]),
    );
    expect(
      probe.result.current.resourceTemplates.map((template) => template.uriTemplate),
    ).toContain("mcp-test://profiles/{profileId}");
    expect(probe.result.current.prompts.map((prompt) => prompt.name)).toContain(
      "summarize-profile",
    );
    expect(probe.snapshots()).toContainEqual({
      catalogStatus: "loading",
      promptNames: [],
      resourceTemplateUris: [],
      resourceUris: [],
      status: "loading",
      toolNames: [],
    });
    expect(probe.snapshots()).toContainEqual({
      catalogStatus: "ready",
      promptNames: ["summarize-profile"],
      resourceTemplateUris: ["mcp-test://profiles/{profileId}"],
      resourceUris: expect.arrayContaining(["mcp-test://profile", "mcp-test://profiles/current"]),
      status: "ready",
      toolNames: ["whoami"],
    });
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        pathname: "/.well-known/oauth-protected-resource/mcp",
      }),
    );
    expect(
      server.requestLog.filter((entry) => entry.method === "POST" && entry.pathname === "/mcp")
        .length,
    ).toBeGreaterThanOrEqual(5);

    await probe.act(() => probe.result.current.disconnect());
    await probe.unmount();
  });

  it("closes a hook-owned pre-opened popup when OAuth is not required", async () => {
    const server = createOAuthMcpTestServer({
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ enabled: false, url: null }),
      (mcp) => ({
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
    );

    const openedWindows: string[] = [];
    let popupClosed = false;
    const popup = {
      get closed() {
        return popupClosed;
      },
      close: () => {
        popupClosed = true;
      },
      focus: () => {},
      location: { href: "about:blank" },
    } as Window;
    const originalOpen = window.open;
    window.open = ((url?: string | URL) => {
      openedWindows.push(String(url));
      return popup;
    }) as typeof window.open;

    try {
      await probe.act(() =>
        probe.result.current.connect({
          authorizationTarget: "popup",
          enabled: true,
          url: server.mcpUrl,
        }),
      );
    } finally {
      window.open = originalOpen;
    }

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(openedWindows).toEqual(["about:blank"]);
    expect(popupClosed).toBe(true);
    expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");

    await probe.act(() => probe.result.current.disconnect());
    await probe.unmount();
  });

  it("includes server instructions in the runtime profile initialize result", async () => {
    const server = createOAuthMcpTestServer({
      requireAuth: false,
      serverInstructions: "Use the profile tools only after listing resources.",
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        instructions: mcp.serverProfile?.initialize?.instructions,
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(probe.result.current.serverProfile?.initialize?.instructions).toBe(
      "Use the profile tools only after listing resources.",
    );
    expect(probe.snapshots()).toContainEqual({
      instructions: "Use the profile tools only after listing resources.",
      status: "ready",
    });

    await probe.act(() => probe.result.current.disconnect());
    await probe.unmount();
  });

  it("drains paginated catalog sections before marking them complete", async () => {
    const server = createOAuthMcpTestServer({
      paginatedTools: true,
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        complete: mcp.serverProfile?.catalog.tools.complete,
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(probe.result.current.tools.map((tool) => tool.name)).toEqual([
      "first-page-tool",
      "second-page-tool",
    ]);
    expect(probe.result.current.serverProfile?.catalog.tools).toMatchObject({
      complete: true,
      items: [{ name: "first-page-tool" }, { name: "second-page-tool" }],
    });
    expect(
      server.requestLog.filter((entry) => entry.method === "POST" && entry.pathname === "/mcp")
        .length,
    ).toBeGreaterThanOrEqual(6);

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("keeps the connection ready and exposes loaded tools when another catalog call fails", async () => {
    const server = createOAuthMcpTestServer({
      failCatalogMethods: ["prompts/list"],
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        catalogStatus: mcp.catalogStatus,
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(probe.result.current.catalogStatus).toBe("partial");
    expect(probe.result.current.catalogErrors).toHaveProperty("prompts");
    expect(probe.result.current.serverProfile?.catalog.prompts).toMatchObject({
      complete: false,
      items: [],
      error: expect.any(Error),
    });
    expect(probe.result.current.serverProfile?.catalog.tools).toMatchObject({
      complete: true,
      items: [{ name: "whoami" }],
    });
    expect(probe.result.current.error).toBeNull();
    expect(probe.result.current.client).toBeInstanceOf(Client);
    expect(probe.result.current.transport).toBeInstanceOf(StreamableHTTPClientTransport);
    expect(probe.result.current.tools.map((tool) => tool.name)).toEqual(["whoami"]);
    expect(probe.result.current.prompts).toEqual([]);
    expect(probe.snapshots()).toContainEqual({
      catalogStatus: "partial",
      status: "ready",
      toolNames: ["whoami"],
    });

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("disconnects the current SDK connection without clearing loaded server state", async () => {
    const server = createOAuthMcpTestServer({
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        catalogStatus: mcp.catalogStatus,
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    const connectedClient = probe.result.current.client;
    const connectedTransport = probe.result.current.transport;
    let transportClosed = false;
    connectedTransport!.onclose = () => {
      transportClosed = true;
    };

    await probe.act(() => probe.result.current.disconnect());

    expect(transportClosed).toBe(true);
    expect(probe.result.current.status).toBe("idle");
    expect(probe.result.current.client).toBeNull();
    expect(probe.result.current.transport).toBeNull();
    expect(probe.result.current.serverVersion).toMatchObject({
      name: "msw-oauth-mcp-test-server",
      version: "0.0.0",
    });
    expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");
    expect(probe.result.current.resources.map((resource) => resource.uri)).toContain(
      "mcp-test://profile",
    );
    expect(
      probe.result.current.resourceTemplates.map((template) => template.uriTemplate),
    ).toContain("mcp-test://profiles/{profileId}");
    expect(probe.result.current.prompts.map((prompt) => prompt.name)).toContain(
      "summarize-profile",
    );
    expect(connectedClient).not.toBe(probe.result.current.client);
    expect(connectedTransport).not.toBe(probe.result.current.transport);

    await probe.unmount();
  });

  it("closes the active SDK connection when connect is called with disabled options", async () => {
    const server = createOAuthMcpTestServer({
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    const connectedTransport = probe.result.current.transport;
    let transportClosed = false;
    connectedTransport!.onclose = () => {
      transportClosed = true;
    };

    await probe.act(() => probe.result.current.connect({ enabled: false, url: null }));

    expect(transportClosed).toBe(true);
    expect(probe.result.current.status).toBe("idle");
    expect(probe.result.current.client).toBeNull();
    expect(probe.result.current.transport).toBeNull();

    await probe.unmount();
  });

  it("closes the existing SDK connection before replacing it with connect", async () => {
    const server = createOAuthMcpTestServer({
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    const firstClient = probe.result.current.client;
    const firstTransport = probe.result.current.transport;
    let firstTransportClosed = false;
    firstTransport!.onclose = () => {
      firstTransportClosed = true;
    };

    await probe.act(() => probe.result.current.connect());

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(firstTransportClosed).toBe(true);
    expect(probe.result.current.client).toBeInstanceOf(Client);
    expect(probe.result.current.transport).toBeInstanceOf(StreamableHTTPClientTransport);
    expect(probe.result.current.client).not.toBe(firstClient);
    expect(probe.result.current.transport).not.toBe(firstTransport);
    expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("reports bearer auth requirements for a bearer-only MCP server without probing OAuth endpoints", async () => {
    const server = createOAuthMcpTestServer({
      advertiseOAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        authRequirement: mcp.authRequirement,
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    expect(probe.result.current.authRequirement).toEqual({
      realm: "mcp-test",
      reason: "oauth_metadata_absent",
      scopes: ["mcp:tools"],
      type: "bearer",
    });
    expect(probe.result.current.authorizationUrl).toBeNull();
    expect(probe.result.current.error).toBeNull();
    expect(probe.result.current.client).toBeNull();
    expect(probe.result.current.transport).toBeNull();
    expect(probe.result.current.tools).toEqual([]);
    expect(probe.result.current.resources).toEqual([]);
    expect(probe.result.current.resourceTemplates).toEqual([]);
    expect(probe.result.current.prompts).toEqual([]);
    expect(probe.snapshots()).toContainEqual({
      authRequirement: {
        realm: "mcp-test",
        reason: "oauth_metadata_absent",
        scopes: ["mcp:tools"],
        type: "bearer",
      },
      status: "pending_auth",
    });
    expect(server.requestLog).toContainEqual(
      expect.objectContaining({
        method: "POST",
        pathname: "/mcp",
        status: 401,
      }),
    );
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        pathname: "/.well-known/oauth-protected-resource/mcp",
      }),
    );
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        pathname: "/.well-known/oauth-authorization-server",
      }),
    );
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        pathname: "/register",
      }),
    );
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        pathname: "/token",
      }),
    );

    await probe.unmount();
  });

  it("parses bearer auth requirements from mixed and unquoted authenticate parameters", async () => {
    const mcpUrl = `${window.location.origin}/mcp-custom-auth-header`;
    worker.use(
      http.post(mcpUrl, () =>
        HttpResponse.json(
          { error: "missing bearer token" },
          {
            headers: {
              "WWW-Authenticate":
                'Basic realm="ignored", Bearer realm=mcp-test, scope="mcp:tools mcp:resources"',
            },
            status: 401,
          },
        ),
      ),
    );

    const probe = await renderHookProbe(
      () => useMcp({ url: mcpUrl }),
      (mcp) => ({
        authRequirement: mcp.authRequirement,
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    expect(probe.result.current.authRequirement).toEqual({
      realm: "mcp-test",
      reason: "oauth_metadata_absent",
      scopes: ["mcp:tools", "mcp:resources"],
      type: "bearer",
    });

    await probe.unmount();
  });

  it("connects to a bearer-only MCP server with a provided bearer token and loads the catalog", async () => {
    const token = "test-api-key";
    const server = createOAuthMcpTestServer({
      acceptedBearerTokens: [
        {
          clientId: "api-key-client",
          resource: `${window.location.origin}/mcp`,
          scope: "mcp:tools",
          token,
        },
      ],
      advertiseOAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ bearerToken: token, url: server.mcpUrl }),
      (mcp) => ({
        promptNames: mcp.prompts.map((prompt) => prompt.name),
        resourceTemplateUris: mcp.resourceTemplates.map((template) => template.uriTemplate),
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(probe.result.current.authRequirement).toBeNull();
    expect(probe.result.current.error).toBeNull();
    expect(probe.result.current.client).toBeInstanceOf(Client);
    expect(probe.result.current.transport).toBeInstanceOf(StreamableHTTPClientTransport);
    expect(probe.result.current.serverProfile?.auth).toEqual({ mode: "external-bearer" });
    expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");
    expect(probe.result.current.resources.map((resource) => resource.uri)).toContain(
      "mcp-test://profile",
    );
    expect(
      probe.result.current.resourceTemplates.map((template) => template.uriTemplate),
    ).toContain("mcp-test://profiles/{profileId}");
    expect(probe.result.current.prompts.map((prompt) => prompt.name)).toContain(
      "summarize-profile",
    );
    expect(probe.snapshots()).toContainEqual({
      promptNames: ["summarize-profile"],
      resourceTemplateUris: ["mcp-test://profiles/{profileId}"],
      status: "ready",
      toolNames: ["whoami"],
    });
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        status: 401,
      }),
    );
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        pathname: "/.well-known/oauth-protected-resource/mcp",
      }),
    );
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        pathname: "/.well-known/oauth-authorization-server",
      }),
    );
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        pathname: "/register",
      }),
    );
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        pathname: "/token",
      }),
    );

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("reconnects with the latest bearer token when the token value changes", async () => {
    const firstToken = "test-api-key-1";
    const secondToken = "test-api-key-2";
    const server = createOAuthMcpTestServer({
      acceptedBearerTokens: [
        {
          clientId: "api-key-client",
          resource: `${window.location.origin}/mcp`,
          scope: "mcp:tools",
          token: firstToken,
        },
        {
          clientId: "api-key-client",
          resource: `${window.location.origin}/mcp`,
          scope: "mcp:tools",
          token: secondToken,
        },
      ],
      advertiseOAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      (props?: { token: string }) => useMcp({ bearerToken: props!.token, url: server.mcpUrl }),
      (mcp) => ({
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
      {
        initialProps: { token: firstToken },
      },
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });
    const mcpRequestsAfterReady = mcpPostRequestCount(server.requestLog);
    const firstWhoami = await probe.result.current.client!.callTool({
      arguments: {},
      name: "whoami",
    });
    expect(readWhoamiToken(firstWhoami)).toBe(firstToken);

    await probe.rerender({ token: secondToken });
    await vi.waitFor(() => {
      expect(mcpPostRequestCount(server.requestLog)).toBeGreaterThan(mcpRequestsAfterReady);
    });
    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(probe.result.current.status).toBe("ready");
    expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");
    const secondWhoami = await probe.result.current.client!.callTool({
      arguments: {},
      name: "whoami",
    });
    expect(readWhoamiToken(secondWhoami)).toBe(secondToken);

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("does not reconnect when an inline URL object is semantically unchanged", async () => {
    const server = createOAuthMcpTestServer({
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      (_props?: { nonce: number }) => useMcp({ url: new URL(server.mcpUrl) }),
      (mcp) => ({
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
      {
        initialProps: { nonce: 0 },
      },
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });
    const mcpRequestsAfterReady = mcpPostRequestCount(server.requestLog);

    await probe.rerender({ nonce: 1 });
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 120);
    });

    expect(probe.result.current.status).toBe("ready");
    expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");
    expect(mcpPostRequestCount(server.requestLog)).toBe(mcpRequestsAfterReady);

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("passes client capabilities and client options into SDK initialize without reconnecting for equivalent inline options", async () => {
    const server = createOAuthMcpTestServer({
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      (_props?: { nonce: number }) =>
        useMcp({
          clientCapabilities: {
            extensions: {
              "io.modelcontextprotocol/ui": {},
            },
          },
          clientOptions: {
            capabilities: {
              experimental: {
                "example.dev/host": {},
              },
            },
            enforceStrictCapabilities: true,
          },
          url: server.mcpUrl,
        }),
      (mcp) => ({
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
      {
        initialProps: { nonce: 0 },
      },
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(server.requestLog).toContainEqual(
      expect.objectContaining({
        initializeCapabilities: {
          experimental: {
            "example.dev/host": {},
          },
          extensions: {
            "io.modelcontextprotocol/ui": {},
          },
        },
        jsonRpcMethod: "initialize",
      }),
    );
    const mcpRequestsAfterReady = mcpPostRequestCount(server.requestLog);

    await probe.rerender({ nonce: 1 });
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 120);
    });

    expect(probe.result.current.status).toBe("ready");
    expect(mcpPostRequestCount(server.requestLog)).toBe(mcpRequestsAfterReady);

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("advertises MCP Apps support through the apps capability helper", async () => {
    const server = createOAuthMcpTestServer({
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () =>
        useMcp({
          clientCapabilities: createMcpAppClientCapabilities(),
          url: server.mcpUrl,
        }),
      (mcp) => ({
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(server.requestLog).toContainEqual(
      expect.objectContaining({
        initializeCapabilities: {
          extensions: {
            "io.modelcontextprotocol/ui": {
              mimeTypes: ["text/html;profile=mcp-app"],
            },
          },
        },
        jsonRpcMethod: "initialize",
      }),
    );

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("reads MCP App HTML resources through the authorized MCP client", async () => {
    const server = createOAuthMcpTestServer({
      appResources: [
        {
          html: "<main>Forecast ready</main>",
          uri: "ui://weather/view.html",
        },
      ],
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () =>
        useMcp({
          clientCapabilities: createMcpAppClientCapabilities(),
          url: server.mcpUrl,
        }),
      (mcp) => ({
        client: mcp.client,
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    const client = probe.result.current.client;
    if (!client) {
      throw new Error("Expected useMcp to expose a connected client.");
    }

    await expect(readMcpAppResource(client, "ui://weather/view.html")).resolves.toEqual({
      html: "<main>Forecast ready</main>",
      metadata: undefined,
      mimeType: "text/html;profile=mcp-app",
      uri: "ui://weather/view.html",
    });

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("decodes blob MCP App HTML resources through the authorized MCP client", async () => {
    const html = "<main>Blob café forecast ready</main>";
    const bytes = new TextEncoder().encode(html);
    const server = createOAuthMcpTestServer({
      appResources: [
        {
          blob: window.btoa(String.fromCharCode(...bytes)),
          uri: "ui://weather/blob-view.html",
        },
      ],
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () =>
        useMcp({
          clientCapabilities: createMcpAppClientCapabilities(),
          url: server.mcpUrl,
        }),
      (mcp) => ({
        client: mcp.client,
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    const client = probe.result.current.client;
    if (!client) {
      throw new Error("Expected useMcp to expose a connected client.");
    }

    await expect(readMcpAppResource(client, "ui://weather/blob-view.html")).resolves.toEqual({
      html,
      metadata: undefined,
      mimeType: "text/html;profile=mcp-app",
      uri: "ui://weather/blob-view.html",
    });

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("rejects resources that do not use the MCP Apps MIME type", async () => {
    const server = createOAuthMcpTestServer({
      appResources: [
        {
          html: "<main>Plain HTML</main>",
          mimeType: "text/html",
          uri: "ui://weather/plain-html.html",
        },
      ],
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () =>
        useMcp({
          clientCapabilities: createMcpAppClientCapabilities(),
          url: server.mcpUrl,
        }),
      (mcp) => ({
        client: mcp.client,
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    const client = probe.result.current.client;
    if (!client) {
      throw new Error("Expected useMcp to expose a connected client.");
    }

    await expect(readMcpAppResource(client, "ui://weather/plain-html.html")).rejects.toThrow(
      "Expected MCP App resource ui://weather/plain-html.html to use MIME type text/html;profile=mcp-app.",
    );

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("returns MCP App resource UI metadata from the content payload", async () => {
    const server = createOAuthMcpTestServer({
      appResources: [
        {
          html: "<main>Metadata forecast ready</main>",
          metadata: {
            csp: {
              connectSrc: ["https://api.example.test"],
            },
            permissions: {
              clipboardWrite: true,
            },
          },
          uri: "ui://weather/metadata-view.html",
        },
      ],
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () =>
        useMcp({
          clientCapabilities: createMcpAppClientCapabilities(),
          url: server.mcpUrl,
        }),
      (mcp) => ({
        client: mcp.client,
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    const client = probe.result.current.client;
    if (!client) {
      throw new Error("Expected useMcp to expose a connected client.");
    }

    await expect(readMcpAppResource(client, "ui://weather/metadata-view.html")).resolves.toEqual({
      html: "<main>Metadata forecast ready</main>",
      metadata: {
        csp: {
          connectSrc: ["https://api.example.test"],
        },
        permissions: {
          clipboardWrite: true,
        },
      },
      mimeType: "text/html;profile=mcp-app",
      uri: "ui://weather/metadata-view.html",
    });

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("renders MCP App HTML resources in a sandboxed iframe", async () => {
    const server = createOAuthMcpTestServer({
      appResources: [
        {
          html: "<main><h1>Forecast iframe ready</h1></main>",
          uri: "ui://weather/render-view.html",
        },
      ],
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    function AppHost() {
      const mcp = useMcp({
        clientCapabilities: createMcpAppClientCapabilities(),
        url: server.mcpUrl,
      });

      if (mcp.status !== "ready" || !mcp.client) {
        return <p>Connecting</p>;
      }

      return (
        <McpAppView
          client={mcp.client}
          title="Weather MCP App"
          uri="ui://weather/render-view.html"
        />
      );
    }

    await render(<AppHost />);

    const iframe = page.getByTitle("Weather MCP App");
    await expect.element(iframe).toBeVisible();

    const iframeElement = document.querySelector("iframe[title='Weather MCP App']");
    expect(iframeElement?.getAttribute("sandbox")).toBe("allow-scripts");
    await vi.waitFor(() => {
      expect(iframeElement?.getAttribute("src")).toBe(
        "data:text/html;charset=utf-8,%3Cmain%3E%3Ch1%3EForecast%20iframe%20ready%3C%2Fh1%3E%3C%2Fmain%3E",
      );
    });
  });

  it("does not tear down an MCP App iframe during normal data-url loading", async () => {
    const appMessages: unknown[] = [];
    const appMessageListener = (event: MessageEvent) => {
      if (event.data?.type?.startsWith("mcp-app-lifecycle-")) {
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
                  window.parent.postMessage({ type: "mcp-app-lifecycle-ready" }, "*");
                  return;
                }

                if (event.data?.method === "ui/resource-teardown") {
                  window.parent.postMessage({ type: "mcp-app-lifecycle-teardown" }, "*");
                  window.parent.postMessage({
                    id: event.data.id,
                    jsonrpc: "2.0",
                    result: {}
                  }, "*");
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
                    appInfo: { name: "lifecycle-test-app", version: "0.0.0" },
                    protocolVersion: "2026-01-26"
                  }
                }, "*");
              }, 20);
            </script>
          `,
          uri: "ui://weather/single-init-view.html",
        },
      ],
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    function AppHost() {
      const mcp = useMcp({
        clientCapabilities: createMcpAppClientCapabilities(),
        url: server.mcpUrl,
      });

      if (mcp.status !== "ready" || !mcp.client) {
        return <p>Connecting</p>;
      }

      return (
        <McpAppView
          client={mcp.client}
          title="Single Init MCP App"
          uri="ui://weather/single-init-view.html"
        />
      );
    }

    try {
      await render(<AppHost />);

      await vi.waitFor(() => {
        expect(appMessages).toContainEqual({ type: "mcp-app-lifecycle-ready" });
      });
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 120);
      });

      expect(appMessages).not.toContainEqual({ type: "mcp-app-lifecycle-teardown" });
    } finally {
      window.removeEventListener("message", appMessageListener);
    }
  });

  it("sends MCP App resource teardown before switching iframe resources", async () => {
    const appMessages: unknown[] = [];
    const appMessageListener = (event: MessageEvent) => {
      if (event.data?.type?.startsWith("mcp-app-lifecycle-")) {
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
                  window.parent.postMessage({ type: "mcp-app-lifecycle-ready" }, "*");
                  return;
                }

                if (event.data?.method === "ui/resource-teardown") {
                  window.parent.postMessage({ type: "mcp-app-lifecycle-teardown" }, "*");
                  window.parent.postMessage({
                    id: event.data.id,
                    jsonrpc: "2.0",
                    result: {}
                  }, "*");
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
                    appInfo: { name: "teardown-test-app", version: "0.0.0" },
                    protocolVersion: "2026-01-26"
                  }
                }, "*");
              }, 20);
            </script>
          `,
          uri: "ui://weather/teardown-first-view.html",
        },
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
                  window.parent.postMessage({ type: "mcp-app-lifecycle-next-ready" }, "*");
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
                    appInfo: { name: "next-test-app", version: "0.0.0" },
                    protocolVersion: "2026-01-26"
                  }
                }, "*");
              }, 20);
            </script>
          `,
          uri: "ui://weather/teardown-next-view.html",
        },
      ],
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    function AppHost() {
      const [uri, setUri] = useState("ui://weather/teardown-first-view.html");
      const mcp = useMcp({
        clientCapabilities: createMcpAppClientCapabilities(),
        url: server.mcpUrl,
      });

      if (mcp.status !== "ready" || !mcp.client) {
        return <p>Connecting</p>;
      }

      return (
        <>
          <button onClick={() => setUri("ui://weather/teardown-next-view.html")} type="button">
            Switch app
          </button>
          <McpAppView client={mcp.client} title="Teardown MCP App" uri={uri} />
        </>
      );
    }

    try {
      await render(<AppHost />);

      await vi.waitFor(() => {
        expect(appMessages).toContainEqual({ type: "mcp-app-lifecycle-ready" });
      });

      await page.getByRole("button", { name: "Switch app" }).click();

      await vi.waitFor(() => {
        expect(appMessages).toContainEqual({ type: "mcp-app-lifecycle-teardown" });
      });
      await vi.waitFor(() => {
        expect(appMessages).toContainEqual({ type: "mcp-app-lifecycle-next-ready" });
      });
    } finally {
      window.removeEventListener("message", appMessageListener);
    }
  });

  it("lets MCP Apps call protected server tools through the parent authorized client", async () => {
    const token = "bridge-test-token";
    const appResultMessages: unknown[] = [];
    const appMessageListener = (event: MessageEvent) => {
      if (event.data?.type === "mcp-app-test-result") {
        appResultMessages.push(event.data);
      }
    };
    window.addEventListener("message", appMessageListener);

    const server = createOAuthMcpTestServer({
      acceptedBearerTokens: [
        {
          clientId: "bridge-test-client",
          resource: `${window.location.origin}/mcp`,
          scope: "mcp:tools",
          token,
        },
      ],
      advertiseOAuth: false,
      appResources: [
        {
          html: `
            <main>Bridge app</main>
            <script>
              const seenMessages = [];
              let initialized = false;
              let nextId = 1;
              let toolCallId = 0;

              window.addEventListener("message", (event) => {
                seenMessages.push(JSON.stringify(event.data));

                if (event.data?.id === 1 && !initialized) {
                  initialized = true;
                  window.parent.postMessage({
                    jsonrpc: "2.0",
                    method: "ui/notifications/initialized"
                  }, "*");
                  toolCallId = ++nextId;
                  window.parent.postMessage({
                    id: toolCallId,
                    jsonrpc: "2.0",
                    method: "tools/call",
                    params: {
                      name: "app-visible-tool",
                      arguments: {}
                    }
                  }, "*");
                }

                if (event.data?.id === toolCallId) {
                  window.parent.postMessage({
                    type: "mcp-app-test-result",
                    result: event.data.result,
                    sawToken: seenMessages.some((message) => message.includes("${token}"))
                  }, "*");
                }
              });

              const initializeInterval = window.setInterval(() => {
                if (initialized) {
                  window.clearInterval(initializeInterval);
                  return;
                }
                window.parent.postMessage({
                  id: 1,
                  jsonrpc: "2.0",
                  method: "ui/initialize",
                  params: {
                    appCapabilities: {},
                    appInfo: { name: "bridge-test-app", version: "0.0.0" },
                    protocolVersion: "2026-01-26"
                  }
                }, "*");
              }, 20);
            </script>
          `,
          uri: "ui://weather/bridge-view.html",
        },
      ],
      requireAuth: true,
      transportMode: "stateless",
    });
    server.registerTool("app-visible-tool");
    worker.use(...server.handlers);

    function AppHost() {
      const mcp = useMcp({
        bearerToken: token,
        clientCapabilities: createMcpAppClientCapabilities(),
        url: server.mcpUrl,
      });

      if (mcp.status !== "ready" || !mcp.client) {
        return <p>Connecting</p>;
      }

      return (
        <McpAppView
          client={mcp.client}
          title="Weather Bridge MCP App"
          tools={mcp.tools}
          uri="ui://weather/bridge-view.html"
        />
      );
    }

    try {
      await render(<AppHost />);

      await vi.waitFor(() => {
        expect(appResultMessages).toContainEqual(
          expect.objectContaining({
            result: {
              content: [
                {
                  text: "app-visible-tool",
                  type: "text",
                },
              ],
            },
            sawToken: false,
            type: "mcp-app-test-result",
          }),
        );
      });

      expect(server.requestLog).toContainEqual(
        expect.objectContaining({
          authorization: `Bearer ${token}`,
          jsonRpcMethod: "tools/call",
        }),
      );
    } finally {
      window.removeEventListener("message", appMessageListener);
    }
  });

  it("rejects MCP App calls to model-only server tools", async () => {
    const appResultMessages: unknown[] = [];
    const appMessageListener = (event: MessageEvent) => {
      if (event.data?.type === "mcp-app-denied-tool-result") {
        appResultMessages.push(event.data);
      }
    };
    window.addEventListener("message", appMessageListener);

    const server = createOAuthMcpTestServer({
      appResources: [
        {
          html: `
            <script>
              let initialized = false;
              let toolCallId = 0;

              window.addEventListener("message", (event) => {
                if (event.data?.id === 1 && !initialized) {
                  initialized = true;
                  window.parent.postMessage({
                    jsonrpc: "2.0",
                    method: "ui/notifications/initialized"
                  }, "*");
                  toolCallId = 2;
                  window.parent.postMessage({
                    id: toolCallId,
                    jsonrpc: "2.0",
                    method: "tools/call",
                    params: {
                      name: "model-only-tool",
                      arguments: {}
                    }
                  }, "*");
                }

                if (event.data?.id === toolCallId) {
                  window.parent.postMessage({
                    error: event.data.error,
                    type: "mcp-app-denied-tool-result"
                  }, "*");
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
                    appInfo: { name: "denied-tool-test-app", version: "0.0.0" },
                    protocolVersion: "2026-01-26"
                  }
                }, "*");
              }, 20);
            </script>
          `,
          uri: "ui://weather/denied-tool-view.html",
        },
      ],
      requireAuth: false,
      transportMode: "stateless",
    });
    server.registerTool("model-only-tool", {
      metadata: {
        ui: {
          visibility: ["model"],
        },
      },
    });
    worker.use(...server.handlers);

    function AppHost() {
      const mcp = useMcp({
        clientCapabilities: createMcpAppClientCapabilities(),
        url: server.mcpUrl,
      });

      if (mcp.status !== "ready" || !mcp.client) {
        return <p>Connecting</p>;
      }

      return (
        <McpAppView
          client={mcp.client}
          title="Denied Tool MCP App"
          tools={mcp.tools}
          uri="ui://weather/denied-tool-view.html"
        />
      );
    }

    try {
      await render(<AppHost />);

      await vi.waitFor(() => {
        expect(appResultMessages).toContainEqual(
          expect.objectContaining({
            error: expect.objectContaining({
              message: expect.stringContaining(
                "MCP App is not allowed to call tool model-only-tool.",
              ),
            }),
            type: "mcp-app-denied-tool-result",
          }),
        );
      });

      expect(server.requestLog.some((entry) => entry.jsonRpcMethod === "tools/call")).toBe(false);
    } finally {
      window.removeEventListener("message", appMessageListener);
    }
  });

  it("uses the latest MCP App tools policy without reloading the iframe", async () => {
    const appMessages: unknown[] = [];
    const appMessageListener = (event: MessageEvent) => {
      if (event.data?.type?.startsWith("mcp-app-policy-")) {
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
              let toolCallId = 0;

              window.addEventListener("message", (event) => {
                if (event.data?.id === 1 && !initialized) {
                  initialized = true;
                  window.parent.postMessage({
                    jsonrpc: "2.0",
                    method: "ui/notifications/initialized"
                  }, "*");
                  window.parent.postMessage({ type: "mcp-app-policy-initialized" }, "*");
                }

                if (event.data?.type === "mcp-app-policy-call-tool") {
                  toolCallId += 1;
                  window.parent.postMessage({
                    id: toolCallId + 1,
                    jsonrpc: "2.0",
                    method: "tools/call",
                    params: {
                      name: "dynamic-policy-tool",
                      arguments: {}
                    }
                  }, "*");
                  return;
                }

                if (event.data?.id === toolCallId + 1 && toolCallId > 0) {
                  window.parent.postMessage({
                    error: event.data.error,
                    result: event.data.result,
                    type: "mcp-app-policy-tool-result"
                  }, "*");
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
                    appInfo: { name: "policy-test-app", version: "0.0.0" },
                    protocolVersion: "2026-01-26"
                  }
                }, "*");
              }, 20);
            </script>
          `,
          uri: "ui://weather/policy-view.html",
        },
      ],
      requireAuth: false,
      transportMode: "stateless",
    });
    server.registerTool("dynamic-policy-tool");
    worker.use(...server.handlers);

    function AppHost() {
      const [denyTool, setDenyTool] = useState(false);
      const mcp = useMcp({
        clientCapabilities: createMcpAppClientCapabilities(),
        url: server.mcpUrl,
      });

      if (mcp.status !== "ready" || !mcp.client) {
        return <p>Connecting</p>;
      }

      const tools = denyTool
        ? mcp.tools.map((tool) =>
            tool.name === "dynamic-policy-tool"
              ? { ...tool, _meta: { ...tool._meta, ui: { visibility: ["model"] } } }
              : tool,
          )
        : mcp.tools;

      return (
        <>
          <button onClick={() => setDenyTool(true)} type="button">
            Deny app tool
          </button>
          <McpAppView
            client={mcp.client}
            title="Policy MCP App"
            tools={tools}
            uri="ui://weather/policy-view.html"
          />
        </>
      );
    }

    try {
      await render(<AppHost />);

      await vi.waitFor(() => {
        expect(appMessages).toContainEqual({ type: "mcp-app-policy-initialized" });
      });
      const iframe = document.querySelector<HTMLIFrameElement>("iframe[title='Policy MCP App']");
      const iframeSrc = iframe?.getAttribute("src");
      expect(iframeSrc).toBeTruthy();

      await page.getByRole("button", { name: "Deny app tool" }).click();
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 80);
      });

      expect(document.querySelector("iframe[title='Policy MCP App']")?.getAttribute("src")).toBe(
        iframeSrc,
      );

      iframe?.contentWindow?.postMessage({ type: "mcp-app-policy-call-tool" }, "*");

      await vi.waitFor(() => {
        expect(appMessages).toContainEqual(
          expect.objectContaining({
            error: expect.objectContaining({
              message: expect.stringContaining(
                "MCP App is not allowed to call tool dynamic-policy-tool.",
              ),
            }),
            type: "mcp-app-policy-tool-result",
          }),
        );
      });
      expect(server.requestLog.some((entry) => entry.jsonRpcMethod === "tools/call")).toBe(false);
    } finally {
      window.removeEventListener("message", appMessageListener);
    }
  });

  it("refreshes only the catalog section named by list-changed notifications", async () => {
    const server = createOAuthMcpTestServer({
      requireAuth: false,
      transportMode: "stateful",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        promptNames: mcp.prompts.map((prompt) => prompt.name),
        resourceUris: mcp.resources.map((resource) => resource.uri),
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });
    const originalTools = probe.result.current.tools;
    const originalResources = probe.result.current.resources;
    const originalResourceTemplates = probe.result.current.resourceTemplates;
    const originalPrompts = probe.result.current.prompts;
    const originalCallTool = probe.result.current.callTool;
    const originalReadResource = probe.result.current.readResource;
    const originalGetPrompt = probe.result.current.getPrompt;
    const originalComplete = probe.result.current.complete;

    server.registerTool("dynamic-tool");
    server.sendToolListChanged();

    await vi.waitFor(() => {
      expect(probe.result.current.tools.map((tool) => tool.name)).toContain("dynamic-tool");
    });
    expect(probe.result.current.tools).not.toBe(originalTools);
    expect(probe.result.current.resources).toBe(originalResources);
    expect(probe.result.current.resourceTemplates).toBe(originalResourceTemplates);
    expect(probe.result.current.prompts).toBe(originalPrompts);
    expect(probe.result.current.callTool).toBe(originalCallTool);
    expect(probe.result.current.readResource).toBe(originalReadResource);
    expect(probe.result.current.getPrompt).toBe(originalGetPrompt);
    expect(probe.result.current.complete).toBe(originalComplete);

    const resourcesAfterToolRefresh = probe.result.current.resources;
    const resourceTemplatesAfterToolRefresh = probe.result.current.resourceTemplates;
    const promptsAfterToolRefresh = probe.result.current.prompts;
    server.registerResource("mcp-test://dynamic-resource");
    server.sendResourceListChanged();

    await vi.waitFor(() => {
      expect(probe.result.current.resources.map((resource) => resource.uri)).toContain(
        "mcp-test://dynamic-resource",
      );
    });
    expect(probe.result.current.prompts).toBe(promptsAfterToolRefresh);
    expect(probe.result.current.resourceTemplates).toBe(resourceTemplatesAfterToolRefresh);
    expect(probe.result.current.resources).not.toBe(resourcesAfterToolRefresh);
    expect(probe.result.current.callTool).toBe(originalCallTool);
    expect(probe.result.current.readResource).toBe(originalReadResource);
    expect(probe.result.current.getPrompt).toBe(originalGetPrompt);
    expect(probe.result.current.complete).toBe(originalComplete);

    server.registerPrompt("dynamic-prompt");
    server.sendPromptListChanged();

    await vi.waitFor(() => {
      expect(probe.result.current.prompts.map((prompt) => prompt.name)).toContain("dynamic-prompt");
    });
    expect(probe.result.current.resourceTemplates).toBe(resourceTemplatesAfterToolRefresh);
    expect(probe.result.current.callTool).toBe(originalCallTool);
    expect(probe.result.current.readResource).toBe(originalReadResource);
    expect(probe.result.current.getPrompt).toBe(originalGetPrompt);
    expect(probe.result.current.complete).toBe(originalComplete);
    expect(probe.result.current.catalogStatus).toBe("ready");
    expect(probe.result.current.catalogErrors).toEqual({});

    await probe.act(() => probe.result.current.disconnect());
    await probe.unmount();
  });

  it.each([
    {
      expectedItems: ["whoami"],
      jsonRpcMethod: "tools/list",
      label: "tools",
      readItems: (mcp: ReturnType<typeof useMcp>) => mcp.tools.map((tool) => tool.name),
      sendListChanged: (server: OAuthMcpTestServer) => server.sendToolListChanged(),
    },
    {
      expectedItems: ["mcp-test://profile", "mcp-test://profiles/current"],
      jsonRpcMethod: "resources/list",
      label: "resources",
      readItems: (mcp: ReturnType<typeof useMcp>) => mcp.resources.map((resource) => resource.uri),
      sendListChanged: (server: OAuthMcpTestServer) => server.sendResourceListChanged(),
    },
    {
      expectedItems: ["summarize-profile"],
      jsonRpcMethod: "prompts/list",
      label: "prompts",
      readItems: (mcp: ReturnType<typeof useMcp>) => mcp.prompts.map((prompt) => prompt.name),
      sendListChanged: (server: OAuthMcpTestServer) => server.sendPromptListChanged(),
    },
  ])(
    "does not re-render when a $label list-changed refresh returns a semantically unchanged catalog section",
    async ({ expectedItems, jsonRpcMethod, readItems, sendListChanged }) => {
      const server = createOAuthMcpTestServer({
        requireAuth: false,
        transportMode: "stateful",
      });
      worker.use(...server.handlers);

      const probe = await renderHookProbe(
        () => useMcp({ url: server.mcpUrl }),
        (mcp) => ({
          catalogErrors: mcp.catalogErrors,
          catalogStatus: mcp.catalogStatus,
          items: readItems(mcp),
          status: mcp.status,
        }),
      );

      await vi.waitFor(() => {
        expect(probe.result.current.status).toBe("ready");
      });

      const listRequestsAfterReady = mcpJsonRpcRequestCount(server.requestLog, jsonRpcMethod);
      const renderCountAfterReady = probe.snapshots().length;

      sendListChanged(server);

      await vi.waitFor(() => {
        expect(mcpJsonRpcRequestCount(server.requestLog, jsonRpcMethod)).toBeGreaterThan(
          listRequestsAfterReady,
        );
      });
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 80);
      });

      expect(probe.result.current.status).toBe("ready");
      expect(probe.result.current.catalogStatus).toBe("ready");
      expect(probe.result.current.catalogErrors).toEqual({});
      expect(readItems(probe.result.current)).toEqual(expectedItems);
      expect(probe.snapshots()).toHaveLength(renderCountAfterReady);

      await probe.act(() => probe.result.current.disconnect());
      await probe.unmount();
    },
  );

  it("keeps the active client ready when a live catalog refresh fails", async () => {
    const server = createOAuthMcpTestServer({
      requireAuth: false,
      transportMode: "stateful",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        catalogStatus: mcp.catalogStatus,
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });
    const client = probe.result.current.client;
    const resources = probe.result.current.resources;
    const resourceTemplates = probe.result.current.resourceTemplates;
    const prompts = probe.result.current.prompts;

    server.failCatalogMethods(["tools/list"]);
    server.sendToolListChanged();

    await vi.waitFor(() => {
      expect(probe.result.current.catalogStatus).toBe("partial");
    });

    expect(probe.result.current.client).toBe(client);
    expect(probe.result.current.status).toBe("ready");
    expect(probe.result.current.resources).toBe(resources);
    expect(probe.result.current.resourceTemplates).toBe(resourceTemplates);
    expect(probe.result.current.prompts).toBe(prompts);
    expect(probe.result.current.catalogErrors).toHaveProperty("tools");
    expect(probe.result.current.serverProfile?.catalog.tools).toMatchObject({
      complete: false,
      error: expect.any(Error),
      items: [{ name: "whoami" }],
    });

    await probe.act(() => probe.result.current.disconnect());
    await probe.unmount();
  });

  it("ignores stale list-changed refreshes after reconnecting to a newer connection", async () => {
    const firstServer = createOAuthMcpTestServer({
      mcpPath: "/mcp-stale-first",
      randomResponseDelay: { maxMs: 80, seed: 1 },
      requireAuth: false,
      transportMode: "stateful",
    });
    const secondServer = createOAuthMcpTestServer({
      mcpPath: "/mcp-stale-second",
      requireAuth: false,
      transportMode: "stateful",
    });
    worker.use(...firstServer.handlers, ...secondServer.handlers);

    const probe = await renderHookProbe(
      (props?: { url: string }) => useMcp({ url: props!.url }),
      (mcp) => ({
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
      {
        initialProps: { url: firstServer.mcpUrl },
      },
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    firstServer.registerTool("stale-tool");
    firstServer.sendToolListChanged();
    await probe.rerender({ url: secondServer.mcpUrl });

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 160);
    });

    expect(probe.result.current.serverProfile?.url).toBe(secondServer.mcpUrl);
    expect(probe.result.current.tools.map((tool) => tool.name)).not.toContain("stale-tool");

    await probe.act(() => probe.result.current.disconnect());
    await probe.unmount();
  });

  it("wraps MCP operations with structured results and stable identities", async () => {
    const server = createOAuthMcpTestServer({
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ enabled: false, url: server.mcpUrl }),
      (mcp) => ({
        callTool: mcp.callTool,
        status: mcp.status,
      }),
    );

    expect(await probe.result.current.callTool({ name: "whoami" })).toEqual({
      ok: false,
      reason: "not_connected",
    });
    const initialCallTool = probe.result.current.callTool;
    const initialReadResource = probe.result.current.readResource;
    const initialGetPrompt = probe.result.current.getPrompt;
    const initialComplete = probe.result.current.complete;

    await probe.act(() => probe.result.current.connect({ enabled: true }));
    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(probe.result.current.callTool).toBe(initialCallTool);
    expect(probe.result.current.readResource).toBe(initialReadResource);
    expect(probe.result.current.getPrompt).toBe(initialGetPrompt);
    expect(probe.result.current.complete).toBe(initialComplete);

    const abortController = new AbortController();
    const requestOptions = {
      onprogress: vi.fn(),
      signal: abortController.signal,
      timeout: 1_000,
    };
    const client = probe.result.current.client!;
    const callToolSpy = vi.spyOn(client, "callTool");

    const toolResult = await probe.result.current.callTool(
      {
        arguments: {},
        name: "whoami",
      },
      requestOptions,
    );
    const resourceResult = await probe.result.current.readResource({
      uri: "mcp-test://profile",
    });
    const promptResult = await probe.result.current.getPrompt({
      name: "summarize-profile",
    });
    const completeResult = await probe.result.current.complete({
      argument: { name: "profileId", value: "c" },
      ref: { type: "ref/resource", uri: "mcp-test://profiles/{profileId}" },
    });

    expect(toolResult.ok).toBe(true);
    expect(resourceResult.ok).toBe(true);
    expect(promptResult.ok).toBe(true);
    expect(completeResult).toMatchObject({
      ok: true,
      result: {
        completion: {
          values: ["current"],
        },
      },
    });
    expect(callToolSpy).toHaveBeenCalledWith(
      {
        arguments: {},
        name: "whoami",
      },
      undefined,
      requestOptions,
    );

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("reports OAuth requirements with a prepared authorization URL for an OAuth-protected MCP server", async () => {
    const server = createOAuthMcpTestServer({
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        authorizationPath: mcp.authorizationUrl?.pathname,
        authRequirement: mcp.authRequirement,
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    expect(probe.result.current.error).toBeNull();
    expect(probe.result.current.client).toBeNull();
    expect(probe.result.current.transport).toBeNull();
    expect(probe.result.current.authorizationUrl).toBeInstanceOf(URL);
    expect(probe.result.current.authorizationUrl?.origin).toBe(window.location.origin);
    expect(probe.result.current.authorizationUrl?.pathname).toBe("/authorize");
    expect(probe.result.current.authorizationUrl?.searchParams.get("resource")).toBe(server.mcpUrl);
    expect(probe.result.current.authorizationUrl?.searchParams.get("code_challenge_method")).toBe(
      "S256",
    );
    expect(probe.result.current.authorizationUrl?.searchParams.get("client_id")).toBe("client-1");
    expect(probe.result.current.authRequirement).toMatchObject({
      issuer: window.location.origin,
      scopes: ["mcp:tools"],
      supportsClientMetadataDocument: false,
      supportsDynamicClientRegistration: true,
      type: "oauth",
    });
    expect(probe.snapshots()).toContainEqual({
      authorizationPath: "/authorize",
      authRequirement: expect.objectContaining({
        supportsDynamicClientRegistration: true,
        type: "oauth",
      }),
      status: "pending_auth",
    });
    expect(server.requestLog).toContainEqual(
      expect.objectContaining({
        method: "POST",
        pathname: "/mcp",
        status: 401,
      }),
    );
    expect(server.requestLog).toContainEqual(
      expect.objectContaining({
        pathname: "/.well-known/oauth-protected-resource/mcp",
      }),
    );
    expect(server.requestLog).toContainEqual(
      expect.objectContaining({
        pathname: "/.well-known/oauth-authorization-server",
      }),
    );
    expect(server.requestLog).toContainEqual(
      expect.objectContaining({
        method: "POST",
        pathname: "/register",
      }),
    );
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        pathname: "/token",
      }),
    );
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        pathname: "/authorize",
      }),
    );

    await probe.unmount();
  });

  it("uses the Firefox WebExtension identity API when it is available", async () => {
    const server = createOAuthMcpTestServer({
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const redirectUrl = "https://firefox-extension.example.invalid/oauth2";
    const launchedAuthorizationUrls: string[] = [];
    const originalBrowserDescriptor = Object.getOwnPropertyDescriptor(globalThis, "browser");
    Object.defineProperty(globalThis, "browser", {
      configurable: true,
      value: {
        identity: {
          getRedirectURL: () => redirectUrl,
          launchWebAuthFlow: async (details: { interactive?: boolean; url: string }) => {
            launchedAuthorizationUrls.push(details.url);
            expect(details.interactive).toBe(true);
            const authorizationUrl = new URL(details.url);
            const code = server.authorize(authorizationUrl);
            const callbackUrl = new URL(redirectUrl);
            callbackUrl.searchParams.set("code", code);
            callbackUrl.searchParams.set("state", authorizationUrl.searchParams.get("state")!);

            return callbackUrl.toString();
          },
        },
        runtime: { id: "firefox-extension-id" },
      },
    });

    try {
      const probe = await renderHookProbe(
        () => useMcp({ url: server.mcpUrl }),
        (mcp) => ({
          authorizationUrl: mcp.authorizationUrl?.toString(),
          status: mcp.status,
          toolNames: mcp.tools.map((tool) => tool.name),
        }),
      );

      await vi.waitFor(() => {
        expect(probe.result.current.status).toBe("pending_auth");
      });

      expect(probe.result.current.authorizationUrl?.toString()).toContain(
        `redirect_uri=${encodeURIComponent(redirectUrl)}`,
      );

      await probe.act(() => probe.result.current.authorize());

      await vi.waitFor(() => {
        expect(probe.result.current.status).toBe("ready");
      });

      expect(launchedAuthorizationUrls).toEqual([expect.any(String)]);
      expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");
      expect(server.requestLog).toContainEqual(
        expect.objectContaining({
          method: "POST",
          pathname: "/register",
        }),
      );
      expect(server.requestLog).toContainEqual(
        expect.objectContaining({
          grantType: "authorization_code",
          pathname: "/token",
        }),
      );

      await probe.unmount();
    } finally {
      if (originalBrowserDescriptor) {
        Object.defineProperty(globalThis, "browser", originalBrowserDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "browser");
      }
    }
  });

  it("preserves pathful authorization server issuers and metadata URLs", async () => {
    const server = createOAuthMcpTestServer({
      authorizationServerPath: "/oauth2/default",
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        authDiagnostics: mcp.authDiagnostics,
        authRequirement: mcp.authRequirement,
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    expect(probe.result.current.authorizationUrl?.pathname).toBe("/oauth2/default/authorize");
    expect(probe.result.current.authRequirement).toMatchObject({
      issuer: server.authorizationServerUrl,
      supportsDynamicClientRegistration: true,
      type: "oauth",
    });
    expect(probe.result.current.authDiagnostics).toMatchObject({
      authorizationServerMetadataUrl: server.authorizationServerMetadataUrl,
      issuer: server.authorizationServerUrl,
      resourceMetadataUrl: `${window.location.origin}/.well-known/oauth-protected-resource/mcp`,
      registrationStrategy: "dynamic_client_registration",
    });

    const authorizationUrl = probe.result.current.authorizationUrl!;
    const code = server.authorize(authorizationUrl);
    await probe.act(() =>
      probe.result.current.finishAuthorization(code, authorizationUrl.searchParams.get("state")!),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(probe.result.current.serverProfile?.auth).toMatchObject({
      authorizationServerMetadata: {
        authorization_endpoint: server.authorizationEndpoint,
        issuer: server.authorizationServerUrl,
        registration_endpoint: server.registrationEndpoint,
        token_endpoint: server.tokenEndpoint,
      },
      authorizationServerUrl: server.authorizationServerUrl,
      mode: "oauth-protected",
    });
    expect(server.requestLog).toContainEqual(
      expect.objectContaining({
        grantType: "authorization_code",
        method: "POST",
        pathname: "/oauth2/default/token",
      }),
    );

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("handles protected resource metadata that binds an /mcp endpoint to the server origin", async () => {
    const server = createOAuthMcpTestServer({
      protectedResource: window.location.origin,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        authorizationResource: mcp.authorizationUrl?.searchParams.get("resource"),
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    expect(probe.result.current.authorizationUrl?.searchParams.get("resource")).toBe(
      `${window.location.origin}/`,
    );

    const authorizationUrl = probe.result.current.authorizationUrl!;
    const code = server.authorize(authorizationUrl);
    await probe.act(() =>
      probe.result.current.finishAuthorization(code, authorizationUrl.searchParams.get("state")!),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");
    expect(server.requestLog).toContainEqual(
      expect.objectContaining({
        grantType: "authorization_code",
        method: "POST",
        pathname: "/token",
        resource: `${window.location.origin}/`,
      }),
    );

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("routes MCP transport through a proxy while keeping OAuth discovery direct", async () => {
    const server = createOAuthMcpTestServer({
      transportMode: "stateless",
    });
    worker.use(...server.handlers);
    document.cookie = "mcp_proxy_secret=browser-session; path=/";

    const probe = await renderHookProbe(
      () => useMcp({ transportProxy: server.proxyUrl, url: server.mcpUrl }),
      (mcp) => ({
        authorizationResource: mcp.authorizationUrl?.searchParams.get("resource"),
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    expect(probe.result.current.authorizationUrl?.searchParams.get("resource")).toBe(server.mcpUrl);
    expect(server.requestLog).toContainEqual(
      expect.objectContaining({
        jsonRpcMethod: "initialize",
        method: "POST",
        pathname: "/mcp-proxy",
        proxyTargetUrl: server.mcpUrl,
        status: 401,
      }),
    );
    expect(server.requestLog).toContainEqual(
      expect.objectContaining({
        pathname: "/.well-known/oauth-protected-resource/mcp",
      }),
    );
    expect(server.requestLog).toContainEqual(
      expect.objectContaining({
        pathname: "/.well-known/oauth-authorization-server",
      }),
    );
    expect(server.requestLog).toContainEqual(
      expect.objectContaining({
        method: "POST",
        pathname: "/register",
      }),
    );
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        pathname: "/mcp",
      }),
    );

    const authorizationUrl = probe.result.current.authorizationUrl!;
    const code = server.authorize(authorizationUrl);
    await probe.act(() =>
      probe.result.current.finishAuthorization(code, authorizationUrl.searchParams.get("state")!),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");
    expect(server.requestLog).toContainEqual(
      expect.objectContaining({
        grantType: "authorization_code",
        method: "POST",
        pathname: "/token",
        status: 200,
      }),
    );
    expect(server.requestLog).toContainEqual(
      expect.objectContaining({
        accept: expect.stringContaining("application/json"),
        authorization: expect.stringMatching(/^Bearer /u),
        cookie: null,
        jsonRpcMethod: "tools/list",
        mcpProtocolVersion: expect.any(String),
        method: "POST",
        pathname: "/mcp-proxy",
        proxyTargetUrl: server.mcpUrl,
        status: 200,
      }),
    );
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        method: "GET",
        pathname: "/mcp-proxy",
      }),
    );
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        pathname: "/mcp",
      }),
    );

    document.cookie = "mcp_proxy_secret=; max-age=0; path=/";
    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("does not infer OAuth from resource metadata on a non-Bearer challenge", async () => {
    const server = createOAuthMcpTestServer({
      authenticateHeader: () =>
        `Basic resource_metadata="${window.location.origin}/.well-known/oauth-protected-resource/mcp"`,
      dynamicClientRegistration: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        authRequirement: mcp.authRequirement?.type ?? null,
        errorMessage: mcp.error?.message,
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("failed");
    });

    expect(probe.result.current.authRequirement).toBeNull();
    expect(probe.result.current.authorizationUrl).toBeNull();

    await probe.unmount();
  });

  it("fails closed when the transport proxy URL is invalid", async () => {
    const server = createOAuthMcpTestServer({
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ transportProxy: "http://[", url: server.mcpUrl }),
      (mcp) => ({
        errorMessage: mcp.error?.message,
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("failed");
    });

    expect(probe.result.current.error?.message).toContain("Invalid transportProxy URL");
    expect(server.requestLog).toEqual([]);

    await probe.unmount();
  });

  it("reports the challenge resource metadata URL when SDK discovery state omits it", async () => {
    const resourceMetadataUrl = `${window.location.origin}/.well-known/oauth-protected-resource/mcp`;
    // Bearer second keeps the challenge valid while making SDK 1.29.0 omit resourceMetadataUrl.
    const server = createOAuthMcpTestServer({
      authenticateHeader: (defaultHeader) => `Basic realm="ignored", ${defaultHeader}`,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        authDiagnostics: mcp.authDiagnostics,
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    expect(probe.result.current.authDiagnostics?.resourceMetadataUrl).toBe(resourceMetadataUrl);

    const authorizationUrl = probe.result.current.authorizationUrl;
    expect(authorizationUrl).toBeInstanceOf(URL);

    const code = server.authorize(authorizationUrl!);
    await probe.act(() =>
      probe.result.current.finishAuthorization(code, authorizationUrl!.searchParams.get("state")!),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(probe.result.current.serverProfile?.auth).toMatchObject({
      mode: "oauth-protected",
      protectedResourceMetadataUrl: resourceMetadataUrl,
    });

    await probe.unmount();
  });

  it("reports the discovered resource metadata URL when the auth challenge header is not readable", async () => {
    const resourceMetadataUrl = `${window.location.origin}/.well-known/oauth-protected-resource/mcp`;
    const server = createOAuthMcpTestServer({
      authenticateHeader: "",
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        authDiagnostics: mcp.authDiagnostics,
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    expect(probe.result.current.authDiagnostics?.resourceMetadataUrl).toBe(resourceMetadataUrl);

    await probe.unmount();
  });

  it("does not duplicate OAuth registration when auto-connected inside StrictMode", async () => {
    const server = createOAuthMcpTestServer({
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        authRequirement: mcp.authRequirement?.type ?? null,
        status: mcp.status,
      }),
      {
        wrapper: StrictMode,
      },
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    expect(probe.result.current.authRequirement?.type).toBe("oauth");
    expect(registerRequestCount(server.requestLog)).toBe(1);

    await probe.unmount();
  });

  it("does not reconnect when inline OAuth client metadata is semantically unchanged", async () => {
    const server = createOAuthMcpTestServer({
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      (_props?: { nonce: number }) =>
        useMcp({
          oauth: {
            clientMetadata: {
              client_name: "inline metadata client",
              grant_types: ["authorization_code", "refresh_token"],
              redirect_uris: [`${window.location.origin}/oauth/callback`],
              response_types: ["code"],
              scope: "mcp:tools",
              token_endpoint_auth_method: "none",
            },
          },
          url: server.mcpUrl,
        }),
      (mcp) => ({
        authorizationPath: mcp.authorizationUrl?.pathname,
        status: mcp.status,
      }),
      {
        initialProps: { nonce: 0 },
      },
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });
    expect(registerRequestCount(server.requestLog)).toBe(1);

    await probe.rerender({ nonce: 1 });
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 120);
    });

    expect(probe.result.current.status).toBe("pending_auth");
    expect(probe.result.current.authorizationUrl?.pathname).toBe("/authorize");
    expect(registerRequestCount(server.requestLog)).toBe(1);

    const authorizationUrl = probe.result.current.authorizationUrl!;
    const code = server.authorize(authorizationUrl);
    await probe.act(() =>
      probe.result.current.finishAuthorization(code, authorizationUrl.searchParams.get("state")!),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });
    expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("uses a pre-registered OAuth client id without dynamic client registration", async () => {
    const server = createOAuthMcpTestServer({
      dynamicClientRegistration: false,
      preRegisteredClients: [
        {
          client_id: "gmail-manual-client",
          client_name: "Gmail manual client",
          grant_types: ["authorization_code", "refresh_token"],
          redirect_uris: [`${window.location.origin}/oauth/callback`],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        },
      ],
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () =>
        useMcp({
          oauth: {
            clientId: "gmail-manual-client",
          },
          url: server.mcpUrl,
        }),
      (mcp) => ({
        authRequirement: mcp.authRequirement,
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    expect(probe.result.current.authorizationUrl?.searchParams.get("client_id")).toBe(
      "gmail-manual-client",
    );
    expect(probe.result.current.authRequirement).toMatchObject({
      supportsClientMetadataDocument: false,
      supportsDynamicClientRegistration: false,
      type: "oauth",
    });
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        method: "POST",
        pathname: "/register",
      }),
    );

    const authorizationUrl = probe.result.current.authorizationUrl!;
    const code = server.authorize(authorizationUrl);
    await probe.act(() =>
      probe.result.current.finishAuthorization(code, authorizationUrl.searchParams.get("state")!),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("reports manual OAuth client requirements when registration is unavailable", async () => {
    const server = createOAuthMcpTestServer({
      dynamicClientRegistration: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        authRequirement: mcp.authRequirement,
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    expect(probe.result.current.authRequirement).toEqual({
      authorizationEndpoint: server.authorizationEndpoint,
      issuer: window.location.origin,
      reason: "client_registration_unavailable",
      suggestedFields: ["clientId"],
      supportsClientMetadataDocument: false,
      supportsDynamicClientRegistration: false,
      tokenEndpoint: `${window.location.origin}/token`,
      type: "manual_oauth_client",
    });
    expect(probe.result.current.authorizationUrl).toBeNull();
    expect(probe.result.current.error).toBeNull();
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        method: "POST",
        pathname: "/register",
      }),
    );

    await probe.unmount();
  });

  it("does not trust malformed OAuth metadata while inferring manual client requirements", async () => {
    const mcpUrl = `${window.location.origin}/mcp-malformed-oauth-metadata`;
    const resourceMetadataUrl = `${window.location.origin}/.well-known/oauth-protected-resource/malformed`;
    worker.use(
      http.post(mcpUrl, () =>
        HttpResponse.json(
          { error: "authorization required" },
          {
            headers: {
              "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"`,
            },
            status: 401,
          },
        ),
      ),
      http.get(resourceMetadataUrl, () =>
        HttpResponse.json({
          authorization_servers: window.location.origin,
        }),
      ),
      http.get(`${window.location.origin}/.well-known/oauth-authorization-server`, () =>
        HttpResponse.json({ error: "metadata unavailable" }, { status: 404 }),
      ),
      http.get(`${window.location.origin}/.well-known/openid-configuration`, () =>
        HttpResponse.json({ error: "metadata unavailable" }, { status: 404 }),
      ),
      http.post(`${window.location.origin}/register`, () =>
        HttpResponse.json({ error: "registration unavailable" }, { status: 404 }),
      ),
    );

    const probe = await renderHookProbe(
      () => useMcp({ url: mcpUrl }),
      (mcp) => ({
        authRequirement: mcp.authRequirement,
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("failed");
    });

    expect(probe.result.current.authRequirement).toBeNull();
    expect(probe.result.current.error).toBeInstanceOf(Error);

    await probe.unmount();
  });

  it("uses a Client ID Metadata Document URL instead of dynamic client registration when advertised", async () => {
    const clientMetadataUrl = "https://client.example/.well-known/oauth-client-metadata.json";
    const server = createOAuthMcpTestServer({
      acceptedClientMetadataUrls: [clientMetadataUrl],
      clientMetadataDocument: true,
      dynamicClientRegistration: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () =>
        useMcp({
          oauth: {
            clientMetadataUrl,
          },
          url: server.mcpUrl,
        }),
      (mcp) => ({
        authRequirement: mcp.authRequirement,
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    expect(probe.result.current.authorizationUrl?.searchParams.get("client_id")).toBe(
      clientMetadataUrl,
    );
    expect(probe.result.current.authRequirement).toMatchObject({
      supportsClientMetadataDocument: true,
      supportsDynamicClientRegistration: false,
      type: "oauth",
    });
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        method: "POST",
        pathname: "/register",
      }),
    );

    const authorizationUrl = probe.result.current.authorizationUrl!;
    const code = server.authorize(authorizationUrl);
    await probe.act(() =>
      probe.result.current.finishAuthorization(code, authorizationUrl.searchParams.get("state")!),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("reports advertised Client ID Metadata Document support even when DCR is used", async () => {
    const server = createOAuthMcpTestServer({
      clientMetadataDocument: true,
      dynamicClientRegistration: true,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        authDiagnostics: mcp.authDiagnostics,
        authRequirement: mcp.authRequirement,
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    expect(probe.result.current.authRequirement).toMatchObject({
      supportsClientMetadataDocument: true,
      supportsDynamicClientRegistration: true,
      type: "oauth",
    });
    expect(probe.result.current.authDiagnostics).toMatchObject({
      registrationStrategy: "dynamic_client_registration",
    });
    expect(server.requestLog).toContainEqual(
      expect.objectContaining({
        method: "POST",
        pathname: "/register",
      }),
    );

    await probe.unmount();
  });

  it("finishes OAuth authorization with a callback code and then connects with the loaded catalog", async () => {
    const server = createOAuthMcpTestServer({
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        catalogStatus: mcp.catalogStatus,
        promptNames: mcp.prompts.map((prompt) => prompt.name),
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    const authorizationUrl = probe.result.current.authorizationUrl;
    expect(authorizationUrl).toBeInstanceOf(URL);

    const code = server.authorize(authorizationUrl!);
    let finishAuthorization: Promise<unknown> | undefined;
    await probe.act(() => {
      finishAuthorization = probe.result.current.finishAuthorization(
        code,
        authorizationUrl!.searchParams.get("state")!,
      );
    });

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("authenticating");
    });
    expect(probe.result.current.catalogStatus).toBe("idle");
    expect(probe.result.current.tools).toEqual([]);
    expect(probe.result.current.prompts).toEqual([]);

    await probe.act(() => finishAuthorization!);

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(probe.result.current.authRequirement).toBeNull();
    expect(probe.result.current.authorizationUrl).toBeNull();
    expect(probe.result.current.error).toBeNull();
    expect(probe.result.current.client).toBeInstanceOf(Client);
    expect(probe.result.current.transport).toBeInstanceOf(StreamableHTTPClientTransport);
    expect(probe.result.current.serverProfile?.auth).toMatchObject({
      mode: "oauth-protected",
      authorizationServerMetadata: {
        issuer: window.location.origin,
        authorization_endpoint: server.authorizationEndpoint,
        registration_endpoint: server.registrationEndpoint,
      },
      authorizationServerUrl: window.location.origin,
      protectedResourceMetadata: {
        authorization_servers: [window.location.origin],
        resource: server.mcpUrl,
        resource_name: "MSW OAuth MCP test server",
        scopes_supported: ["mcp:tools"],
      },
      protectedResourceMetadataUrl: `${window.location.origin}/.well-known/oauth-protected-resource/mcp`,
    });
    expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");
    expect(probe.result.current.resources.map((resource) => resource.uri)).toContain(
      "mcp-test://profile",
    );
    expect(
      probe.result.current.resourceTemplates.map((template) => template.uriTemplate),
    ).toContain("mcp-test://profiles/{profileId}");
    expect(probe.result.current.prompts.map((prompt) => prompt.name)).toContain(
      "summarize-profile",
    );
    expect(probe.snapshots()).toContainEqual({
      catalogStatus: "ready",
      promptNames: ["summarize-profile"],
      status: "ready",
      toolNames: ["whoami"],
    });
    expect(server.requestLog).toContainEqual(
      expect.objectContaining({
        method: "POST",
        pathname: "/token",
      }),
    );
    expect(
      server.requestLog.filter((entry) => entry.method === "POST" && entry.pathname === "/mcp")
        .length,
    ).toBeGreaterThanOrEqual(6);

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("finishes OAuth authorization from the callback broadcast without app-owned listener glue", async () => {
    const server = createOAuthMcpTestServer({
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    const authorizationUrl = probe.result.current.authorizationUrl!;
    const code = server.authorize(authorizationUrl);
    const channel = new BroadcastChannel(MCP_OAUTH_CALLBACK_CHANNEL);
    channel.postMessage({
      code,
      state: authorizationUrl.searchParams.get("state"),
      type: "use-mcp-react:oauth-callback",
    });
    channel.close();

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");
    expect(
      server.requestLog.filter((entry) => entry.method === "POST" && entry.pathname === "/token"),
    ).toHaveLength(1);

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("recovers from a Linear-style invalid approval callback without rotating the OAuth client", async () => {
    const server = createOAuthMcpTestServer({
      clientMetadataDocument: true,
      protectedResource: window.location.origin,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        clientId: mcp.authorizationUrl?.searchParams.get("client_id"),
        errorMessage: mcp.error?.message,
        resource: mcp.authorizationUrl?.searchParams.get("resource"),
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    const firstAuthorizationUrl = probe.result.current.authorizationUrl!;
    const firstClientId = firstAuthorizationUrl.searchParams.get("client_id");
    expect(firstClientId).toBe("client-1");
    expect(firstAuthorizationUrl.searchParams.get("resource")).toBe(`${window.location.origin}/`);
    const channel = new BroadcastChannel(MCP_OAUTH_CALLBACK_CHANNEL);
    channel.postMessage({
      error: "invalid_approval",
      errorDescription: "Invalid approval",
      state: firstAuthorizationUrl.searchParams.get("state"),
      type: "use-mcp-react:oauth-callback",
    });
    channel.close();

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("failed");
    });
    expect(probe.result.current.error?.message).toBe("Invalid approval");

    await probe.act(() => probe.result.current.connect());

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    const retryAuthorizationUrl = probe.result.current.authorizationUrl!;
    expect(retryAuthorizationUrl.searchParams.get("client_id")).toBe(firstClientId);
    expect(retryAuthorizationUrl.searchParams.get("resource")).toBe(`${window.location.origin}/`);
    expect(
      server.requestLog.filter(
        (entry) => entry.method === "POST" && entry.pathname === "/register",
      ),
    ).toHaveLength(1);
    expect(
      server.requestLog.filter((entry) => entry.method === "POST" && entry.pathname === "/token"),
    ).toHaveLength(0);

    const code = server.authorize(retryAuthorizationUrl);
    await probe.act(() =>
      probe.result.current.finishAuthorization(
        code,
        retryAuthorizationUrl.searchParams.get("state")!,
      ),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");
    expect(server.requestLog).toContainEqual(
      expect.objectContaining({
        grantType: "authorization_code",
        method: "POST",
        pathname: "/token",
        resource: `${window.location.origin}/`,
      }),
    );

    await probe.unmount();
  });

  it("rejects OAuth callbacks whose state does not match without exchanging the code", async () => {
    const server = createOAuthMcpTestServer({
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    const authorizationUrl = probe.result.current.authorizationUrl!;
    const code = server.authorize(authorizationUrl);

    let result: unknown;
    await probe.act(async () => {
      result = await probe.result.current.finishAuthorization(code, "wrong-state");
    });

    expect(result).toEqual({ ok: false, reason: "oauth_state_mismatch" });

    expect(probe.result.current.status).toBe("pending_auth");
    expect(
      server.requestLog.filter((entry) => entry.method === "POST" && entry.pathname === "/token"),
    ).toHaveLength(0);

    await probe.unmount();
  });

  it("ignores callback broadcasts without state and keeps the authorization pending", async () => {
    const server = createOAuthMcpTestServer({
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    const authorizationUrl = probe.result.current.authorizationUrl!;
    const code = server.authorize(authorizationUrl);
    const channel = new BroadcastChannel(MCP_OAUTH_CALLBACK_CHANNEL);
    channel.postMessage({
      code,
      type: "use-mcp-react:oauth-callback",
    });
    channel.close();

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });
    expect(
      server.requestLog.filter((entry) => entry.method === "POST" && entry.pathname === "/token"),
    ).toHaveLength(0);

    await probe.unmount();
  });

  it("finishes OAuth authorization at most once when duplicate callbacks arrive", async () => {
    const server = createOAuthMcpTestServer({
      randomResponseDelay: { maxMs: 40, seed: 101 },
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    const authorizationUrl = probe.result.current.authorizationUrl!;
    const code = server.authorize(authorizationUrl);
    const state = authorizationUrl.searchParams.get("state")!;

    await probe.act(() =>
      Promise.all([
        probe.result.current.finishAuthorization(code, state),
        probe.result.current.finishAuthorization(code, state),
      ]),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");
    expect(
      server.requestLog.filter((entry) => entry.method === "POST" && entry.pathname === "/token"),
    ).toHaveLength(1);

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("reconnects with existing OAuth tokens instead of starting a new authorization", async () => {
    const server = createOAuthMcpTestServer({
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    const authorizationUrl = probe.result.current.authorizationUrl!;
    const code = server.authorize(authorizationUrl);
    await probe.act(() =>
      probe.result.current.finishAuthorization(code, authorizationUrl.searchParams.get("state")!),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });
    const tokenRequests = tokenRequestCount(server.requestLog);
    const registrationRequests = registerRequestCount(server.requestLog);

    await probe.act(() => probe.result.current.reconnect());

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(tokenRequestCount(server.requestLog)).toBe(tokenRequests);
    expect(registerRequestCount(server.requestLog)).toBe(registrationRequests);
    expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("loads stored OAuth credentials on a new hook instance and forget clears them", async () => {
    const server = createOAuthMcpTestServer({
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const firstProbe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(firstProbe.result.current.status).toBe("pending_auth");
    });

    const authorizationUrl = firstProbe.result.current.authorizationUrl!;
    const code = server.authorize(authorizationUrl);
    await firstProbe.act(() =>
      firstProbe.result.current.finishAuthorization(
        code,
        authorizationUrl.searchParams.get("state")!,
      ),
    );

    await vi.waitFor(() => {
      expect(firstProbe.result.current.status).toBe("ready");
    });

    const tokenRequests = tokenRequestCount(server.requestLog);
    const registrationRequests = registerRequestCount(server.requestLog);
    expect(oauthStorageKeys()).not.toEqual([]);

    await firstProbe.unmount();

    const secondProbe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
    );

    await vi.waitFor(() => {
      expect(secondProbe.result.current.status).toBe("ready");
    });

    expect(tokenRequestCount(server.requestLog)).toBe(tokenRequests);
    expect(registerRequestCount(server.requestLog)).toBe(registrationRequests);
    expect(secondProbe.result.current.tools.map((tool) => tool.name)).toContain("whoami");

    await secondProbe.act(() => secondProbe.result.current.forget());

    expect(oauthStorageKeys()).toEqual([]);

    await secondProbe.unmount();
  });

  it("does not reuse stored OAuth tokens after OAuth client options change", async () => {
    const server = createOAuthMcpTestServer({
      dynamicClientRegistration: false,
      preRegisteredClients: [
        {
          client_id: "manual-client-a",
          client_name: "Manual client A",
          grant_types: ["authorization_code", "refresh_token"],
          redirect_uris: [`${window.location.origin}/oauth/callback`],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        },
        {
          client_id: "manual-client-b",
          client_name: "Manual client B",
          grant_types: ["authorization_code", "refresh_token"],
          redirect_uris: [`${window.location.origin}/oauth/callback`],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        },
      ],
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const firstProbe = await renderHookProbe(
      () =>
        useMcp({
          oauth: { clientId: "manual-client-a" },
          url: server.mcpUrl,
        }),
      (mcp) => ({
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(firstProbe.result.current.status).toBe("pending_auth");
    });

    const firstAuthorizationUrl = firstProbe.result.current.authorizationUrl!;
    const firstCode = server.authorize(firstAuthorizationUrl);
    await firstProbe.act(() =>
      firstProbe.result.current.finishAuthorization(
        firstCode,
        firstAuthorizationUrl.searchParams.get("state")!,
      ),
    );

    await vi.waitFor(() => {
      expect(firstProbe.result.current.status).toBe("ready");
    });

    const tokenRequestsAfterFirstAuth = tokenRequestCount(server.requestLog);
    await firstProbe.unmount();

    const secondProbe = await renderHookProbe(
      () =>
        useMcp({
          oauth: { clientId: "manual-client-b" },
          url: server.mcpUrl,
        }),
      (mcp) => ({
        authorizationClientId: mcp.authorizationUrl?.searchParams.get("client_id"),
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(secondProbe.result.current.status).toBe("pending_auth");
    });

    expect(secondProbe.result.current.authorizationUrl?.searchParams.get("client_id")).toBe(
      "manual-client-b",
    );
    expect(tokenRequestCount(server.requestLog)).toBe(tokenRequestsAfterFirstAuth);

    await secondProbe.unmount();
  });

  it("does not reuse OAuth tokens after switching to a different MCP server URL", async () => {
    const firstServer = createOAuthMcpTestServer({
      mcpPath: "/mcp-first",
      transportMode: "stateless",
    });
    const secondServer = createOAuthMcpTestServer({
      mcpPath: "/mcp-second",
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...firstServer.handlers);

    const probe = await renderHookProbe(
      (props?: { url: string }) => useMcp({ url: props!.url }),
      (mcp) => ({
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
      {
        initialProps: { url: firstServer.mcpUrl },
      },
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    const authorizationUrl = probe.result.current.authorizationUrl!;
    const code = firstServer.authorize(authorizationUrl);
    await probe.act(() =>
      probe.result.current.finishAuthorization(code, authorizationUrl.searchParams.get("state")!),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    worker.use(...secondServer.handlers);
    await probe.rerender({ url: secondServer.mcpUrl });

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(
      secondServer.requestLog
        .filter((entry) => entry.pathname === "/mcp-second")
        .every((entry) => entry.authorization === null),
    ).toBe(true);
    expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("finishes OAuth authorization using the connect override options that created the auth request", async () => {
    const server = createOAuthMcpTestServer({
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ enabled: false, url: null }),
      (mcp) => ({
        catalogStatus: mcp.catalogStatus,
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("idle");
    });

    const openedWindows: string[] = [];
    const popup = {
      closed: false,
      focus: () => {},
      location: { href: "about:blank" },
    } as Window;
    const originalOpen = window.open;
    window.open = ((url?: string | URL) => {
      openedWindows.push(String(url));
      return popup;
    }) as typeof window.open;

    await probe.act(() =>
      probe.result.current.connect({
        authorizationTarget: "popup",
        enabled: true,
        url: server.mcpUrl,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });
    expect(openedWindows).toEqual(["about:blank"]);

    const authorizationUrl = probe.result.current.authorizationUrl!;
    const code = server.authorize(authorizationUrl);
    try {
      await probe.act(() =>
        probe.result.current.finishAuthorization(code, authorizationUrl.searchParams.get("state")!),
      );
    } finally {
      window.open = originalOpen;
    }

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(openedWindows).toEqual(["about:blank"]);
    expect(probe.result.current.catalogStatus).toBe("ready");
    expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");
    expect(probe.snapshots()).toContainEqual({
      catalogStatus: "ready",
      status: "ready",
      toolNames: ["whoami"],
    });

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("reports post-authorization MCP initialization failures instead of returning to pending auth", async () => {
    const server = createOAuthMcpTestServer({
      failInitializedNotification: true,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ enabled: false, url: null }),
      (mcp) => ({
        authRequirement: mcp.authRequirement?.type ?? null,
        errorMessage: mcp.error?.message,
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("idle");
    });

    await probe.act(() => probe.result.current.connect({ enabled: true, url: server.mcpUrl }));

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    const authorizationUrl = probe.result.current.authorizationUrl!;
    const code = server.authorize(authorizationUrl);
    await probe.act(() =>
      probe.result.current.finishAuthorization(code, authorizationUrl.searchParams.get("state")!),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("failed");
    });

    expect(probe.result.current.authRequirement).toBeNull();
    expect(probe.result.current.authorizationUrl).toBeNull();
    expect(probe.result.current.error?.message).toContain(
      "Invalid request method for existing session",
    );
    expect(probe.snapshots()).toContainEqual({
      authRequirement: null,
      errorMessage: expect.stringContaining("Invalid request method for existing session"),
      status: "failed",
    });

    await probe.unmount();
  });

  it("uses a fresh popup name for each hook-owned OAuth authorization attempt", async () => {
    const server = createOAuthMcpTestServer({
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ enabled: false, url: null }),
      (mcp) => ({
        status: mcp.status,
      }),
    );

    const openedPopupNames: string[] = [];
    const originalOpen = window.open;
    window.open = ((url?: string | URL, target?: string) => {
      openedPopupNames.push(target ?? "");
      let popupClosed = false;
      let popupHref = String(url ?? "about:blank");
      return {
        get closed() {
          return popupClosed;
        },
        close: () => {
          popupClosed = true;
        },
        focus: () => {},
        location: {
          get href() {
            return popupHref;
          },
          set href(value: string) {
            popupHref = value;
          },
        },
      } as Window;
    }) as typeof window.open;

    try {
      await probe.act(() =>
        probe.result.current.connect({
          authorizationTarget: "popup",
          enabled: true,
          url: server.mcpUrl,
        }),
      );

      await vi.waitFor(() => {
        expect(probe.result.current.status).toBe("pending_auth");
      });

      await probe.act(() =>
        probe.result.current.reauthorize({
          authorizationTarget: "popup",
          enabled: true,
          url: server.mcpUrl,
        }),
      );

      await vi.waitFor(() => {
        expect(openedPopupNames).toHaveLength(2);
      });
    } finally {
      window.open = originalOpen;
    }

    expect(openedPopupNames[0]).toMatch(/^use-mcp-react-oauth-/u);
    expect(openedPopupNames[1]).toMatch(/^use-mcp-react-oauth-/u);
    expect(openedPopupNames[1]).not.toBe(openedPopupNames[0]);

    await probe.unmount();
  });

  it("opens and reuses one OAuth popup for the prepared authorization URL", async () => {
    const server = createOAuthMcpTestServer({
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        authorizationUrl: mcp.authorizationUrl?.toString(),
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    const openedWindows: string[] = [];
    const popupNavigations: string[] = [];
    let focusCalls = 0;
    let popupHref = "about:blank";
    const popup = {
      closed: false,
      focus: () => {
        focusCalls += 1;
      },
      location: {
        get href() {
          return popupHref;
        },
        set href(value: string) {
          popupHref = value;
          popupNavigations.push(value);
        },
      },
    } as Window;
    const originalOpen = window.open;
    window.open = ((url?: string | URL) => {
      openedWindows.push(String(url));
      return popup;
    }) as typeof window.open;

    try {
      await probe.act(() => probe.result.current.authorize());
      await probe.act(() => probe.result.current.authorize());
    } finally {
      window.open = originalOpen;
    }

    expect(openedWindows).toEqual([probe.result.current.authorizationUrl?.toString()]);
    expect(popupNavigations).toEqual([]);
    expect(focusCalls).toBe(2);
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        pathname: "/authorize",
      }),
    );

    await probe.unmount();
  });

  it("closes a stale hook-owned OAuth popup before preparing a new connection", async () => {
    const server = createOAuthMcpTestServer({
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        authorizationUrl: mcp.authorizationUrl?.toString(),
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    const openedWindows: string[] = [];
    const popups: Array<Window & { readonly closed: boolean }> = [];
    const originalOpen = window.open;
    window.open = ((url?: string | URL) => {
      openedWindows.push(String(url));
      let popupClosed = false;
      const popup = {
        get closed() {
          return popupClosed;
        },
        close: () => {
          popupClosed = true;
        },
        focus: () => {},
        location: { href: String(url ?? "about:blank") },
      } as Window & { readonly closed: boolean };
      popups.push(popup);

      return popup;
    }) as typeof window.open;

    try {
      const firstAuthorizationUrl = probe.result.current.authorizationUrl!.toString();
      await probe.act(() => probe.result.current.authorize({ target: "popup" }));

      await probe.act(() => probe.result.current.connect());

      await vi.waitFor(() => {
        expect(probe.result.current.status).toBe("pending_auth");
      });
      expect(popups[0]?.closed).toBe(true);

      const secondAuthorizationUrl = probe.result.current.authorizationUrl!.toString();
      expect(secondAuthorizationUrl).toEqual(expect.any(String));
      expect(secondAuthorizationUrl).not.toBe(firstAuthorizationUrl);

      await probe.act(() => probe.result.current.authorize({ target: "popup" }));

      expect(openedWindows).toEqual([firstAuthorizationUrl, secondAuthorizationUrl]);
      expect(popups).toHaveLength(2);
      expect(popups[1]?.closed).toBe(false);
    } finally {
      window.open = originalOpen;
    }

    await probe.unmount();
  });

  it("reuses the popup pre-opened by connect when authorize is called", async () => {
    const server = createOAuthMcpTestServer({
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ enabled: false, url: null }),
      (mcp) => ({
        authorizationUrl: mcp.authorizationUrl?.toString(),
        status: mcp.status,
      }),
    );

    const openedWindows: string[] = [];
    const popupNavigations: string[] = [];
    let focusCalls = 0;
    let popupHref = "about:blank";
    const popup = {
      closed: false,
      focus: () => {
        focusCalls += 1;
      },
      location: {
        get href() {
          return popupHref;
        },
        set href(value: string) {
          popupHref = value;
          popupNavigations.push(value);
        },
      },
    } as Window;
    const originalOpen = window.open;
    window.open = ((url?: string | URL) => {
      openedWindows.push(String(url));
      return popup;
    }) as typeof window.open;

    try {
      await probe.act(() =>
        probe.result.current.connect({
          authorizationTarget: "popup",
          enabled: true,
          url: server.mcpUrl,
        }),
      );

      await vi.waitFor(() => {
        expect(probe.result.current.status).toBe("pending_auth");
      });

      await probe.act(() => probe.result.current.authorize({ target: "popup" }));
    } finally {
      window.open = originalOpen;
    }

    expect(openedWindows).toEqual(["about:blank"]);
    expect(popup.location.href).toBe(probe.result.current.authorizationUrl?.toString());
    expect(popupNavigations).toEqual([probe.result.current.authorizationUrl?.toString()]);
    expect(focusCalls).toBeGreaterThanOrEqual(2);

    await probe.unmount();
  });

  it("clears OAuth tokens during reauthorize and asks for authorization again", async () => {
    const server = createOAuthMcpTestServer({
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        catalogStatus: mcp.catalogStatus,
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    const authorizationUrl = probe.result.current.authorizationUrl!;
    const code = server.authorize(authorizationUrl);
    await probe.act(() =>
      probe.result.current.finishAuthorization(code, authorizationUrl.searchParams.get("state")!),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    let reauthorize: Promise<unknown> | undefined;
    await probe.act(() => {
      reauthorize = probe.result.current.reauthorize();
    });

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("reconnecting");
    });
    expect(probe.result.current.catalogStatus).toBe("ready");
    expect(probe.result.current.tools.map((tool) => tool.name)).toEqual(["whoami"]);

    await probe.act(() => reauthorize!);

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    expect(probe.result.current.authRequirement).toMatchObject({
      supportsDynamicClientRegistration: true,
      type: "oauth",
    });
    expect(probe.result.current.authorizationUrl?.searchParams.get("client_id")).toBe("client-1");
    expect(probe.result.current.error).toBeNull();
    expect(probe.result.current.client).toBeNull();
    expect(
      server.requestLog
        .filter((entry) => entry.method === "POST" && entry.pathname === "/token")
        .map((entry) => entry.grantType),
    ).toEqual(["authorization_code"]);
    expect(
      server.requestLog.filter(
        (entry) => entry.method === "POST" && entry.pathname === "/register",
      ),
    ).toHaveLength(1);

    await probe.unmount();
  });

  it("refreshes OAuth tokens when the access token expires after ready", async () => {
    const server = createOAuthMcpTestServer({
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    const authorizationUrl = probe.result.current.authorizationUrl!;
    const code = server.authorize(authorizationUrl);
    await probe.act(() =>
      probe.result.current.finishAuthorization(code, authorizationUrl.searchParams.get("state")!),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    server.expireAccessTokens();
    await expect(probe.result.current.client!.ping()).resolves.toEqual({});

    expect(
      server.requestLog.filter(
        (entry) =>
          entry.method === "POST" &&
          entry.pathname === "/token" &&
          entry.grantType === "refresh_token",
      ),
    ).toHaveLength(1);

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("allows cross-origin transport proxies for browser-hosted gateways", async () => {
    const server = createOAuthMcpTestServer({
      acceptedBearerTokens: [
        {
          clientId: "api-key-client",
          resource: `${window.location.origin}/mcp`,
          scope: "mcp:tools",
          token: "secret-token",
        },
      ],
      advertiseOAuth: false,
      proxyUrl: "https://proxy.example/mcp-proxy",
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () =>
        useMcp({
          bearerToken: "secret-token",
          transportProxy: server.proxyUrl,
          url: server.mcpUrl,
        }),
      (mcp) => ({
        errorMessage: mcp.error?.message,
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");
    expect(server.requestLog).toContainEqual(
      expect.objectContaining({
        authorization: "Bearer secret-token",
        cookie: null,
        jsonRpcMethod: "initialize",
        method: "POST",
        pathname: "/mcp-proxy",
        proxyTargetUrl: server.mcpUrl,
        status: 200,
      }),
    );
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        pathname: "/mcp",
      }),
    );

    await probe.result.current.client?.close();
    await probe.unmount();
  });

  it("terminates stateful MCP sessions when disconnecting", async () => {
    const server = createOAuthMcpTestServer({
      requireAuth: false,
      transportMode: "stateful",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        sessionMode: mcp.serverProfile?.transport.sessionMode,
        status: mcp.status,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    expect(probe.result.current.serverProfile?.transport.sessionMode).toBe("stateful");

    await probe.act(() => probe.result.current.disconnect());

    expect(server.requestLog).toContainEqual(
      expect.objectContaining({
        method: "DELETE",
        pathname: "/mcp",
        status: 200,
      }),
    );

    await probe.unmount();
  });

  it("forgets OAuth credentials and returns to idle with empty public state", async () => {
    const server = createOAuthMcpTestServer({
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ url: server.mcpUrl }),
      (mcp) => ({
        status: mcp.status,
        toolCount: mcp.tools.length,
      }),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("pending_auth");
    });

    const authorizationUrl = probe.result.current.authorizationUrl!;
    const code = server.authorize(authorizationUrl);
    await probe.act(() =>
      probe.result.current.finishAuthorization(code, authorizationUrl.searchParams.get("state")!),
    );

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    await probe.act(() => probe.result.current.forget());

    expect(probe.result.current.status).toBe("idle");
    expect(probe.result.current.authRequirement).toBeNull();
    expect(probe.result.current.authorizationUrl).toBeNull();
    expect(probe.result.current.error).toBeNull();
    expect(probe.result.current.client).toBeNull();
    expect(probe.result.current.transport).toBeNull();
    expect(probe.result.current.serverCapabilities).toBeNull();
    expect(probe.result.current.serverVersion).toBeNull();
    expect(probe.result.current.tools).toEqual([]);
    expect(probe.result.current.resources).toEqual([]);
    expect(probe.result.current.resourceTemplates).toEqual([]);
    expect(probe.result.current.prompts).toEqual([]);
    expect(probe.snapshots()).toContainEqual({
      status: "idle",
      toolCount: 0,
    });

    await probe.unmount();
  });

  it("does not let an older forget overwrite a newer connect after async close", async () => {
    const server = createOAuthMcpTestServer({
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const probe = await renderHookProbe(
      () => useMcp({ enabled: false, url: null }),
      (mcp) => ({
        status: mcp.status,
        toolNames: mcp.tools.map((tool) => tool.name),
      }),
    );

    await probe.act(() => probe.result.current.connect({ enabled: true, url: server.mcpUrl }));
    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });

    const connectedClient = probe.result.current.client!;
    const originalClose = connectedClient.close.bind(connectedClient);
    let releaseClose!: () => void;
    connectedClient.close = (() =>
      new Promise<void>((resolve) => {
        releaseClose = () => {
          void originalClose().then(resolve);
        };
      })) as typeof connectedClient.close;

    let forget: Promise<unknown> | undefined;
    await probe.act(() => {
      forget = probe.result.current.forget();
    });

    await probe.act(() => probe.result.current.connect({ enabled: true, url: server.mcpUrl }));
    releaseClose();
    await probe.act(() => forget!);

    await vi.waitFor(() => {
      expect(probe.result.current.status).toBe("ready");
    });
    expect(probe.result.current.tools.map((tool) => tool.name)).toContain("whoami");

    await probe.result.current.client?.close();
    await probe.unmount();
  });
});

function registerRequestCount(requestLog: Array<{ method: string; pathname: string }>): number {
  return requestLog.filter((entry) => entry.method === "POST" && entry.pathname === "/register")
    .length;
}

function mcpPostRequestCount(requestLog: Array<{ method: string; pathname: string }>): number {
  return requestLog.filter((entry) => entry.method === "POST" && entry.pathname === "/mcp").length;
}

function mcpJsonRpcRequestCount(
  requestLog: Array<{ jsonRpcMethod?: string; method: string }>,
  jsonRpcMethod: string,
): number {
  return requestLog.filter(
    (entry) => entry.method === "POST" && entry.jsonRpcMethod === jsonRpcMethod,
  ).length;
}

function tokenRequestCount(requestLog: Array<{ method: string; pathname: string }>): number {
  return requestLog.filter((entry) => entry.method === "POST" && entry.pathname === "/token")
    .length;
}

function oauthStorageKeys(): string[] {
  return Object.keys(localStorage).filter((key) => key.startsWith("use-mcp-react:v1:"));
}

function readWhoamiToken(result: Awaited<ReturnType<Client["callTool"]>>): string | undefined {
  const content = result.content as { text?: string; type?: string }[];
  const payload = JSON.parse(content[0]?.text ?? "{}") as { token?: string };

  return payload.token;
}
