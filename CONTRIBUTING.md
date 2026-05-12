# Contributing

Thanks for helping improve `use-mcp-react`.

## Development

Install dependencies after pulling changes:

```bash
vp install
```

Run the standard checks before opening a pull request:

```bash
vp check
vp test
vp run validate:package
```

This repo uses Vitest Browser Mode with Playwright and MSW for browser/OAuth behavior. Do not add jsdom tests for those paths.

## Implementation Notes

Before changing MCP, OAuth, React hook, or browser-test behavior, read:

- `docs/reference/README.md`
- `docs/prompts/tdd-implementation.md`
- `AGENTS.md`

Keep `@modelcontextprotocol/sdk` as the runtime MCP implementation. Mock external HTTP boundaries with MSW; do not mock SDK internals or this library's own modules.

## Releases

User-visible changes should include a Changeset:

```bash
vp exec changeset
```

The release workflow validates the package, versions through Changesets, and publishes through npm trusted publishing when configured for the canonical repository.
