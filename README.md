# Shared Workflows

Reusable GitHub Actions workflows for the DaVinciBot organization.

Application repositories should call these workflows by tag:

```yaml
jobs:
  ci:
    uses: DaVinciBot/shared-workflows/.github/workflows/ci.yml@v2.0.0
```

Required repository or organization setup:

- Allow application repositories to use reusable workflows from `DaVinciBot/shared-workflows`.
- Create and maintain the `v1` tag after changes are reviewed.
- Grant GitHub Actions `packages: write` for GHCR publishing.
- Grant GitHub Actions `id-token: write` for keyless Cosign signatures.
- Configure deployment environments `dev`, `staging`, and `prod` in application repositories,
  with a required reviewer on `prod`.
- Configure repository secrets (shared across environments):
  - `DOKPLOY_URL`
  - `DOKPLOY_API_KEY`
  - `GHCR_TOKEN` (PAT with `read:packages`, used by Dokploy to pull from GHCR)
- Configure environment secrets (one per environment: `dev`, `staging`, `prod`):
  - `DOKPLOY_APP_ID`
