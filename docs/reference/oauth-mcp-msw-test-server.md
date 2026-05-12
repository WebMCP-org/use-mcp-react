# OAuth MCP Test Server With MSW

Use MSW as the external HTTP boundary, but run a real MCP server behind the `/mcp` handler. The clean design is a test helper that combines:

- a real `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`
- `WebStandardStreamableHTTPServerTransport` from `@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js`
- MSW handlers for OAuth metadata, registration, token exchange, API-key bearer auth, and the MCP endpoint
- a tiny test harness for the browser-only authorization callback step

This gives the hook tests a real MCP protocol peer without starting a separate process or mocking SDK internals.

## What Is Real

The core protocol path is real browser E2E:

- the MCP client runs in the browser document JavaScript runtime
- MSW runs in a real browser service worker runtime
- browser `fetch` crosses the document/service-worker boundary
- the client is the real SDK `Client`
- the client transport is the real SDK `StreamableHTTPClientTransport`
- the server is the real SDK `McpServer`
- the server transport is the real SDK `WebStandardStreamableHTTPServerTransport`
- MCP messages are parsed, routed, validated, and answered by the SDK
- SSE responses use real `ReadableStream`/`text/event-stream` responses
- OAuth client behavior uses the SDK auth flow

The test-owned pieces are the server's deployment environment and identity provider behavior:

- the MCP server runs inside the service worker handler instead of a separate OS process
- the OAuth authorization server is an in-memory Web handler
- codes, clients, and tokens are stored in memory
- user consent is simulated by the test harness instead of a real hosted login page

Do not replace the SDK client, SDK server, SDK transports, or JSON-RPC protocol path with mocks in core tests.

## Conclusion

It is possible to test OAuth-protected Streamable HTTP MCP in Vitest Browser Mode with MSW.

The server should act as both OAuth roles:

- **Protected resource server:** validates bearer tokens, serves `/mcp`, returns `WWW-Authenticate`, and publishes protected resource metadata.
- **Authorization server:** serves authorization server metadata, dynamic client registration, authorization code issuance, and token exchange. Refresh token exchange can be added as a later scenario.

MSW can own the network endpoints because the MCP client transport and OAuth helpers use `fetch`. The one thing MSW should not own is full-page browser navigation. MSW's browser service worker bypasses navigation requests, so hook tests should capture the authorization URL and simulate the callback unless a specific test is covering popup or redirect UI.

## Proven In Browser E2E

The current browser test harness lives in:

```txt
tests/browser/support/oauthMcpServer.ts
tests/browser/oauth-mcp-msw.test.ts
```

It uses Vitest Browser Mode, Playwright Chromium, MSW's real service worker runtime, and the real MCP TypeScript SDK client and server transports.

The suite currently proves:

