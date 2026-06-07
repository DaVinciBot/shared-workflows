# Shared Workflows

Reusable GitHub Actions workflows for the DaVinciBot organization.

Application repositories should call these workflows by tag:

```yaml
jobs:
  ci:
    uses: DaVinciBot/shared-workflows/.github/workflows/ci.yml@v1.2.0
```

Required repository or organization setup:

- Allow application repositories to use reusable workflows from `DaVinciBot/shared-workflows`.
- Create and maintain the `v1` tag after changes are reviewed.
- Grant GitHub Actions `packages: write` for GHCR publishing.
- Grant GitHub Actions `id-token: write` for keyless Cosign signatures.
- Configure deployment environments `dev`, `staging`, and `prod` in application repositories.
- Configure Dokploy webhook secrets in application repositories:
  - `DOKPLOY_WEBHOOK_DEV`
  - `DOKPLOY_WEBHOOK_STAGING`
  - `DOKPLOY_WEBHOOK_PROD`
