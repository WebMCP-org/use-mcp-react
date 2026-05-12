# Maintainable TypeScript

Use the installed `maintainable-typescript` skill before implementation or review when it is available in the local Codex/agent environment.

Project-specific rules:

- Keep browser-facing React behavior in Vitest Browser Mode tests, not jsdom.
- Mock only external HTTP boundaries with MSW.
- Keep framework-agnostic MCP/OAuth behavior separate from React hook glue.
- Prefer observable behavior assertions over private implementation assertions.
