# Release Process

This package releases from the canonical repository:

`WebMCP-org/use-mcp-react`

## Required Repository Settings

- Branch protection on `main`.
- Required checks for CI, package integrity, CodeQL, Dependency Review, and React compatibility stable lanes.
- Required CODEOWNER review for governance, package, CI, and release files.
- GitHub private vulnerability reporting enabled.
- Secret scanning and push protection enabled.
- Dependabot security updates enabled.
- GitHub Actions repository variable `RELEASE_REPOSITORY` set to `WebMCP-org/use-mcp-react`.
- Protected GitHub Environment named `npm-publish`.

## npm Trusted Publishing

Configure npm trusted publishing for:

- Owner/repository: `WebMCP-org/use-mcp-react`
- Workflow filename: `.github/workflows/release.yml`
- Environment: `npm-publish`

The release workflow uses GitHub OIDC and npm provenance. Do not add an `NPM_TOKEN` for normal public package publishing.

## Normal Release

1. Add a Changeset for every user-visible change:

   ```bash
   vp exec changeset
   ```

2. Open a pull request and wait for CI.
3. Merge to `main`.
4. The release workflow creates or updates the Changesets version PR.
5. Review the version PR, including `CHANGELOG.md`, `package.json`, and lockfile changes.
6. Merge the version PR to publish from the protected `npm-publish` environment.

## Local Verification

Run the release gates before merging release-sensitive changes:

```bash
vp install
vp check
vp test
vp run validate:package
vp run verify:packed-consumer
```

`validate:package` builds, checks the packed file list, runs `publint`, and runs `@arethetypeswrong/cli`.

## Failed Publish Recovery

- If package validation fails, fix the package shape and rerun CI. Do not publish manually from a dirty checkout.
- If npm trusted publishing fails, verify the npm trusted publisher owner, repository, workflow filename, and environment.
- If the package version was already published, add a new Changeset and publish a follow-up version.
