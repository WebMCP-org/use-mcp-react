# MCP Server Profile Investigation

The library should expose a runtime-derived MCP server profile, but it should reuse MCP SDK and spec shapes instead of inventing a parallel model.

The main recommendation is:

```ts
const mcp = useMcp({ url });

mcp.serverProfile;
```

`serverProfile` should describe the MCP endpoint as discovered through protocol negotiation, auth discovery, transport behavior, and catalog list calls. It should not replace `authRequirement`, `status`, `catalogStatus`, or the raw SDK `client`/`transport` fields. Those are runtime state and actions.

## Investigation Scope

This investigation covered:

- local repo code in `src/index.ts`, `playground/src/main.tsx`, and `tests/browser`
- local design notes in `docs/reference/react-hook-auth-triage.md`
- local MSW/OAuth test harness notes in `docs/reference/oauth-mcp-msw-test-server.md`
- MCP TypeScript SDK source through `opensrc`
- official MCP specification pages for `2025-11-25`
- council-style review from three agents:
  - SDK/source shape
  - MCP spec alignment
  - repo/playground integration

No implementation changes were made during the investigation.

## Primary Finding

There is no canonical MCP type named `ServerProfile`.

The closest canonical protocol object is `InitializeResult`, which contains:

- `protocolVersion`
- `capabilities`
- `serverInfo`
- `instructions`

The profile should therefore wrap `InitializeResult` rather than flattening or renaming it.

Recommended principle:

```ts
type McpServerProfile = {
  url: string;
  initialize: InitializeResult | null;
  auth: McpAuthProfile;
  transport: McpTransportProfile;
  catalog: McpCatalogSnapshot;
  fetchedAt: number;
};
```

The library can keep legacy fields such as `serverVersion` and `serverCapabilities` on `UseMcpResult`, but a new profile should use MCP names. In particular, prefer `initialize.serverInfo` over `serverVersion`.

## MCP Spec Findings

### Lifecycle And Initialization

The MCP lifecycle starts with initialization. The client sends its protocol version, client capabilities, and client implementation information. The server responds with its protocol version, server capabilities, server implementation information, and optional instructions.

Official source:

- <https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle>
- <https://modelcontextprotocol.io/specification/2025-11-25/schema>

Profile implication:

- `initialize` belongs in the profile.
- Keep the full `InitializeResult` shape.
- Include `instructions`; the current hook does not expose it yet.
- Do not reduce `serverInfo` to name/version. `Implementation` also supports `title`, `description`, `icons`, and `websiteUrl`.

### Server Capabilities

Server capabilities are the MCP-owned description of which optional protocol features the server supports.

Known server capabilities in the current SDK include:

- `logging`
- `completions`
- `prompts`
- `resources`
- `tools`
- `tasks`
- `experimental`
- `extensions`

Profile implication:

- Store `ServerCapabilities` whole.
- Do not convert capabilities into only booleans such as `hasTools`.
- The playground can derive display booleans from `initialize.capabilities`, but the library should preserve the SDK type.

### Tools, Resources, Resource Templates, And Prompts

The server feature lists are separate protocol surfaces:

- `tools/list`
- `resources/list`
- `resources/templates/list`
- `prompts/list`

Official sources:

- <https://modelcontextprotocol.io/specification/2025-11-25/server/tools>
- <https://modelcontextprotocol.io/specification/2025-11-25/server/resources>
- <https://modelcontextprotocol.io/specification/2025-11-25/server/prompts>

Profile implication:

- Reuse SDK item types: `Tool`, `Resource`, `ResourceTemplate`, `Prompt`.
- Wrap them in a library aggregate such as `McpCatalogSnapshot`.
- Preserve pagination semantics. List results can include `nextCursor`.
- Either drain all pages or mark a catalog section as incomplete.

Current code loads one page from each list method, so a future profile must not call that "complete" unless pagination is handled.

### Transport

For Streamable HTTP, the MCP endpoint is a single HTTP path that supports POST and GET.

Transport facts that belong in the profile:

