# TDD Public API Redesign Prompt

You are implementing the pre-release breaking public API redesign for `use-mcp-react`.

Read this prompt first, then read:

- `AGENTS.md`
- `README.md`
- `docs/prompts/tdd-implementation.md`
- `docs/agents/opensrc.md`
- `docs/agents/maintainable-typescript.md`
- `docs/reference/README.md`
- `docs/reference/opensrc-sources.md`
- `docs/reference/oauth-mcp-msw-test-server.md`

Use TDD. Do not update production implementation until the next failing browser test clearly demands the change.

## Hard Constraints

- Keep `@modelcontextprotocol/sdk` as the only runtime dependency.
- Keep `react` as the only peer dependency.
- Do not mock SDK internals.
- Do not mock this library's own modules.
- Mock only external HTTP boundaries with MSW.
- Test browser-facing behavior in Vitest Browser Mode, not jsdom.
- Use real browser APIs for storage, fetch, URL, headers, popup/redirect boundaries, `postMessage`, `BroadcastChannel`, and callback handling.
- Preserve Vite+ workflow. Use focused `vp test run ...` while iterating, then run `vp check` and the relevant full test command before finishing.
- Use `opensrc` for dependency and prior-art source. Do not clone repos by hand.

## Current Situation

The current implementation still exposes older statuses:

```ts
"idle" |
  "connecting" |
  "oauth_required" |
  "manual_oauth_required" |
  "bearer_required" |
  "connected" |
  "error";
```

It also treats `reconnect()` and `reauthorize()` as effectively the same OAuth-clearing action, and the playground manually pre-opens a popup because the hook does not have a clean popup handoff primitive.

Replace this with the README contract. This repo is pre-release, so do not add backward-compatibility shims unless a test proves they are necessary.

## Target State Model

Replace public statuses with:

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
```

`status` describes lifecycle only. Auth-specific branching belongs in `authRequirement`.

`ready` means MCP initialize completed and initial catalog loading completed. Unsupported catalog capabilities are empty arrays. Unexpected catalog failures keep the connection alive and set `catalogStatus` / `catalogErrors`.

`pending_auth` is used for OAuth consent, manual OAuth client id, and bearer/API-key requirements.

## Target Auth Requirement Types

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

Do not expose `{ type: "none" }` as an auth requirement. Use `authRequirement: null` when no auth action is pending.

## Target Action API

```ts
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

