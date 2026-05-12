# CI Research for `use-mcp-react`

Date: 2026-05-10

This note captures current CI patterns from maintained React hook and npm package repositories, then translates them into a SOC2-oriented setup for this library.

## Repositories Reviewed

### Zustand

Source: https://github.com/pmndrs/zustand

Strong patterns observed:

- Workflow actions are pinned to full commit SHAs with version comments.
- React compatibility is tested across React 18, React 19, canary, and experimental releases.
- TypeScript compatibility is tested across many TypeScript versions.
- Publish workflow uses `permissions: id-token: write` and `contents: read`, then runs `npm publish` without an npm token, matching npm trusted publishing.
- Dependabot exists for `npm` and `github-actions`, with update noise reduced by ignoring non-major updates.

Takeaway for us:

- Add a React compatibility matrix once the peer range is finalized.
- Pin third-party actions to SHAs in the SOC2 org.
- Publish with trusted publishing, not `NPM_TOKEN`.

### SWR

Source: https://github.com/vercel/swr

Strong patterns observed:

- CI runs build, all checks, `npm pack`, `@arethetypeswrong/cli`, tests, build tests, and type tests.
- Separate E2E job runs in a Playwright container.
- Separate React legacy and React canary workflows validate compatibility.
- Package manifest has broad React peer support: React 16.11 through 19.
- Uses `exports` with `types`, `import`, `require`, and `react-server` conditions.

Weakness for SOC2:

- Release still uses an npm token plus `--provenance`. For this org, prefer npm trusted publishing and then disallow traditional automation tokens.

Takeaway for us:

- Add package-level checks beyond unit tests: pack, type entrypoint validation, and build-consumer tests.
- Add a scheduled React canary job only after the base CI is stable.

### React Hook Form

Source: https://github.com/react-hook-form/react-hook-form

Strong patterns observed:

- PR workflow runs lint, typecheck, tests, type tests, and bundle watch.
- API Extractor is a separate PR workflow to lock public API surface.
- CodeQL is enabled on push, PR, and schedule.
- Bundle size is enforced through compressed-size/bundlewatch.
- Post-build scripts assert ESM and CJS export correctness.
- Peer dependency range supports React 16.8 through 19.

Takeaway for us:

- If this hook exposes a small public API, either add API Extractor or a lighter declaration/API snapshot check.
- Add a bundle size threshold once there is a real exported surface.

### TanStack Query

Source: https://github.com/TanStack/query

Strong patterns observed:

- PR workflow uses affected-package checks, build, type tests, lint, docs checks, dead-code checks, and size limits.
- Publishes PR preview packages with `pkg-pr-new`.
- Runs a provenance check on PRs.
- Release flow uses Changesets and grants `id-token: write`.
- Renovate groups non-major updates, requires approval for major updates, dedupes pnpm, and ignores peer dependency updates.

SOC2 note:

- Some actions are referenced by tag or branch through org-level reusable actions. In a SOC2 org, enforce SHA pinning or restrict allowed reusable workflow/action sources.

Takeaway for us:

- Changesets is a strong release fit for a library.
- PR preview packages are useful later, but not required for the first CI pass.

### React Testing Library

Source: https://github.com/testing-library/react-testing-library

Strong patterns observed:

- CI matrix tests Node 18 and 24 with React 18, latest, canary, and experimental.
- Canary and experimental React jobs are allowed to fail while stable/latest remain blocking.
- Workflows use explicit permissions.
- Release workflow uses OIDC permission for npm trusted publishing/provenance.
- React peer deps support React 18 and 19.

Takeaway for us:

- For our package, make stable peer versions blocking and canary/experimental non-blocking.
- Use `renderHook` from `@testing-library/react`; it is now part of React Testing Library and is documented as useful mainly for libraries publishing hooks.

### Vite

Source: https://github.com/vitejs/vite

Strong patterns observed:

- Top-level workflow uses `permissions: {}`.
- CI matrix covers Node 20, 22, and 24 plus Linux, macOS, and Windows.
- Third-party actions are pinned to commit SHAs.
- CI includes build, unit tests, serve tests, build tests, lint, format check, typecheck, docs tests, and actionlint.
- Publish workflow is restricted to the canonical repository, uses a GitHub Environment named `Release`, grants only `contents: read` and `id-token: write`, and disables package manager cache in the release job to reduce cache-poisoning risk.
- Release job disables dependency install scripts before install.
- Preview releases use `pkg-pr-new`.
- Renovate pins non-GitHub action digests and groups non-major updates.

