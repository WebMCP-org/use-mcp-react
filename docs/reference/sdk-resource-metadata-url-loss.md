# SDK loses `resource_metadata` URL on initial GET 401

**Status:** Open. Symptom is visible in the playground; root cause is in `@modelcontextprotocol/sdk@1.29.0` (the version this repo currently pins via `package.json`). This document exists to brief a specialist who needs to decide whether to fix the SDK upstream, work around it in `use-mcp-react`, or both.

---

## Symptom

In the playground (`vp dev playground`), connect to **Linear** (`https://mcp.linear.app/mcp`, OAuth · DCR preset). The Discovery timeline renders:

| Step | State | Detail |
|---|---|---|
| Reach endpoint | Done | `https://mcp.linear.app/mcp` |
| No-auth probe | Done | Server returned 401 — auth required |
| **Resource metadata** | **Skipped** | **"Server didn't advertise Protected Resource Metadata"** |
| Authorization server | Done | `https://mcp.linear.app` |
| Pick strategy | Done | Dynamic Client Registration |

The "Resource metadata" row is wrong: Linear **does** advertise PRM correctly. The playground reads `mcp.authDiagnostics.resourceMetadataUrl` and finds it `undefined`, so it falls back to a "skipped" message designed for genuinely non-conformant servers.

Note that the rest of the discovery still works — the SDK locates the authorization server, picks DCR, gets to `pending_auth`. The connection is fine. Only the diagnostic field is missing, which makes the demo lie about Linear's conformance and (more importantly) deprives any downstream UI of a real datum about MCP auth discovery.

## Reproducer (HTTP, ground truth)

```bash
curl -sI -X POST \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  https://mcp.linear.app/mcp
```

Response header:

```
www-authenticate: Bearer realm="OAuth", resource_metadata="https://mcp.linear.app/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="Missing or invalid access token"
```

So `resource_metadata` is present in `WWW-Authenticate`, per RFC 9728 + the MCP authorization spec. The bug is purely on the client side.

## Root cause: SDK `streamableHttp.js` GET 401 path

`node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js` has two 401 handlers. They are **inconsistent**.

### POST 401 (lines 312–334) — correct

```js
if (response.status === 401 && this._authProvider) {
    if (this._hasCompletedAuthFlow) { /* … */ }
    const { resourceMetadataUrl, scope } = extractWWWAuthenticateParams(response);
    this._resourceMetadataUrl = resourceMetadataUrl;
    this._scope = scope;
    const result = await auth(this._authProvider, {
        serverUrl: this._url,
        resourceMetadataUrl: this._resourceMetadataUrl,
        scope: this._scope,
        fetchFn: this._fetchWithInit
    });
    /* … */
}
```

Extracts `resource_metadata` and `scope` from the response, stores them on the transport, **passes them into `auth()`**.

### GET 401 (lines 94–99) — buggy

```js
if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 && this._authProvider) {
        // Need to authenticate
        return await this._authThenStart();
    }
    /* … */
}
```

No extraction. `_authThenStart` then calls `auth()` with whatever `this._resourceMetadataUrl` happens to be — and for a fresh transport it's `undefined` (`this._resourceMetadataUrl = undefined` at line 27).

### Downstream effect in `auth()`

`node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth.js:164–217`:

```js
async function authInternal(provider, { serverUrl, authorizationCode, scope, resourceMetadataUrl, fetchFn }) {
    /* … */
    let effectiveResourceMetadataUrl = resourceMetadataUrl;          // ← undefined when called from GET 401
    if (!effectiveResourceMetadataUrl && cachedState?.resourceMetadataUrl) {
        effectiveResourceMetadataUrl = new URL(cachedState.resourceMetadataUrl);
    }
    /* … else branch (full discovery): */
    const serverInfo = await discoverOAuthServerInfo(serverUrl, { resourceMetadataUrl: effectiveResourceMetadataUrl, fetchFn });
    /* …  TODO comment lives here … */
    await provider.saveDiscoveryState?.({
        authorizationServerUrl: String(authorizationServerUrl),
        resourceMetadataUrl: effectiveResourceMetadataUrl?.toString(),   // ← still undefined
        resourceMetadata,
        authorizationServerMetadata: metadata
    });
}
```

The SDK acknowledges the gap inline at `auth.js:208–210`:

```js
// TODO: resourceMetadataUrl is only populated when explicitly provided via options
// or loaded from cached state. The URL derived internally by
// discoverOAuthProtectedResourceMetadata() is not captured back here.
```