connect(options?: UseMcpActionOptions): Promise<McpActionResult>;
disconnect(): Promise<McpActionResult>;
reconnect(options?: UseMcpActionOptions): Promise<McpActionResult>;
reauthorize(options?: UseMcpActionOptions): Promise<McpActionResult>;
forget(): Promise<McpActionResult>;
authorize(options?: { target?: AuthorizationTarget | "popup" }): Promise<McpActionResult>;
finishAuthorization(code: string, state: string): Promise<McpActionResult>;
```

Action semantics:

- `connect()` starts a connection with current options plus one-shot overrides. It preserves hook-owned OAuth state.
- `disconnect()` closes client/transport, clears `client` and `transport`, sets `status: "idle"`, and preserves last-known catalog/server metadata as stale data.
- `reconnect()` closes client/transport and connects again while preserving hook-owned OAuth client info, tokens, discovery, and catalog unless replaced.
- `reauthorize()` clears OAuth tokens, PKCE verifier, and pending authorization state, then starts a fresh user authorization. It preserves DCR/CIMD/manual client info and discovery by default. `clearClient` and `clearDiscovery` opt into stronger resets.
- `forget()` closes live and pending SDK connections, clears hook-owned auth storage, pending auth state, client/transport refs, server metadata, catalog state, errors, and returns to `idle`.
- `authorize()` opens/focuses/navigates the pending authorization target after `pending_auth`.
- `finishAuthorization(code, state)` must require matching OAuth `state`. Missing or mismatched state must not exchange the authorization code.

When a new `connect`, `reconnect`, or `reauthorize` starts, it supersedes prior pending work for that hook instance. Late results from older generations must be ignored.

## Popup Handoff Contract

Browser popup creation must happen inside a user gesture.

`useMcp({ url })` may auto-connect and prepare OAuth, but mount/effect auto-connect must not call `window.open()` or navigate a popup.

User-gesture actions may do popup handoff:

```ts
await mcp.connect({ authorizationTarget: "popup" });
await mcp.reconnect({ authorizationTarget: "popup" });
await mcp.reauthorize({ authorizationTarget: "popup" });
await mcp.authorize({ target: "popup" });
```

`authorizationTarget: "popup"` means:

1. Open `about:blank` synchronously during the action.
2. Store the opened `Window` as a one-shot pending target.
3. Let the SDK perform OAuth discovery, DCR/CIMD, PKCE setup, and resource binding.
4. When `OAuthClientProvider.redirectToAuthorization(authorizationUrl)` is called, store the URL, set `status: "pending_auth"`, then navigate the target.
5. If `window.open()` returns `null`, return `{ ok: false, reason: "popup_blocked" }`, keep `status: "pending_auth"` if an authorization URL exists, and preserve the URL for fallback UI.

Apps may pass an already-opened `Window`. The hook may navigate or focus it. Do not assume ownership of app-supplied windows except that the callback page may close itself.

The target is one-shot. A later action must not accidentally navigate an old target.

## Callback Contract

Export:

```ts
function McpOAuthCallback(): JSX.Element;
function handleMcpOAuthCallback(options?: {
  closeWindow?: boolean;
  targetOrigin?: string;
}): McpOAuthCallbackResult;
```

Callback behavior:

- Read `code`, `state`, `error`, and `error_description` from `window.location.search`.
- Send a typed callback message to `window.opener` when available.
- Publish the same message through a fixed `BroadcastChannel`.
- Close the popup after success when possible unless `closeWindow === false`.
- Render a small fallback page if it cannot close.

The hook must install callback listeners only for active pending attempts and must route callbacks by OAuth `state`.

## Storage Contract

Public option:

```ts
type McpStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