Takeaway for us:

- This is the closest template for SOC2-grade Actions posture.
- Use `permissions: {}` by default, explicit job permissions, protected publish environment, no cache in publish job, and actionlint.

### MUI

Source: https://github.com/mui/material-ui

Strong patterns observed:

- Workflows use `permissions: {}` by default.
- Third-party actions are SHA pinned.
- CI runs across Linux, macOS, and Windows for dev/build workflows.
- CodeQL exists as a dedicated workflow.
- OpenSSF Scorecard runs on a schedule and uploads SARIF to code scanning.
- Publish workflow is manual, requires a target SHA, supports dry run, uses protected npm publish environments, and grants `id-token: write`.

Takeaway for us:

- Add OpenSSF Scorecard once the org has code scanning configured.
- Make release workflow manual or Changesets-driven, but always require a protected environment and an exact source ref.

### Radix Primitives

Source: https://github.com/radix-ui/primitives

Strong patterns observed:

- Simple PR build workflow runs lint, build, and tests.
- Snapshot and stable release workflows are split.
- Stable release uses Changesets.

Weakness for SOC2:

- Release workflows use `NPM_TOKEN`.
- Actions are not SHA pinned.

Takeaway for us:

- Useful release shape, but harden before copying.

## Recommended CI For This Repo

### 1. Pull Request CI

File: `.github/workflows/ci.yml`

Run on:

- `pull_request`
- `merge_group`
- `push` to `main`

Jobs:

- `check`: `vp check`
- `test`: `vp test`
- `build`: `vp run build` or `vp pack`
- `package`: build first, then run package validation
- `actionlint`: validate workflow files

Node matrix:

- Blocking: Node 22 and 24.
- Do not include Node 20 by default after 2026-04-30 because Node 20 is EOL.
- Add Node 20 only if the package explicitly promises runtime/tooling support for EOL Node.

Policy:

- Use `permissions: {}` at workflow top.
- Grant `contents: read` only where checkout is needed.
- Use `concurrency` to cancel stale PR runs.
- Use `vp install` or the repo's Vite+ install path, not raw package manager commands.

### 2. React Compatibility CI

File: `.github/workflows/react-compat.yml`

Run on:

- `pull_request`
- nightly schedule, once tests are stable

Matrix:

- React 18 latest, if supported
- React 19 latest
- React canary
- React experimental, optional

Policy:

- Stable supported React versions are blocking.
- Canary and experimental are non-blocking signal jobs.
- Keep peer dependency ranges honest. The current `package.json` only supports `react: ^19.2.6`, which is probably too narrow for a general hook library.

### 3. Package Integrity CI

Add scripts or Vite+ tasks for:

- `npm pack --json` or equivalent tarball inspection.
- `publint` after build.
- `@arethetypeswrong/cli --pack .` or equivalent after build.
- Temporary consumer install test:
  - pack the library
  - install it into a temp React app
  - test ESM import
  - test TypeScript import
  - ensure React and React DOM are peer deps, not bundled runtime deps

Why:

- Hook libraries fail in consumers most often through peer dependency, `exports`, ESM/CJS, and declaration-file mistakes, not just unit test failures.

### 4. Security Workflows

Files:

- `.github/workflows/dependency-review.yml`
- `.github/workflows/codeql.yml`
- `.github/workflows/scorecards.yml`

Recommended gates:

- Dependency Review Action on PRs that change manifests or lockfiles.
- CodeQL for JavaScript/TypeScript on PR, push, and weekly schedule.
- OpenSSF Scorecard weekly, upload SARIF to code scanning.
- Secret scanning and push protection enabled at the org level.
- Branch protection requiring CI, dependency review, and CodeQL checks.

### 5. Dependency Automation

Use either Dependabot or Renovate. For GitHub-native SOC2 posture, start with Dependabot unless the org already standardizes on Renovate.

File: `.github/dependabot.yml`

