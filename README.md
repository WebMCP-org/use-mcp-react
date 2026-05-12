# use-mcp-react

React hooks for connecting browser apps to remote MCP servers.

`use-mcp-react` is for browser apps where the MCP server URL may be entered at runtime and the app may not know ahead of time whether the server uses no auth, OAuth, a manually registered OAuth client, or an API-key style bearer token.

> Status: this repo is pre-release. The browser MCP/OAuth hook and test harness are implemented, but the API may still change before the first stable release.

## Installation

```bash
npm install use-mcp-react react @types/react
```

## Goals

- Use the real MCP TypeScript SDK client and Streamable HTTP transport.
- Infer auth requirements from the MCP server instead of requiring provider-specific setup up front.
- Support runtime MCP URLs.
- Support OAuth with explicitly configured Client ID Metadata Documents, Dynamic Client Registration, and manually registered public clients.
- Support API-key style bearer auth when the MCP server does not advertise MCP OAuth metadata.
- Keep bearer tokens app-owned. The hook must not persist them.
- Own browser OAuth popup handoff, callback delivery, storage, and state routing.
- Test browser-facing behavior in Vitest Browser Mode with MSW and real MCP SDK client/transport/server paths.

## Basic Usage

Register the callback route once:

```tsx
import { McpOAuthCallback } from "use-mcp-react";

<Route path="/oauth/callback" element={<McpOAuthCallback />} />;
```

Use one hook instance per MCP server:

```tsx
import { useMcp } from "use-mcp-react";

export function McpConnection({ url }: { url: string }) {
  const mcp = useMcp({ url });

  if (mcp.status === "pending_auth") {
    if (mcp.authRequirement?.type === "oauth") {
      return <button onClick={() => void mcp.authorize({ target: "popup" })}>Authorize</button>;
    }

    if (mcp.authRequirement?.type === "manual_oauth_client") {
      return (
        <ClientIdForm
          onSubmit={(clientId) =>
            void mcp.reconnect({
              oauth: { clientId },
              authorizationTarget: "popup",
            })
          }
        />
      );
    }

    if (mcp.authRequirement?.type === "bearer") {
      return <ApiKeyForm onSubmit={(bearerToken) => void mcp.reconnect({ bearerToken })} />;
    }
  }

  if (mcp.status === "ready") {
    return <McpTools client={mcp.client} tools={mcp.tools} />;
  }

  return <ConnectionStatus status={mcp.status} error={mcp.error} />;
}
```

For a one-click connect button that can open OAuth automatically, call an action from the user gesture:

```tsx
<button onClick={() => void mcp.connect({ authorizationTarget: "popup" })} type="button">
  Connect
</button>
```

Mount-time auto-connect may prepare OAuth, but it must not open or navigate a popup. Browser popup creation must happen from a user gesture.

## Public API

```ts
type UseMcpStatus =
  | "idle"
  | "connecting"
  | "pending_auth"
  | "authenticating"
  | "loading"
  | "ready"
  | "reconnecting"
  | "failed";

type McpStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

type UseMcpOAuthOptions = {
  clientId?: string;
  clientMetadata?: OAuthClientMetadata;
  clientMetadataUrl?: string;
  redirectUrl?: URL | string;
};

type UseMcpTransportProxy = string | URL;

type UseMcpOptions = {
  bearerToken?: string;
  enabled?: boolean;
  oauth?: UseMcpOAuthOptions;
  storage?: McpStorage | false;
  transportProxy?: UseMcpTransportProxy;
  url?: URL | string | null;
};

type AuthorizationTarget = Window;

type UseMcpActionOptions = Partial<UseMcpOptions> & {
  authorizationTarget?: AuthorizationTarget | "popup";
  clearClient?: boolean;
  clearDiscovery?: boolean;
};

type McpActionResult =
  | { ok: true }
  | { ok: false; reason: "popup_blocked" }
  | { ok: false; reason: "no_pending_authorization" }
  | { ok: false; reason: "missing_oauth_state" }
  | { ok: false; reason: "oauth_state_mismatch" }
  | { ok: false; reason: "not_oauth" }
  | { ok: false; reason: "failed"; error: Error };

type UseMcpResult = {
  status: UseMcpStatus;
  authRequirement: McpAuthRequirement | null;
  authDiagnostics: McpAuthDiagnostics | null;
  authorizationUrl: URL | null;
  error: Error | null;

  client: Client | null;
  transport: StreamableHTTPClientTransport | null;
  serverCapabilities: ServerCapabilities | null;
  serverVersion: Implementation | null;
  serverProfile: McpServerProfile | null;

  tools: Tool[];
  resources: Resource[];
  resourceTemplates: ResourceTemplate[];
  prompts: Prompt[];
  catalogStatus: "idle" | "loading" | "ready" | "partial" | "error";
  catalogErrors: {
    tools?: unknown;
    resources?: unknown;
    resourceTemplates?: unknown;
    prompts?: unknown;
  };

  connect(options?: UseMcpActionOptions): Promise<McpActionResult>;
  disconnect(): Promise<McpActionResult>;
  reconnect(options?: UseMcpActionOptions): Promise<McpActionResult>;
  reauthorize(options?: UseMcpActionOptions): Promise<McpActionResult>;
  forget(): Promise<McpActionResult>;
  authorize(options?: { target?: AuthorizationTarget | "popup" }): Promise<McpActionResult>;
  finishAuthorization(code: string, state: string): Promise<McpActionResult>;
};
```