- OAuth with Dynamic Client Registration
- OAuth with a pre-registered public browser client id
- failure when DCR is disabled and no manual client id is available
- PKCE `S256` enforcement, including a tampered verifier failure
- API-key style bearer auth when the MCP server does not advertise OAuth metadata
- bearer-required detection when no token is provided
- `Client.connect()` initialization
- server version and capabilities
- `ping`
- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`
- `prompts/list`
- `prompts/get`
- `text/event-stream` SSE responses through MSW
- stateful `mcp-session-id`
- `DELETE /mcp` session termination through `transport.terminateSession()`

This proves the core shape: `Request -> Response` routing is enough to host the SDK's web-standard MCP server transport in a service worker-backed browser test. The MCP client/server stack is not mocked. The test-owned pieces are the in-memory authorization server, token store, and user consent step.

## Specs That Matter

### MCP Authorization 2025-11-25

The current MCP authorization model uses OAuth 2.1-compatible authorization flows. MCP servers that require auth behave as protected resource servers. They advertise authorization details through OAuth 2.0 Protected Resource Metadata and challenge unauthenticated requests with a `WWW-Authenticate` header.

The test server should exercise:

- `WWW-Authenticate: Bearer resource_metadata="...", scope="..."`
- RFC 9728 protected resource metadata
- RFC 8414 authorization server metadata
- PKCE with `S256`
- RFC 8707 `resource`
- dynamic client registration fallback
- optional Client ID Metadata Document support

### RFC 9728 Protected Resource Metadata

For an MCP URL like:

```txt
http://localhost:5173/mcp
```

the path-aware protected resource metadata endpoint should be:

```txt
http://localhost:5173/.well-known/oauth-protected-resource/mcp
```

The metadata should include:

```json
{
  "resource": "http://localhost:5173/mcp",
  "authorization_servers": ["http://localhost:5173"],
  "scopes_supported": ["mcp:tools"]
}
```

The SDK validates that the protected resource metadata resource is compatible with the requested MCP server URL. Keep the resource URL exact in tests unless the test is specifically about invalid resource handling.

### RFC 8414 Authorization Server Metadata

The mock authorization server should serve:

```txt
http://localhost:5173/.well-known/oauth-authorization-server
```

Minimal useful metadata:

```json
{
  "issuer": "http://localhost:5173",
  "authorization_endpoint": "http://localhost:5173/authorize",
  "token_endpoint": "http://localhost:5173/token",
  "registration_endpoint": "http://localhost:5173/register",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_methods_supported": ["none"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": ["mcp:tools"]
}
```

For URL-based Client ID Metadata Document tests, add:

```json
{
  "client_id_metadata_document_supported": true
}
```

The MCP SDK requires `clientMetadataUrl` to be HTTPS with a non-root path. That makes dynamic client registration easier for the default localhost browser test path. Client ID Metadata Document coverage may need an HTTPS dev origin or a fake HTTPS URL intercepted by MSW.

### RFC 7591 Dynamic Client Registration

The SDK falls back to DCR when it has no saved client information and URL-based client IDs are unavailable. The `/register` handler should accept the client's metadata and return the same metadata plus generated client information:

```json
{
  "client_id": "generated-client-id",
  "client_id_issued_at": 1778420000,
  "redirect_uris": ["http://localhost:5173/oauth/callback"],
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "client_name": "use-mcp-react test client",
  "scope": "mcp:tools"
}
```

Keep public clients as `token_endpoint_auth_method: "none"` for browser tests.

### RFC 7636 PKCE

The authorization endpoint must record `code_challenge` and `code_challenge_method`. The token endpoint must verify:

- `grant_type=authorization_code`
- `code`
- `client_id`
- `redirect_uri`
- `code_verifier`
- `resource`

For `S256`, compute:

```txt
BASE64URL(SHA256(code_verifier)) == code_challenge
```

### RFC 8707 Resource Indicators

The client includes `resource` in the authorization URL and token request when protected resource metadata is present. The test authorization server should bind issued tokens to that resource.

The MCP resource server should reject tokens whose stored resource does not match `/mcp`. This catches audience mistakes and prevents token passthrough bugs from looking valid.

## MCP SDK Findings

### Client Auth Flow

Relevant source:

```bash
sed -n '1,260p' "$(vp exec opensrc path @modelcontextprotocol/sdk)/src/client/auth.ts"
sed -n '1,260p' "$(vp exec opensrc path @modelcontextprotocol/sdk)/src/client/streamableHttp.ts"
```

`StreamableHTTPClientTransport` does the auth retry loop:

1. Sends MCP requests through `fetch`.
2. On `401`, extracts `resource_metadata` and `scope` from `WWW-Authenticate`.
3. Calls `auth(provider, { serverUrl, resourceMetadataUrl, scope, fetchFn })`.
4. If auth returns `AUTHORIZED`, retries the MCP request.
5. If auth returns `REDIRECT`, throws `UnauthorizedError`.
6. After the application receives an authorization code, `finishAuth(code)` exchanges it for tokens.

The `OAuthClientProvider` is the hook boundary. It owns:

- redirect URL
- client metadata
- saved client information
- saved tokens
- PKCE verifier
- redirect behavior
- optional discovery-state caching
- optional resource URL validation

### Server Transport

Relevant source:

```bash
sed -n '1,260p' "$(vp exec opensrc path @modelcontextprotocol/sdk)/src/server/webStandardStreamableHttp.ts"
```

`WebStandardStreamableHTTPServerTransport` uses Web APIs:

- `Request`
- `Response`
- `ReadableStream`
- `Headers`

That makes it compatible with MSW handler returns. The transport supports:

- stateless mode
- stateful sessions with `mcp-session-id`
- `POST` JSON-RPC request handling
- `GET` standalone SSE streams
- `DELETE` session termination
- JSON response mode via `enableJsonResponse`
- SSE response mode via `text/event-stream`
- optional event store and resumability

For this repo's hook tests, prefer stateful mode because the client transport and real servers use `mcp-session-id`.

### Auth Server Router

Relevant source:

```bash
sed -n '1,260p' "$(vp exec opensrc path @modelcontextprotocol/sdk)/src/server/auth/router.ts"
sed -n '1,260p' "$(vp exec opensrc path @modelcontextprotocol/sdk)/src/server/auth/handlers/token.ts"
sed -n '1,260p' "$(vp exec opensrc path @modelcontextprotocol/sdk)/src/server/auth/handlers/authorize.ts"
```

The SDK includes OAuth server handlers, but they are Express handlers. They are useful as reference, not the best implementation substrate for browser-mode MSW tests.

Implement the test OAuth server directly as Web handlers. Match the SDK behavior where it matters:

- metadata endpoints allow browser clients
- DCR accepts public client metadata
- authorization validates redirect URI and PKCE parameters
- token endpoint validates client, code, PKCE, redirect URI, and resource
- refresh endpoint can issue replacement access tokens

## MSW Findings

Relevant source:

```bash
sed -n '1,260p' "$(vp exec opensrc path msw)/src/mockServiceWorker.js"
sed -n '1,260p' "$(vp exec opensrc path msw)/src/browser/sources/service-worker-source.ts"
sed -n '1,260p' "$(vp exec opensrc path msw)/src/core/sse.ts"
```

MSW's browser worker:

- intercepts fetch requests
- bypasses `event.request.mode === "navigate"`
- forwards intercepted requests to the client page
- accepts mocked `Response` objects from handlers
- transfers `ReadableStream` response bodies when the browser supports transferable streams
- buffers stream bodies as `ArrayBuffer` when transferable streams are unavailable

MSW also has an `sse()` helper, but the MCP server transport already returns `text/event-stream` `Response` objects. Prefer returning the SDK transport's response directly from the `/mcp` MSW handler.

Use MSW's `sse()` only for isolated EventSource-specific tests, not for the core MCP transport.

## Recommended Test Helper

Create a browser-test helper along these lines:

```ts
const server = createOAuthMcpTestServer({
  origin: window.location.origin,
  mcpPath: "/mcp",
  scopes: ["mcp:tools"],
  tools: [
    {
      name: "echo",
      handler: async ({ text }) => ({
        content: [{ type: "text", text }],
      }),
    },
  ],
});

