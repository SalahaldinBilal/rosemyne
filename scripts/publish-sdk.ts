// Run with: npm run publish:sdk [-- --dry-run]
// Publishes both plugin SDKs: the rosemyne-plugin crate and the @rosemyne/plugin npm package.
//
// Order: check both logins, build and verify both, and only then publish. Nothing is uploaded
// unless every step before it passed for both. A version that is already published is skipped,
// so the script can be run again after one of the two uploads failed.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const NPM_ORG = "rosemyne";
const NPM_PUBLISH_ROLES = ["developer", "admin", "owner"];
const CRATES_IO_USER = "SalahaldinBilal";
const CRATES_IO = "https://crates.io/api/v1";
const USER_AGENT = "rosemyne-sdk-publish-script";
const WASM_TARGET = "wasm32-unknown-unknown";

const rustDir = fileURLToPath(new URL("../plugin-sdk/rust", import.meta.url));
const tsDir = fileURLToPath(new URL("../plugin-sdk/ts", import.meta.url));
const dryRun = process.argv.includes("--dry-run");

type Captured = { ok: boolean, stdout: string, stderr: string };
type Spawned = { command: string, args: string[], shell: boolean };

function fail(message: string): never {
  throw new Error(message);
}

function step(title: string): void {
  console.log(`\n== ${title}`);
}

// npm is a .cmd on Windows and needs a shell, which takes one command line. The args are fixed text.
function spawned(command: string, args: string[]): Spawned {
  if (command === "npm" && process.platform === "win32") {
    return { command: `npm ${args.join(" ")}`, args: [], shell: true };
  }
  return { command, args, shell: false };
}

