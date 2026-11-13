# Shared Workflows

Reusable GitHub Actions workflows for the DaVinciBot SvelteKit applications and npm packages.

## Usage

Application repositories call the reusable workflows by release tag. The current tag is **`v7.2.0`**:

```yaml
jobs:
  ci:
    uses: DaVinciBot/shared-workflows/.github/workflows/ci.yml@v7.2.0
    secrets: inherit
```

Every workflow is a `workflow_call` workflow and takes a `runner` input (see [Self-hosted runner](#self-hosted-runner)).
Callers pass their secrets with `secrets: inherit`.

| Workflow                                                     | Purpose                                                        |
|--------------------------------------------------------------|----------------------------------------------------------------|
| [`ci.yml`](#ciyml)                                           | quality gates (check, lint, unit tests, build)                 |
| [`container.yml`](#containeryml)                             | lint, build, inspect, then publish and sign the image on GHCR  |
| [`deploy.yml`](#deployyml)                                   | ask Watchtower on the VPS to pull the new image, then health check |
| [`e2e.yml`](#e2eyml)                                         | Playwright end-to-end tests                                    |
| [`security-scan.yml`](#security-scanyml)                     | dependency review, Trivy on the filesystem, checkov            |
| [`publish-npm.yml`](#publish-npmyml)                         | publish an npm package to GitHub Packages                      |
| [`release-changesets.yml`](#release-changesetsyml)           | open and maintain the changesets "Version Packages" PR         |

## Workflows

### `ci.yml`

Shared quality gates. By default runs `pnpm check`, `pnpm lint`, `pnpm test:unit` and `pnpm build` at the repository
root, one matrix job each (`fail-fast: false`). Dependencies are installed with `pnpm install --frozen-lockfile`, always
from the repository root so pnpm workspaces link correctly. The `working_directory`/`commands`/`install_filter` inputs
let a monorepo call the workflow once per package (see [DaVinciBot/packages](https://github.com/DaVinciBot/packages)).

| Input               | Default                       | Notes                                                                                               |
|---------------------|-------------------------------|-----------------------------------------------------------------------------------------------------|
| `runner`            | `'["self-hosted", "helsinki"]'` | JSON array of labels                                                                              |
| `pnpm_version`      | `11.5.2`                      |                                                                                                     |
| `node_version_file` | `.nvmrc`                      |                                                                                                     |
| `working_directory` | `.`                           | directory the gate commands run in; the install still runs at the root                              |
| `commands`          | `''`                          | JSON array of `{name, command}`; replaces the default gates, to run only the scripts a package defines |
| `install_filter`    | `''`                          | pnpm filter, `...` appended, so a monorepo leg installs one package and its workspace dependencies  |
| `pnpm_store_dir`    | `/home/gha-runner/pnpm-store` | persistent store on the self-hosted runner                                                          |

Secrets: `PACKAGES_READ_TOKEN` (optional, exposed to the install as `NPM_TOKEN`).

### `container.yml`

Builds and publishes the application container. Nothing is published before the gates pass: `hadolint` runs on the
Dockerfile, the image is then built with `load` (never `push`) and inspected locally by `dive --ci`, `dockle` and Trivy
(`os,library`, `ignore-unfixed`, fails at `trivy_severity`) — same path on a pull request and on a branch push. Only
then, and only when `push` is true, a second build publishes to GHCR: every layer is served from the cache of the
audited build, so the published image is the one that was inspected, and it carries the provenance and SBOM
attestations the local build cannot export. The published digest is then signed keyless with Cosign, and an SPDX SBOM
(`image-sbom`) and the image metadata (`image-metadata`) are uploaded as artifacts.

Tag contract: exactly two tags per pushed commit, `sha-<full commit sha>` (traceability and rollback) and the branch
name (`dev`, `staging`, `main`), which is what Watchtower follows on the VPS.

`PACKAGES_READ_TOKEN` is mounted as the build secret `npm_token` (`RUN --mount=type=secret,id=npm_token` in the
Dockerfiles), so it never ends up in a layer.

Layer caching is local to the runner (`type=local` under `<buildx_cache_dir>/<owner>-<repo>`, `mode=max`), not
`type=gha`: on a self-hosted runner the layers stay on the box instead of round-tripping to GitHub's cache service. It
is enabled only when `runner.environment` is `self-hosted`; on a GitHub-hosted runner the directory would be created
empty and thrown away with the VM, so both builds run without cache.

| Input               | Default                         | Notes                                                    |
|---------------------|---------------------------------|----------------------------------------------------------|
| `runner`            | `'["self-hosted", "helsinki"]'` |                                                          |
| `push`              | `false`                         | publish to GHCR (callers pass `github.event_name == 'push'`) |
| `image_name`        | `ghcr.io/<owner>/<repo>`        | lower-cased                                              |
| `context`           | `.`                             |                                                          |
| `dockerfile`        | `./Dockerfile`                  |                                                          |
| `trivy_severity`    | `CRITICAL`                      | image scan gate                                          |
| `trivy_cache_dir`   | `/home/gha-runner/trivy-cache`  |                                                          |
| `hadolint_version`  | `v2.14.0`                       |                                                          |
| `hadolint_config`   | `.hadolint.yaml`                |                                                          |
| `dive_version`      | `v0.13.1`                       |                                                          |
| `dive_config`       | `.dive-ci`                      |                                                          |
| `dockle_version`    | `v0.4.15`                       |                                                          |
| `dockle_exit_level` | `WARN`                          | `INFO`, `WARN` or `FATAL`                                |
| `buildx_cache_dir`  | `/home/gha-runner/buildx-cache` |                                                          |

Secrets: `PACKAGES_READ_TOKEN` (**required**). Outputs: `image` (name without tag), `digest` (published digest, empty
when `push` is false). The caller must grant `contents: read`, `packages: write`, `id-token: write` and
`security-events: write`.

### `deploy.yml`

Deploys by asking Watchtower on the VPS to pull the new image — there is no SSH and no deployment platform involved.
The job runs in the GitHub environment named by `environment` (so environment protection rules, such as the required
reviewer on `prod`, apply), then:

1. resolves the image reference: `image_name` (default `ghcr.io/<repo>`, lower-cased) and `image_tag`, which defaults
   to the environment mapping `prod` → `main`, anything else → `<environment>`;
2. calls `POST $WATCHTOWER_URL/v1/update?image=<ref>` with `Authorization: Bearer $WATCHTOWER_TOKEN` (3 retries). The
   job fails if Watchtower reports a failed update, and only warns when nothing was updated (image already current, or
   no container labelled for Watchtower runs that image and tag);
3. polls `health_url` every 10 s, up to 30 attempts (about 5 minutes), until it returns 200.

| Input         | Default                         | Notes                                                       |
|---------------|---------------------------------|-------------------------------------------------------------|
| `runner`      | `'["self-hosted", "helsinki"]'` |                                                             |
| `environment` | — (**required**)                | `dev`, `staging` or `prod`                                  |
| `image_name`  | `ghcr.io/<repo>`                | image name without tag                                      |
| `image_tag`   | environment mapping             | explicit tag, e.g. `sha-<commit>` for a rollback            |
| `health_url`  | — (**required**)                | URL polled after the update                                 |

Secrets: `WATCHTOWER_URL` and `WATCHTOWER_TOKEN` (both **required**). The Watchtower side (HTTP API, Caddy route,
container labels) lives in [DaVinciBot/vps-helsinki-srv](https://github.com/DaVinciBot/vps-helsinki-srv).

### `e2e.yml`

Runs Playwright end-to-end tests: install with `--frozen-lockfile`, `playwright install`, then `e2e_command`. The
`playwright-report/` and `test-results/` directories are always uploaded as the `playwright-report` artifact.

| Input                     | Default                         | Notes                                     |
|---------------------------|---------------------------------|-------------------------------------------|
| `runner`                  | `'["self-hosted", "helsinki"]'` |                                           |
| `pnpm_version`            | `11.5.2`                        |                                           |
| `node_version_file`       | `.nvmrc`                        |                                           |
| `pnpm_store_dir`          | `/home/gha-runner/pnpm-store`   |                                           |
| `e2e_command`             | `pnpm test:e2e`                 |                                           |
| `playwright_install_deps` | `false`                         | runs `playwright install --with-deps`     |

`playwright_install_deps` is off because the runner shares its host with production and `--with-deps` runs apt under
sudo on that host at every run. Install the Playwright system libraries once on the host instead — the browsers
themselves persist in the runner cache between runs.

Secrets: `PACKAGES_READ_TOKEN` (optional).

### `security-scan.yml`

Three jobs:

- **Dependency Review** (pull requests only): `actions/dependency-review-action`, fails at
  `dependency_review_severity`.
- **Trivy FS**: a first pass (`vuln,secret,misconfig`, `HIGH,CRITICAL`, never fails) uploads a SARIF report to code
  scanning; a second pass on the same tree gates on `fs_gate_severity`. The two passes share one database: it is
  downloaded once, kept in `trivy_cache_dir` on the self-hosted runner, and the gate pass skips the update.
- **Checkov**: scans the repository configuration (Dockerfile, workflows…) with the repository's `.checkov.yaml` and
  uploads a SARIF report.

| Input                        | Default                         |
|------------------------------|---------------------------------|
| `runner`                     | `'["self-hosted", "helsinki"]'` |
| `fs_gate_severity`           | `CRITICAL`                      |
| `dependency_review_severity` | `high`                          |
| `trivy_cache_dir`            | `/home/gha-runner/trivy-cache`  |
| `checkov_version`            | `3.3.11`                        |
| `checkov_config`             | `.checkov.yaml`                 |

No secrets. The caller must grant `contents: read`, `pull-requests: read` and `security-events: write`.

### `publish-npm.yml`

Publishes an npm package to GitHub Packages (`npm.pkg.github.com`, scope `@davincibot`). Idempotent, and cheaply so:
the version in `package_dir/package.json` is checked against the registry right after the checkout, before pnpm is
even installed, so a push that publishes nothing costs a checkout and one `npm view` instead of a full install and
build. A `npm view` failure that is not a 404 fails the job rather than being read as "not published yet". The
publication itself (`pnpm publish --no-git-checks`) uses the caller's `GITHUB_TOKEN`, so the caller must grant
`packages: write`. No npm provenance: attestation is npmjs-only.

| Input               | Default                         | Notes                                                                                     |
|---------------------|---------------------------------|-------------------------------------------------------------------------------------------|
| `runner`            | `'["self-hosted", "helsinki"]'` |                                                                                           |
| `package_dir`       | `.`                             | directory holding the `package.json` to publish                                           |
| `pnpm_version`      | `11.5.2`                        |                                                                                           |
| `node_version_file` | `.nvmrc`                        |                                                                                           |
| `build_command`     | `''`                            | empty also means no install: `pnpm publish` resolves `workspace:` from the manifests, not from `node_modules` |
| `install_filter`    | `''`                            | same as in `ci.yml`                                                                       |
| `pnpm_store_dir`    | `/home/gha-runner/pnpm-store`   |                                                                                           |

Secrets: `PACKAGES_READ_TOKEN` (optional, only to install `@davincibot/*` dependencies published from other
repositories).

### `release-changesets.yml`

Opens and keeps up to date the "Version Packages" PR from the pending changesets (`changesets/action`). It does not
publish anything — merging that PR is what triggers `publish-npm.yml` in the calling repository. The install skips
lifecycle scripts (`--ignore-scripts`) — bumping versions and changelogs needs none.

| Input               | Default                         |
|---------------------|---------------------------------|
| `runner`            | `'["self-hosted", "helsinki"]'` |
| `pnpm_version`      | `11.5.2`                        |
| `node_version_file` | `.nvmrc`                        |
| `pnpm_store_dir`    | `/home/gha-runner/pnpm-store`   |
| `version_script`    | `pnpm changeset version`        |
| `pr_title`          | `chore: version packages`       |
| `commit_message`    | `chore: version packages`       |

Secrets: `PACKAGES_READ_TOKEN` (optional). The caller must grant `contents: write` and `pull-requests: write`, since a
reusable workflow can only narrow the caller's token.

## Shared caches

Two caches live on the self-hosted runner and are shared by every repository: the pnpm store (`pnpm_store_dir`, default
`/home/gha-runner/pnpm-store`) and the Trivy vulnerability database (`trivy_cache_dir`, default
`/home/gha-runner/trivy-cache`). Both hold content that is addressed by hash or expires on its own, so sharing them is
what they are for, and on a self-hosted runner they make GitHub's cache service redundant — the workflows disable it
there rather than round-tripping a tarball for something already on the disk. On a GitHub-hosted runner the directories
would die with the VM, so the GitHub cache is used instead.

## Per-repository tooling configs

Each application repository carries the container tooling configs at its root. They are read from the checkout, so a
repository tunes its own thresholds without touching this repository:

| File             | Tool     | Holds                                                  |
|------------------|----------|--------------------------------------------------------|
| `.hadolint.yaml` | hadolint | failure threshold, ignored rules, trusted registries   |
| `.dive-ci`       | dive     | efficiency, wasted bytes and wasted-percent thresholds |
| `.dockleignore`  | dockle   | waived CIS checkpoints                                 |
| `.checkov.yaml`  | checkov  | frameworks, skipped paths, waived checks               |

## Required repository or organization setup

- Allow application repositories to use reusable workflows from `DaVinciBot/shared-workflows`.
- Create and maintain version tags such as `v7.2.0` after changes are reviewed.
- Grant GitHub Actions `packages: write` for workflows that publish to GHCR or GitHub Packages.
- Grant GitHub Actions `id-token: write` for `container.yml`, which signs the published image keyless with Cosign.
- Configure deployment environments `dev`, `staging`, and `prod` in application repositories, with a required reviewer
  on `prod`.
- Configure the deploy secrets `WATCHTOWER_URL` (base URL of the Watchtower HTTP API exposed by the VPS proxy) and
  `WATCHTOWER_TOKEN` (its bearer token), reachable by the deploy jobs.
- Configure the organization secret `PACKAGES_READ_TOKEN` (PAT with `read:packages` from a bot account): used by the
  `ci.yml`/`e2e.yml`/`release-changesets.yml` installs and mounted as a Docker build secret by `container.yml` so builds
  can install the private `@davincibot/*` packages from GitHub Packages. `container.yml` treats it as required.

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

## Maintenance

- Every change is reviewed by the lead (`CODEOWNERS`: `@aust-1`).
- Dependabot bumps the GitHub Actions used here every Monday.

## Packages

The shared npm packages live in [DaVinciBot/packages](https://github.com/DaVinciBot/packages):
`@davincibot/config`, `@davincibot/lib` and `@davincibot/components`, published to GitHub Packages (private) via
`publish-npm.yml`. `@davincibot/database-types` is published the same way
from [DaVinciBot/Supabased](https://github.com/DaVinciBot/Supabased).

The first-generation packages (`@davincibot/eslint-config`,
`@davincibot/prettier-config`, `@davincibot/tsconfig`, on public npmjs) are frozen and deprecated in favour of
`@davincibot/config` v2+.