`ready` means MCP initialize completed and the initial catalog load completed. Unsupported catalog capabilities resolve to empty arrays. Unexpected catalog failures keep the connection alive and set `catalogStatus` / `catalogErrors`.

Catalog arrays are always arrays:

```ts
mcp.tools;
mcp.resources;
mcp.resourceTemplates;
mcp.prompts;
```

## State Model

`status` describes the connection lifecycle. `authRequirement` describes missing auth input.

```ts
type McpAuthRequirement =
  | {
      type: "oauth";
      authorizationUrl: URL;
      issuer?: string;
      scopes?: string[];
      supportsClientMetadataDocument: boolean;
      supportsDynamicClientRegistration: boolean;
    }
  | {
      type: "manual_oauth_client";
      issuer?: string;
      authorizationEndpoint?: string;
      tokenEndpoint?: string;
      reason: "client_registration_unavailable";
      suggestedFields: ["clientId"];
      supportsClientMetadataDocument: false;
      supportsDynamicClientRegistration: false;
    }
  | {
      type: "bearer";
      realm?: string;
      scopes?: string[];
      reason: "oauth_metadata_absent";
    };
```

`authDiagnostics` is for debug UI and playgrounds. It should expose stable decisions, not internal SDK phases:

```ts
type McpAuthDiagnostics = {
  issuer?: string;
  resourceMetadataUrl?: string;
  authorizationServerMetadataUrl?: string;
  registrationStrategy?: "client_id" | "client_metadata_url" | "dynamic_client_registration";
  scopes?: string[];
  lastError?: Error;
};
```

`serverProfile` is a diagnostics snapshot captured after initialize and initial catalog loading. It contains the initialized server info, auth classification, transport mode, catalog completeness, and fetch timestamp. Treat `status === "ready"` and the top-level catalog arrays as the primary runtime contract; use `serverProfile` for debug panes, setup guidance, and proof-of-life displays.

## Auth Inference

`useMcp({ url })` probes the server when `enabled !== false` and `url` is non-empty and parseable.

Inference order:

1. Try stored hook-owned OAuth credentials or app-provided credentials.
2. If the server connects without auth, proceed to catalog loading.
3. If `bearerToken` is provided, send it directly and skip OAuth discovery.
4. If the server returns `WWW-Authenticate: Bearer` with MCP `resource_metadata`, treat it as OAuth-protected.
5. Use app-provided `oauth.clientId` when present.
6. Use app-provided `oauth.clientMetadataUrl` only when the authorization server advertises Client ID Metadata Document support.
7. Use Dynamic Client Registration only when the authorization server advertises `registration_endpoint`.
8. If OAuth exists but no client id can be produced, set `status: "pending_auth"` with `authRequirement.type === "manual_oauth_client"`.
9. If the server returns `WWW-Authenticate: Bearer` without MCP `resource_metadata`, set `status: "pending_auth"` with `authRequirement.type === "bearer"`.
10. If metadata, CORS, token exchange, or transport behavior fails unexpectedly, set `status: "failed"` with a concrete error.

There is no default `clientMetadataUrl`. A generic library cannot assume the consuming app serves a valid Client ID Metadata Document. To use CIMD, host a metadata document and pass its HTTPS URL:

```tsx
const mcp = useMcp({
  url,
  oauth: {
    clientMetadataUrl: "https://app.example.com/.well-known/oauth-client-metadata.json",
  },
});
```

When `clientMetadataUrl` is configured and advertised, prefer it over DCR. MCPJam follows this same strategy for its own hosted metadata document, but that default is product-specific.

Manual client ids skip DCR:

```tsx
const mcp = useMcp({
  url,
  oauth: {
    clientId: "pre_registered_public_client_id",
  },
});
```

Bearer tokens skip OAuth discovery:

```tsx
const mcp = useMcp({
  url,
  bearerToken: apiKey,
});
```

`bearerToken` is a value, not a getter. When the token changes, pass the new string value so React can reconnect with the current credential.

## Browser Deployment Modes

### Direct Mode

Use direct mode only when you know the MCP server supports browser CORS on the MCP endpoint and on every required OAuth endpoint:

```tsx
const mcp = useMcp({
  url: "https://mcp.linear.app/mcp",
});
```

Many remote MCP servers do not expose browser CORS headers on the MCP transport endpoint. Use transport proxy mode when direct browser transport is blocked.

### Transport Proxy Mode

Keep `url` as the upstream MCP server and set `transportProxy` to an app-owned backend route:

```tsx
const mcp = useMcp({
  url: userEnteredMcpUrl,
  transportProxy: "/api/mcp-proxy",
});
```

The browser still owns OAuth, tokens, and discovery. The proxy only forwards MCP transport requests. Proxied requests include the logical upstream target in `x-mcp-target-url`.

The backend shape is up to your app. If it is dynamic, do not expose it as an unrestricted URL fetcher. See [Transport proxy mode](docs/reference/transport-proxy-mode.md) for one example.

`transportProxy` must be same-origin. If an app needs a remote backend gateway, expose it through a same-origin route and enforce its target allowlist on the server.

### Backend Gateway Mode

Backend gateway mode, where your server owns OAuth tokens or tool policy, is a different product model and is not implemented by this hook.

## Action Semantics

`connect(options?)`

Starts a connection using current hook options plus optional one-shot overrides. It preserves stored hook-owned OAuth state. If `authorizationTarget` is supplied and OAuth is required, the hook may navigate that target after the SDK prepares the authorization URL.

`disconnect()`

Closes the active SDK client and transport. It clears `client` and `transport`, sets `status: "idle"`, and preserves server metadata and catalog arrays as stale last-known data. Apps that need a live MCP client should check `status === "ready"` and `client !== null`.

`reconnect(options?)`

Closes active SDK client/transport and connects again. It preserves hook-owned OAuth client information, tokens, discovery state, and loaded catalog unless a newer result replaces them. This is a connection retry, not a fresh authorization attempt.

`reauthorize(options?)`

Closes active SDK client/transport, clears OAuth tokens, PKCE verifier, and pending authorization state, then starts a fresh user authorization. It preserves reusable client registration and discovery by default. Pass `clearClient: true` or `clearDiscovery: true` for a stronger reset.

`forget()`

Closes live and pending SDK connections, clears hook-owned auth storage, pending authorization state, client/transport refs, server metadata, catalog state, errors, and returns to `idle`.

`authorize(options?)`

Opens, focuses, or navigates a pending OAuth popup. This is useful after auto-connect has already reached `pending_auth` with a prepared `authorizationUrl`.

`finishAuthorization(code, state)`

Completes a callback only when `state` matches the current pending OAuth attempt. Missing or mismatched state must not exchange the code.

When a new `connect`, `reconnect`, or `reauthorize` starts, it supersedes prior pending work for the same hook instance. Late results from older generations must be ignored.

## OAuth Popup Handoff

Browser popup creation must happen inside a user gesture. The hook supports this without forcing apps to understand SDK discovery phases:

```tsx
await mcp.connect({ authorizationTarget: "popup" });
```

`authorizationTarget: "popup"` means:

1. The hook opens `about:blank` synchronously during the action call.
2. The SDK performs auth discovery, client registration or CIMD, PKCE setup, and resource binding.
3. The hook stores the prepared `authorizationUrl`.
4. The hook navigates the popup to the final authorization URL.
5. The callback route posts the result back and closes the popup when possible.

Apps may also pre-open their own window and hand it to the hook:

```tsx
const target = window.open("about:blank", "mcp-oauth");
await mcp.connect({ authorizationTarget: target });
```

The target is one-shot per action. The hook owns windows it opens via `"popup"`. For app-supplied windows, the hook may navigate or focus the window but should not assume ownership beyond the OAuth callback page closing itself.

## OAuth Callback

Apps should serve `McpOAuthCallback` at the configured redirect URL. The default is `/oauth/callback` on the current origin.

```tsx
import { McpOAuthCallback } from "use-mcp-react";

<Route path="/oauth/callback" element={<McpOAuthCallback />} />;
```

The library should also export a non-React helper:

```ts
handleMcpOAuthCallback(options?: {
  closeWindow?: boolean;
  targetOrigin?: string;
}): McpOAuthCallbackResult;
```

Callback behavior:

