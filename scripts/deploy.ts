// Run with: node scripts/deploy.ts
// Node 24 strips the type annotations natively, no build step.
//
// Uploads a built Windows NSIS bundle to B2 and creates a GitHub release that
// links to it. Expects `tauri build` to have already run with
// `bundle.createUpdaterArtifacts: true` (see src-tauri/tauri.conf.json), and
// CHANGELOG.md to already have a `## [<version>]` section (bump-version.ts
// cuts "Unreleased" into one) , that section's body is used as the release notes.
//
// Required env vars: B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY, GH_TOKEN
// (the `gh` CLI reads GH_TOKEN itself; it's preinstalled on GitHub-hosted runners).

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const B2_BUCKET = "rosemyne-files";
const DOWNLOAD_DOMAIN = "rosemyne.won.fyi";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const nsisDir = `${rootDir}/src-tauri/target/release/bundle/nsis`;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function b2(...args: string[]) {
  execFileSync("b2", args, { stdio: "inherit" });
}

function gh(...args: string[]) {
  execFileSync("gh", args, { stdio: "inherit" });
}

function upload(localPath: string, remotePath: string) {
  console.log(`Uploading ${localPath} -> b2://${B2_BUCKET}/${remotePath}`);
  b2("file", "upload", B2_BUCKET, localPath, remotePath);
}

// Reads just the body of CHANGELOG.md's `## [<version>]` section (everything
// up to the next `## [` heading, or EOF), matching the section bump-version.ts
// cuts "Unreleased" into.
function readChangelogNotes(version: string): string {
  const changelogPath = `${rootDir}/CHANGELOG.md`;
  const contents = readFileSync(changelogPath, "utf-8");

  const heading = `## [${version}]`;
  const headingStart = contents.indexOf(heading);
  if (headingStart === -1) {
    throw new Error(`Could not find a "${heading}" section in CHANGELOG.md , did you run \`npm run version:bump\` before tagging?`);
  }

  const sectionStart = contents.indexOf("\n", headingStart) + 1;
  const nextHeadingIndex = contents.indexOf("\n## [", sectionStart);
  const sectionEnd = nextHeadingIndex === -1 ? contents.length : nextHeadingIndex;

  return contents.slice(sectionStart, sectionEnd).trim();
}

const b2KeyId = requireEnv("B2_APPLICATION_KEY_ID");
const b2AppKey = requireEnv("B2_APPLICATION_KEY");

const { productName, version } = JSON.parse(readFileSync(`${rootDir}/src-tauri/tauri.conf.json`, "utf-8"));

// The NSIS bundle produces the human-facing installer (`-setup.exe`) and,
// since createUpdaterArtifacts is on, a separate `.nsis.zip` + `.sig` pair ,
// that's what the auto-updater actually downloads and applies, not the .exe.
// Discovered by extension rather than hardcoding the exact filename, since
// the precise Tauri-generated name can shift between versions.
const bundleFiles = readdirSync(nsisDir);
const installerFile = bundleFiles.find(file => file.endsWith("-setup.exe"));
const sigFile = bundleFiles.find(file => file.endsWith(".sig"));

if (!installerFile || !sigFile) {
  throw new Error(`Could not find both a -setup.exe and a .sig file in ${nsisDir} (found: ${bundleFiles.join(", ") || "nothing"})`);
}

const updaterFile = sigFile.slice(0, -".sig".length);
const signature = readFileSync(`${nsisDir}/${sigFile}`, "utf-8");
const notes = readChangelogNotes(version);

b2("account", "authorize", b2KeyId, b2AppKey);

const latestInstallerPath = `${productName}_latest_x64_en-US.exe`;
const versionedInstallerPath = `installer/${version}/${installerFile}`;
const updaterArtifactPath = `updater/${version}/${updaterFile}`;
const updaterManifestPath = "updater/latest.json";

upload(`${nsisDir}/${installerFile}`, latestInstallerPath);
upload(`${nsisDir}/${installerFile}`, versionedInstallerPath);
upload(`${nsisDir}/${updaterFile}`, updaterArtifactPath);

const manifest = {
  version: `v${version}`,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://${DOWNLOAD_DOMAIN}/${updaterArtifactPath}`,
    },
  },
};

const manifestFile = `${rootDir}/latest.json`;
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
upload(manifestFile, updaterManifestPath);

const tag = `v${version}`;
const releaseNotes = `${notes}\n\n`
  + `Download (latest): https://${DOWNLOAD_DOMAIN}/${latestInstallerPath}\n`
  + `Download (v${version}): https://${DOWNLOAD_DOMAIN}/${versionedInstallerPath}`;
gh("release", "create", tag, "--title", tag, "--notes", releaseNotes);

console.log(`\nDeployed ${tag}.`);