- transport kind: `"streamable-http"`
- endpoint URL
- negotiated protocol version, if known
- session mode as a safe summary:
  - `"stateful"` if the transport has a session id
  - `"stateless"` if the connection completed without one
  - `"unknown"` before connection completes

Transport facts that should not be in the profile:

- raw `MCP-Session-Id`
- raw transport object
- request/response history
- retry timers
- popup/window state

The SDK exposes `transport.sessionId` and `transport.protocolVersion`, but private fields should not be inspected.

### Authorization

MCP authorization is standards-based:

- RFC 9728 Protected Resource Metadata
- RFC 8414 Authorization Server Metadata
- OAuth 2.1 compatible authorization flow
- PKCE
- RFC 8707 Resource Indicators
- optional Client ID Metadata Documents
- optional Dynamic Client Registration

Official source:

- <https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization>

Profile implication:

- Auth metadata belongs in the profile when it is standards-discovered and tied to the MCP resource.
- `authRequirement` should stay separate because it describes the next UI action, not the server profile.
- The profile should not include secrets or one-time auth state.

Auth profile should include:

- auth mode:
  - `"none"`
  - `"oauth-protected"`
  - `"external-bearer"`
  - `"unknown"`
- protected resource metadata URL, when known
- protected resource metadata, when discovered
- selected authorization server URL
- authorization server metadata, when discovered
- supported scopes
- whether DCR is advertised
- whether Client ID Metadata Documents are advertised

Auth profile should not include:

- bearer tokens
- access tokens
- refresh tokens
- PKCE verifier
- OAuth `state`
- authorization code
- raw authorization URL as stable profile data
- popup state

The authorization URL remains part of `authRequirement` or action state because it is ephemeral and tied to PKCE/state.

## SDK Source Findings

Source code is available through `opensrc`:

```bash
vp exec opensrc path @modelcontextprotocol/sdk
```

High-signal SDK files:

- `src/types.ts`
- `src/client/index.ts`
- `src/client/auth.ts`
- `src/client/streamableHttp.ts`
- `src/shared/auth.ts`

### Types To Reuse

Reuse these from `@modelcontextprotocol/sdk/types.js`:

- `InitializeResult`
- `Implementation`
- `ServerCapabilities`
- `Tool`
- `Resource`
- `ResourceTemplate`
- `Prompt`

Do not hand-roll equivalents.

The SDK schemas show:

- `Implementation` includes `name`, `title`, `icons`, `version`, `websiteUrl`, and `description`.
- `ServerCapabilities` includes known capabilities and extension points.
- `InitializeResult` contains the handshake fields the profile should preserve.
- catalog item schemas already include metadata, icons, descriptions, annotations, and `_meta`.

### Runtime APIs To Use

After `client.connect(transport)`, the SDK exposes:

```ts
client.getServerCapabilities();
client.getServerVersion();
client.getInstructions();
```

The current hook already reads the first two, but not `getInstructions()`.

The SDK catalog APIs are:

```ts
client.listTools();
client.listResources();
client.listResourceTemplates();
client.listPrompts();
```

The current hook uses these calls, but only as one-page calls.

### OAuth APIs To Reuse

The SDK `OAuthClientProvider` is the right boundary for browser auth state.

Important optional provider hooks:

- `saveDiscoveryState`
- `discoveryState`
- `invalidateCredentials`
- `validateResourceURL`

The current `PendingOAuthProvider` does not implement these yet. Adding them would let the library capture profile-grade auth discovery state without duplicating SDK discovery logic.

Relevant SDK auth types:

- `OAuthDiscoveryState`
- `OAuthServerInfo`
- `OAuthProtectedResourceMetadata`
- `AuthorizationServerMetadata`
- `OAuthClientMetadata`
- `OAuthClientInformationMixed`
- `OAuthTokens`

Use these types or wrapped forms instead of raw object shapes.

### Streamable HTTP APIs To Use

The SDK `StreamableHTTPClientTransport` exposes:

- `sessionId`
- `protocolVersion`
- `finishAuth`
- `terminateSession`
- `resumeStream`

The profile should expose only derived safe state from these fields. Do not expose raw session id inside `serverProfile`.