- Read `code`, `state`, `error`, and `error_description` from the callback URL.
- Send a typed message to `window.opener` when available.
- Publish the same typed message through a fixed `BroadcastChannel` for opener-hostile browser or provider behavior.
- Close the popup after success when possible.
- Render a small fallback page if the window cannot close.

Each hook instance must route callback messages by OAuth `state`, so several MCP servers can authorize on one page without mixing callbacks.

## Storage

Storage is async from the public API even when the default implementation wraps synchronous `localStorage`:

```ts
type McpStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};
```

Default storage is `localStorage`, partitioned by canonical MCP server URL and OAuth client configuration. Pass `storage: false` for memory-only state.

Storage keys use a SHA-256 hash of the canonical MCP server URL plus OAuth client id, redirect URL, client metadata URL, and client metadata:

```txt
use-mcp-react:v1:<authHash>:client
use-mcp-react:v1:<authHash>:tokens
use-mcp-react:v1:<authHash>:discovery
use-mcp-react:v1:<authHash>:state
use-mcp-react:v1:<authHash>:verifier
```

Hook-owned credentials:

- OAuth client information produced by DCR or CIMD.
- OAuth tokens.
- OAuth discovery state.
- Pending OAuth state, including PKCE verifier and expected state.

App-owned credentials and config:

- `bearerToken`.
- `oauth.clientId`.
- `oauth.clientMetadataUrl`.
- `oauth.clientMetadata`.

`forget()` clears hook-owned state for the current MCP server. It cannot clear bearer tokens or OAuth options that the app keeps passing as props.

## Playground UX Contract

The playground should demonstrate the library API, not reimplement OAuth lifecycle details.

Presets should be server-first:

```ts
type Preset = {
  name: string;
  url: string;
  expectedAuth: "none" | "oauth" | "bearer" | "path_api_key" | "manual_oauth";
  docsUrl: string;
};
```

Auth controls should be overrides:

- Auto
- Bearer token
- Manual OAuth client id
- Client metadata URL
- Path API key

The primary button should call:

```ts
mcp.connect({ authorizationTarget: "popup" });
```

Diagnostic UI may show issuer, scopes, metadata URLs, and selected registration strategy. Users should not need to understand DCR, CIMD, or SDK auth phases to try a known server.

Remote browser examples should derive transport from URL policy instead of storing per-server proxy flags: use the app-owned transport proxy for public HTTPS MCP URLs and keep local development URLs direct.

## Multiple MCP Servers

Use one hook instance per MCP server:

```tsx
const github = useMcp({ url: githubMcpUrl });
const linear = useMcp({ url: linearMcpUrl });
```

Each instance owns its own auth discovery, PKCE state, tokens, MCP client, transport, pending callback state, and catalog state.

A future `useMcps()` can coordinate several servers, but it should compose per-server state machines instead of creating a separate multi-server protocol model.

## What Is Tested Today

The browser E2E harness uses:

- Vitest Browser Mode
- Playwright Chromium
- MSW in a real browser service worker
- real browser `fetch`
- real SDK `Client`
- real SDK `StreamableHTTPClientTransport`
- real SDK `McpServer`
- real SDK `WebStandardStreamableHTTPServerTransport`
- real MCP JSON-RPC protocol handling
- real SSE `text/event-stream` responses
- real SDK OAuth client behavior

Covered scenarios:

- OAuth with Dynamic Client Registration
- OAuth with a pre-registered public client id
- OAuth with Client ID Metadata Document when explicitly configured
- failure when DCR is disabled and no client id is available
- PKCE `S256` enforcement
- static bearer/API-key auth when the MCP server does not advertise OAuth metadata
- bearer-required detection when no token is provided
- transport proxy mode for MCP requests while OAuth metadata, registration, and token exchange stay direct
- MCP `initialize`, `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get`
- SSE responses through MSW
- stateful `mcp-session-id`
- explicit `DELETE /mcp` session termination

The test-owned pieces are the in-memory authorization server, token store, and simulated user consent step. The MCP client/server stack is not mocked.

## Development

Install dependencies:

```bash
vp install
```

Run checks:

```bash
vp check
```

Run tests:

```bash
vp test
```

Build the package:

```bash
vp pack
```

## Reference Docs

- [React hook auth triage](docs/reference/react-hook-auth-triage.md)
- [OAuth MCP test server with MSW](docs/reference/oauth-mcp-msw-test-server.md)
- [Transport proxy mode](docs/reference/transport-proxy-mode.md)
- [TDD implementation prompt](docs/prompts/tdd-implementation.md)
- [Public API redesign TDD prompt](docs/prompts/tdd-public-api-redesign.md)
