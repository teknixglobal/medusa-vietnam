# Releasing

Packages are published by `.github/workflows/release.yml` (Changesets + npm trusted publishing, no npm token in GitHub). `scripts/publish.mjs` packs each public package with `pnpm pack` (rewrites `workspace:^`) and publishes the tarball with `npm publish`; versions already on npm are skipped.

## Every release

1. In the PR: `pnpm changeset`, choose packages and bump (while < 1.0: minor = breaking, patch = fix), commit the generated `.changeset/*.md`.
2. Merge to `main`: the workflow opens or updates the **Version Packages** PR (versions + CHANGELOGs).
3. Merge that PR: the workflow tests, builds, publishes, tags `name@version` and creates GitHub releases.

## One-time setup (done once per npm package)

npm cannot attach a trusted publisher to a package that does not exist yet, so the first version goes out from a machine:

1. npm account with 2FA; org `teknixglobal` (free for public packages).
2. A short-lived granular access token (Read and write, organization `teknixglobal`, expiry 1-7 days) in a file outside the repo, e.g. `_teknix/secrets/npm-publish.env`: `NPM_TOKEN=...`
3. First publish, in the dev container (only the listed packages):
   ```bash
   set -a; . ../../_teknix/secrets/npm-publish.env; set +a
   docker compose run --rm -e NPM_TOKEN dev sh -c 'echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > /tmp/npmrc && NPM_CONFIG_USERCONFIG=/tmp/npmrc pnpm build && NPM_CONFIG_USERCONFIG=/tmp/npmrc node scripts/publish.mjs @teknixglobal/teknix-vietnam-core @teknixglobal/teknix-vietnam-payment-cod-medusa-plugin @teknixglobal/teknix-vietnam-payment-sepay-medusa-plugin @teknixglobal/teknix-vietnam-payment-vnpay-medusa-plugin @teknixglobal/teknix-vietnam-commerce-medusa-plugin @teknixglobal/teknix-vietnam-shipping-core @teknixglobal/teknix-vietnam-fulfillment-ghn-medusa-plugin'
   ```
4. For each package on npmjs.com: Settings > Trusted Publisher > GitHub Actions: organization `teknixglobal`, repository `teknix-vietnam-commerce-plugins`, workflow `release.yml`, no environment. Then Settings > Publishing access: require 2FA and disallow tokens.
5. Delete the token (npmjs.com > Access Tokens) and the secrets file.
6. GitHub repo > Settings > Secrets and variables > Actions > Variables: `RELEASE_ENABLED=true`.

A new package added later needs steps 2-5 for that package only.
