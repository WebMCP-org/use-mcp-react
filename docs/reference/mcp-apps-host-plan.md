# MCP Apps Host Plan

This plan captures the intended path for making `use-mcp-react` a browser MCP
host layer that can authenticate to a remote MCP server and render MCP Apps from
that same authorized connection.

## Goal

Let a React app or browser extension connect to an OAuth-protected remote MCP
server, render a server-provided MCP App in a sandboxed iframe, and let the
iframe behave like an authenticated application without receiving raw OAuth
tokens.

The target shape is:

```text
Browser app or extension
  useMcp()
    connects to the remote MCP server
    handles OAuth, DCR, PKCE, browser-extension redirect handling, token refresh
    owns the authorized MCP Client

  MCP Apps host renderer
    advertises MCP Apps support during initialize
    reads ui:// resources
    renders sandboxed iframe content
    bridges iframe requests to the authorized MCP Client

Sandboxed iframe
  MCP App runtime
    receives tool input/results
    calls server tools through AppBridge
    optionally uses HTTP middleware so existing app code can call fetch/XHR

MCP server
  ext-apps server helpers
    register tools/resources with UI metadata
    optionally expose app-only tools and HTTP adapter tools
```

## Product Story

The user installs or opens a browser/extension shell built with
`use-mcp-react`. They enter or select a remote MCP server URL. The shell handles
the MCP auth flow using the same hook state machine as normal browser MCP
connections.

Once the connection is ready, the shell can detect MCP App tools by their
`_meta.ui.resourceUri` metadata, fetch the referenced `ui://` resource, and
render the returned `text/html;profile=mcp-app` content inside a sandboxed
iframe.

Inside the iframe, app code talks to the host through MCP Apps
`PostMessageTransport`. The parent host forwards allowed requests through the
authorized SDK `Client` it already owns. From the app's perspective, protected
actions work. From the host's perspective, credentials never leave the parent
security boundary.

## Security Model

Do not pass provider access tokens into the iframe by default.

The iframe is server-provided HTML and should be treated as less trusted than
the parent host. It should receive authenticated capabilities, not raw
credentials.

The parent host owns:

- OAuth tokens and refresh state.
- DCR/CIMD/manual client configuration.
- Browser extension identity redirect handling.
- MCP SDK `Client` and transport lifecycle.
- Tool/resource/prompt forwarding policy.
- Sandbox, CSP, and permission policy.

The iframe may receive:

- Tool input/result notifications.
- Host context.
- Permission-scoped bridge methods such as `callServerTool`.
- Optional HTTP adapter behavior that maps `fetch`/XHR to MCP tool calls.

If token-like behavior is ever required, prefer a host-minted iframe session
token that only works against the bridge or MCP server's app tools. Do not
project the upstream OAuth provider token into the iframe unless an application
explicitly opts into that risk.

## Current Building Blocks

`use-mcp-react` already owns the browser MCP connection story:

- Streamable HTTP transport.
- MCP OAuth discovery.
- Dynamic Client Registration.
- Client ID Metadata Document support.
- Manual client id support.
- PKCE and Resource Indicators.
- Browser extension redirect handling through `browser.identity` or
  `chrome.identity`.
- Server capabilities, catalogs, and auth diagnostics.

The `alex/react-mcp-host-layer` branch also adds the important next
prerequisites:

- `clientCapabilities`.
- `clientOptions`.
- live catalog refresh for `listChanged`.
- first-class operation wrappers.

The local `ext-apps` checkout at
`/Users/alexmnahas/personalRepos/WebMCP-org/ext-apps` contains two relevant
tracks:

- Published upstream MCP Apps host/runtime APIs in
  `@modelcontextprotocol/ext-apps`.
- An unpublished `packages/http-adapter` branch that converts iframe
  `fetch`/XHR calls into MCP `http_request` tool calls.

As of this investigation, upstream `main` and npm are at
`@modelcontextprotocol/ext-apps@1.7.2`. The upstream host/runtime APIs should be
the source of truth for the first implementation. The local HTTP adapter branch
is older, unpublished, and should be treated as a separate middleware library,
not part of this core host-rendering work.

Upstream APIs and examples to reference before implementation:

- `src/app.ts`: `RESOURCE_MIME_TYPE`, `RESOURCE_URI_META_KEY`, and host-side
  guidance for checking both `_meta.ui.resourceUri` and deprecated
  `_meta["ui/resourceUri"]`.
- `src/app-bridge.ts`: `AppBridge`, automatic forwarding when constructed with
  an SDK `Client`, `teardownResource`, and bridge request handlers such as
  `oncalltool`.
- `src/message-transport.ts`: `PostMessageTransport` source/target validation.
- `examples/basic-host/src/implementation.ts`: current host-side loading,
  resource MIME validation, metadata fallback, sandbox proxy loading,
  `AppBridge` setup, tool input/result delivery, and teardown shape.
- `examples/basic-host/src/sandbox.ts` and `examples/basic-host/serve.ts`:
  upstream sandbox proxy and CSP behavior.
- `specification/2026-01-26/apps.mdx` and `specification/draft/apps.mdx`:
  current MCP Apps capability advertisement and `ui://` resource semantics.

## Phase 1: MCP Apps Host Rendering

Add an optional MCP Apps host layer to `use-mcp-react`.

Decision: ship this as a `use-mcp-react/apps` subpath export, not as a
separate package. The app host layer is an optional extension of the existing
hook because it consumes the authorized SDK `Client` that `useMcp` already
owns. A separate package would be premature while upstream
`@modelcontextprotocol/ext-apps` already owns the protocol/runtime/server-helper
package boundary.

Dependency decision: make `@modelcontextprotocol/ext-apps` an optional peer
dependency plus a dev dependency for this repo's build and tests once
`McpAppView` imports upstream bridge code. Do not make it a direct dependency of
the root package. Plain `use-mcp-react` consumers should not install the MCP
Apps stack, and upstream `ext-apps@1.7.2` currently declares `node >=20` while
this package supports `node >=18`.

Likely API shape:

```tsx
const mcp = useMcp({
  url,
  clientCapabilities: {
    extensions: {
      "io.modelcontextprotocol/ui": {
        mimeTypes: ["text/html;profile=mcp-app"],
      },
    },
  },
});

<McpAppView
  client={mcp.client}
  tool={tool}
  input={input}
  policy={{
    allowTools: true,
    allowResources: true,
    allowPrompts: false,
  }}
/>
```

Possible exports:

- `MCP_APP_EXTENSION_ID`.
- `MCP_APP_RESOURCE_MIME_TYPE`.
- `createMcpAppClientCapabilities()`.
- `getMcpAppResourceUri(tool)`.
- `readMcpAppResource(client, uri)`.
- `McpAppView`.

The renderer should:

- require an already connected SDK `Client`;
- read the `ui://` resource through `client.readResource`;
- require MIME type `text/html;profile=mcp-app`;
- support text and base64 blob resource content;
- respect content-level `_meta.ui` first and resource-listing `_meta.ui` as
  fallback;
- configure sandbox/CSP/permissions through host-controlled policy;
- create an upstream `AppBridge` connected to the iframe via
  `PostMessageTransport`;
- construct `AppBridge` without automatic SDK-client forwarding for the default
  secure path, then register explicit handlers that enforce host policy before
  calling the authorized `Client`;
- derive host capabilities from the resolved forwarding policy instead of
  blindly copying server capabilities;
- call `teardownResource` before unmounting when possible;
- never expose OAuth tokens to the iframe.

This phase can build against published `@modelcontextprotocol/ext-apps@1.7.2`.

The first pass should not import or depend on the local HTTP adapter branch.
The iframe should run MCP Apps-native code first: `App` in the iframe calls
`callServerTool`, and the host bridge forwards that to the already-authorized
MCP `Client`.

### Forwarding Policy

`useMcp` should stay the connection, catalog, and auth state machine.
`McpAppView` should own iframe trust and forwarding policy.

Recommended public shape:

```ts
type McpAppForwardingPolicy = {
  tools?: false | "app-visible" | McpAppToolPolicy;
  resources?: false | true | McpAppResourcePolicy;
  prompts?: false | true | McpAppPromptPolicy;
  links?: false | McpAppLinkPolicy;
  downloads?: false | McpAppDownloadPolicy;
  sampling?: false | McpAppSamplingPolicy;
  modelContext?: false | McpAppModelContextPolicy;
};
```

