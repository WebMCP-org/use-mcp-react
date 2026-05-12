import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { worker } from "./setup.js";
import { createOAuthMcpTestServer } from "./support/oauthMcpServer.js";

function readTextContent(content: { type?: string; text?: string } | undefined): string {
  expect(content?.type).toBe("text");
  expect(content?.text).toEqual(expect.any(String));

  return content?.text ?? "";
}

function readResourceText(
  content:
    | {
        uri: string;
        text: string;
        mimeType?: string;
      }
    | {
        uri: string;
        blob: string;
        mimeType?: string;
      }
    | undefined,
): string {
  expect(content).toBeDefined();
  expect(content && "text" in content).toBe(true);

  return content && "text" in content ? content.text : "";
}

describe("OAuth MCP over MSW", () => {
  it("connects a real SDK client to a stateless MCP server in the service worker and loads catalogs", async () => {
    const server = createOAuthMcpTestServer({
      requireAuth: false,
      transportMode: "stateless",
    });
    worker.use(...server.handlers);

    const client = new Client({ name: "browser-test-client", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(server.mcpUrl));

    await client.connect(transport);

    expect(transport.sessionId).toBeUndefined();
    expect(client.getServerVersion()?.name).toBe("msw-oauth-mcp-test-server");
    expect(client.getServerCapabilities()).toMatchObject({
      prompts: { listChanged: true },
      resources: { listChanged: true },
      tools: { listChanged: true },
    });

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("whoami");

    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri)).toEqual(
      expect.arrayContaining(["mcp-test://profile", "mcp-test://profiles/current"]),
    );

    const resourceTemplates = await client.listResourceTemplates();
    expect(resourceTemplates.resourceTemplates.map((template) => template.uriTemplate)).toContain(
      "mcp-test://profiles/{profileId}",
    );

    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((prompt) => prompt.name)).toContain("summarize-profile");

    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        pathname: "/.well-known/oauth-protected-resource/mcp",
      }),
    );
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        pathname: "/register",
      }),
    );
    expect(
      server.requestLog.filter((entry) => entry.method === "POST" && entry.pathname === "/mcp")
        .length,
    ).toBeGreaterThanOrEqual(5);

    await client.close();
  });

  it("connects a document-context SDK client to an OAuth-protected MCP server in the service worker", async () => {
    const server = createOAuthMcpTestServer();
    worker.use(...server.handlers);

    let authorizationUrl: URL | undefined;
    const authProvider = new InMemoryBrowserOAuthProvider((url) => {
      authorizationUrl = url;
    });

    const firstClient = new Client({ name: "browser-test-client", version: "0.0.0" });
    const firstTransport = new StreamableHTTPClientTransport(new URL(server.mcpUrl), {
      authProvider,
    });

    await expect(firstClient.connect(firstTransport)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(authorizationUrl?.origin).toBe(window.location.origin);
    expect(authorizationUrl?.pathname).toBe("/authorize");
    expect(authorizationUrl?.searchParams.get("resource")).toBe(server.mcpUrl);
    expect(authorizationUrl?.searchParams.get("code_challenge_method")).toBe("S256");

    const authorizationCode = server.authorize(authorizationUrl!);
    await firstTransport.finishAuth(authorizationCode);

    const client = new Client({ name: "browser-test-client", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(server.mcpUrl), {
      authProvider,
    });

    await client.connect(transport);

    expect(client.getServerVersion()?.name).toBe("msw-oauth-mcp-test-server");
    expect(client.getServerCapabilities()).toMatchObject({
      prompts: { listChanged: true },
      resources: { listChanged: true },
      tools: { listChanged: true },
    });
    await expect(client.ping()).resolves.toEqual({});

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("whoami");

    const result = await client.callTool({ name: "whoami", arguments: {} });
    expect(Array.isArray(result.content)).toBe(true);
    const content = result.content as { text?: string; type?: string }[];
    expect(content).toHaveLength(1);
    expect(content[0]?.type).toBe("text");

    const payload = JSON.parse(content[0]?.text ?? "{}") as {
      clientId: string;
      scopes: string[];
      token: string;
    };
    expect(payload.clientId).toBe(authProvider.clientInformation()?.client_id);
    expect(payload.scopes).toEqual(["mcp:tools"]);
    expect(payload.token).toBe(authProvider.tokens()?.access_token);

    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri)).toContain("mcp-test://profile");

    const resource = await client.readResource({ uri: "mcp-test://profile" });
    expect(resource.contents).toHaveLength(1);
    expect(resource.contents[0]?.uri).toBe("mcp-test://profile");
    expect(resource.contents[0]?.mimeType).toBe("application/json");
    const resourceContent = resource.contents[0];
    const resourcePayload = JSON.parse(readResourceText(resourceContent)) as {
      clientId: string;
      scopes: string[];
    };
    expect(resourcePayload.clientId).toBe(authProvider.clientInformation()?.client_id);
    expect(resourcePayload.scopes).toEqual(["mcp:tools"]);

    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((prompt) => prompt.name)).toContain("summarize-profile");

    const prompt = await client.getPrompt({ name: "summarize-profile" });
    expect(prompt.messages).toHaveLength(1);
    expect(prompt.messages[0]?.role).toBe("user");
    const promptContent = prompt.messages[0]?.content;
    expect(readTextContent(promptContent)).toContain(authProvider.clientInformation()?.client_id);

    const successfulMcpResponses = server.requestLog.filter(
      (entry) => entry.method === "POST" && entry.pathname === "/mcp" && entry.status === 200,
    );
    expect(successfulMcpResponses.length).toBeGreaterThan(0);
    expect(
      successfulMcpResponses.every((entry) => entry.contentType?.includes("text/event-stream")),
    ).toBe(true);
    expect(server.requestLog.map((entry) => entry.pathname)).toEqual(
      expect.arrayContaining([
        "/mcp",
        "/.well-known/oauth-protected-resource/mcp",
        "/.well-known/oauth-authorization-server",
        "/register",
        "/token",
      ]),
    );

    expect(transport.sessionId).toEqual(expect.any(String));
    await transport.terminateSession();
    expect(transport.sessionId).toBeUndefined();
    expect(server.requestLog).toContainEqual(
      expect.objectContaining({
        method: "DELETE",
        pathname: "/mcp",
        status: 200,
      }),
    );

    await client.close();
    await firstClient.close();
  });

  it("supports providers that require a pre-registered public client instead of DCR", async () => {
    const preRegisteredClient = createPreRegisteredClient("workos-style-public-client");
    const server = createOAuthMcpTestServer({
      dynamicClientRegistration: false,
      preRegisteredClients: [preRegisteredClient],
    });
    worker.use(...server.handlers);

    let authorizationUrl: URL | undefined;
    const authProvider = new InMemoryBrowserOAuthProvider((url) => {
      authorizationUrl = url;
    }, preRegisteredClient);
    const firstClient = new Client({ name: "browser-test-client", version: "0.0.0" });
    const firstTransport = new StreamableHTTPClientTransport(new URL(server.mcpUrl), {
      authProvider,
    });

    await expect(firstClient.connect(firstTransport)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(authorizationUrl?.searchParams.get("client_id")).toBe(preRegisteredClient.client_id);
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        method: "POST",
        pathname: "/register",
      }),
    );

    await firstTransport.finishAuth(server.authorize(authorizationUrl!));

    const client = new Client({ name: "browser-test-client", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(server.mcpUrl), {
      authProvider,
    });
    await client.connect(transport);

    await expect(client.ping()).resolves.toEqual({});
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("whoami");

    await client.close();
    await firstClient.close();
  });

  it("fails clearly when a provider disables DCR and the client has no pre-registration", async () => {
    const server = createOAuthMcpTestServer({ dynamicClientRegistration: false });
    worker.use(...server.handlers);

    let authorizationUrl: URL | undefined;
    const authProvider = new InMemoryBrowserOAuthProvider((url) => {
      authorizationUrl = url;
    });
    const client = new Client({ name: "browser-test-client", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(server.mcpUrl), {
      authProvider,
    });

    await expect(client.connect(transport)).rejects.toThrow();
    expect(authorizationUrl).toBeUndefined();
    expect(server.requestLog).not.toContainEqual(
      expect.objectContaining({
        pathname: "/authorize",
      }),
    );

    await client.close();
  });

  it("rejects an authorization code exchange when PKCE verification fails", async () => {
    const server = createOAuthMcpTestServer();
    worker.use(...server.handlers);

    let authorizationUrl: URL | undefined;
    const authProvider = new InMemoryBrowserOAuthProvider((url) => {
      authorizationUrl = url;
    });
    const client = new Client({ name: "browser-test-client", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(server.mcpUrl), {
      authProvider,
    });

    await expect(client.connect(transport)).rejects.toBeInstanceOf(UnauthorizedError);
    const code = server.authorize(authorizationUrl!);
    authProvider.saveCodeVerifier("tampered-code-verifier");

    await expect(transport.finishAuth(code)).rejects.toThrow();
    expect(authProvider.tokens()).toBeUndefined();

    await client.close();
  });

  it("supports API-key style bearer auth when the MCP server does not advertise OAuth", async () => {
    const token = "test-api-key";
    const server = createOAuthMcpTestServer({
      advertiseOAuth: false,
      acceptedBearerTokens: [
        {
          clientId: "api-key-client",
          resource: `${window.location.origin}/mcp`,
          scope: "mcp:tools",
          token,
        },
      ],
    });
    worker.use(...server.handlers);

    const authProvider = new StaticBearerAuthProvider(token);
    const client = new Client({ name: "browser-test-client", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(server.mcpUrl), {
      authProvider,
    });

    await client.connect(transport);
    await expect(client.ping()).resolves.toEqual({});

    const result = await client.callTool({ name: "whoami", arguments: {} });
    const content = result.content as { text?: string; type?: string }[];
    const payload = JSON.parse(readTextContent(content[0])) as {
      clientId: string;
      scopes: string[];
      token: string;
    };
    expect(payload).toEqual({
      clientId: "api-key-client",
      scopes: ["mcp:tools"],
      token,
    });
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
        pathname: "/token",
      }),
    );

    await client.close();
  });

  it("surfaces bearer auth as required when the MCP server has no OAuth metadata", async () => {
    const server = createOAuthMcpTestServer({ advertiseOAuth: false });
    worker.use(...server.handlers);

    const client = new Client({ name: "browser-test-client", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(server.mcpUrl));

    await expect(client.connect(transport)).rejects.toThrow("Error POSTing to endpoint");
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
        pathname: "/register",
      }),
    );

    await client.close();
  });
});