So even when `discoverOAuthProtectedResourceMetadata` succeeds in finding PRM (by trying default well-known URLs), the URL it used is discarded — `saveDiscoveryState` only sees `undefined`.

### `use-mcp-react` reads back from saved state

`src/index.ts:1822–1846`:

```ts
authDiagnostics(): McpAuthDiagnostics | null {
    const requirement = this.authRequirement();
    if (!requirement) return null;

    return {
        issuer: requirement.issuer,
        authorizationServerMetadataUrl: this.savedDiscoveryState?.authorizationServerUrl
            ? new URL("/.well-known/oauth-authorization-server", this.savedDiscoveryState.authorizationServerUrl).toString()
            : undefined,
        resourceMetadataUrl: this.savedDiscoveryState?.resourceMetadataUrl,   // ← undefined for Linear
        registrationStrategy: /* … */,
        scopes: requirement.scopes,
    };
}
```

So `mcp.authDiagnostics.resourceMetadataUrl` is `undefined`, and the playground's discovery-timeline logic at `playground/src/main.tsx` (in `buildDiscoverySteps`) falls into its "PRM not advertised" branch.

## Why this is bigger than the playground

`authDiagnostics` is part of the **public API** of `use-mcp-react` (`src/index.ts:283`, `UseMcpResult.authDiagnostics: McpAuthDiagnostics | null`). The README sells it as the supported debug surface for apps and playgrounds:

> `authDiagnostics` is for debug UI and playgrounds. It should expose stable decisions, not internal SDK phases. (`README.md`, around the `McpAuthDiagnostics` definition)

Anyone consuming `authDiagnostics.resourceMetadataUrl` today gets `undefined` for any OAuth server whose first 401 happens on the SSE GET — which is the normal Streamable HTTP flow. The field is effectively dead for the common case. The playground just happens to make the gap visible because we draw a discovery story; a typical consumer would silently miss the URL.

Same fallout for `mcp.serverProfile.auth.protectedResourceMetadataUrl` (`McpAuthProfile.oauth-protected.protectedResourceMetadataUrl?`, declared at `src/index.ts:431`) — same `savedDiscoveryState` source, same `undefined`.

There is also a behavioral consequence on the SDK side: when `resourceMetadataUrl` is `undefined` in `saveDiscoveryState`, the **cached** state can't be used to skip the discovery roundtrip on a later `auth()` call (see `auth.js:173`, the cache hydration check). Each fresh transport will re-derive PRM. Minor for browser sessions, more visible if anyone is persisting discovery state across reloads.

## Prior art in the upstream repo (this is a known bug)

A search of [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) on 2026-05-10 found this is well-trodden ground. The shortest version: the fix exists, but it lives in the v2 alpha package, not in the v1 line we depend on.

### The exact issue and PR (closed without merging)

