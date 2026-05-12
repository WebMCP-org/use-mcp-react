# React Hook Auth Triage

`useMcp` should be a one-server hook that infers as much as possible from the MCP URL. The golden path should be:

```ts
const mcp = useMcp({ url });
```

The hook should probe the server, classify the auth requirement, and ask the app for only the missing runtime input: OAuth consent, a manual public `client_id`, or a bearer/API key.

## Core Shape

Keep the core abstraction one MCP server per hook call:

```ts
const github = useMcp({ url: githubUrl });
const linear = useMcp({ url: linearUrl });
```

Each server has separate OAuth discovery metadata, client registration, PKCE state, tokens, session id, capabilities, and errors. A future `useMcps()` can orchestrate multiple `useMcp` instances, but the state machine should stay per server.

The hook must support runtime URLs. A user may paste a URL, add a `clientId`, or add a bearer token after the first probe:

```ts
const mcp = useMcp({
  url,
  enabled: Boolean(url),
  oauth: clientId ? { clientId } : undefined,
  bearerToken: bearerToken || undefined,
});
```

When `url` changes, close the old client/transport, clear in-memory pending auth state for the old URL, and start a fresh probe for the new URL.

Auto-connect should be the default. The hook should connect only when `enabled !== false` and `url` is non-null, non-empty, and parseable. `null`, `undefined`, and `""` should stay `idle` and perform no network work.

## Proposed API

```ts
type UseMcpOptions = {
  url?: string | URL;
  enabled?: boolean;

  oauth?: {
    clientId?: string;
    redirectUrl?: string;
    clientMetadata?: OAuthClientMetadata;
    clientMetadataUrl?: string;
    redirectMode?: "popup" | "page";
  };

  bearerToken?: string;
  refresh?: {
    enabled?: boolean;
    maxAttempts?: number;
  };
  storage?: McpStorage;
};
```

Defaults:

- `enabled`: `Boolean(url)`
- `redirectUrl`: `${window.location.origin}/oauth/callback`
- `clientMetadataUrl`: `${window.location.origin}/.well-known/oauth-client-metadata.json`
- `clientMetadata`: browser-safe public client metadata derived from the origin/app name
- `redirectMode`: `"popup"`
- `refresh.enabled`: `true`
- `refresh.maxAttempts`: `1`
- `storage`: async adapter backed by `localStorage`, scoped by MCP server URL

Do not require an app-wide provider for v1. A provider can be added later if repeated defaults become painful.

## Return Value

```ts
type UseMcpResult = {
  status:
    | "idle"
    | "connecting"
    | "oauth_required"
    | "manual_oauth_required"
    | "bearer_required"
    | "connected"
    | "error";

  authRequirement: McpAuthRequirement | null;
  authorizationUrl: URL | null;
  error: Error | null;

  client: Client | null;
  transport: StreamableHTTPClientTransport | null;
  serverCapabilities: ServerCapabilities | null;
  serverVersion: Implementation | null;
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

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  reconnect(options?: Partial<UseMcpOptions>): Promise<void>;
  reauthorize(): Promise<void>;
  forget(): Promise<void>;
  authorize(): Promise<void>;
  finishAuthorization(code: string, state?: string): Promise<void>;
  reloadCatalog(): Promise<void>;
  reloadTools(): Promise<void>;
  reloadResources(): Promise<void>;
  reloadPrompts(): Promise<void>;
};
```

The app should own form state. The hook reports what is needed; the app updates `clientId` or `bearerToken` and calls `reconnect()` with the updated options.

Action semantics:

- `connect()`: starts or retries connection with current options.
- `disconnect()`: closes the client/transport and keeps stored credentials.
- `reconnect()`: closes the current transport, preserves stored auth state, and connects again. It may accept option overrides for runtime form submissions.
- `reauthorize()`: clears OAuth tokens for this server, keeps reusable client/discovery state when safe, and starts authorization again.
- `forget()`: clears all stored hook state for this server.
- `authorize()`: opens or focuses one pending OAuth popup for this server.

## Auth Requirement Diagnosis

Expose a normalized diagnosis instead of forcing apps to inspect SDK errors.

```ts
type McpAuthRequirement =
  | { type: "none" }
  | {
      type: "oauth";
      authorizationUrl: URL;
      issuer?: string;
      scopes?: string[];
      supportsDynamicClientRegistration: boolean;
      supportsClientMetadataDocument: boolean;
    }
  | {
      type: "manual_oauth_client";
      issuer?: string;
      authorizationEndpoint?: string;
      reason: "dynamic_client_registration_unavailable";
      suggestedFields: ["clientId"];
    }
  | {
      type: "bearer";
      realm?: string;
      scopes?: string[];
      reason: "oauth_metadata_absent";
    }
  | {
      type: "unknown";
      reason: string;
      error: Error;
    };
```

