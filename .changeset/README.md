# Changesets

Every change to a published package needs a changeset: `pnpm changeset`, pick the packages, pick patch/minor/major, write one line.
Release: `pnpm version` (bumps versions + CHANGELOG.md per package), commit, then `pnpm release` (build + npm publish).