worker.use(...server.handlers);
```

The current helper exposes:

```ts
server.mcpUrl;
server.authorizationEndpoint;
server.registrationEndpoint;
server.requestLog;
server.authorize(authorizationUrl);
server.handlers;
```

It accepts options for the provider shapes proven so far:

```ts
createOAuthMcpTestServer({
  dynamicClientRegistration: false,
  preRegisteredClients: [client],
  advertiseOAuth: false,
  acceptedBearerTokens: [token],
});
```

The helper should grow toward this richer shape as React tests need more introspection:

```ts
server.resourceMetadataUrl;
server.authorizationServerMetadataUrl;
server.getRequestLog();
server.getRegisteredClients();
server.getIssuedTokens();
server.authorize(authorizationUrl);
server.reset();
```

`authorize(authorizationUrl)` currently validates the URL and returns an authorization code directly:

```ts
const code = server.authorize(capturedAuthorizationUrl);
await transport.finishAuth(code);
```

For popup hook tests, add a callback helper that returns the redirect URL shape:

```ts
const callbackUrl = server.authorize(capturedAuthorizationUrl);
await completeOAuthCallback(callbackUrl);
```

For hook tests that capture popup behavior, the provider can use an injected redirect function rather than real `window.open`. For a small number of browser-navigation tests, add a Vite route for `/authorize` or `/oauth/callback`; keep MSW responsible for the HTTP protocol endpoints.

## Handler Design

### `/mcp`

The MSW handler should:

1. Validate `Authorization`.
2. If missing or invalid, return `401` with `WWW-Authenticate`.
3. If insufficient scope, return `403` with `WWW-Authenticate` including `error="insufficient_scope"` and `scope="..."`.
4. If valid, route to `WebStandardStreamableHTTPServerTransport.handleRequest(request, { authInfo })`.

The current browser helper uses one stateful `WebStandardStreamableHTTPServerTransport` per test server instance. A later multi-session helper should keep a map:

```ts
const sessions = new Map<string, {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
}>();
```

On a request without a known session id, create a new server and transport. Register the session inside `onsessioninitialized`.

### Protected Resource Metadata

Return the path-aware RFC 9728 document:

```txt
/.well-known/oauth-protected-resource/mcp
```

Return `authorization_servers` pointing at the same test origin unless the test is specifically covering split AS/RS behavior.

### Authorization Server Metadata

Return metadata at:

```txt
/.well-known/oauth-authorization-server
```

Keep `code_challenge_methods_supported: ["S256"]` present. Some OAuth implementations reject servers that omit PKCE support metadata.

### `/register`

Accept JSON metadata and return generated client information. Store the full record by `client_id`.

### `/authorize`

Do not rely on MSW for full-page navigation. Implement authorization as a helper that parses a captured URL:

1. Validate `response_type=code`.
2. Validate `client_id`.
3. Validate exact `redirect_uri` against the registered client.
4. Validate `code_challenge_method=S256`.
5. Record `code_challenge`, `scope`, `resource`, `client_id`, and `redirect_uri`.
6. Return `redirect_uri?code=...&state=...`.

An MSW `GET /authorize` handler can exist for fetch-based tests, but navigation will bypass MSW in the browser worker.

### `/token`

For `authorization_code`:

1. Authenticate the public client by `client_id`.
2. Validate authorization code exists and belongs to the client.
3. Validate `redirect_uri`.
4. Verify PKCE.
5. Validate `resource`.
6. Delete the one-time code.
7. Issue `access_token`, `refresh_token`, `expires_in`, `token_type`, and `scope`.

For `refresh_token`:

1. Validate refresh token exists.
2. Validate client id.
3. Validate requested `resource`.
4. Issue a new access token.
5. Preserve or rotate refresh token depending on the test case.

## Test Matrix

Covered now:

- DCR authorization-code flow succeeds.
- Pre-registered public client flow succeeds without `/register`.
- Missing DCR plus missing client id fails before authorization.
- PKCE `S256` is enforced.
- Static bearer/API-key auth succeeds without OAuth discovery.
- Bearer-only server without a token is classified by its non-OAuth bearer challenge.
- `tools/list` works after auth.
- `tools/call` receives authenticated `authInfo`.
- `resources/list` and `resources/read` work after auth.
- `prompts/list` and `prompts/get` work after auth.
- `ping` works after auth.
- Session id is saved and explicit session termination works.
- SSE response mode works through MSW.

Add next:

- URL-based Client ID Metadata Document mode.
- Wrong resource token is rejected.
- Expired access token refreshes and retries.
- Refresh token failure falls back to authorization redirect.
- Insufficient scope returns `403` and triggers upscoping.
- Split authorization server and resource server origins.
- GET standalone SSE notifications.
- resumability with `Last-Event-ID`.
- popup callback behavior for the React hook.
- popup-blocked/manual-auth UI behavior.

## Risks And Constraints

- **Navigation bypass:** MSW does not intercept full-page navigations. Simulate auth callbacks for core tests.
- **HTTPS client metadata URL:** the MCP SDK rejects non-HTTPS `clientMetadataUrl`. DCR is easier for localhost tests.
- **Streaming support:** MSW transfers `ReadableStream` bodies only when the browser supports stream transfer. Chromium works for the current SSE tests. Keep JSON response mode available only as a diagnostic fallback.
- **Long-lived streams:** tests must close clients/transports or reset handlers carefully to avoid hanging browser tests.
- **State leaks:** reset clients, codes, tokens, sessions, request logs, storage, and document body after every test.
- **SDK version drift:** the findings here are for `@modelcontextprotocol/sdk@1.29.0` and `msw@2.14.5`.

## Implementation Status And Order

Done:

1. Added the browser MSW MCP/OAuth test server at `tests/browser/support/oauthMcpServer.ts`.
2. Added direct SDK browser tests in `tests/browser/oauth-mcp-msw.test.ts`.
3. Proved OAuth DCR, pre-registered OAuth clients, static bearer auth, SSE, tools, resources, prompts, ping, and session termination.

Next:

1. Add the browser OAuth provider abstraction for the hook.
2. Port the direct SDK tests to the public hook API.
3. Add popup callback behavior.
4. Add Client ID Metadata Document coverage.
5. Add refresh/upscope/failure coverage.

This keeps the test infrastructure honest: the only mocked thing is the external network server. MCP message handling, SDK auth behavior, browser storage, fetch, headers, and streams stay real.

## Source Paths

Dependency sources are available through `opensrc`:

```bash
vp exec opensrc path @modelcontextprotocol/sdk
vp exec opensrc path msw
vp exec opensrc path @ai-sdk/mcp
vp exec opensrc path github:modelcontextprotocol/use-mcp
vp exec opensrc path github:modelcontextprotocol/inspector
```

High-signal files:

- `@modelcontextprotocol/sdk/src/client/auth.ts`
- `@modelcontextprotocol/sdk/src/client/streamableHttp.ts`
- `@modelcontextprotocol/sdk/src/server/webStandardStreamableHttp.ts`
- `@modelcontextprotocol/sdk/src/server/auth/router.ts`
- `@modelcontextprotocol/sdk/src/server/auth/handlers/authorize.ts`
- `@modelcontextprotocol/sdk/src/server/auth/handlers/token.ts`
- `@modelcontextprotocol/sdk/src/server/auth/handlers/register.ts`
- `@modelcontextprotocol/sdk/src/server/auth/middleware/bearerAuth.ts`
- `@modelcontextprotocol/sdk/src/examples/server/demoInMemoryOAuthProvider.ts`
- `msw/src/mockServiceWorker.js`
- `msw/src/browser/sources/service-worker-source.ts`
- `msw/src/core/sse.ts`
- `github:modelcontextprotocol/use-mcp/src/auth/browser-provider.ts`
- `github:modelcontextprotocol/use-mcp/src/auth/callback.ts`
- `github:modelcontextprotocol/inspector/client/src/lib/auth.ts`
