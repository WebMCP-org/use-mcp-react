# Open Source Checklist

Complete this before making the repository public.

- Confirm `WebMCP-org/use-mcp-react` is the canonical repository.
- Enable private vulnerability reporting.
- Enable secret scanning and push protection.
- Enable Dependabot security updates.
- Protect `main` with required CI, package, CodeQL, Dependency Review, and stable React compatibility checks.
- Require CODEOWNER review for `.github/**`, `.changeset/**`, package manifests, lockfiles, release docs, and security policy docs.
- Configure the `npm-publish` GitHub Environment.
- Configure npm trusted publishing for `.github/workflows/release.yml` and the `npm-publish` environment.
- Confirm `npm pack --dry-run --ignore-scripts` contains only the documented release files.
- Remove or intentionally document any root-level screenshots, generated artifacts, and local-only notes.