type UseMcpOptions = {
  storage?: McpStorage | false;
};
```

Default storage is an async adapter over `localStorage`, scoped by a SHA-256 hash of the canonical MCP server URL and OAuth client configuration.

Use key shapes:

```txt
use-mcp-react:v1:<authHash>:client
use-mcp-react:v1:<authHash>:tokens
use-mcp-react:v1:<authHash>:discovery
use-mcp-react:v1:<authHash>:pending:<state>
```

Hook-owned state:

- OAuth client information produced by DCR or CIMD.
- OAuth tokens.
- OAuth discovery state.
- Pending OAuth state, including expected state and PKCE verifier.

App-owned state:

- `bearerToken`.
- `oauth.clientId`.
- `oauth.clientMetadataUrl`.
- `oauth.clientMetadata`.

`forget()` clears hook-owned storage for the current MCP server. It must not pretend to clear bearer tokens or props that the app continues to pass.

`storage: false` means memory-only hook state.

## Auth Strategy Contract

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
10. Unexpected metadata, CORS, token exchange, or transport failures set `status: "failed"`.

There is no default `clientMetadataUrl`. A generic React hook cannot assume the consuming app serves a valid Client ID Metadata Document. If `oauth.clientMetadataUrl` is configured and the server advertises CIMD, prefer it over DCR. MCPJam does this with its own hosted metadata URL, but that default is product-specific.

## Diagnostics Contract

Expose small stable diagnostics:

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

Do not expose SDK phase names as the main hook contract. A playground can show these diagnostics, but the library is not a full OAuth debugger.

## Minimal TDD Slices

Implement in small red-green-refactor slices. Keep tests browser-mode and observable.

1. Rename state model.
   - Update no-auth test to expect `connecting` -> `loading` -> `ready`.
   - Assert `authRequirement: null` when ready.

2. Auto-connect OAuth prepares auth without popup.
   - Mount `useMcp({ url })` against OAuth MSW server.
   - Spy on `window.open`.
   - Assert `status: "pending_auth"`, `authRequirement.type === "oauth"`, prepared URL exists, no popup opened.

3. Action-level popup handoff.
   - Mount with `enabled: false` or with an active URL and call `connect({ authorizationTarget: "popup" })` from `probe.act`.
   - Mock `window.open` to return a fake `Window`.
   - Assert it opens `about:blank` synchronously, later assigns/navigates to the prepared auth URL exactly once, and returns `{ ok: true }`.

4. Popup blocked result.
   - Mock `window.open` to return `null`.
   - Assert action result `{ ok: false, reason: "popup_blocked" }`.
   - Assert no token exchange happened and prepared auth remains recoverable when available.

5. Callback ownership.
   - Add `McpOAuthCallback` / `handleMcpOAuthCallback` tests for `postMessage` and `BroadcastChannel`.
   - Assert the hook completes auth only for matching state.
   - Missing or mismatched state returns the correct action result and does not hit `/token`.

6. `reconnect()` preserves OAuth.
   - Complete OAuth once.
   - Expire access token if needed and keep refresh token valid.
   - Call `reconnect()`.
   - Assert refresh or stored token reuse path, no new `/register`, no new authorization URL, no new authorization-code token exchange, and final `ready`.

7. `reauthorize()` clears grant state but preserves client/discovery.
   - Complete OAuth once.
   - Call `reauthorize({ authorizationTarget: "popup" })`.
   - Assert a fresh authorization request/state and no new DCR registration by default.
   - Add separate test for `{ clearClient: true }` if implementation supports it in this slice.

8. `forget()` clears all hook-owned public and stored state.
   - Complete OAuth and load catalog.
   - Call `forget()`.
   - Assert public state is idle/empty, storage keys for that server are removed, pending popup/connection refs are closed or abandoned, and no old callback can complete.

9. Manual OAuth requirement.
   - Server advertises OAuth metadata but no DCR, no configured `clientId`, no configured valid CIMD.
   - Assert `status: "pending_auth"` and `authRequirement.type === "manual_oauth_client"`.

10. Bearer requirement.
    - Server returns bearer challenge without MCP OAuth metadata.
    - Assert `status: "pending_auth"` and `authRequirement.type === "bearer"`.
    - Assert no OAuth metadata endpoints are probed.

11. StrictMode idempotence.
    - In StrictMode, assert no duplicate DCR, popup open, token exchange, or initialize side effects.
    - Use MSW request logs and popup capture, not private spies.

12. Playground API cleanup.
    - Remove manual blank-popup navigation logic from `playground/src/main.tsx`.
    - Use `connect({ authorizationTarget: "popup" })`, `reauthorize({ authorizationTarget: "popup" })`, and public callback component/helper.
    - Keep presets server-first and auth controls as overrides.

## Test Assertions To Prefer

Assert:

- rendered semantic state snapshots
- MSW request log entries and absence of unwanted entries
- storage contents
- popup open/navigate/focus/close behavior
- callback message delivery
- SDK-visible client/transport state

Avoid:

- private helper call order
- whole hook result snapshots
- fake SDK clients or transports
- jsdom
- compatibility aliases for old status names

## Prior Art Notes

MCPJam is useful prior art for strategy selection and diagnostics:

- Prefer CIMD over DCR only when a valid client metadata URL is configured and the authorization server advertises CIMD.
- Persist callback context before navigation.
- Expose diagnostics for registration strategy, metadata URLs, scopes, and OAuth failures.

Do not copy MCPJam's product-specific default metadata URL. `use-mcp-react` must require apps to pass `oauth.clientMetadataUrl` explicitly.

Use opensrc source if you need details:

```bash
vp exec opensrc path github:MCPJam/inspector
```

High-signal files:

```bash
sed -n '1,260p' "$(vp exec opensrc path github:MCPJam/inspector)/sdk/src/oauth/authorization-plan.ts"
sed -n '1,260p' "$(vp exec opensrc path github:MCPJam/inspector)/sdk/src/oauth/client-identity.ts"
sed -n '2260,2515p' "$(vp exec opensrc path github:MCPJam/inspector)/mcpjam-inspector/client/src/lib/oauth/mcp-oauth.ts"
```

## Finish Criteria

Finish only when:

- tests were written before each production slice
- focused browser tests pass
- `vp check` passes
- relevant full test command passes or failures are explicitly explained
- README public contract still matches implementation
- playground uses the public API instead of custom OAuth popup plumbing