function capture(command: string, args: string[], cwd: string): Captured {
  const target = spawned(command, args);
  const result = spawnSync(target.command, target.args, { cwd, shell: target.shell, encoding: "utf-8" });
  if (result.error) fail(`Couldn't run ${command}: ${result.error.message}`);
  return { ok: result.status === 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function run(command: string, args: string[], cwd: string): void {
  console.log(`> ${command} ${args.join(" ")}`);
  const target = spawned(command, args);
  const result = spawnSync(target.command, target.args, { cwd, shell: target.shell, stdio: "inherit" });
  if (result.error) fail(`Couldn't run ${command}: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${args[0]} failed, nothing was published after this point`);
}

function checkNpmLogin(): void {
  const who = capture("npm", ["whoami"], tsDir);
  if (!who.ok || !who.stdout) fail("npm is not logged in. Run: npm login");
  const user = who.stdout;

  const members = capture("npm", ["org", "ls", NPM_ORG, user, "--json"], tsDir);
  if (!members.ok) {
    fail(`npm user ${user} can't read the ${NPM_ORG} org, so it is not a member of it.\n${members.stderr}`);
  }

  let roles: Record<string, string>;
  try {
    roles = JSON.parse(members.stdout);
  } catch {
    fail(`npm gave an unexpected answer for the ${NPM_ORG} org members: ${members.stdout}`);
  }
  const role = roles[user];
  if (!role || !NPM_PUBLISH_ROLES.includes(role)) {
    fail(`npm user ${user} is not a member of the ${NPM_ORG} org with publish rights (role: ${role ?? "none"})`);
  }
  console.log(`npm: logged in as ${user}, ${role} of the ${NPM_ORG} org`);
}

function tokenFromCredentials(text: string): string | null {
  let inRegistry = false;
  for (const line of text.split(/\r?\n/)) {
    const section = line.match(/^\s*\[(.+)\]\s*$/);
    if (section) {
      inRegistry = section[1] === "registry" || section[1] === "registries.crates-io";
      continue;
    }
    const token = inRegistry ? line.match(/^\s*token\s*=\s*"([^"]+)"/) : null;
    if (token) return token[1];
  }
  return null;
}

function hasCargoToken(): boolean {
  if (process.env.CARGO_REGISTRY_TOKEN) return true;
  const cargoHome = process.env.CARGO_HOME ?? join(homedir(), ".cargo");
  return ["credentials.toml", "credentials"].some(name => {
    const path = join(cargoHome, name);
    return existsSync(path) && tokenFromCredentials(readFileSync(path, "utf-8")) !== null;
  });
}

async function cratesIo(path: string): Promise<Response> {
  return fetch(`${CRATES_IO}${path}`, { headers: { "User-Agent": USER_AGENT } });
}

// crates.io won't say whose a token is, so the account is checked through the crate's owners.
async function checkCargoLogin(crate: string): Promise<void> {
  if (!hasCargoToken()) {
    fail("cargo has no crates.io token in CARGO_REGISTRY_TOKEN or ~/.cargo/credentials.toml. Run: cargo login");
  }

  const response = await cratesIo(`/crates/${crate}/owners`);
  if (response.status === 404) {
    await response.arrayBuffer();
    console.log(`cargo: a token is set. ${crate} is not on crates.io yet, so whoever publishes it first becomes its owner.`);
    return;
  }
  if (!response.ok) fail(`crates.io answered ${response.status} when asked who owns ${crate}`);

  const body = await response.json() as { users?: Array<{ login?: string }> };
  const owners = (body.users ?? []).map(user => user.login ?? "");
  if (!owners.some(login => login.toLowerCase() === CRATES_IO_USER.toLowerCase())) {
    fail(`${crate} on crates.io belongs to ${owners.join(", ") || "nobody"}, not to ${CRATES_IO_USER}`);
  }
  console.log(`cargo: a token is set, and ${crate} belongs to ${CRATES_IO_USER}`);
}

function cargoPackageField(field: string): string {
  const manifest = readFileSync(join(rustDir, "Cargo.toml"), "utf-8");
  const value = manifest.match(new RegExp(`^\\[package\\][\\s\\S]*?^${field}\\s*=\\s*"([^"]+)"`, "m"));
  if (!value) fail(`plugin-sdk/rust/Cargo.toml has no package ${field}`);
  return value[1];
}

async function crateIsPublished(name: string, version: string): Promise<boolean> {
  const response = await cratesIo(`/crates/${name}/${version}`);
  await response.arrayBuffer();
  if (response.status === 404) return false;
  if (!response.ok) fail(`crates.io answered ${response.status} when asked about ${name} ${version}`);
  return true;
}

function npmIsPublished(name: string, version: string): boolean {
  const view = capture("npm", ["view", `${name}@${version}`, "version"], tsDir);
  if (view.ok) return view.stdout === version;
  if (/E404|404 Not Found/.test(view.stderr)) return false;
  fail(`npm couldn't say whether ${name}@${version} is published:\n${view.stderr}`);
}

async function main(): Promise<void> {
  const crate = { name: cargoPackageField("name"), version: cargoPackageField("version") };
  const npmPackage: { name: string, version: string } = JSON.parse(readFileSync(join(tsDir, "package.json"), "utf-8"));

  step("Checking logins");
  checkNpmLogin();
  await checkCargoLogin(crate.name);

  step("Checking versions");
  const publishCrate = !await crateIsPublished(crate.name, crate.version);
  const publishNpm = !npmIsPublished(npmPackage.name, npmPackage.version);
  console.log(`${crate.name} ${crate.version}: ${publishCrate ? "to publish" : "already on crates.io, skipped"}`);
  console.log(`${npmPackage.name} ${npmPackage.version}: ${publishNpm ? "to publish" : "already on npm, skipped"}`);
  if (!publishCrate && !publishNpm) {
    console.log("\nBoth versions are already published. Bump the versions to publish again.");
    return;
  }

  step("Building and verifying the Rust SDK");
  run("cargo", ["test"], rustDir);
  run("cargo", ["check", "--lib", "--target", WASM_TARGET], rustDir);
  // Fails on uncommitted changes, so what gets published is what is in git.
  run("cargo", ["package"], rustDir);

  step("Building and verifying the TypeScript SDK");
  run("npm", ["install", "--no-audit", "--no-fund"], tsDir);
  run("npm", ["run", "build"], tsDir);
  run("npm", ["pack", "--dry-run"], tsDir);

  if (dryRun) {
    step("Dry run");
    if (publishCrate) run("cargo", ["publish", "--dry-run"], rustDir);
    if (publishNpm) run("npm", ["publish", "--dry-run"], tsDir);
    console.log("\nEverything passed. Nothing was published (--dry-run).");
    return;
  }

  step("Publishing");
  if (publishCrate) run("cargo", ["publish"], rustDir);
  if (publishNpm) run("npm", ["publish"], tsDir);
  console.log("\nDone.");
}

// No process.exit: it crashes Node on Windows while a fetch connection is still closing.
try {
  await main();
} catch (error) {
  console.error(`\npublish-sdk: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
