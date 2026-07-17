// Run with: node scripts/bump-version.ts <version>  (e.g. 0.2.0)
// Node 24 strips the type annotations natively, no build step.
//
// Keeps package.json, src-tauri/Cargo.toml and src-tauri/tauri.conf.json in
// sync , nothing else does this automatically, so they'd otherwise drift.
// Also cuts CHANGELOG.md's "Unreleased" section into a dated release section,
// which deploy.ts later reads as the release notes.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const newVersion = process.argv[2];

if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error("Usage: node scripts/bump-version.ts <version>  (e.g. 0.2.0)");
  process.exit(1);
}

function replaceOrThrow(contents: string, pattern: RegExp, replacement: string, filePath: string): string {
  if (!pattern.test(contents)) {
    throw new Error(`Could not find a version field matching ${pattern} in ${filePath}`);
  }

  return contents.replace(pattern, replacement);
}

function bumpJsonVersion(relativePath: string) {
  const filePath = fileURLToPath(new URL(relativePath, import.meta.url));
  const contents = readFileSync(filePath, "utf-8");
  const updated = replaceOrThrow(contents, /"version":\s*"[^"]*"/, `"version": "${newVersion}"`, filePath);
  writeFileSync(filePath, updated);
  console.log(`Updated ${relativePath}`);
}

function bumpCargoVersion(relativePath: string) {
  const filePath = fileURLToPath(new URL(relativePath, import.meta.url));
  const contents = readFileSync(filePath, "utf-8");
  // Anchored to the start of a line so this only matches [package]'s own
  // `version = "..."`, not a dependency's inline `{ version = "..." }`.
  const updated = replaceOrThrow(contents, /^version = "[^"]*"/m, `version = "${newVersion}"`, filePath);
  writeFileSync(filePath, updated);
  console.log(`Updated ${relativePath}`);
}

function cutChangelog() {
  const relativePath = "../CHANGELOG.md";
  const filePath = fileURLToPath(new URL(relativePath, import.meta.url));
  const contents = readFileSync(filePath, "utf-8");

  const unreleasedHeading = "## [Unreleased]";
  const headingStart = contents.indexOf(unreleasedHeading);
  if (headingStart === -1) {
    throw new Error(`Could not find "${unreleasedHeading}" in ${relativePath}`);
  }

  const sectionStart = headingStart + unreleasedHeading.length;
  const nextHeadingIndex = contents.indexOf("\n## [", sectionStart);
  const sectionEnd = nextHeadingIndex === -1 ? contents.length : nextHeadingIndex;
  const sectionBody = contents.slice(sectionStart, sectionEnd).trim();

  if (!sectionBody) {
    console.warn(`Warning: the "${unreleasedHeading}" section in ${relativePath} is empty , this release's notes will be blank.`);
  }

  const date = new Date().toISOString().slice(0, 10);
  const releasedHeading = `## [${newVersion}] - ${date}`;
  const replacement = sectionBody
    ? `${unreleasedHeading}\n\n${releasedHeading}\n\n${sectionBody}`
    : `${unreleasedHeading}\n\n${releasedHeading}`;

  const updated = contents.slice(0, headingStart) + replacement + contents.slice(sectionEnd);
  writeFileSync(filePath, updated);
  console.log(`Updated ${relativePath}`);
}

bumpJsonVersion("../package.json");
bumpCargoVersion("../src-tauri/Cargo.toml");
bumpJsonVersion("../src-tauri/tauri.conf.json");
cutChangelog();

console.log(`\nBumped to ${newVersion}. Cargo.lock will pick it up on the next cargo check/build.`);
