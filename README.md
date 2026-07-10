# Shared Workflows

Reusable GitHub Actions workflows and shared tooling packages for the DaVinciBot
SvelteKit applications.

## Workflows

Application repositories should call reusable workflows by release tag:

```yaml
jobs:
  ci:
    uses: DaVinciBot/shared-workflows/.github/workflows/ci.yml@v4.0.0
```

Available workflows:

- `.github/workflows/ci.yml`: shared quality gates (`pnpm check`, `pnpm lint`,
  `pnpm test:unit`, `pnpm build`).
- `.github/workflows/container.yml`: build and publish application containers.
- `.github/workflows/deploy.yml`: deploy applications through Dokploy.
- `.github/workflows/e2e.yml`: run Playwright end-to-end tests.
- `.github/workflows/security-scan.yml`: run security scans.
- `.github/workflows/publish-packages.yml`: publish shared npm packages when
  `packages/**` changes on `main`.

Required repository or organization setup:

- Allow application repositories to use reusable workflows from `DaVinciBot/shared-workflows`.
- Create and maintain version tags such as `v4.0.0` after changes are reviewed.
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

This repository also publishes shared npm packages used by the apps:

- `@davincibot/eslint-config`: strict ESLint flat config for SvelteKit apps.
- `@davincibot/prettier-config`: shared Prettier settings with Svelte and Tailwind plugins.
- `@davincibot/tsconfig`: shared TypeScript strictness for SvelteKit apps.

Install them in each app with the required peer dependencies:

```sh
pnpm add -D @davincibot/eslint-config @davincibot/prettier-config @davincibot/tsconfig @eslint/js eslint eslint-config-prettier eslint-plugin-svelte globals prettier prettier-plugin-svelte prettier-plugin-tailwindcss typescript-eslint
```

Use the shared ESLint config from `eslint.config.js`:

```js
import { createConfig } from '@davincibot/eslint-config';
import { fileURLToPath } from 'node:url';
import svelteConfig from './svelte.config.js';

export default createConfig({
 tsconfigRootDir: fileURLToPath(new URL('.', import.meta.url)),
 svelteConfig
});
```

Use the shared Prettier config from `.prettierrc`:

```json
"@davincibot/prettier-config"
```

Extend the shared TypeScript config from `tsconfig.json`:

```json
{
 "extends": ["./.svelte-kit/tsconfig.json", "@davincibot/tsconfig/sveltekit"]
}
```

Packages are published by `.github/workflows/publish-packages.yml` on pushes to
`main` that modify `packages/**`, or manually through `workflow_dispatch`.
Publishing requires the repository secret `NPM_TOKEN`.
