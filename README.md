# Shared Workflows

Reusable GitHub Actions workflows for the DaVinciBot SvelteKit applications.

## Workflows

Application repositories should call reusable workflows by release tag:

```yaml
jobs:
  ci:
    uses: DaVinciBot/shared-workflows/.github/workflows/ci.yml@v7.2.0
```

Available workflows:

- `.github/workflows/ci.yml`: shared quality gates. By default runs `pnpm check`, `pnpm lint`, `pnpm test:unit`,
  `pnpm build` at the repository root. Inputs: `pnpm_version`, `node_version_file`, `working_directory` (directory the
  gate commands run in — dependencies are still installed from the repo root so pnpm workspaces link correctly),
  `commands` (JSON array of `{name, command}` to run only the scripts a package defines; overrides the default gates),
  `install_filter` (a pnpm filter, `...` appended, so a monorepo leg installs one package and its workspace dependencies
  instead of the whole workspace), `pnpm_store_dir`. The `working_directory`/`commands` inputs let a monorepo call the
  workflow once per package (see [DaVinciBot/packages](https://github.com/DaVinciBot/packages)).
- `.github/workflows/container.yml`: build and publish application containers. Nothing is published before the gates
  pass: `hadolint` runs on the Dockerfile, the image is then built with `load` (never `push`) and inspected locally by
  `dive --ci`, `dockle` and Trivy — same path on a pull request and on a branch push. Only then, and only when `push` is
  true, a second build publishes to GHCR: every layer is served from the cache of the audited build, so the published
  image is the one that was inspected, and it carries the provenance and SBOM attestations the local build cannot
  export. Inputs pin each tool and point at its config: `hadolint_version`/`hadolint_config`, `dive_version`/
  `dive_config`, `dockle_version`/`dockle_exit_level`, `trivy_severity`, `trivy_cache_dir`, `buildx_cache_dir`. Layer
  caching is local to the runner (`type=local` under `/home/gha-runner/buildx-cache/<owner>-<repo>`, `mode=max`), not
  `type=gha`: on a self-hosted runner the layers stay on the box instead of round-tripping to GitHub's cache service. It
  is enabled only when `runner.environment` is `self-hosted`; on a GitHub-hosted runner the directory would be created
  empty and thrown away with the VM, so both builds run without cache.
- `.github/workflows/deploy.yml`: deploy applications through Dokploy.
- `.github/workflows/e2e.yml`: run Playwright end-to-end tests. Inputs: `pnpm_store_dir`, `playwright_install_deps`
  (default `false`)
  controls `playwright install --with-deps`; it is off because the runner shares its host with production and
  `--with-deps` runs apt under sudo on that host at every run. Install the Playwright system libraries once on the host
  instead — the browsers themselves persist in the runner cache between runs.
- `.github/workflows/security-scan.yml`: run security scans — dependency review, Trivy on the filesystem, and `checkov`
  on the Dockerfile and the workflows. The two Trivy passes of a job share one database: it is downloaded once, kept in
  `trivy_cache_dir` on the self-hosted runner, and the gate pass skips the update. Inputs: `trivy_cache_dir`,
  `checkov_version`, `checkov_config`.
- `.github/workflows/publish-npm.yml`: publish an npm package to GitHub Packages (npm.pkg.github.com). Idempotent, and
  cheaply so: the version in `package_dir/package.json` is checked against the registry right after the checkout, before
  pnpm is even installed, so a push that publishes nothing costs a checkout and one `npm view` instead of a full install
  and build. A `npm view` failure that is not a 404 fails the job rather than being read as "not published yet". Inputs:
  `package_dir`, `build_command` (empty also means no install: `pnpm publish` resolves the `workspace:` protocol from
  the workspace manifests, not from `node_modules`), `install_filter`, `pnpm_version`, `node_version_file`,
  `pnpm_store_dir`. No npm provenance: attestation is npmjs-only.
- `.github/workflows/release-changesets.yml`: open and keep up to date the "Version Packages" PR from the pending
  changesets. It does not publish anything — merging that PR is what triggers `publish-npm.yml` in the calling
  repository. The install skips lifecycle scripts — bumping versions and changelogs needs none. Inputs: `pnpm_version`,
  `node_version_file`, `pnpm_store_dir`, `version_script`, `pr_title`, `commit_message`. The caller must grant
  `contents: write` and `pull-requests: write`, since a reusable workflow can only narrow the caller's token.

Two caches live on the self-hosted runner and are shared by every repository: the pnpm store (`pnpm_store_dir`, default
`/home/gha-runner/pnpm-store`) and the Trivy vulnerability database (`trivy_cache_dir`, default
`/home/gha-runner/trivy-cache`). Both hold content that is addressed by hash or expires on its own, so sharing them is
what they are for, and on a self-hosted runner they make GitHub's cache service redundant — the workflows disable it
there rather than round-tripping a tarball for something already on the disk. On a GitHub-hosted runner the directories
would die with the VM, so the GitHub cache is used instead.

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
- Create and maintain version tags such as `v7.2.0` after changes are reviewed.
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

## Self-hosted runner

Every workflow takes a `runner` input — a JSON array of labels, defaulting to `'["self-hosted", "helsinki"]'` — and
resolves it with `runs-on: ${{ fromJSON(inputs.runner) }}`. Callers leave it alone and land on the single persistent
organisation runner, co-located with production, so one job runs at a time and the whole file set is written for that.
Pass `runner: '["ubuntu-latest"]'` from a caller for the rare job that really needs a GitHub-hosted VM. Consequences
worth keeping in mind:

- The runner is **not** a GitHub-hosted image. Node and pnpm are set up explicitly by the workflows that need them; do
  not add a step that assumes the toolchain a GitHub-hosted image would have preinstalled.
- `/home/gha-runner/buildx-cache` is **not** touched by the host's daily `docker system prune`. `container.yml` keeps it
  bounded by writing each build to `<dir>-new` and swapping it in, so a repository holds one generation of layers rather
  than accumulating all of them. If the directory still grows past what the box can spare, move that repository to a
  registry cache (`type=registry` against a `:buildcache` tag on GHCR) rather than adding a prune step here.
- The per-repository subdirectory exists because a second runner on the same host writing the same local cache
  concurrently can corrupt it. Adding a runner means either keeping one cache root per runner or moving to a registry
  cache.
- `.github/actionlint.yaml` declares the `helsinki` label; without it actionlint rejects every `runs-on`.

## Packages

The shared npm packages live in [DaVinciBot/packages](https://github.com/DaVinciBot/packages):
`@davincibot/config`, `@davincibot/lib` and `@davincibot/components`, published to GitHub Packages (private) via
`publish-npm.yml`. `@davincibot/database-types` is published the same way
from [DaVinciBot/Supabased](https://github.com/DaVinciBot/Supabased).

The first-generation packages (`@davincibot/eslint-config`,
`@davincibot/prettier-config`, `@davincibot/tsconfig`, on public npmjs) are frozen and deprecated in favour of
`@davincibot/config` v2+.
