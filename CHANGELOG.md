# use-mcp-react

## 0.4.2

### Patch Changes

- Route hook-owned MCP OAuth discovery, dynamic registration, token exchange, and refresh requests through `transportProxy` while keeping authorization navigation direct.
- Prevent proxied OAuth metadata responses from being reused across different `x-mcp-target-url` upstreams.
- Recover from stale persisted OAuth discovery state that points at a `.well-known` metadata endpoint instead of an authorization server.
- Update the `ws` dependency lockfile entry from 8.18.0 to 8.20.1.

## 0.4.1

### Patch Changes

- Allow `transportProxy` to point at absolute cross-origin gateway URLs for browser-hosted MCP transport proxies.

## 0.4.0

### Minor Changes

- 1c81562: Add the optional `use-mcp-react/apps` subpath with MCP Apps capability advertisement, authorized `ui://` resource loading, iframe host rendering, and upstream app bridge lifecycle handling.

## 0.3.0

### Minor Changes

- 23cc7d8: Add SDK client capability/options pass-through, live catalog refresh for list-changed notifications, and structured operation wrappers for tools, resources, prompts, and completions.

## 0.2.0

### Minor Changes

- cc19602: Add automatic WebExtension OAuth handling for Chrome and Firefox-style extension identity APIs.

## 0.1.1

### Patch Changes

- 546ce7c: Fix npm README image rendering.

## 0.1.0

### Minor Changes

- 322a4d0: Initial public release of the React hook library for connecting browser apps to remote MCP servers.