Examples:

```tsx
if (mcp.authRequirement?.type === "manual_oauth_client") {
  return <ClientIdForm issuer={mcp.authRequirement.issuer} onSubmit={setClientId} />;
}

if (mcp.authRequirement?.type === "bearer") {
  return <ApiKeyForm realm={mcp.authRequirement.realm} onSubmit={setBearerToken} />;
}

if (mcp.status === "oauth_required") {
  return <button onClick={() => mcp.authorize()}>Connect</button>;
}
```

## Auth Inference Order

The hook should use this order:

1. Try to connect with any stored or provided credentials.
2. If the server connects without auth, set `authRequirement: { type: "none" }`.
3. If the server returns `WWW-Authenticate: Bearer` with MCP `resource_metadata`, treat it as OAuth-protected.
4. Try Client ID Metadata Document when `clientMetadataUrl` is configured and the authorization server supports URL-based client ids.
5. Try Dynamic Client Registration when authorization server metadata includes `registration_endpoint`.
6. If OAuth exists but neither CIMD nor DCR can produce a client id, set `manual_oauth_required`.
7. If the server returns `WWW-Authenticate: Bearer` without MCP `resource_metadata`, set `bearer_required`.
8. If metadata is malformed, fetch is blocked, or token exchange fails, set `unknown` or `error` with the concrete cause.

Manual `oauth.clientId` should skip DCR and use the pre-registered browser client path.

`bearerToken` should skip OAuth discovery and send `Authorization: Bearer ...` immediately.

Stored OAuth credentials should be used automatically. If an access token is expired or rejected and a refresh token exists, the hook should attempt one refresh by default before surfacing `oauth_required`. If refresh fails, clear tokens, keep reusable client/discovery state, and prepare a fresh authorization URL.

Bearer token persistence is app-owned by default. Passing `bearerToken` should not write it into hook storage.

## Catalog Loading

After MCP initialize succeeds, v1 should load the full catalog by default:

```ts
client.listTools();
client.listResources();
client.listResourceTemplates();
client.listPrompts();
```

Use SDK item/result types instead of new library-owned shapes:

```ts
tools: Tool[];
resources: Resource[];
resourceTemplates: ResourceTemplate[];
prompts: Prompt[];
serverCapabilities: ServerCapabilities | null;
serverVersion: Implementation | null;
```

Catalog fields are always arrays. Empty means not loaded yet, unsupported, or no items.

`connected` means initialization completed and initial catalog loading completed. Unsupported capabilities should resolve to empty arrays and should not surface as errors. Unexpected catalog failures should keep `status: "connected"` and set:

```ts
catalogStatus: "partial" | "error";
catalogErrors: {
  tools?: unknown;
  resources?: unknown;
  resourceTemplates?: unknown;
  prompts?: unknown;
};
```

Expose:

```ts
reloadCatalog();
reloadTools();
reloadResources(); // reloads resources and resourceTemplates
reloadPrompts();
```

For future stateful mode, register SDK list-changed handlers when constructing the client so tool/resource/prompt notifications trigger the relevant reload. V1 can use stateless transport for simpler hook state, while keeping stateful transport coverage in the server harness.

## Redirects

Use popup OAuth by default.

Follow existing React auth library patterns: the app serves a callback route, and this library provides the callback UI. Default route:

```txt
/oauth/callback
```

Default usage:

```tsx
import { McpOAuthCallback } from "use-mcp-react";

<Route path="/oauth/callback" element={<McpOAuthCallback />} />;
```

Also export `handleMcpOAuthCallback()` for non-router or non-React callback pages, but document `<McpOAuthCallback />` as the normal React path.

`authorize()` must be called from a user gesture. It opens the SDK-generated authorization URL in a popup. The callback component posts the result back to the opener:

```ts
window.opener?.postMessage(
  {
    type: "use-mcp-react/oauth-callback",
    code: new URLSearchParams(location.search).get("code"),
    state: new URLSearchParams(location.search).get("state"),
  },
  window.location.origin,
);

window.close();
```

Each hook instance should generate a unique OAuth `state`, for example:

```txt
mcp_auth_<serverHash>_<random>
```

Persist pending auth by `state`:

```txt
use-mcp-react:oauth-pending:<state>
```

The pending record should include at least:

- MCP server URL
- PKCE verifier
- client information or discovery state
- redirect URL
- creation time

When a callback message arrives, a hook should handle it only if the `state` matches its pending auth session. This lets several MCP servers exist on the same page without callback confusion.