Important caution: `Client.connect()` skips initialization when a transport already has a `sessionId`. If future storage/resume support is added, the cached profile and session lifecycle need to be kept in sync.

## Current Repo State

### Library

The current `useMcp` hook already has several pieces of a profile:

- `status`
- `authRequirement`
- `authDiagnostics`
- `authorizationUrl`
- `catalogStatus`
- `catalogErrors`
- `serverCapabilities`
- `serverVersion`
- `tools`
- `resources`
- `resourceTemplates`
- `prompts`
- raw `client`
- raw `transport`

Current strengths:

- one hook instance maps to one MCP server URL
- empty or invalid URLs remain idle
- real SDK client and transport are used
- OAuth DCR, manual client ID, Client ID Metadata URL, and bearer paths are represented
- browser tests use real Vitest Browser Mode, Playwright, MSW, and the real MCP SDK
- catalog failures can be partial without dropping the connection

Current gaps for profile work:

- no `serverProfile`
- no `InitializeResult` aggregate
- no `instructions`
- no `transport.protocolVersion` in public state
- no safe session summary
- sparse `authDiagnostics`
- `PendingOAuthProvider` does not retain SDK discovery state
- catalog loading does not drain pagination or report cursors
- profile and diagnostics are not clearly separated

### Playground

The playground currently has presets with an explicit `authMode`:

- `auto`
- `bearer`
- `manual-oauth`

This is useful for demos, but it should not become the library's source of truth.

The playground currently renders:

- lifecycle status
- catalog status
- auth type
- client/transport presence
- server name
- authorization URL
- DCR/CIMD/scopes
- bearer realm/scopes
- manual OAuth issuer/fields
- catalog item names
- catalog errors

Current playground gap:

- it does not render a server profile.
- it is preset-first rather than URL-first.
- it does not show the initialize result, full capabilities, instructions, transport protocol version, session mode, or discovered auth metadata.

## Library Versus Playground Split

### Library Owns

The library owns facts an app needs to make correct runtime decisions:

- normalized auth classification
- missing runtime input:
  - OAuth consent
  - manual client ID
  - bearer token
- standards-discovered auth metadata
- SDK-derived initialize result
- server capabilities
- server implementation metadata
- instructions
- catalog items and catalog completeness
- safe transport/session summary
- stable action APIs

### Playground Owns

The playground owns human-facing explanation:

- presets and provider links
- configuration form layout
- generated config snippets
- visual profile cards
- expandable raw metadata panels
- comparison between attempted config and recommended config
- request-log display for local tests or debugging
- copy for known providers such as Linear, Firecrawl, Recraft, and Gmail templates

The playground should not manually fetch `.well-known` metadata to decide core behavior. If a real app needs the same fact, it belongs in the library.

## Recommended Public API Direction

Add `serverProfile` to `UseMcpResult`.

Keep existing fields for compatibility:

```ts
type UseMcpResult = {
  status: UseMcpStatus;
  authRequirement: McpAuthRequirement | null;
  authDiagnostics: McpAuthDiagnostics | null;
  catalogStatus: CatalogStatus;
  catalogErrors: CatalogErrors;
  serverCapabilities: ServerCapabilities | null;
  serverVersion: Implementation | null;
  tools: Tool[];
  resources: Resource[];
  resourceTemplates: ResourceTemplate[];
  prompts: Prompt[];
  serverProfile: McpServerProfile | null;
};
```

Proposed profile types:

