<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.

<!--VITE PLUS END-->

## Project-Specific Agent Setup

- Use Vercel Labs `opensrc` for dependency and prior-art source: see `docs/agents/opensrc.md`.
- Use Miguel's `maintainable-typescript` skill before implementation or review: see `docs/agents/maintainable-typescript.md`.
- Read `docs/reference/README.md` before implementing MCP, OAuth, React hook, or browser-test behavior.
- This repo intentionally uses Vitest Browser Mode with Playwright and MSW. Do not add jsdom tests for browser/OAuth behavior.
- Do not write the hook implementation until the reference material and test harness have been reviewed.

<!-- opensrc:start -->

## Source Code Reference

Source code for dependencies is cached at `~/.opensrc/` for deeper understanding of implementation details.

See `~/.opensrc/sources.json` and `docs/reference/opensrc-sources.md` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Source Code

To cache package or repository source without doing anything else, use:

```bash
vp exec opensrc fetch <package>
vp exec opensrc fetch pypi:<package> crates:<package> github:<owner>/<repo>
```

### Reading Source Code

Use `opensrc path` inside other commands to search, read, or explore source. It fetches on cache miss:

```bash
rg "pattern" "$(vp exec opensrc path <package>)"
sed -n '1,220p' "$(vp exec opensrc path <package>)/path/to/file.ts"
find "$(vp exec opensrc path github:<owner>/<repo>)" -name "*.ts"
```

<!-- opensrc:end -->