- **[Issue #1450](https://github.com/modelcontextprotocol/typescript-sdk/issues/1450) — "OAuth Token Exchange Fails with Separate Authorization Servers"** (open since 2026-02-02). Reports the same bug from a different angle: AWS Bedrock MCP + Cognito. Repro is identical in shape — server returns 401 with `resource_metadata` in `WWW-Authenticate`, SDK fails to extract during initial GET, `finishAuth()` falls back to the MCP server URL as the AS origin and constructs the wrong token endpoint. Issue body explicitly names `_startOrAuthSse()` in `streamableHttp.ts` as the missing extraction site.
- **[PR #1472](https://github.com/modelcontextprotocol/typescript-sdk/pull/1472) — "Fix OAuth Resource Metadata Extraction During Initial Connection"** (closed 2026-03-27, never merged). Proposed exactly the 4-line extract I sketched in option A. Closed by @felixweinberger with `"Thanks for this, superseded by #1710. Closing."`

### The "superseding" PR doesn't actually contain the same fix scope

- **[PR #1710](https://github.com/modelcontextprotocol/typescript-sdk/pull/1710) — "feat: introduce minimal AuthProvider interface with OAuthClientProvider adapter"** (merged 2026-03-25). This is a transport-level refactor that introduces a minimal `AuthProvider` (`token()` + `onUnauthorized()`) and adapts `OAuthClientProvider` at the transport boundary. The body discusses 401 handling but does **not** call out the GET-401 PRM-extract bug as something it fixes; its motivation is broader (support non-OAuth token providers). It was merged to the v2 monorepo workspace, not the v1 line. Felix's closure note on #1472 conflates the two — the structural rewrite landed, but the bugfix from #1472 wasn't ported into v1.

### The fix DOES exist in v2 alpha

`@modelcontextprotocol/client@2.0.0-alpha.2` (current `alpha` dist-tag as of writing) has `extractWWWAuthenticateParams(response)` followed by `this._resourceMetadataUrl = resourceMetadataUrl` at multiple call sites in its bundled `index.mjs` (lines 2710-2711, 2812-2813, 3082-3083, 3264-3265 in the published bundle). The structural refactor from #1710 brought the extraction into the new `onUnauthorized` pipeline.

But:
- The v2 package is **alpha**, with new package names (`@modelcontextprotocol/client` / `server` / `express` / `hono` / `node` / `core`) and a redesigned `AuthProvider` interface that is not a drop-in for the `OAuthClientProvider` `use-mcp-react` depends on.
- v1 has shipped four releases since the v2 alpha started (`1.26.0` → `1.29.0`) and none of them include the GET-401 PRM-extract fix.
- The SDK release timeline shows `1.28.0` shipped 2026-03-25 at 11:58 UTC, **then** PR #1710 merged at 13:09 UTC the same day. `1.29.0` (2026-03-30) does include #1710's commits in the monorepo, but the published `@modelcontextprotocol/sdk` v1 surface still has the unfixed file. Confirmed by reading `node_modules/.../streamableHttp.js:94-99` after a clean install of `1.29.0`.

### Adjacent unresolved issues in the same area

- **[PR #1951](https://github.com/modelcontextprotocol/typescript-sdk/pull/1951) — "fix(client): preserve resource_metadata URL across non-Bearer WWW-Authenticate challenges"** (open since 2026-04-23). A `Negotiate` 401 after a Bearer 401 clobbers the stored `_resourceMetadataUrl`. Different bug, same family (the SDK's handling of WWW-Authenticate is brittle and incremental). Lives in the v2 codebase.
- **[Issue #1234](https://github.com/modelcontextprotocol/typescript-sdk/issues/1234) — "OAuth: Resource metadata URL lost after redirect, causing token exchange to fail"** (open since 2025-12-04). PRM URL is lost across browser navigation away/back. Different code path (state persistence vs. extraction) but symptomatically adjacent. Multiple closed PRs targeted it (#1350, #1816); browser-redirect persistence is still an open story.
- **[Issue #860](https://github.com/modelcontextprotocol/typescript-sdk/issues/860) — "Inconsistent `resource_metadata` handling between C# and TypeScript MCP SDKs"** (closed Aug 2025). Older issue documenting SDK-to-SDK conformance drift in this exact area. Closed but not necessarily resolved.

### Precedent for the exact fix shape

- **[PR #675](https://github.com/modelcontextprotocol/typescript-sdk/pull/675) — "fix(client/sse): extract protected resource from eventsource 401"** (merged 2025-06-20). The author hit the same bug, but in the legacy SSE transport. The merged fix is the SSE-side analogue of what #1472 proposed for Streamable HTTP. So one transport got fixed in mid-2025, and the matching Streamable HTTP fix has been stalled for almost a year despite an open issue and a closed PR.

### What this means for `use-mcp-react`

1. **An upstream-only fix for v1 is unlikely.** The maintainer view (per the #1472 close) is that the v2 refactor is the resolution. v1 is in maintenance-for-bugfixes mode, but the specific class of bugs the v2 refactor "supersedes" don't appear to be backportable in practice — PR #1472 sat for 7 weeks before being closed, and 6+ weeks have passed since then with no follow-up v1 patch.
2. **Migrating to v2 is not a near-term option.** It's alpha, the package name changes, the auth provider interface changes (`OAuthClientProvider` → `AuthProvider`/`onUnauthorized`), and `use-mcp-react`'s entire design rests on the v1 `OAuthClientProvider` shape (`src/index.ts:1572` — `PendingOAuthProvider` implements that interface).
3. **The bug class is recurring.** #675 (SSE), #1234 (redirect persistence), #1450 (initial GET extract), #1951 (Negotiate overwrites Bearer URL) — all separate bugs, all in the same WWW-Authenticate / resource-metadata code area. Treating any of them as "the SDK will fix it" is optimistic on a multi-quarter timescale for v1.

## Two fixes, not mutually exclusive

### A. Upstream SDK fix (correct home for the fix)

Mirror the POST path in the GET path. In `streamableHttp.js`, replace lines 94–99 with:

```js
if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 && this._authProvider) {
        const { resourceMetadataUrl, scope } = extractWWWAuthenticateParams(response);
        this._resourceMetadataUrl = resourceMetadataUrl;
        this._scope = scope;
        return await this._authThenStart();
    }
    /* … */
}
```

Two lines of real change. Fixes the root cause for every MCP TS SDK consumer, not just this one. Filed against [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk/issues).

The `auth.js` TODO is a separate, deeper fix (have `discoverOAuthProtectedResourceMetadata` return the URL it actually used, then thread it through `saveDiscoveryState`). Worth doing for completeness but the GET-401 fix is the practical win — once the URL is extracted upstream of `auth()`, the existing param-passing already lands it in `saveDiscoveryState`.

**Pros:** real fix, helps all consumers, lets `use-mcp-react`'s `authDiagnostics` and `serverProfile` stay simple pass-throughs.
**Cons:** waits on an SDK release + a `@modelcontextprotocol/sdk` bump here. Possibly weeks. Anyone on the current SDK version sees the bug until then.

### B. Workaround in `use-mcp-react`

`use-mcp-react` already parses `resource_metadata` itself, independently of the SDK, for the bearer-vs-OAuth classification path (`src/index.ts:1652–1655`):

```ts
const resourceMetadataUrl = authenticateHeader
    ? readWwwAuthenticateParameter(authenticateHeader, "resource_metadata")
    : undefined;
```

There's also a place in `inferManualOAuthClientRequirement` (`src/index.ts:856–865`) that explicitly assembles `authDiagnostics.resourceMetadataUrl` from the same parsed header — proof that this is a known-good source.

The fix: have the OAuth-path fetch wrapper capture two independent signals and store them on the provider:

1. the parsed `resource_metadata` URL when `WWW-Authenticate` is readable; and
2. the actual URL of any successful `/.well-known/oauth-protected-resource...` fetch the SDK performs during discovery.

The second signal matters in browsers. Linear returns `WWW-Authenticate`, but does not expose it through CORS, so `response.headers.get("www-authenticate")` is `null` even though `curl` can see the header. The SDK still discovers PRM by fetching the default well-known URL, then loses the URL because of the `auth.js` TODO. Recording the successful PRM fetch URL closes that gap.

Then in `authDiagnostics()` (`src/index.ts:1836`) fall back to the stored values when `savedDiscoveryState.resourceMetadataUrl` is missing:

```ts
resourceMetadataUrl:
    this.savedDiscoveryState?.resourceMetadataUrl ??
    this.discoveredResourceMetadataUrl ??
    this.parsedResourceMetadataUrlFromChallenge,
```

The same fallback should apply when building `McpAuthProfile.protectedResourceMetadataUrl` (look near `src/index.ts:1386` where `serverProfile` is assembled — needs a separate read).

**Pros:** ships independently of the SDK; closes the diagnostic gap for users of the library today; correct semantically (we already know the URL — we parsed it).
**Cons:** keeps a duplicate of state the SDK should be giving us. Easy to forget to remove once the SDK is fixed. Doesn't fix the cache-skip behavior inside the SDK itself (that needs the upstream fix).

### C. Recommendation (revised after prior-art search)

The shape of the recommendation changes once you know PR #1472 already existed, was closed without merging into v1, and the v2 fix is in alpha and not migration-ready. The upstream path is **weaker** than it looks.

**Land B.** The workaround in `use-mcp-react` is the realistic path. It is:
- Contained (~5 lines of provider state plumbing + 1-line fallback in `authDiagnostics()` + 1 line in the `serverProfile` builder).
- Honest — we *did* parse the URL, we *can* surface it, and we already do for the manual-OAuth-client requirement (`src/index.ts:856–865`), which is what `authDiagnostics.resourceMetadataUrl` should mean.
- Free of the "wait for a release we don't control" trap that has stalled #1472 for 3+ months.

Whether to also file/revive upstream is a judgment call:

- **Worth doing if:** the goal is good MCP citizenship. The simplest path is a comment on the still-open Issue #1450 with a Linear repro (extends the AWS Bedrock evidence to a major browser-facing MCP), pointing at `streamableHttp.js:94-99` as the exact site, and explicitly asking whether the SDK team will land the #1472 patch in the v1 line. A new PR mirroring the SSE fix (#675) at the Streamable HTTP GET 401 path would be 4 lines plus a test. Total time investment is short.
- **Probably not worth doing if:** the priority is shipping `use-mcp-react`. The signal from Felix's #1472 closure is that v1 fixes in this area are deferred to v2; reopening that conversation is a slow process. The workaround makes the playground correct today, and there's no behavioral wedge that requires the SDK fix specifically — only the diagnostic value.

The argument for filing anyway is leverage on the *related* bugs: #1951, #1234, #1450 all live in the same brittle WWW-Authenticate handling. A clean repro that documents the GET-401 site by name (which Issue #1450 already does well; we'd just be adding "+1, here's another server hitting it") raises the collective signal without much cost.

**Recommendation: land B, comment on #1450 with the Linear repro and a link to this doc, don't block on upstream.**

When v2 stabilises and `use-mcp-react` migrates to `@modelcontextprotocol/client@2.x`, revisit the workaround. The v2 transport already does the extraction (verified in the alpha bundle); on migration, the workaround can be removed and we should be reading the URL from the SDK's discovery state cleanly.

If forced to pick one: B alone is acceptable indefinitely — diagnostics are advisory and the library is the right place to enforce "we tell you what we found."

## Files and lines a fix touches

**Upstream SDK (A):**
- `node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js:94-99` — add the extract, mirror POST path.
- `node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth.js:208-217` — optional deeper TODO: capture derived URL from `discoverOAuthProtectedResourceMetadata`.

**Workaround (B):**
- `src/index.ts:1780` (around) — add fields on `PendingOAuthProvider` for the parsed challenge PRM URL and the successfully fetched PRM URL.
- The custom fetch wrapper passed to `StreamableHTTPClientTransport` — pipe readable `WWW-Authenticate` headers and successful `/.well-known/oauth-protected-resource...` request URLs into the provider.
- `src/index.ts:1836` — fall back to the stored URL in `authDiagnostics()`.
- `src/index.ts` near `1386` (where `McpServerProfile.auth.protectedResourceMetadataUrl` is built) — same fallback.

**Playground copy (cosmetic, optional):**
- `playground/src/main.tsx`, `buildDiscoverySteps` — once the data is fixed, the existing "Server didn't advertise Protected Resource Metadata" branch becomes correct for genuinely non-conformant servers and stops firing for Linear. No code change needed once B is in.

## Tests

`tests/browser/useMcp.test.tsx` uses MSW + real SDK + real transport. A regression test for B would:

1. Stand up an MSW MCP server that returns 401 on the initial GET with `WWW-Authenticate: Bearer realm="…", resource_metadata="https://test/.well-known/oauth-protected-resource"`.
2. Connect via `useMcp`.
3. Assert `mcp.authDiagnostics?.resourceMetadataUrl === "https://test/.well-known/oauth-protected-resource"` (not `undefined`).

This test will also serve as a canary: once the upstream SDK fix ships and the workaround is removed, the test should still pass via the SDK's own path. If it fails after the workaround is removed, the upstream fix isn't actually in the bumped version.

## Out-of-scope but worth flagging

- The same `extractWWWAuthenticateParams` extraction is also missing from the **SSE GET 401** inside `_startOrAuthSse` (`streamableHttp.js:96-99`) — that's the exact line cluster the playground hits for Linear. The fix above covers it; mentioning it explicitly so the upstream PR description names both call sites if there are more than one (there's only one in 1.29.0, but the SDK churns).
- `discoverOAuthProtectedResourceMetadata` itself (`auth.js`, around line 658) silently swallows 404 from the well-known URL and returns `undefined`. That's correct for "server doesn't advertise PRM" servers. It's not the bug being discussed here — the bug is that even when PRM **is** found, the URL used to find it isn't propagated back.

## TL;DR for the specialist

- Linear's MCP server correctly advertises `resource_metadata` in `WWW-Authenticate`. Verified by curl.
- The MCP TS SDK v1 fails to extract that URL when the initial 401 is on the GET (`streamableHttp.js:94-99`), so it never reaches `saveDiscoveryState`.
- `use-mcp-react.authDiagnostics.resourceMetadataUrl` reads from saved state and is `undefined` for the common case.
- The playground correctly reflects what the library tells it, but the library is reading a stale `undefined`.
- **The fix exists in v2 alpha** (`@modelcontextprotocol/client@2.0.0-alpha.2`) — the v2 transport rewrite (PR #1710) extracts the URL on every 401 path.
- **The v1 fix does not exist.** PR #1472 proposed it, was closed as "superseded by #1710" without being ported to v1, and v1 has shipped four releases since with no GET-401 fix. Issue #1450 documenting the bug remains open.
- The SSE transport got the same fix back in 2025 (PR #675 merged). Streamable HTTP didn't.
- **Recommendation:** land the local workaround in `use-mcp-react`, comment on Issue #1450 with the Linear repro for collective leverage, don't block on the SDK.