```ts
import type {
  Implementation,
  InitializeResult,
  Prompt,
  Resource,
  ResourceTemplate,
  ServerCapabilities,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type {
  AuthorizationServerMetadata,
  OAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js";

export type McpServerProfile = {
  url: string;
  transport: McpTransportProfile;
  initialize: InitializeResult | null;
  auth: McpAuthProfile;
  catalog: McpCatalogSnapshot;
  fetchedAt: number;
};

export type McpTransportProfile = {
  kind: "streamable-http";
  endpoint: string;
  protocolVersion?: string;
  sessionMode: "stateful" | "stateless" | "unknown";
};

export type McpAuthProfile =
  | { mode: "none" }
  | {
      mode: "oauth-protected";
      protectedResourceMetadataUrl?: string;
      protectedResourceMetadata?: OAuthProtectedResourceMetadata;
      authorizationServerUrl?: string;
      authorizationServerMetadata?: AuthorizationServerMetadata;
    }
  | {
      mode: "external-bearer";
      realm?: string;
      scopes?: string[];
    }
  | {
      mode: "unknown";
      reason?: string;
    };

export type McpCatalogSnapshot = {
  tools: McpCatalogSection<Tool>;
  resources: McpCatalogSection<Resource>;
  resourceTemplates: McpCatalogSection<ResourceTemplate>;
  prompts: McpCatalogSection<Prompt>;
};

export type McpCatalogSection<Item> = {
  items: Item[];
  complete: boolean;
  nextCursor?: string;
  error?: unknown;
};
```

This shape keeps SDK types in the protocol-owned positions and uses library wrappers only for aggregate state.

## Naming Decisions

Recommended names:

- `serverProfile` for the public aggregate
- `initialize` for the full MCP `InitializeResult`
- `initialize.serverInfo`, not `serverVersion`
- `initialize.capabilities`, not `serverCapabilities` inside the profile
- `catalog`, not `catalogs`
- `auth.mode`, not `auth.type`, to avoid collision with `authRequirement.type`
- `external-bearer` for bearer/API-key servers that do not advertise MCP OAuth metadata

Keep existing names outside the profile until a later breaking API cleanup:

- `serverCapabilities`
- `serverVersion`
- `authRequirement`
- `authDiagnostics`
- `catalogStatus`
- `catalogErrors`

## Implementation Plan

### Slice 1: Add Profile Types And Assembly

Add profile types near the existing public types in `src/index.ts`, or split them into `src/profile.ts` if `src/index.ts` becomes too large.

Add a pure helper:

```ts
function createServerProfile(input: {
  url: URL;
  transport: StreamableHTTPClientTransport | null;
  initialize: InitializeResult | null;
  auth: McpAuthProfile;
  catalog: McpCatalogSnapshot;
}): McpServerProfile;
```

Use this helper inside state transitions instead of hand-building profile objects inline.

### Slice 2: Capture Full Initialize Result

Current code reads:

```ts
const serverCapabilities = client.getServerCapabilities() ?? null;
const serverVersion = client.getServerVersion() ?? null;
```

Add:

```ts
const instructions = client.getInstructions();
const initialize =
  serverCapabilities && serverVersion
    ? {
        protocolVersion: transport.protocolVersion ?? "",
        capabilities: serverCapabilities,
        serverInfo: serverVersion,
        ...(instructions ? { instructions } : {}),
      }
    : null;
```

If `transport.protocolVersion` is unavailable in an edge case, do not invent a value. Either keep `initialize` null or make the profile expose a separate partial initialize summary. Prefer preserving protocol truth over filling blanks.

### Slice 3: Capture Auth Discovery Through The Provider

Extend `PendingOAuthProvider` with:

- `saveDiscoveryState`
- `discoveryState`
- `invalidateCredentials`
- `validateResourceURL` if needed

Store discovery state in memory first. Storage can come later.

The profile should read from the provider's saved discovery state instead of duplicating metadata fetches.

Manual OAuth fallback currently refetches metadata in `inferManualOAuthClientRequirement`. That logic should eventually move toward SDK discovery helpers or shared discovery capture.

### Slice 4: Catalog Snapshot With Pagination Semantics

Replace or wrap `loadCatalog` so each section carries:

- `items`
- `complete`
- `nextCursor`
- `error`

Two acceptable first implementations:

1. drain all pages until no `nextCursor`
2. keep current one-page behavior but mark `complete: false` when `nextCursor` exists

Draining is better for a playground/profile because the goal is to learn as much as possible. Add a sensible max-page guard to avoid infinite loops against a broken server.

### Slice 5: Preserve Runtime Diagnostics

Keep these separate from the profile:

- `catalogStatus`
- `catalogErrors`
- `authRequirement`
- `authDiagnostics`
- `authorizationUrl`
- `error`
- raw `client`
- raw `transport`

