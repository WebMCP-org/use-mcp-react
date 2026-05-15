import { http, HttpResponse } from "msw";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthClientMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";

type TransportMode = "stateful" | "stateless";

type AuthorizationCode = {
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  redirectUri: string;
  resource: string;
  scope: string;
  state?: string;
};

type AccessToken = {
  clientId: string;
  resource: string;
  scope: string;
  token: string;
};

type RefreshToken = {
  clientId: string;
  resource: string;
  scope: string;
  token: string;
};

type RequestLogEntry = {
  accept?: string | null;
  authorization?: string | null;
  contentType?: string | null;
  cookie?: string | null;
  grantType?: string;
  initializeCapabilities?: unknown;
  jsonRpcMethod?: string;
  method: string;
  mcpProtocolVersion?: string | null;
  pathname: string;
  proxyTargetUrl?: string | null;
  resource?: string;
  status?: number;
};

type OAuthMcpTestServerOptions = {
  acceptedBearerTokens?: AccessToken[];
  acceptedClientMetadataUrls?: string[];
  advertiseOAuth?: boolean;
  authorizationServerPath?: `/${string}`;
  authenticateHeader?: string | ((defaultHeader: string) => string);
  failCatalogMethods?: Array<
    "prompts/list" | "resources/list" | "resources/templates/list" | "tools/list"
  >;
  failInitializedNotification?: boolean;
  clientMetadataDocument?: boolean;
  dynamicClientRegistration?: boolean;
  mcpPath?: `/${string}`;
  paginatedTools?: boolean;
  preRegisteredClients?: OAuthClientInformationFull[];
  protectedResource?: string;
  randomResponseDelay?: {
    maxMs: number;
    seed: number;
  };
  requireAuth?: boolean;
  serverInstructions?: string;
  transportMode?: TransportMode;
};

export type OAuthMcpTestServer = {
  readonly authorizationEndpoint: string;
  readonly authorizationServerMetadataUrl: string;
  readonly authorizationServerUrl: string;
  readonly mcpUrl: string;
  readonly proxyUrl: string;
  readonly registrationEndpoint: string;
  readonly requestLog: RequestLogEntry[];
  readonly tokenEndpoint: string;
  authorize(authorizationUrl: URL): string;
  expireAccessTokens(): void;
  failCatalogMethods(methods: OAuthMcpTestServerOptions["failCatalogMethods"]): void;
  handlers: ReturnType<typeof http.all>[];
  registerPrompt(name: string): void;
  registerResource(uri: string): void;
  registerTool(name: string): void;
  sendPromptListChanged(): void;
  sendResourceListChanged(): void;
  sendToolListChanged(): void;
};

