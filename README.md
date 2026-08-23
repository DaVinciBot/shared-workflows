# Shared Workflows

Reusable GitHub Actions workflows for the DaVinciBot SvelteKit applications.

## Workflows

Application repositories should call reusable workflows by release tag:

```yaml
jobs:
  ci:
    uses: DaVinciBot/shared-workflows/.github/workflows/ci.yml@v6.2.0
```

Available workflows:

- `.github/workflows/ci.yml`: shared quality gates. By default runs `pnpm check`,
  `pnpm lint`, `pnpm test:unit`, `pnpm build` at the repository root. Inputs:
  `pnpm_version`, `node_version_file`, `working_directory` (directory the gate commands run in — dependencies are still
  installed from the repo root so pnpm workspaces link correctly), `commands` (JSON array of `{name, command}` to run
  only the scripts a package defines; overrides the default gates). The
  `working_directory`/`commands` inputs let a monorepo call the workflow once per package
  (see [DaVinciBot/packages](https://github.com/DaVinciBot/packages)).
- `.github/workflows/container.yml`: build and publish application containers. Nothing is published before the gates
  pass: `hadolint` runs on the Dockerfile, the image is then built with `load` (never `push`) and inspected locally by
  `dive --ci`, `dockle` and Trivy — same path on a pull request and on a branch push. Only then, and only when `push` is
  true, a second build publishes to GHCR: every layer is served from the cache of the audited build, so the published
  image is the one that was inspected, and it carries the provenance and SBOM attestations the local build cannot
  export. Inputs pin each tool and point at its config: `hadolint_version`/`hadolint_config`,
  `dive_version`/`dive_config`, `dockle_version`/`dockle_exit_level`, `trivy_severity`.
- `.github/workflows/deploy.yml`: deploy applications through Dokploy.
- `.github/workflows/e2e.yml`: run Playwright end-to-end tests.
- `.github/workflows/security-scan.yml`: run security scans — dependency review, Trivy on the filesystem, and `checkov`
  on the Dockerfile and the workflows. Inputs: `checkov_version`, `checkov_config`.
- `.github/workflows/publish-npm.yml`: publish an npm package to GitHub Packages (npm.pkg.github.com). Idempotent (skips
  already-published versions). Inputs:
  `package_dir`, `build_command`, `pnpm_version`, `node_version_file`. No npm provenance: attestation is npmjs-only.
- `.github/workflows/release-changesets.yml`: open and keep up to date the "Version Packages" PR from the pending
  changesets. It does not publish anything — merging that PR is what triggers `publish-npm.yml` in the calling
  repository. Inputs: `pnpm_version`, `node_version_file`, `version_script`, `pr_title`, `commit_message`. The caller
  must grant `contents: write` and `pull-requests: write`, since a reusable workflow can only narrow the caller's token.

Each application repository carries the container tooling configs at its root. They are read from the checkout, so a
repository tunes its own thresholds without touching this repository:

| File             | Tool     | Holds                                                  |
|------------------|----------|--------------------------------------------------------|
| `.hadolint.yaml` | hadolint | failure threshold, ignored rules, trusted registries   |
| `.dive-ci`       | dive     | efficiency, wasted bytes and wasted-percent thresholds |
| `.dockleignore`  | dockle   | waived CIS checkpoints                                 |
| `.checkov.yaml`  | checkov  | frameworks, skipped paths, waived checks               |

Required repository or organization setup:

- Allow application repositories to use reusable workflows from `DaVinciBot/shared-workflows`.
- Create and maintain version tags such as `v6.2.0` after changes are reviewed.
- Grant GitHub Actions `packages: write` for workflows that publish to GHCR.
- Grant GitHub Actions `id-token: write` for workflows that create keyless Cosign and npm signatures.
- Configure deployment environments `dev`, `staging`, and `prod` in application repositories, with a required reviewer
  on `prod`.
- Configure repository secrets (shared across environments):
    - `DOKPLOY_URL`
    - `DOKPLOY_API_KEY`
    - `GHCR_TOKEN` (PAT with `read:packages`, used by Dokploy to pull from GHCR)
- Configure the organization secret `PACKAGES_READ_TOKEN` (PAT with
  `read:packages` from a bot account): used by `ci.yml`/`e2e.yml` installs and mounted as a Docker build secret by
  `container.yml` so builds can install the private `@davincibot/*` packages from GitHub Packages. `container.yml`
  treats it as required.
- Configure environment secrets (one per environment: `dev`, `staging`, `prod`):
    - `DOKPLOY_APP_ID`

## Packages

The shared npm packages live in [DaVinciBot/packages](https://github.com/DaVinciBot/packages):
`@davincibot/config`, `@davincibot/lib` and `@davincibot/components`, published to GitHub Packages (private) via
`publish-npm.yml`. `@davincibot/database-types` is published the same way
from [DaVinciBot/Supabased](https://github.com/DaVinciBot/Supabased).

The first-generation packages (`@davincibot/eslint-config`,
`@davincibot/prettier-config`, `@davincibot/tsconfig`, on public npmjs) are frozen and deprecated in favour of
`@davincibot/config` v2+.