Support `"page"` redirect later through the same pending-auth storage, but do not expose it unless needed for v1. If exposed early, keep `"popup"` as the default.

Only one pending OAuth attempt is allowed per server URL. If `authorize()` is called while a popup is already pending, focus/reuse the popup. If the pending popup is closed or expired, clear it and start a new attempt.

Prepare `authorizationUrl` during the auth probe and expose it on the hook result. `authorize()` should refresh the prepared URL if its pending PKCE/state record is stale.

If a popup is blocked, keep `status: "oauth_required"`, preserve `authorizationUrl`, and expose a recoverable auth error such as `popup_blocked`.

## Storage

Use `localStorage` by default, behind an async adapter:

```ts
type McpStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};
```

Storage adapters can later support `sessionStorage`, memory, IndexedDB, or browser extension storage such as `chrome.storage.local`.

Use separate keys under a server-scoped namespace:

```txt
use-mcp-react:v1:<authHash>:client
use-mcp-react:v1:<authHash>:tokens
use-mcp-react:v1:<authHash>:discovery
use-mcp-react:v1:<authHash>:pending:<state>
```

Compute `authHash` from a canonicalized MCP server URL and the OAuth client configuration that affects token validity:

- parse as `URL`
- remove hash
- lower-case protocol and hostname
- preserve path, port, and query
- include `clientId`, `clientMetadata`, `clientMetadataUrl`, and `redirectUrl`
- hash the stable JSON representation with SHA-256 and encode it for storage keys

Do not put raw URLs into storage keys.

## Multiple Servers

Multiple MCP servers should use multiple hook instances:

```ts
const first = useMcp({ url: firstUrl });
const second = useMcp({ url: secondUrl });
```

Each `authorize()` opens one popup for that server. Do not auto-open many popups. A future `useMcps()` should connect servers sequentially and expose `authorizeNext()` rather than opening several popups from one action.

## Runtime UX

The hook should act like a probe when the user enters an unknown MCP URL:

- no URL: `idle`
- URL entered: `connecting`
- OAuth can proceed with CIMD or DCR: `oauth_required`
- OAuth exists but needs a public client id: `manual_oauth_required`
- no MCP OAuth metadata, but bearer challenge exists: `bearer_required`
- provided credentials work: `connected`
- malformed metadata, failed fetch, rejected token, or unexpected SDK error: `error`

This lets the host app build a dynamic setup screen without knowing the upstream provider in advance.

## Server Harness Coverage

The current browser E2E harness proves the paths this hook should depend on:

- OAuth with Dynamic Client Registration
- OAuth with pre-registered public client id
- failure when DCR is disabled and no client id is available
- PKCE S256 enforcement
- API-key style bearer auth when the MCP server does not advertise OAuth
- bearer-required detection when no token is provided
- real MCP SDK client/server transport, SSE, tools, resources, prompts, ping, and session termination

Keep React tests on top of this harness. Do not mock SDK client/server methods for the core flow.

## React Test Strategy

React tests should assert observable hook state and protocol behavior together:

- semantic hook state snapshots
- MSW server request logs
- SDK-visible client state
- storage state
- popup callback messages
- render behavior only where render behavior is part of the public contract

Do not add a global "every test must assert render count" rule. Use render-count tests only for:

- subscription boundaries
- selector or field tracking
- batching behavior
- StrictMode idempotence
- loop prevention
- stable action identity
- auth and transport transitions that should be externally visible exactly once

StrictMode coverage is required for auth side effects. The test should mount the consumer inside `<React.StrictMode>` and assert through external behavior:

- one DCR request, not two
- one authorization URL produced, not two
- one popup/open redirect action, not two
- one token exchange per callback code
- no duplicate MCP initialize after auth completes unless the first unauthenticated attempt is explicitly expected

Prefer semantic snapshots over whole hook-result snapshots:

```ts
probe.snapshot({
  status: result.status,
  authType: result.authRequirement?.type,
  toolNames: result.tools.map((tool) => tool.name),
  hasSession: Boolean(result.transport?.sessionId),
});
```

Avoid snapshotting SDK clients, transports, functions, errors with stack traces, timestamps, abort controllers, or generated ids.

Useful consumer shapes for render tests:

- `StatusConsumer`: reads only status/auth status
- `ToolsConsumer`: reads only tools
- `ResourcesConsumer`: reads only resources
- `PromptsConsumer`: reads only prompts
- `ActionsConsumer`: reads only stable action functions
- `ErrorConsumer`: reads only error

Exact render counts are appropriate only when the count is the contract. Use upper bounds for retry, reconnect, callback race, and failure-loop tests.