export function createOAuthMcpTestServer(
  options: OAuthMcpTestServerOptions = {},
): OAuthMcpTestServer {
  const advertiseOAuth = options.advertiseOAuth ?? true;
  const acceptedClientMetadataUrls = new Set(options.acceptedClientMetadataUrls ?? []);
  const clientMetadataDocument = options.clientMetadataDocument ?? false;
  const dynamicClientRegistration = options.dynamicClientRegistration ?? true;
  const requireAuth = options.requireAuth ?? true;
  const transportMode = options.transportMode ?? "stateful";
  const failCatalogMethods = new Set(options.failCatalogMethods ?? []);
  const failInitializedNotification = options.failInitializedNotification ?? false;
  const nextResponseDelay = createResponseDelay(options.randomResponseDelay);
  const origin = window.location.origin;
  const mcpPath = options.mcpPath ?? "/mcp";
  const authorizationServerPath = normalizeOptionalPath(options.authorizationServerPath);
  const mcpUrl = `${origin}${mcpPath}`;
  const proxyUrl = `${origin}${mcpPath === "/mcp" ? "/mcp-proxy" : `${mcpPath}-proxy`}`;
  const protectedResource = options.protectedResource ?? mcpUrl;
  const acceptedTokenResource = new URL(protectedResource).href;
  const authorizationServerUrl = `${origin}${authorizationServerPath}`;
  const authorizationEndpoint = `${authorizationServerUrl}/authorize`;
  const registrationEndpoint = `${authorizationServerUrl}/register`;
  const tokenEndpoint = `${authorizationServerUrl}/token`;
  const protectedResourceMetadataUrl = `${origin}/.well-known/oauth-protected-resource${mcpPath}`;
  const authorizationServerMetadataUrl = `${origin}/.well-known/oauth-authorization-server${authorizationServerPath}`;
  const requestLog: RequestLogEntry[] = [];
  const clients = new Map<string, OAuthClientInformationFull>();
  const authorizationCodes = new Map<string, AuthorizationCode>();
  const accessTokens = new Map<string, AccessToken>();
  const refreshTokens = new Map<string, RefreshToken>();
  const dynamicPrompts = new Set<string>();
  const dynamicResources = new Set<string>();
  const dynamicTools = new Set<string>();
  let statefulMcpServer: McpServer | undefined;

  for (const client of options.preRegisteredClients ?? []) {
    clients.set(client.client_id, client);
  }
  for (const token of options.acceptedBearerTokens ?? []) {
    accessTokens.set(token.token, token);
  }

  function createMcpServer(): McpServer {
    const mcpServer = new McpServer(
      { name: "msw-oauth-mcp-test-server", version: "0.0.0" },
      {
        capabilities: { tools: {} },
        ...(options.serverInstructions ? { instructions: options.serverInstructions } : {}),
      },
    );

    mcpServer.registerTool(
      "whoami",
      {
        description: "Returns the OAuth subject attached to the MCP request.",
      },
      (extra) => {
        const authInfo = extra.authInfo;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                clientId: authInfo?.clientId,
                scopes: authInfo?.scopes ?? [],
                token: authInfo?.token,
              }),
            },
          ],
        };
      },
    );
    mcpServer.registerResource(
      "profile",
      "mcp-test://profile",
      {
        title: "Authenticated profile",
        description: "A resource that is read through the real MCP resources/read flow.",
        mimeType: "application/json",
      },
      (_uri, extra) => {
        const authInfo = extra.authInfo;

        return {
          contents: [
            {
              uri: "mcp-test://profile",
              mimeType: "application/json",
              text: JSON.stringify({
                clientId: authInfo?.clientId,
                scopes: authInfo?.scopes ?? [],
              }),
            },
          ],
        };
      },
    );
    mcpServer.registerResource(
      "profile-template",
      new ResourceTemplate("mcp-test://profiles/{profileId}", {
        list: () => ({
          resources: [
            {
              uri: "mcp-test://profiles/current",
              name: "Current profile",
              mimeType: "application/json",
            },
          ],
        }),
        complete: {
          profileId: (value) =>
            ["current", "archived"].filter((profileId) => profileId.startsWith(value)),
        },
      }),
      {
        title: "Profile by id",
        description: "A templated profile resource.",
        mimeType: "application/json",
      },
      (uri, variables, extra) => {
        const authInfo = extra.authInfo;

        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "application/json",
              text: JSON.stringify({
                clientId: authInfo?.clientId,
                profileId: variables.profileId,
                scopes: authInfo?.scopes ?? [],
              }),
            },
          ],
        };
      },
    );
    mcpServer.registerPrompt(
      "summarize-profile",
      {
        description: "Builds a prompt through the real MCP prompts/get flow.",
      },
      (extra) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Summarize OAuth client ${extra.authInfo?.clientId ?? "unknown"}.`,
            },
          },
        ],
      }),
    );
    for (const toolName of dynamicTools) {
      registerDynamicTool(mcpServer, toolName);
    }
    for (const resourceUri of dynamicResources) {
      registerDynamicResource(mcpServer, resourceUri);
    }
    for (const promptName of dynamicPrompts) {
      registerDynamicPrompt(mcpServer, promptName);
    }

    return mcpServer;
  }

  const statefulTransport =
    transportMode === "stateful"
      ? new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
        })
      : undefined;
  if (statefulTransport) {
    statefulMcpServer = createMcpServer();
  }
  const statefulConnected =
    statefulTransport && statefulMcpServer
      ? statefulMcpServer.connect(statefulTransport)
      : undefined;

  function logRequest(
    request: Request,
    overrides: Partial<Pick<RequestLogEntry, "pathname" | "proxyTargetUrl">> = {},
  ): RequestLogEntry {
    const url = new URL(request.url);
    const entry: RequestLogEntry = {
      accept: request.headers.get("accept"),
      authorization: request.headers.get("authorization"),
      cookie: request.headers.get("cookie"),
      mcpProtocolVersion: request.headers.get("mcp-protocol-version"),
      method: request.method,
      pathname: url.pathname,
      ...overrides,
    };

    requestLog.push(entry);

    return entry;
  }

  function logResponse(entry: RequestLogEntry, response: Response) {
    entry.contentType = response.headers.get("content-type");
    entry.status = response.status;
  }

  async function handleMcpRequest(
    request: Request,
    logOverrides: Partial<Pick<RequestLogEntry, "pathname" | "proxyTargetUrl">> = {},
  ): Promise<Response> {
    await nextResponseDelay();
    const logEntry = logRequest(request, logOverrides);
    await captureJsonRpcMethod(request, logEntry);
    const failedCatalogResponse = await maybeFailCatalogRequest(request, logEntry);
    if (failedCatalogResponse) {
      return failedCatalogResponse;
    }
    const paginatedCatalogResponse = await maybePaginateCatalogRequest(request, logEntry);
    if (paginatedCatalogResponse) {
      return paginatedCatalogResponse;
    }
    const failedInitializedResponse = await maybeFailInitializedNotification(request, logEntry);
    if (failedInitializedResponse) {
      return failedInitializedResponse;
    }

    const authInfo = requireAuth ? authenticateMcpRequest(request) : undefined;
    if (requireAuth && !authInfo) {
      const defaultAuthenticateHeader = advertiseOAuth
        ? `Bearer resource_metadata="${protectedResourceMetadataUrl}", scope="mcp:tools"`
        : 'Bearer realm="mcp-test", scope="mcp:tools"';
      const authenticateHeader =
        typeof options.authenticateHeader === "function"
          ? options.authenticateHeader(defaultAuthenticateHeader)
          : (options.authenticateHeader ?? defaultAuthenticateHeader);
      const response = new Response("Unauthorized", {
        status: 401,
        headers: {
          "WWW-Authenticate": authenticateHeader,
        },
      });
      logResponse(logEntry, response);

      return response;
    }

    if (transportMode === "stateless") {
      const transport = new WebStandardStreamableHTTPServerTransport();
      await createMcpServer().connect(transport);
      const response = await transport.handleRequest(request, { authInfo });
      logResponse(logEntry, response);

      return response;
    }

    if (!statefulTransport || !statefulConnected) {
      throw new Error("Stateful MCP transport was not initialized.");
    }

    await statefulConnected;

    const response = await statefulTransport.handleRequest(request, { authInfo });
    logResponse(logEntry, response);

    return response;
  }

  async function handleProxyRequest(request: Request): Promise<Response> {
    const targetUrl = request.headers.get("x-mcp-target-url");
    const logOverrides = {
      pathname: new URL(proxyUrl).pathname,
      proxyTargetUrl: targetUrl,
    };

    if (!targetUrl) {
      const logEntry = logRequest(request, logOverrides);
      const response = new Response("Missing x-mcp-target-url", { status: 400 });
      logResponse(logEntry, response);

      return response;
    }

    if (targetUrl !== mcpUrl) {
      const logEntry = logRequest(request, logOverrides);
      const response = new Response("Target not allowed", { status: 403 });
      logResponse(logEntry, response);

      return response;
    }

    if (request.method === "GET") {
      const logEntry = logRequest(request, logOverrides);
      const response = new Response("SSE not enabled for this proxy", { status: 405 });
      logResponse(logEntry, response);

      return response;
    }

    if (request.method !== "POST") {
      const logEntry = logRequest(request, logOverrides);
      const response = new Response("Method not allowed", { status: 405 });
      logResponse(logEntry, response);

      return response;
    }

    return handleMcpRequest(
      new Request(targetUrl, {
        body: await request.text(),
        headers: request.headers,
        method: request.method,
      }),
      logOverrides,
    );
  }

  async function captureJsonRpcMethod(request: Request, logEntry: RequestLogEntry): Promise<void> {
    if (request.method !== "POST" || !request.headers.get("content-type")?.includes("json")) {
      return;
    }

    const requestBody = await request
      .clone()
      .json()
      .catch(() => null);

    if (
      typeof requestBody === "object" &&
      requestBody !== null &&
      "method" in requestBody &&
      typeof requestBody.method === "string"
    ) {
      logEntry.jsonRpcMethod = requestBody.method;
      if (
        requestBody.method === "initialize" &&
        "params" in requestBody &&
        typeof requestBody.params === "object" &&
        requestBody.params !== null &&
        "capabilities" in requestBody.params
      ) {
        logEntry.initializeCapabilities = requestBody.params.capabilities;
      }
    }
  }

  async function maybeFailCatalogRequest(
    request: Request,
    logEntry: RequestLogEntry,
  ): Promise<Response | null> {
    if (request.method !== "POST" || !request.headers.get("content-type")?.includes("json")) {
      return null;
    }

    const requestBody = await request
      .clone()
      .json()
      .catch(() => null);
    const method =
      typeof requestBody === "object" &&
      requestBody !== null &&
      "method" in requestBody &&
      typeof requestBody.method === "string"
        ? requestBody.method
        : null;

    if (
      method !== "tools/list" &&
      method !== "resources/list" &&
      method !== "resources/templates/list" &&
      method !== "prompts/list"
    ) {
      return null;
    }

    if (!failCatalogMethods.has(method)) {
      return null;
    }

    const response = HttpResponse.json(
      {
        error: {
          code: -32603,
          message: `${method} failed for test`,
        },
        id: requestBody.id,
        jsonrpc: "2.0",
      },
      { status: 200 },
    );
    logResponse(logEntry, response);

    return response;
  }

  async function maybeFailInitializedNotification(
    request: Request,
    logEntry: RequestLogEntry,
  ): Promise<Response | null> {
    if (!failInitializedNotification || request.method !== "POST") {
      return null;
    }

    const requestBody = await request
      .clone()
      .json()
      .catch(() => null);
    const method =
      typeof requestBody === "object" &&
      requestBody !== null &&
      "method" in requestBody &&
      typeof requestBody.method === "string"
        ? requestBody.method
        : null;

    if (method !== "notifications/initialized") {
      return null;
    }

    const response = HttpResponse.json(
      {
        error: {
          code: -32600,
          message: "Invalid request method for existing session",
        },
        id: null,
        jsonrpc: "2.0",
      },
      { status: 400 },
    );
    logResponse(logEntry, response);

    return response;
  }

  async function maybePaginateCatalogRequest(
    request: Request,
    logEntry: RequestLogEntry,
  ): Promise<Response | null> {
    if (!options.paginatedTools || request.method !== "POST") {
      return null;
    }

    const requestBody = await request
      .clone()
      .json()
      .catch(() => null);
    const method =
      typeof requestBody === "object" &&
      requestBody !== null &&
      "method" in requestBody &&
      typeof requestBody.method === "string"
        ? requestBody.method
        : null;

    if (method !== "tools/list") {
      return null;
    }

    const cursor =
      typeof requestBody === "object" &&
      requestBody !== null &&
      "params" in requestBody &&
      typeof requestBody.params === "object" &&
      requestBody.params !== null &&
      "cursor" in requestBody.params &&
      typeof requestBody.params.cursor === "string"
        ? requestBody.params.cursor
        : undefined;
    const response = HttpResponse.json({
      id: requestBody.id,
      jsonrpc: "2.0",
      result:
        cursor === "page-2"
          ? {
              tools: [
                {
                  name: "second-page-tool",
                  inputSchema: { type: "object", properties: {} },
                },
              ],
            }
          : {
              nextCursor: "page-2",
              tools: [
                {
                  name: "first-page-tool",
                  inputSchema: { type: "object", properties: {} },
                },
              ],
            },
    });
    logResponse(logEntry, response);

    return response;
  }

  function authenticateMcpRequest(request: Request): AuthInfo | undefined {
    const authorization = request.headers.get("authorization");
    const tokenValue = authorization?.match(/^Bearer (?<token>.+)$/u)?.groups?.token;

    if (!tokenValue) {
      return undefined;
    }

    const token = accessTokens.get(tokenValue);
    if (!token || token.resource !== acceptedTokenResource) {
      return undefined;
    }

    return {
      token: token.token,
      clientId: token.clientId,
      scopes: token.scope.split(" "),
      resource: new URL(token.resource),
    };
  }

  function registerClient(metadata: OAuthClientMetadata): OAuthClientInformationFull {
    const clientId = `client-${clients.size + 1}`;
    const client: OAuthClientInformationFull = {
      ...metadata,
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };

    clients.set(clientId, client);

    return client;
  }

  function parseClientMetadata(value: unknown): OAuthClientMetadata | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const metadata = value as OAuthClientMetadata;
    if (!Array.isArray(metadata.redirect_uris) || metadata.redirect_uris.length === 0) {
      return null;
    }
    if (!metadata.redirect_uris.every((redirectUri) => typeof redirectUri === "string")) {
      return null;
    }
    if (
      metadata.response_types &&
      (!Array.isArray(metadata.response_types) || !metadata.response_types.includes("code"))
    ) {
      return null;
    }
    if (
      metadata.grant_types &&
      (!Array.isArray(metadata.grant_types) || !metadata.grant_types.includes("authorization_code"))
    ) {
      return null;
    }
    if (
      metadata.token_endpoint_auth_method !== undefined &&
      metadata.token_endpoint_auth_method !== "none"
    ) {
      return null;
    }

    return metadata;
  }

  function authorize(authorizationUrl: URL): string {
    const clientId = authorizationUrl.searchParams.get("client_id");
    const codeChallenge = authorizationUrl.searchParams.get("code_challenge");
    const codeChallengeMethod = authorizationUrl.searchParams.get("code_challenge_method");
    const redirectUri = authorizationUrl.searchParams.get("redirect_uri");
    const resource = authorizationUrl.searchParams.get("resource");
    const state = authorizationUrl.searchParams.get("state");

    if (!clientId || !codeChallenge || !codeChallengeMethod || !redirectUri || !resource) {
      throw new Error(`Incomplete authorization request: ${authorizationUrl.toString()}`);
    }

    if (codeChallengeMethod !== "S256") {
      throw new Error(`Unsupported PKCE challenge method: ${codeChallengeMethod}`);
    }

    if (!clients.has(clientId) && !acceptedClientMetadataUrls.has(clientId)) {
      throw new Error(`Unknown OAuth client: ${clientId}`);
    }
    if (new URL(resource).href !== acceptedTokenResource) {
      throw new Error(`Unexpected OAuth resource: ${resource}`);
    }

    const client = clients.get(clientId);
    if (client && !client.redirect_uris.includes(redirectUri)) {
      throw new Error(`Unregistered redirect URI: ${redirectUri}`);
    }

    const code = `code-${authorizationCodes.size + 1}`;

    authorizationCodes.set(code, {
      clientId,
      codeChallenge,
      codeChallengeMethod,
      redirectUri,
      resource,
      scope: authorizationUrl.searchParams.get("scope") ?? "mcp:tools",
      ...(state ? { state } : {}),
    });

    return code;
  }

  function issueAccessToken(clientId: string, resource: string, scope: string): string {
    const token = `access-token-${accessTokens.size + 1}`;
    accessTokens.set(token, {
      clientId,
      resource,
      scope,
      token,
    });

    return token;
  }

  function issueRefreshToken(clientId: string, resource: string, scope: string): string {
    const token = `refresh-token-${refreshTokens.size + 1}`;
    refreshTokens.set(token, {
      clientId,
      resource,
      scope,
      token,
    });

    return token;
  }

  const handlers = [
    http.all(proxyUrl, ({ request }) => handleProxyRequest(request)),
    http.all(mcpUrl, ({ request }) => handleMcpRequest(request)),
    http.get(protectedResourceMetadataUrl, ({ request }) => {
      logRequest(request);

      return delayedJson({
        bearer_methods_supported: ["header"],
        resource: protectedResource,
        resource_name: "MSW OAuth MCP test server",
        scopes_supported: ["mcp:tools"],
        authorization_servers: [authorizationServerUrl],
      });
    }),
    http.get(authorizationServerMetadataUrl, ({ request }) => {
      logRequest(request);

      return delayedJson({
        issuer: authorizationServerUrl,
        authorization_endpoint: authorizationEndpoint,
        token_endpoint: tokenEndpoint,
        ...(dynamicClientRegistration ? { registration_endpoint: registrationEndpoint } : {}),
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: ["mcp:tools"],
        ...(clientMetadataDocument ? { client_id_metadata_document_supported: true } : {}),
      });
    }),
    http.post(registrationEndpoint, async ({ request }) => {
      logRequest(request);

      await nextResponseDelay();
      if (!dynamicClientRegistration) {
        return HttpResponse.json({ error: "registration_not_supported" }, { status: 404 });
      }

      const metadata = parseClientMetadata(await request.json().catch(() => null));
      if (!metadata) {
        return HttpResponse.json({ error: "invalid_client_metadata" }, { status: 400 });
      }

      return HttpResponse.json(registerClient(metadata), {
        status: 201,
      });
    }),
    http.get(authorizationEndpoint, async ({ request }) => {
      logRequest(request);
      await nextResponseDelay();

      return HttpResponse.json({ error: "Tests should capture this URL instead of navigating." });
    }),
    http.post(tokenEndpoint, async ({ request }) => {
      await nextResponseDelay();
      const logEntry = logRequest(request);

      const body = await request.formData();
      const grantType = stringFormValue(body, "grant_type");
      logEntry.grantType = grantType;
      if (grantType === "refresh_token") {
        const refreshToken = stringFormValue(body, "refresh_token");
        const clientId = stringFormValue(body, "client_id");
        const resource = stringFormValue(body, "resource");
        logEntry.resource = resource;
        const savedRefreshToken = refreshTokens.get(refreshToken);

        if (
          !savedRefreshToken ||
          savedRefreshToken.clientId !== clientId ||
          savedRefreshToken.resource !== resource
        ) {
          const response = HttpResponse.json({ error: "invalid_grant" }, { status: 400 });
          logResponse(logEntry, response);

          return response;
        }

        const accessToken = issueAccessToken(
          savedRefreshToken.clientId,
          savedRefreshToken.resource,
          savedRefreshToken.scope,
        );
        const response = HttpResponse.json({
          access_token: accessToken,
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: savedRefreshToken.token,
          scope: savedRefreshToken.scope,
        });
        logResponse(logEntry, response);

        return response;
      }

      const code = stringFormValue(body, "code");
      const clientId = stringFormValue(body, "client_id");
      const redirectUri = stringFormValue(body, "redirect_uri");
      const codeVerifier = stringFormValue(body, "code_verifier");
      const resource = stringFormValue(body, "resource");
      logEntry.resource = resource;
      const authorizationCode = authorizationCodes.get(code);
      const isValidPkceChallenge =
        authorizationCode &&
        (await createS256CodeChallenge(codeVerifier)) === authorizationCode.codeChallenge;

      if (grantType !== "authorization_code") {
        const response = HttpResponse.json({ error: "unsupported_grant_type" }, { status: 400 });
        logResponse(logEntry, response);

        return response;
      }

      if (
        !authorizationCode ||
        authorizationCode.clientId !== clientId ||
        authorizationCode.redirectUri !== redirectUri ||
        authorizationCode.resource !== resource ||
        !isValidPkceChallenge
      ) {
        const response = HttpResponse.json({ error: "invalid_grant" }, { status: 400 });
        logResponse(logEntry, response);

        return response;
      }

      authorizationCodes.delete(code);

      const token = issueAccessToken(clientId, authorizationCode.resource, authorizationCode.scope);
      const refreshToken = issueRefreshToken(
        clientId,
        authorizationCode.resource,
        authorizationCode.scope,
      );

      const response = HttpResponse.json({
        access_token: token,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: refreshToken,
        scope: authorizationCode.scope,
      });
      logResponse(logEntry, response);

      return response;
    }),
  ];

  function delayedJson(
    body: Parameters<typeof HttpResponse.json>[0],
    init?: ResponseInit,
  ): Promise<Response> {
    return nextResponseDelay().then(() => HttpResponse.json(body, init));
  }

  return {
    authorizationEndpoint,
    authorizationServerMetadataUrl,
    authorizationServerUrl,
    mcpUrl,
    proxyUrl,
    registrationEndpoint,
    requestLog,
    tokenEndpoint,
    authorize,
    expireAccessTokens: () => accessTokens.clear(),
    failCatalogMethods: (methods) => {
      failCatalogMethods.clear();
      for (const method of methods ?? []) {
        failCatalogMethods.add(method);
      }
    },
    handlers,
    registerPrompt: (name) => {
      dynamicPrompts.add(name);
      if (statefulMcpServer) {
        registerDynamicPrompt(statefulMcpServer, name);
      }
    },
    registerResource: (uri) => {
      dynamicResources.add(uri);
      if (statefulMcpServer) {
        registerDynamicResource(statefulMcpServer, uri);
      }
    },
    registerTool: (name) => {
      dynamicTools.add(name);
      if (statefulMcpServer) {
        registerDynamicTool(statefulMcpServer, name);
      }
    },
    sendPromptListChanged: () => {
      statefulMcpServer?.sendPromptListChanged();
    },
    sendResourceListChanged: () => {
      statefulMcpServer?.sendResourceListChanged();
    },
    sendToolListChanged: () => {
      statefulMcpServer?.sendToolListChanged();
    },
  };
}

function registerDynamicTool(mcpServer: McpServer, name: string): void {
  mcpServer.registerTool(
    name,
    {
      description: `Dynamic test tool ${name}.`,
    },
    () => ({
      content: [
        {
          type: "text",
          text: name,
        },
      ],
    }),
  );
}

function registerDynamicResource(mcpServer: McpServer, uri: string): void {
  mcpServer.registerResource(
    uri,
    uri,
    {
      mimeType: "text/plain",
      title: uri,
    },
    () => ({
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text: uri,
        },
      ],
    }),
  );
}

function registerDynamicPrompt(mcpServer: McpServer, name: string): void {
  mcpServer.registerPrompt(
    name,
    {
      description: `Dynamic test prompt ${name}.`,
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: name,
          },
        },
      ],
    }),
  );
}

function normalizeOptionalPath(path: `/${string}` | undefined): "" | `/${string}` {
  if (!path || path === "/") {
    return "";
  }

  return path.endsWith("/") ? (path.slice(0, -1) as `/${string}`) : path;
}

function createResponseDelay(
  randomResponseDelay: OAuthMcpTestServerOptions["randomResponseDelay"],
): () => Promise<void> {
  if (!randomResponseDelay || randomResponseDelay.maxMs <= 0) {
    return () => Promise.resolve();
  }

  let state = randomResponseDelay.seed >>> 0;

  return async () => {
    state = (1664525 * state + 1013904223) >>> 0;
    const delayMs = state % (Math.floor(randomResponseDelay.maxMs) + 1);

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, delayMs);
    });
  };
}

function stringFormValue(body: FormData, name: string): string {
  const value = body.get(name);

  return typeof value === "string" ? value : "";
}

async function createS256CodeChallenge(codeVerifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const binary = String.fromCharCode(...new Uint8Array(digest));

  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}
