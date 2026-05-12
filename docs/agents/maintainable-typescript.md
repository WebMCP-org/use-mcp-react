# Maintainable TypeScript

This repo should follow Miguel's `maintainable-typescript` skill for implementation and review.

Use the skill before writing production code, especially for:

- frontend React state and hook design
- high-risk auth, storage, and transport logic
- test strategy and test review
- package boundary decisions

Key rules for this project:

- Build on mature dependencies: `@modelcontextprotocol/sdk`, `@ai-sdk/mcp` where useful, MSW, Vitest Browser Mode, and Playwright.
- Put browser-facing React behavior in real browser tests, not jsdom.
- Mock only external HTTP boundaries. For MCP/OAuth, that means MSW handlers for MCP server, authorization metadata, protected resource metadata, registration, authorization, and token endpoints.
- Assert observable behavior: rendered state, HTTP calls, storage state, popup/redirect behavior, and SDK-visible client state.
- Keep framework-agnostic MCP/OAuth logic separate from React hook glue.

Local skill source:

`/Users/alexmnahas/.agents/skills/maintainable-typescript/SKILL.md`
