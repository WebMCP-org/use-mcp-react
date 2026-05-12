# CI Todo

The CI configuration is ready from the repository side. These items still need to be completed in GitHub/npm for the SOC2 org.

## GitHub Org/Repo Settings

- Enable GitHub Actions for the repository.
- Set the repository variable `RELEASE_REPOSITORY` to the real `owner/repo` value.
- Replace placeholder CODEOWNERS entries with the real GitHub users or teams.
- Enable branch protection or rulesets for `main`.
- Require the blocking checks before merge:
  - `Verify / Node 22`
  - `Verify / Node 24`
  - `Package integrity`
  - `React 18`
  - `React 19`
  - `Dependency Review`
  - `CodeQL`
  - `Scorecard`

## npm Release Setup

- Create the package on npm, or confirm the package name is available.
- Configure npm trusted publishing for the GitHub Actions release workflow.
- Confirm the package access policy is correct for the org.
- Confirm who can approve/merge Changesets release PRs.

## Security/SOC2 Settings

- Enable GitHub Advanced Security if required by the org.
- Enable code scanning alerts.
- Confirm CodeQL SARIF uploads are accepted for the repository.
- Confirm OpenSSF Scorecard SARIF uploads are accepted for the repository.
- Confirm Dependabot alerts and security updates are enabled.
- Confirm dependency review is required on pull requests.

## Local Notes

- `act` validation passed for the workflows that can reasonably run locally.
- The local workspace used for validation was not a git checkout, so `act` warned about missing git ref/revision metadata.
- The installed local `act` version was `0.2.84`; upgrade to `0.2.86` or newer before relying on it for SOC2 workflow validation.
