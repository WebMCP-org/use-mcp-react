<p align="center">
  <img alt="use-mcp-react" src="https://unpkg.com/use-mcp-react/assets/use-mcp-react-card.svg" width="560">
</p>

<h1 align="center">use-mcp-react</h1>

<p align="center">
  React hooks for connecting browser apps to remote MCP servers.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/use-mcp-react"><img alt="npm package" src="https://img.shields.io/badge/npm-use--mcp--react-19e68c?logo=npm&logoColor=white"></a>
  <a href="https://www.npmjs.com/package/use-mcp-react"><img alt="npm version" src="https://img.shields.io/npm/v/use-mcp-react?color=19e68c"></a>
  <img alt="TypeScript types included" src="https://img.shields.io/badge/types-included-19e68c?logo=typescript&logoColor=white">
  <a href="https://github.com/WebMCP-org/use-mcp-react/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-19e68c"></a>
  <img alt="React 18 and 19" src="https://img.shields.io/badge/react-18%20%7C%2019-19e68c?logo=react&logoColor=white">
  <img alt="Node.js 18 or newer" src="https://img.shields.io/badge/node-%3E%3D18-19e68c?logo=node.js&logoColor=white">
  <img alt="MCP ready" src="https://img.shields.io/badge/MCP-ready-19e68c">
</p>

<p align="center">
  <a href="https://use-mcp-react-playground.alexmnahas.workers.dev">Live playground</a>
</p>

`use-mcp-react` is for product UIs, playgrounds, and developer tools that accept an MCP server URL at runtime. The hook probes the server with the real MCP TypeScript SDK, classifies the auth requirement, and returns the exact UI branch your React app should render next.

## Why This Exists

Remote MCP servers do not all expose the same browser setup:

- some initialize with no auth
- some use [MCP OAuth](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) with [PKCE](https://www.rfc-editor.org/rfc/rfc7636) and [Dynamic Client Registration](https://www.rfc-editor.org/rfc/rfc7591)
- some require a manually registered public OAuth client id
- some only return a [bearer/API-key challenge](https://www.rfc-editor.org/rfc/rfc6750)
- some need an app-owned transport proxy because the [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#streamable-http) MCP endpoint does not allow browser CORS

`useMcp` turns those differences into one React state machine. Your app keeps control of the UI, tokens you own, and proxy policy; the hook owns the MCP client lifecycle, OAuth callback handoff, server profile, and initial catalog loading.

## Install

```bash
npm install use-mcp-react react
```

React is a peer dependency. TypeScript projects that do not already include React types should also install `@types/react`.

```bash
npm install -D @types/react
```

## Quick Start

Mount the OAuth callback route once in your app:

```tsx
import { McpOAuthCallback } from "use-mcp-react";

<Route path="/oauth/callback" element={<McpOAuthCallback />} />;
```

Then create one hook instance per MCP server and render from `status` plus `authRequirement`:

```tsx
import { useMcp } from "use-mcp-react";

export function McpConnection({ url }: { url: string }) {
  const mcp = useMcp({ url });

  if (mcp.status === "pending_auth") {
    if (mcp.authRequirement?.type === "oauth") {
      return (
        <button onClick={() => void mcp.authorize({ target: "popup" })} type="button">
          Authorize
        </button>
      );
    }

    if (mcp.authRequirement?.type === "manual_oauth_client") {
      return (
        <ClientIdForm
          onSubmit={(clientId) =>
            void mcp.reconnect({
              authorizationTarget: "popup",
              oauth: { clientId },
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
    return <ToolList client={mcp.client} tools={mcp.tools} />;
  }

  return <ConnectionStatus error={mcp.error} status={mcp.status} />;
}
```

Browser popups must be opened from a user gesture. Mount-time auto-connect can discover OAuth and prepare `authorizationUrl`, but your UI should call `authorize`, `connect`, `reconnect`, or `reauthorize` from a button/form submit when it needs a popup.

## Runtime Connection Pattern

For URL-entry UIs, keep the hook idle until the user submits a real endpoint:

```tsx
const [url, setUrl] = useState("");
const mcp = useMcp({ enabled: false, url: null });

function connect() {
  void mcp.connect({
    enabled: true,
    transportProxy: "/api/mcp-proxy",
    url,
  });
}
```

The playground uses this pattern. It starts idle, lets users pick a known server or paste an MCP URL, then calls `connect` with one-shot options. If discovery reports a bearer token or manual OAuth client id is needed, the playground collects that value and calls `reconnect` with the new credential.

## Auth Branches

### No Auth

```tsx
const mcp = useMcp({ url: "https://mcp.deepwiki.com/mcp" });
```

If the server initializes without auth, the hook loads the initial catalog and moves to `ready`.

### MCP OAuth

When a server returns an [MCP OAuth](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) challenge, the hook prepares an authorization request using [OAuth 2.0 Protected Resource Metadata](https://www.ietf.org/rfc/rfc9728.html), [OAuth 2.0 Authorization Server Metadata](https://www.rfc-editor.org/rfc/rfc8414.html), [PKCE](https://www.rfc-editor.org/rfc/rfc7636), [Resource Indicators](https://www.rfc-editor.org/rfc/rfc8707), and [Dynamic Client Registration](https://www.rfc-editor.org/rfc/rfc7591) where available.

```tsx
if (mcp.authRequirement?.type === "oauth") {
  return <button onClick={() => void mcp.authorize({ target: "popup" })}>Authorize</button>;
}
```

`authRequirement.supportsDynamicClientRegistration`, `authRequirement.supportsClientMetadataDocument`, and `authDiagnostics.registrationStrategy` are available for setup/debug UI.

### Client ID Metadata Document

Generic libraries cannot invent a [Client ID Metadata Document](https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/) URL for your app. If you host one, pass it explicitly:

```tsx
const mcp = useMcp({
  oauth: {
    clientMetadataUrl: "https://app.example.com/.well-known/oauth-client-metadata.json",
  },
  url,
});
```

When the authorization server advertises URL-based client identifiers, the hook can use this URL as the public client id.
The hosted document must include a `client_id` property whose value exactly matches the document URL.

### Manually Registered Public Client

Some authorization servers require a public client id registered out of band:

```tsx
const mcp = useMcp({
  oauth: {
    clientId: "pre_registered_public_client_id",
    redirectUrl: "https://app.example.com/oauth/callback",
  },
  url,
});
```

The hook still handles PKCE, state validation, token exchange, callback routing, and MCP connection lifecycle.

### Bearer Token

```tsx
const mcp = useMcp({
  bearerToken: apiKey,
  url,
});
```

[Bearer tokens](https://www.rfc-editor.org/rfc/rfc6750) skip OAuth discovery. The hook does not persist bearer tokens because masking, rotation, revocation, and storage policy belong to the host app.

## Browser Deployment Modes

### Direct Mode

Use direct mode when the MCP server supports browser CORS for the MCP endpoint and every required OAuth endpoint:

```tsx
const mcp = useMcp({
  url: "https://mcp.linear.app/mcp",
});
```

### Transport Proxy Mode

Use transport proxy mode when only the MCP transport endpoint needs server-side forwarding:

```tsx
const mcp = useMcp({
  transportProxy: "/api/mcp-proxy",
  url: userEnteredMcpUrl,
});
```

Keep `url` pointed at the upstream MCP server. OAuth discovery, registration, token exchange, token refresh, and callback handling stay in the browser. Only MCP transport requests are sent to the proxy, with `x-mcp-target-url` identifying the upstream target.

If the proxy accepts runtime targets, enforce an allowlist or equivalent policy on the server. The playground demonstrates this with a proxy server route at [`playground/worker/index.ts`](https://github.com/WebMCP-org/use-mcp-react/blob/main/playground/worker/index.ts). See [transport proxy mode](https://github.com/WebMCP-org/use-mcp-react/blob/main/docs/reference/transport-proxy-mode.md) for the setup contract and security checklist.

### Backend Gateway Mode

Backend gateway mode, where your server owns OAuth tokens, tool policy, approvals, tenancy, or audit logging, is a different product model. This hook does not implement that model.

## Public API

### `useMcp(options)`

```ts
type UseMcpOptions = {
  bearerToken?: string;
  clientCapabilities?: ClientCapabilities;
  clientOptions?: ClientOptions;
  enabled?: boolean;
  oauth?: {
    clientId?: string;
    clientMetadata?: OAuthClientMetadata;
    clientMetadataUrl?: string;
    redirectUrl?: URL | string;
  };
  storage?: McpStorage | false;
  transportProxy?: URL | string;
  url?: URL | string | null;
};
```

`enabled` defaults to `true`. `null`, `undefined`, an empty string, an unparseable URL, or `enabled: false` keeps the hook in `idle`.

### Status

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

`status` describes what the app can do next. `authRequirement` describes missing auth input.

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
      reason: "client_registration_unavailable";
      suggestedFields: ["clientId"];
      issuer?: string;
      authorizationEndpoint?: string;
      tokenEndpoint?: string;
    }
  | {
      type: "bearer";
      reason: "oauth_metadata_absent";
      realm?: string;
      scopes?: string[];
    };
```

### Result

`useMcp` returns:

| Field                                                | Purpose                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `status`                                             | Current connection state for UI branching.                               |
| `authRequirement`                                    | Normalized OAuth, manual-client, or bearer requirement.                  |
| `authDiagnostics`                                    | Discovery and registration details for debug/setup UI.                   |
| `authorizationUrl`                                   | Prepared OAuth authorization URL when OAuth is pending.                  |
| `client`                                             | Connected MCP SDK `Client`, or `null` until ready.                       |
| `transport`                                          | Connected `StreamableHTTPClientTransport`, or `null` until ready.        |
| `tools`, `resources`, `resourceTemplates`, `prompts` | MCP catalog arrays. Unsupported sections are empty arrays.               |
| `catalogStatus`, `catalogErrors`                     | Catalog loading result. A server can be ready with a partial catalog.    |
| `serverCapabilities`, `serverVersion`                | Values reported by MCP initialize.                                       |
| `serverProfile`                                      | Runtime snapshot of initialize, transport, auth mode, and catalog state. |
| `error`                                              | Last unrecoverable connection, auth, or catalog error.                   |

`clientCapabilities` is a narrow way to advertise client capabilities during MCP initialize. It is merged with `clientOptions.capabilities`, including extension capability keys such as `extensions["io.modelcontextprotocol/ui"]`. `clientOptions` is passed to the SDK `Client` for advanced configuration such as strict capability enforcement or SDK validators.

When a connected server advertises `tools.listChanged`, `resources.listChanged`, or `prompts.listChanged`, the hook refreshes the relevant catalog section after SDK list-changed notifications. Refresh failures update `catalogStatus`, `catalogErrors`, and `serverProfile.catalog` without disconnecting the active client.

### Actions

Every async action returns `Promise<McpActionResult>` so UI code can handle failures without parsing exceptions.

| Action                             | Purpose                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `connect(options?)`                | Start or retry a connection using hook options plus one-shot overrides.                  |
| `disconnect()`                     | Close the active SDK client and transport while keeping last-known server/catalog state. |
| `reconnect(options?)`              | Close and connect again while preserving reusable OAuth state.                           |
| `reauthorize(options?)`            | Clear OAuth tokens and PKCE state, then start fresh authorization.                       |
| `forget()`                         | Clear hook-owned auth, connection, server, catalog, and error state.                     |
| `authorize(options?)`              | Open, focus, or navigate a pending OAuth popup.                                          |
| `finishAuthorization(code, state)` | Complete an OAuth callback when `state` matches the pending attempt.                     |
| `callTool(params, options?)`       | Call `client.callTool` and return a structured operation result.                         |
| `readResource(params, options?)`   | Call `client.readResource` and return a structured operation result.                     |
| `getPrompt(params, options?)`      | Call `client.getPrompt` and return a structured operation result.                        |
| `complete(params, options?)`       | Call `client.complete` and return a structured operation result.                         |

`connect`, `reconnect`, and `reauthorize` accept one-shot overrides:

```ts
type UseMcpActionOptions = Partial<UseMcpOptions> & {
  authorizationTarget?: Window | "popup";
  clearClient?: boolean;
  clearDiscovery?: boolean;
};
```

When a new connection action starts, it supersedes older pending work for the same hook instance. Late results from older attempts are ignored.

Operation wrappers return `{ ok: true, result }`, `{ ok: false, reason: "not_connected" }`, or `{ ok: false, reason: "failed", error }`. They accept SDK request options, including abort signals, timeouts, and progress callbacks where the SDK method supports them. The raw `client` remains available for advanced SDK use.

## OAuth Callback

`McpOAuthCallback` is a minimal React page for the configured redirect URL. The default redirect is `/oauth/callback` on the current origin.

```tsx
import { McpOAuthCallback } from "use-mcp-react";

<Route path="/oauth/callback" element={<McpOAuthCallback />} />;
```

The callback page reads `code`, `state`, `error`, and `error_description`, posts a typed message to `window.opener`, publishes the same message through `BroadcastChannel`, and closes the popup after success when possible.

For non-React routing, use `handleMcpOAuthCallback()` directly.

## Protocol References

This package intentionally follows the MCP and OAuth specifications instead of provider-specific conventions. These are the first-party references behind the auth and transport behavior:

| Topic                         | Source                                                                                                                                                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP authorization             | [MCP Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)                                                                                                                                                                      |
| MCP Streamable HTTP           | [MCP Transports: Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#streamable-http)                                                                                                                                           |
| MCP tools/resources/prompts   | [MCP Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), [MCP Resources](https://modelcontextprotocol.io/specification/2025-11-25/server/resources), [MCP Prompts](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts) |
| Protected resource metadata   | [RFC 9728: OAuth 2.0 Protected Resource Metadata](https://www.ietf.org/rfc/rfc9728.html)                                                                                                                                                                               |
| Authorization server metadata | [RFC 8414: OAuth 2.0 Authorization Server Metadata](https://www.rfc-editor.org/rfc/rfc8414.html)                                                                                                                                                                       |
| Dynamic Client Registration   | [RFC 7591: OAuth 2.0 Dynamic Client Registration Protocol](https://www.rfc-editor.org/rfc/rfc7591)                                                                                                                                                                     |
| Client ID Metadata Document   | [IETF draft: OAuth Client ID Metadata Document](https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/)                                                                                                                                        |
| PKCE                          | [RFC 7636: Proof Key for Code Exchange](https://www.rfc-editor.org/rfc/rfc7636)                                                                                                                                                                                        |
| Resource Indicators           | [RFC 8707: Resource Indicators for OAuth 2.0](https://www.rfc-editor.org/rfc/rfc8707)                                                                                                                                                                                  |
| Bearer tokens                 | [RFC 6750: OAuth 2.0 Bearer Token Usage](https://www.rfc-editor.org/rfc/rfc6750)                                                                                                                                                                                       |

## Storage

```ts
type McpStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};
```

Default storage wraps browser `localStorage` and is partitioned by canonical MCP server URL and OAuth client configuration. Pass `storage: false` for memory-only hook state.

Hook-owned storage may include OAuth discovery state, Dynamic Client Registration client information, tokens, pending OAuth state, PKCE verifier, and expected callback state.

The hook never stores app-owned values such as `bearerToken`, `oauth.clientId`, `oauth.clientMetadataUrl`, or `oauth.clientMetadata`.

## Multiple MCP Servers

Use one hook instance per MCP server:

```tsx
const github = useMcp({ url: githubMcpUrl });
const linear = useMcp({ url: linearMcpUrl });
```

Each instance owns its own auth discovery, token audience, PKCE state, MCP client, transport, pending callback state, and catalog state.

## Playground

Open the live playground to see the intended integration flow:

https://use-mcp-react-playground.alexmnahas.workers.dev

Or run it locally:

```bash
vp run playground
```

The playground includes presets for unauthenticated, OAuth, bearer-token, and manual-client scenarios. Remote presets use an app-owned transport proxy for MCP transport requests; OAuth remains browser-owned.

The deployed playground ships its React SPA and `/api/mcp-proxy` backend together. The proxy exists for servers such as Stripe whose MCP transport endpoint does not expose browser CORS. See [`playground/worker/index.ts`](https://github.com/WebMCP-org/use-mcp-react/blob/main/playground/worker/index.ts) and [transport proxy mode](https://github.com/WebMCP-org/use-mcp-react/blob/main/docs/reference/transport-proxy-mode.md).

It also serves a Client ID Metadata Document at `/.well-known/oauth-client-metadata.json`. The document includes `client_id` equal to that full URL, which authorization servers require when they validate URL-based client ids. Use the playground CIMD toggle to pass that URL as `oauth.clientMetadataUrl` and demonstrate URL-based public OAuth client ids.

## Development

This repo uses Vite+.

```bash
vp install
vp check
vp test
vp pack
```

Validate the publishable package:

```bash
vp run validate:package
vp run verify:packed-consumer
```

## Documentation

- [Transport proxy mode](https://github.com/WebMCP-org/use-mcp-react/blob/main/docs/reference/transport-proxy-mode.md)
- [OAuth MCP test server with MSW](https://github.com/WebMCP-org/use-mcp-react/blob/main/docs/reference/oauth-mcp-msw-test-server.md)
- [Release process](https://github.com/WebMCP-org/use-mcp-react/blob/main/docs/release.md)
- [Open source checklist](https://github.com/WebMCP-org/use-mcp-react/blob/main/docs/open-source-checklist.md)

## Contributing

See [CONTRIBUTING.md](https://github.com/WebMCP-org/use-mcp-react/blob/main/CONTRIBUTING.md). Before opening a PR, run:

```bash
vp check
vp test
```

## License

MIT