Ecosystems:

- `npm` in `/`
- `github-actions` in `/`

Recommended config:

- Weekly scheduled version updates.
- Immediate security updates.
- Group non-major npm updates.
- Group GitHub Actions updates.
- Add cooldown for version updates to avoid same-day supply-chain surprises.
- Do not cooldown security updates.
- Limit open PRs.

If using Renovate instead:

- Use `config:recommended`.
- Group non-major updates.
- Require approval for majors.
- Pin GitHub Action digests or enforce SHA pinning through org policy.
- Disable peer dependency auto-updates unless intentionally reviewed.

### 6. Release Workflow

File: `.github/workflows/release.yml`

Recommended flow:

- Use Changesets.
- Merge feature PRs with changesets.
- On `main`, Changesets opens a version PR.
- Merging the version PR publishes to npm.
- Publish job uses npm trusted publishing with GitHub OIDC.
- Configure npm trusted publisher for the exact repo, workflow filename, and GitHub Environment.
- Use a protected GitHub Environment named `npm-publish`.
- Require reviewer approval for the environment.
- Use `permissions: contents: read`, `id-token: write`.
- Do not use `NPM_TOKEN`.
- After verified trusted publishing, set npm package publishing access to require 2FA and disallow tokens.

Release job hardening:

- Restrict to the canonical repository.
- Use GitHub-hosted runners for trusted publishing.
- Disable package manager cache in publish jobs.
- Prefer frozen installs.
- Run `vp check`, `vp test`, and `vp pack` before publish or require those checks from the same commit.
- Validate tarball contents before publishing.

### 7. CODEOWNERS And Branch Protection

Add `.github/CODEOWNERS` requiring review for:

- `.github/**`
- `package.json`
- lockfile
- `vite.config.ts`
- `.changeset/**`
- release scripts
- package build scripts

Branch protection:

- Require PR.
- Require CODEOWNER review.
- Require signed commits if org policy uses them.
- Require status checks.
- Require linear history if the org prefers clean audit trails.
- Require merge queue if multiple contributors are active.
- Restrict who can push tags that trigger publishing.

### 8. Avoid These Patterns

- Do not use `pull_request_target` to build or test PR code.
- Do not use long-lived `NPM_TOKEN` for normal public package publishing.
- Do not let publish workflows run on arbitrary branches.
- Do not grant workflow-wide `contents: write`.
- Do not put secrets in PR workflows.
- Do not rely only on `npm audit`; malicious packages and package-shape regressions need other controls.
- Do not publish without inspecting the packed artifact.
- Do not cache package-manager state in release jobs unless there is a reviewed reason.

## Initial File Set To Add

- `.github/workflows/ci.yml`
- `.github/workflows/react-compat.yml`
- `.github/workflows/dependency-review.yml`
- `.github/workflows/codeql.yml`
- `.github/workflows/scorecards.yml`
- `.github/workflows/release.yml`
- `.github/dependabot.yml`
- `.github/CODEOWNERS`
- `.changeset/config.json`
- `SECURITY.md`

## Sources

- npm Trusted Publishers: https://docs.npmjs.com/trusted-publishers/
- npm provenance: https://docs.npmjs.com/generating-provenance-statements/
- GitHub Actions secure use: https://docs.github.com/en/actions/reference/security/secure-use
- GitHub `GITHUB_TOKEN` permissions: https://docs.github.com/en/actions/tutorials/authenticate-with-github_token
- GitHub dependency review: https://docs.github.com/en/code-security/concepts/supply-chain-security/about-dependency-review
- GitHub CodeQL: https://docs.github.com/en/code-security/concepts/code-scanning/codeql/about-code-scanning-with-codeql
- GitHub artifact attestations: https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations
- GitHub workflow events and `pull_request_target` warning: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- Dependabot options: https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference
- OpenSSF Scorecard Action: https://github.com/ossf/scorecard-action
- Node.js release schedule: https://github.com/nodejs/release#release-schedule
- React Testing Library `renderHook`: https://testing-library.com/docs/react-testing-library/api/#renderhook
- publint: https://publint.dev/docs/
- `@arethetypeswrong/cli`: https://www.npmjs.com/package/@arethetypeswrong/cli
