# Shared Workflows

Reusable GitHub Actions workflows for the DaVinciBot SvelteKit applications.

## Workflows

Application repositories should call reusable workflows by release tag:

```yaml
jobs:
  ci:
    uses: DaVinciBot/shared-workflows/.github/workflows/ci.yml@v4.1.0
```

Available workflows:

- `.github/workflows/ci.yml`: shared quality gates (`pnpm check`, `pnpm lint`,
  `pnpm test:unit`, `pnpm build`).
- `.github/workflows/container.yml`: build and publish application containers.
- `.github/workflows/deploy.yml`: deploy applications through Dokploy.
- `.github/workflows/e2e.yml`: run Playwright end-to-end tests.
- `.github/workflows/security-scan.yml`: run security scans.

Required repository or organization setup:

- Allow application repositories to use reusable workflows from `DaVinciBot/shared-workflows`.
- Create and maintain version tags such as `v4.1.0` after changes are reviewed.
- Grant GitHub Actions `packages: write` for workflows that publish to GHCR.
- Grant GitHub Actions `id-token: write` for workflows that create keyless Cosign and npm signatures.
- Configure deployment environments `dev`, `staging`, and `prod` in application repositories,
  with a required reviewer on `prod`.
- Configure repository secrets (shared across environments):
  - `DOKPLOY_URL`
  - `DOKPLOY_API_KEY`
  - `GHCR_TOKEN` (PAT with `read:packages`, used by Dokploy to pull from GHCR)
- Configure environment secrets (one per environment: `dev`, `staging`, `prod`):
  - `DOKPLOY_APP_ID`

## Packages

The shared npm packages (`@davincibot/eslint-config`, `@davincibot/prettier-config`,
`@davincibot/tsconfig`) now live in [DaVinciBot/packages](https://github.com/DaVinciBot/packages).