Default policy:

- tools: `"app-visible"`;
- resources: allow list, template list, and read against the same MCP server;
- prompts: disabled;
- links: disabled;
- downloads: disabled;
- sampling: disabled;
- model context updates: disabled.

App tool calls should be allowed only for tools from the same connected MCP
server whose `_meta.ui.visibility` is omitted or includes `"app"`. Reject
`"model"`-only tools. Do not let app-only tools leak into model-facing catalogs.

Prompts should stay disabled by default. If enabled in the first implementation,
that should mean `prompts/list` only because upstream `AppBridge` currently
does not expose a `prompts/get` app request handler.

Links, downloads, sampling, and model-context updates are browser/model side
effects. They should require explicit opt-in callbacks or allow predicates.

### Sandbox Policy

For local browser apps, follow upstream's double-iframe model:

```text
host page -> sandbox proxy on a different origin -> inner MCP App iframe
```

The proxy iframe should use the smallest viable sandbox token set. Upstream's
browser proxy currently needs `allow-scripts allow-same-origin` so it can load a
same-origin proxy document and write the inner app HTML. Add `allow-forms` only
when form submission is intentionally supported. Do not grant top navigation,
popups, modals, downloads, pointer lock, presentation, or similar capabilities
by default.

Do not trust arbitrary server-declared sandbox domains in v1. The renderer may
support a host-controlled `sandboxUrl` or `sandboxOrigin`, but `_meta.ui.domain`
is metadata for host policy decisions, not authority to choose a sandbox origin.
If `allow-same-origin` is present, the sandbox proxy must not be served from the
same origin as the host app.

For Chrome extensions, use the same logical proxy protocol but an
extension-specific sandbox page declared in the manifest. Chrome sandboxed
extension pages have a unique origin, no extension API access, and communicate
by `postMessage`. The current extension e2e now declares this page and passes
its `chrome.runtime.getURL("sandbox.html")` URL to `McpAppView`. The page uses
the upstream sandbox proxy protocol: it sends
`ui/notifications/sandbox-proxy-ready`, accepts
`ui/notifications/sandbox-resource-ready`, and relays JSON-RPC between the
parent bridge and the inner app iframe.

## TDD Plan

Use vertical slices. Do not write the whole suite first.

### Slice 1: App Capability Advertisement

Red:

- Browser/MSW test proves `useMcp` can be configured with
  `createMcpAppClientCapabilities()` and the service-worker MCP server receives
  `extensions["io.modelcontextprotocol/ui"].mimeTypes` with
  `text/html;profile=mcp-app`.

Green:

- Add only the capability helper and public export needed to pass.

Refactor:

- Keep constants aligned with upstream names and MIME values.

### Slice 2: UI Resource Discovery

Red:

- Public helper test proves a tool with `_meta.ui.resourceUri` returns the
  `ui://` URI.
- Second test proves deprecated `_meta["ui/resourceUri"]` still works because
  upstream currently documents both.

Green:

- Implement `getMcpAppResourceUri` using the upstream metadata conventions.

Refactor:

- Keep this helper small and independent of React.

### Slice 3: Read And Validate App Resource

Red:

- Browser/MSW test calls `readMcpAppResource(client, uri)` against the MCP
  service-worker server and verifies text HTML, MIME validation, and
  content-level `_meta.ui`.
- Add the blob/base64 case after the text case passes.
- Add listing-level metadata fallback only after the content-level path passes.

Green:

- Implement resource reading through the existing authorized SDK `Client`.

Refactor:

- Return a small host-owned shape: `{ html, csp, permissions, metadata }`.

### Slice 4: Render A Sandboxed MCP App

Red:

- Browser Mode test renders `<McpAppView>` with a connected client and a tool
  whose UI resource is served by the MSW MCP server.
- The iframe app initializes through upstream `App` and
  `PostMessageTransport`.
- The test asserts visible iframe-rendered content, not implementation details.

Green:

- Use upstream `AppBridge` and `PostMessageTransport` to load the resource and
  initialize the app.

Refactor:

- Isolate sandbox construction and bridge lifecycle behind the component.

### Slice 5: Authenticated Bridge Call

Red:

- Browser/MSW test proves the iframe calls `app.callServerTool`, the parent
  bridge forwards it through the same authorized MCP client, and the MCP server
  sees the auth state already established by `useMcp`.
- Assert the iframe receives the protected result.
- Assert the iframe never receives a raw OAuth access token.

Green:

- Wire `AppBridge` forwarding against the connected client and host policy.

Refactor:

- Keep policy explicit and default-deny for risky host operations such as
  external links, prompts, sampling, downloads, or model-context updates.

### Slice 6: Lifecycle And React Stability

Red:

- Re-rendering with unchanged props should not reconnect or reload the iframe.
- Changing the selected tool/resource should tear down the previous resource.
- Unmount should call `teardownResource` when initialized.
- Disconnecting `useMcp` should close the bridge cleanly.

Green:

- Add lifecycle guards and stable refs.

Refactor:

- Make React behavior boring: no render loops, no state updates after unmount,
  no duplicated bridge connections.

### Slice 7: Real Extension E2E

Red:

- Extend the real Chromium extension harness so the extension connects to an
  OAuth-protected MCP server, receives a UI-enabled tool, reads the `ui://`
  resource, renders the iframe, and lets the iframe call a protected server
  tool through the parent bridge.

Green:

- Add the smallest extension UI needed to exercise the path.

Refactor:

- Pull reusable extension fixture pieces back into test support.

The MSW MCP server should be the main test shovel:

- initialize records app capabilities;
- tools/list returns a UI-enabled tool only when the host advertises support;
- resources/list returns the `ui://` resource metadata;
- resources/read returns `text/html;profile=mcp-app` with CSP/permissions
  metadata;
- tools/call returns protected data only when the existing OAuth path has
  authorized the MCP request;
- test-only assertions record that no raw token was posted into the iframe.

## Phase 2: Real Extension Proof

Extend the existing real Chromium extension e2e harness.

The test should prove:

- the extension connects to an OAuth-protected MCP server through
  `chrome.identity`;
- the hook advertises MCP Apps support during initialize;
- the server exposes an app-enabled tool/resource only when that capability is
  present;
- the extension renders the MCP App iframe;
- the iframe calls a protected tool through `AppBridge`;
- the protected call uses the parent host's authorized MCP client;
- the iframe never receives the raw OAuth access token.

The server fixture should include:

- OAuth-protected `/mcp`;
- protected resource metadata;
- DCR;
- a UI-enabled tool with `_meta.ui.resourceUri`;
- a `ui://` HTML resource;
- an app-only tool callable by the iframe;
- assertions around token use and redirect URI.

## Phase 3: HTTP Adapter Middleware

Port the local `ext-apps` HTTP adapter branch onto upstream `ext-apps@1.7.2`,
but keep it conceptually separate from `use-mcp-react` core. This should be a
middleware package or extension that app authors can opt into when they want an
existing web app to run inside MCP Apps without rewriting every network call.

Decision: publish this separately as
`@modelcontextprotocol/ext-apps-http-adapter`, maintained in the `ext-apps`
repo, rather than folding it into core `@modelcontextprotocol/ext-apps` exports.
The adapter patches or wraps network boundaries and introduces a
security-sensitive `http_request` convention; it should version, document, and
warn independently from the core app runtime.

The adapter goal:

```ts
await fetch("/api/items");
```

becomes:

```ts
await app.callServerTool({
  name: "http_request",
  arguments: {
    method: "GET",
    url: "/api/items",
  },
});
```

This lets existing frontend applications run inside MCP Apps with less
rewriting. Their network boundary is adapted to MCP tool calls.

Porting notes:

- preserve forbidden header stripping;
- preserve request body serialization for JSON, text, URL-encoded, form data,
  and base64;
- preserve response reconstruction for fetch and XHR;
- keep allowlists mandatory for server-side HTTP proxy handlers;
- adapt tests to upstream's current test harness;
- align peer dependency with `@modelcontextprotocol/sdk@^1.29.0`;
- decide whether the adapter is a separate published package or an export from
  `@modelcontextprotocol/ext-apps`.

This should be landed and published in `ext-apps` before `use-mcp-react`
documents first-class HTTP adapter integration. `use-mcp-react/apps` can later
document how to combine the middleware with `McpAppView`, but should not own the
adapter implementation.