class InMemoryBrowserOAuthProvider implements OAuthClientProvider {
  private readonly redirectUri = `${window.location.origin}/oauth/callback`;
  private readonly metadata: OAuthClientMetadata = {
    redirect_uris: [this.redirectUri],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: "Browser test client",
  };

  private client?: OAuthClientInformationMixed;
  private savedTokens?: OAuthTokens;
  private verifier?: string;

  constructor(
    private readonly onRedirect: (url: URL) => void,
    clientInformation?: OAuthClientInformationMixed,
  ) {
    this.client = clientInformation;
  }

  get redirectUrl(): string {
    return this.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this.metadata;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.client;
  }

  saveClientInformation(clientInformation: OAuthClientInformationMixed): void {
    this.client = clientInformation;
  }

  tokens(): OAuthTokens | undefined {
    return this.savedTokens;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.savedTokens = tokens;
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.onRedirect(authorizationUrl);
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.verifier = codeVerifier;
  }

  codeVerifier(): string {
    if (!this.verifier) {
      throw new Error("No OAuth PKCE verifier saved.");
    }

    return this.verifier;
  }
}

class StaticBearerAuthProvider implements OAuthClientProvider {
  readonly clientMetadata: OAuthClientMetadata = {
    redirect_uris: [],
    token_endpoint_auth_method: "none",
    grant_types: [],
    response_types: [],
    client_name: "Static bearer test client",
  };

  readonly redirectUrl = undefined;

  constructor(private readonly token: string) {}

  clientInformation(): OAuthClientInformationMixed | undefined {
    return {
      client_id: "static-bearer-client",
      redirect_uris: [],
      token_endpoint_auth_method: "none",
      grant_types: [],
      response_types: [],
    };
  }

  tokens(): OAuthTokens {
    return {
      access_token: this.token,
      token_type: "Bearer",
    };
  }

  saveTokens(): void {
    throw new Error("Static bearer auth does not save OAuth tokens.");
  }

  redirectToAuthorization(): void {
    throw new Error("Static bearer auth does not redirect.");
  }

  saveCodeVerifier(): void {
    throw new Error("Static bearer auth does not use PKCE.");
  }

  codeVerifier(): string {
    throw new Error("Static bearer auth does not use PKCE.");
  }
}

function createPreRegisteredClient(clientId: string): OAuthClientInformationFull {
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: [`${window.location.origin}/oauth/callback`],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_name: "Browser test client",
  };
}
