# Privacy Policy

Last updated: 2026-05-12

`use-mcp-react` is an open-source client-side React library. The library itself does not operate a hosted service, does not collect analytics, and does not transmit data to the package maintainers.

## Runtime Data

Applications that use this library choose which MCP servers to connect to. At runtime, the library may send MCP requests, OAuth discovery requests, OAuth authorization data, and bearer tokens to the MCP server or authorization server configured by the consuming application.

The library does not send this data to any maintainer-controlled endpoint.

## Browser Storage

By default, the hook may store hook-owned OAuth state in browser storage for the configured MCP server, including client registration data, OAuth tokens, discovery metadata, pending authorization state, and PKCE verifier state.

Bearer tokens passed through `bearerToken` are app-owned and are not persisted by this library.

Applications can disable hook-owned storage by passing `storage: false`.

## Development And Test Tooling

This repository uses development tools such as package managers, browser test runners, and CI services. Those tools may have their own telemetry or logs when contributors run them or when maintainers run CI. That behavior is outside the runtime behavior of the published library.

## Consuming Applications

Applications that integrate this library are responsible for their own privacy policy, including disclosures for MCP servers, OAuth providers, analytics, logs, hosting providers, and any data they process or store.

## Contact

Report security-sensitive privacy issues through the process in `SECURITY.md`.