## Phase 4: Existing App Auth Compatibility

Support existing frontend auth libraries by adapting their network/session
boundary rather than passing them OAuth tokens.

Preferred pattern:

- iframe app calls its usual session or API endpoints;
- HTTP adapter intercepts those requests;
- requests become MCP tool calls;
- MCP server responds using the authenticated MCP request context;
- app receives ordinary HTTP-like responses and behaves as logged in.

Common compatibility endpoints:

- `GET /me`.
- `GET /session`.
- `GET /api/auth/session`.
- protected API routes.
- `POST /logout`.

The parent host may expose policy hooks for these routes, but the actual
identity should remain bound to the authorized MCP client and server-side
request context.

Avoid default token projection. If absolutely needed, make it an explicit
advanced mode with clear warnings and a constrained token audience.

## Non-Goals

- Do not add legacy SSE fallback as part of this work.
- Do not make MCP Apps support automatic for every `useMcp` consumer.
- Do not pass raw OAuth provider tokens to app iframes by default.
- Do not implement a general browser CORS bypass in the iframe.
- Do not depend on the unpublished HTTP adapter package from `use-mcp-react`
  until it is ported and published.

## Open Questions

- Should the app host subpath use export-map object syntax for `types` before
  `default`, or rely on Vite+/tsdown export inference?
- What exact host-controlled sandbox URL contract should `McpAppView` expose
  for web apps?
- How much of the extension sandbox page should live in reusable library assets
  versus the consuming extension's own manifest/page?
- Should app-visible tool filtering be added to the core hook catalogs, or only
  inside `use-mcp-react/apps` bridge policy?
- What is the minimum first release support for prompts: keep disabled entirely
  or expose list-only policy?

## Suggested Implementation Order

1. Finish and merge the current host-layer branch.
2. Confirm upstream `ext-apps` APIs against `@modelcontextprotocol/ext-apps`
   latest before coding.
3. Add `use-mcp-react/apps` capability helpers with the first red/green slice.
4. Add resource discovery and reading through the MSW MCP server.
5. Add `McpAppView` against published `@modelcontextprotocol/ext-apps`.
6. Prove OAuth plus iframe tool calls in the real Chromium extension harness.
7. Port the HTTP adapter branch forward in `ext-apps` as separate middleware.
8. Add HTTP adapter docs/examples after the adapter has a stable install path.
9. Investigate framework-specific auth compatibility shims only after the
   generic HTTP adapter path works.

## Current Implementation Status

Implemented in the current working tree:

- `use-mcp-react/apps` subpath export.
- Optional peer plus dev dependency on `@modelcontextprotocol/ext-apps@1.7.2`.
- `createMcpAppClientCapabilities()`.
- `getMcpAppResourceUri()` for nested `_meta.ui.resourceUri` and deprecated
  `_meta["ui/resourceUri"]`.
- `readMcpAppResource()` with text/blob HTML support, MCP Apps MIME validation,
  and content `_meta.ui` extraction.
- `McpAppView` rendering a `ui://` resource into a sandboxed iframe.
- Host-controlled `sandboxUrl` support for manifest-declared extension sandbox
  pages using the upstream MCP Apps sandbox proxy notification protocol.
- Parent-side upstream `AppBridge`/`PostMessageTransport` integration.
- Manual tool-call forwarding through the authorized SDK `Client`.
- Default rejection for model-only tools.
- Browser/MSW tests for capability advertisement, resource loading, iframe
  rendering, protected tool calls through the parent client, and token
  non-projection to the iframe.
- Real Chromium extension e2e for DCR plus Chrome Identity auth, MCP Apps
  capability advertisement, `ui://` resource loading through the authorized
  extension client, sandboxed iframe rendering, protected app tool calls, and
  token non-projection.

Still to do:

- Host-controlled web sandbox URL/proxy support that matches upstream's
  double-iframe, different-origin browser model.
- Rich forwarding-policy API for resources, prompts, links, downloads,
  sampling, and model-context updates.
- App tool visibility filtering from model-facing catalogs if that belongs in
  this package rather than only the app bridge.
- HTTP adapter port as a separate `ext-apps` middleware package.