The profile is a discovered description. Diagnostics are how the current attempt is going.

### Slice 6: Playground Profile UI

After the library exposes `serverProfile`, update the playground to render:

- endpoint and transport section
- initialize result section:
  - protocol version
  - server title/name/version
  - instructions
  - capability matrix
- auth discovery section:
  - auth mode
  - protected resource name/resource/scopes
  - authorization server issuer/endpoints
  - DCR/CIMD support
- config recommendation section:
  - no additional config
  - click Authorize
  - enter bearer token
  - enter OAuth client ID
  - optionally provide client metadata URL
- catalog section:
  - counts and names
  - complete/incomplete state
  - partial errors

Keep presets as playground seed data. Do not publish hard-coded provider presets as core runtime API until there is a stronger product reason.

## Test Plan

Use the existing browser harness. Do not add jsdom.

### Library Tests

Add or extend `tests/browser/useMcp.test.tsx`:

- no-auth server produces a profile with `auth.mode === "none"`
- ready server profile includes `initialize.protocolVersion`
- ready server profile includes `initialize.capabilities`
- ready server profile includes `initialize.serverInfo`
- ready server profile includes `instructions` when the server provides it
- stateless transport profile reports `sessionMode: "stateless"`
- stateful transport profile reports `sessionMode: "stateful"` without exposing raw session id
- OAuth-protected server profile includes protected resource metadata and authorization server metadata
- bearer-only server profile reports `auth.mode === "external-bearer"`
- manual OAuth client requirement keeps `serverProfile.auth.mode === "oauth-protected"` and `authRequirement.type === "manual_oauth_client"`
- catalog sections preserve item types and completeness
- partial catalog failure keeps profile usable but records section error

### Test Harness Updates

Extend `tests/browser/support/oauthMcpServer.ts` to support:

- server instructions
- custom capabilities
- paginated catalog responses
- split authorization server/resource server metadata, if needed later
- insufficient-scope challenge, if implementing step-up profile data

### Playground Tests

Extend `tests/browser/playground.test.tsx`:

- profile panel renders server name, protocol version, and capabilities after connect
- auth section renders OAuth metadata before authorization completes
- bearer-required flow shows config recommendation
- manual OAuth flow shows client ID recommendation
- catalog profile renders incomplete/partial state

### Validation

Run:

```bash
vp check
vp test run
```

If public exports change, also run:

```bash
vp run validate:package
```

## Risks And Tradeoffs

### Public API Size

`serverProfile` can become an "everything bagel" if it mixes protocol facts, diagnostics, and secrets. Keep the stable profile small and SDK-shaped. Put debugging detail in `authDiagnostics` or a future `debug` field.

### Spec Drift

The MCP spec and SDK evolve quickly. Reusing SDK types reduces drift. Hard-coded local mirror types increase drift.

### Static Presets

Provider presets are useful in the playground but brittle in the library. Server behavior, OAuth policies, CORS, and docs URLs can change. Treat presets as examples, not protocol truth.

### Pagination

Current catalog loading does not prove the full catalog. A profile aimed at "maximizing information" should either drain pagination or be honest about incompleteness.

### Secrets And Session Data

Do not expose raw tokens, raw session IDs, PKCE verifier, OAuth state, or authorization codes in `serverProfile`. Keep those in private provider/transport state.

### Resume Semantics

If future storage supports session resume, connecting with an existing session id can skip initialization. A profile from a resumed session may need to come from cache or force a fresh initialize through a new transport.

## Decision Summary

Adopt a runtime-derived `McpServerProfile`.

Use SDK and MCP spec types wherever they already exist:

- `InitializeResult`
- `Implementation`
- `ServerCapabilities`
- `Tool`
- `Resource`
- `ResourceTemplate`
- `Prompt`
- OAuth metadata types

Keep the profile separate from next-action UI state:

- `serverProfile`: what was discovered about the server
- `authRequirement`: what the app/user needs to do next
- `catalogStatus` and `catalogErrors`: how the catalog load attempt went
- `client` and `transport`: advanced escape hatches

The playground should become a server profiler UI built on top of the library profile. It should not own protocol inference.

