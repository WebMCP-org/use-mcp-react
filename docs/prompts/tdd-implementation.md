# TDD Implementation Prompt

You are implementing `use-mcp-react`, a browser-side React hook library for connecting to MCP servers through `@modelcontextprotocol/sdk`.

The goal is not to get a quick hook working. The goal is to build a small, correct, boring, production-quality library with tests strong enough that future refactors can move fast without breaking OAuth, MCP transport behavior, browser semantics, or React render ergonomics.

Work test-first. Do not write production implementation code until the next failing test clearly demands it.

## Non-Negotiables

- Use TDD: red, green, refactor.
- Keep `@modelcontextprotocol/sdk` as the only runtime dependency.
- Keep `react` as the only peer dependency.
- Keep React DOM, Vitest Browser Mode, Playwright, MSW, and test helpers as dev-only tooling.
- Do not mock SDK internals.
- Do not mock this library's own modules.
- Mock only external HTTP boundaries with MSW.
- Test browser-facing behavior in Vitest Browser Mode, not jsdom.
- Use real browser APIs for storage, fetch, URL, headers, popup/redirect boundaries, and callback handling.
- Use `opensrc` for source reading. Do not clone repos by hand.
- Preserve the Vite+ workflow: `vp check`, `vp test run`, and relevant focused test commands.

## Read First

Before writing code, read:

- `AGENTS.md`
- `docs/agents/opensrc.md`
- `docs/agents/maintainable-typescript.md`
- `docs/reference/README.md`
- `docs/reference/opensrc-sources.md`
- `docs/reference/oauth-mcp-msw-test-server.md`

Then inspect the SDK and prior art through `opensrc`:

```bash
sed -n '1,260p' "$(vp exec opensrc path @modelcontextprotocol/sdk)/src/client/auth.ts"
sed -n '1,260p' "$(vp exec opensrc path @modelcontextprotocol/sdk)/src/client/streamableHttp.ts"
sed -n '1,220p' "$(vp exec opensrc path @modelcontextprotocol/sdk)/src/shared/auth.ts"
sed -n '1,260p' "$(vp exec opensrc path github:modelcontextprotocol/use-mcp)/src/auth/browser-provider.ts"
sed -n '1,260p' "$(vp exec opensrc path github:modelcontextprotocol/use-mcp)/src/react/useMcp.ts"
sed -n '1,260p' "$(vp exec opensrc path github:modelcontextprotocol/inspector)/client/src/lib/auth.ts"
sed -n '1,260p' "$(vp exec opensrc path github:modelcontextprotocol/inspector)/client/src/lib/oauth-state-machine.ts"
```

For render-count TDD patterns, inspect:

```bash
sed -n '730,830p' "$(vp exec opensrc path github:TanStack/query)/packages/react-query/src/__tests__/useQuery.test.tsx"
sed -n '2318,2355p' "$(vp exec opensrc path github:TanStack/query)/packages/react-query/src/__tests__/useQuery.test.tsx"
sed -n '88,155p' "$(vp exec opensrc path github:pmndrs/zustand)/tests/basic.test.tsx"
sed -n '55,110p' "$(vp exec opensrc path github:vercel/swr)/test/use-swr-loading.test.tsx"
sed -n '170,285p' "$(vp exec opensrc path github:wevm/wagmi)/packages/react/src/hooks/useConnectorClient.test.tsx"
```

## Architecture Direction

Keep the library split into two layers:

```txt
src/core/
  framework-agnostic MCP/OAuth/storage/transport coordination

src/react/
  React hook and provider bindings
```

The SDK should own MCP protocol mechanics, Streamable HTTP behavior, PKCE generation, OAuth discovery, DCR, CIMD, token exchange, refresh, and retry behavior wherever it already provides that behavior.

This library should own:

- browser `OAuthClientProvider` implementation
- storage abstraction and default localStorage adapter
- per-server storage isolation
- popup/redirect/callback resume boundary
- hook state model
- stable action APIs
- render-friendly subscription behavior
- clear error states

Do not hand-roll OAuth protocol logic beyond the browser provider and test server responsibilities.

## Test Infrastructure First

Before implementing the public hook, build the test harness.

Add or refine:

- `tests/browser/support/oauthMcpServer.ts`
- `tests/browser/support/renderProbe.tsx`
- focused MSW scenarios for MCP + OAuth
- direct SDK smoke tests through MSW
- hook tests only after the server fixture is proven with the SDK directly

The MSW test server should act as:

