#!/usr/bin/env node
// Publish every public package whose current version is not on npm yet.
//
// `pnpm pack` rewrites `workspace:^` to real versions; `npm publish <tarball>` then
// uploads it. npm >= 11.5.1 is required for trusted publishing (OIDC) in GitHub Actions;
// locally it uses whatever auth npm already has (npm login or NPM_CONFIG_USERCONFIG).
//
//   node scripts/publish.mjs            publish what is missing
//   node scripts/publish.mjs --dry-run  only list what would be published
//   node scripts/publish.mjs @teknixglobal/a @teknixglobal/b   only these packages
//     (use it locally: the working tree may hold another thread's unfinished package)
//
// Prints "New tag: <name>@<version>" lines (the format changesets/action reads to
// create GitHub releases) and creates the matching git tags.
import { execFileSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const dryRun = process.argv.includes("--dry-run")
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"))
const root = new URL("..", import.meta.url).pathname
const run = (cmd, args, cwd = root) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim()

function isPublished(name, version) {
  try {
    const out = execFileSync("npm", ["view", `${name}@${version}`, "version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    return out.trim() === version
  } catch {
    return false // 404: not published (or the package does not exist yet)
  }
}

const packages = readdirSync(join(root, "packages"))
  .map((dir) => ({ dir: join(root, "packages", dir), pkg: JSON.parse(readFileSync(join(root, "packages", dir, "package.json"), "utf8")) }))
  .filter(({ pkg }) => !pkg.private && (only.length === 0 || only.includes(pkg.name)))
  // core first: the other packages depend on it.
  .sort((a, b) => Number(b.pkg.name.endsWith("-core")) - Number(a.pkg.name.endsWith("-core")))

const tmp = mkdtempSync(join(tmpdir(), "mv-publish-"))
let published = 0
for (const { dir, pkg } of packages) {
  const id = `${pkg.name}@${pkg.version}`
  if (isPublished(pkg.name, pkg.version)) {
    console.log(`skip ${id} (already on npm)`)
    continue
  }
  if (dryRun) {
    console.log(`would publish ${id}`)
    continue
  }
  run("pnpm", ["pack", "--pack-destination", tmp], dir)
  const tarball = readdirSync(tmp).find((f) => f.endsWith(`-${pkg.version}.tgz`) && f.startsWith(pkg.name.replace("@", "").replace("/", "-")))
  if (!tarball) {
    throw new Error(`pnpm pack produced no tarball for ${id}`)
  }
  run("npm", ["publish", join(tmp, tarball), "--access", "public"])
  try {
    run("git", ["tag", id])
  } catch {
    // tag already exists
  }
  console.log(`New tag: ${id}`)
  published++
}
console.log(dryRun ? "dry run done" : `published ${published} package(s)`)