- MCP protected resource server
- OAuth authorization server
- DCR endpoint
- token endpoint
- refresh endpoint
- request logger

Use a real SDK `McpServer` and `WebStandardStreamableHTTPServerTransport` behind the MSW `/mcp` handler.

## TDD Order

Follow this order unless a test proves the order is wrong:

1. Make the MSW OAuth MCP test server robust.
2. Write a direct SDK browser test: unauthenticated MCP request returns `401`, SDK discovers auth, DCR happens, callback code exchange succeeds, `tools/list` works.
3. Add a render probe helper.
4. Write the first public hook test for no-auth MCP ready state.
5. Implement the minimum hook surface for that test.
6. Add auth-required pending-auth test.
7. Implement the browser OAuth provider boundary.
8. Add callback completion test.
9. Add refresh-token test.
10. Add StrictMode duplicate-effect tests.
11. Add render-count tests for consumer-specific subscriptions.
12. Add failure state tests.
13. Refactor only after tests describe the desired behavior.

## Test Style

Each important test should describe five things:

1. server scenario
2. consumer shape
3. expected request log
4. expected semantic state snapshots
5. render-count contract

Example shape:

```ts
const scenario = server.scenario({
  auth: "dcr",
  token: "expired",
  refresh: "succeeds",
  tools: [{ name: "echo" }],
});
```

Expected observations:

```ts
expect(server.getRequestLog()).toMatchObject([
  { path: "/mcp", status: 401 },
  { path: "/.well-known/oauth-protected-resource/mcp", status: 200 },
  { path: "/.well-known/oauth-authorization-server", status: 200 },
  { path: "/token", status: 200 },
  { path: "/mcp", status: 200, jsonRpcMethod: "initialize" },
  { path: "/mcp", status: 200, jsonRpcMethod: "tools/list" },
]);

expect(probe.snapshots()).toEqual([
  { status: "connecting" },
  { status: "loading", authStatus: "refreshing" },
  { status: "ready", toolNames: ["echo"] },
]);

expect(probe.renders()).toBeLessThanOrEqual(3);
```

Use exact render counts only when the count is truly the public behavior. Use upper bounds for loop prevention, retry paths, reconnects, and concurrent browser behavior.

## Render Contracts

Render behavior is part of this library's quality bar.

Add targeted tests for:

- no unnecessary rerender when an unread field changes
- stable action identities across unrelated state changes
- stable tools/resources/prompts arrays when payloads are unchanged
- token refresh without visible auth flicker
- reconnect without tools consumer rerender when tools are unchanged
- StrictMode does not duplicate DCR, redirect, popup, token exchange, or initialization side effects
- infinite-loop guards on auth failure and refresh failure

Do not use `why-did-you-render` in CI. Local render probes are enough.

## State Model

Prefer a discriminated state model over booleans.

Expected public states should be shaped around observable behavior:

- `idle`
- `connecting`
- `pending_auth`
- `authenticating`
- `loading`
- `ready`
- `reconnecting`
- `failed`

Do not expose a single `connected: boolean` as the primary contract.

Errors should be structured enough for consumers to decide whether to show retry, authenticate, disconnect, or inspect details.

## StrictMode Rules

React StrictMode is a required test lane.

In StrictMode:

- duplicate renders are acceptable
- duplicate externally visible effects are not acceptable
- opening two popups is a bug
- registering two clients for one server is a bug
- exchanging one authorization code twice is a bug
- starting two independent connection loops for one hook instance is a bug

Assert these through MSW request logs and injected redirect/popup capture, not private function spies.

## What Not To Do

- Do not implement the whole hook before writing the tests.
- Do not mock `@modelcontextprotocol/sdk`.
- Do not add extra runtime dependencies without explicit approval.
- Do not use jsdom for OAuth/browser behavior.
- Do not test private helper call order.
- Do not snapshot full hook return objects.
- Do not copy upstream source into `docs/reference/prior-art/`.
- Do not add broad abstractions before a test demands them.
- Do not hide protocol behavior behind fake local mocks.

## Finish Criteria For Each Slice

A slice is not done until:

- the failing test was written first
- the test passes in Vitest Browser Mode
- `vp check` passes
- `vp test run` passes or the exact failing test is explained
- render behavior is asserted when the slice touches subscription, identity, batching, auth effects, or retry loops
- request logs prove the expected MCP/OAuth behavior
- no implementation-only dependency was added

The standard is simple: tests should make it difficult to build the wrong hook.
