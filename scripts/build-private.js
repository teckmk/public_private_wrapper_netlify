#!/usr/bin/env node
/**
 * Netlify build entry point.
 *
 * Clones the private application repository at build time, installs its
 * dependencies, builds it, and verifies the static export exists so Netlify
 * can publish `.private-source/out`.
 *
 * Required environment variables (set in Netlify, never committed):
 *   SOURCE_REPO_URL    https://github.com/<owner>/<repo>.git (no credentials)
 *   SOURCE_REPO_TOKEN  GitHub fine-grained token, Contents: Read-only
 *
 * Optional:
 *   SOURCE_REPO_BRANCH Branch to build (defaults to the repo's default branch)
 *
 * Any failure exits non-zero, which makes Netlify fail the build and keep
 * the previous deployment live (no partial deploys).
 */

"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_DIR = path.join(ROOT, ".private-source");
const OUT_DIR = path.join(SOURCE_DIR, "out");

const secrets = [];

function redact(text) {
  let result = String(text);
  for (const secret of secrets) {
    if (secret) result = result.split(secret).join("***");
  }
  return result;
}

function log(message) {
  console.log(`[build-private] ${redact(message)}`);
}

function fail(message) {
  console.error(`[build-private] ERROR: ${redact(message)}`);
  process.exit(1);
}

function requireEnv(name) {
  const value = (process.env[name] || "").trim();
  if (!value) fail(`Missing required environment variable ${name}.`);
  return value;
}

function parseRepoUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("SOURCE_REPO_URL is not a valid URL.");
  }
  if (url.protocol !== "https:") {
    fail("SOURCE_REPO_URL must use https://.");
  }
  if (url.username || url.password) {
    fail("SOURCE_REPO_URL must not contain credentials; use SOURCE_REPO_TOKEN.");
  }
  return url;
}

// Environment for child processes, with the token removed so the private
// app's install/build scripts can never read or leak it.
function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.SOURCE_REPO_TOKEN;
  return env;
}

// Runs a command with inherited stdio (for npm, which never sees the token).
function run(cmd, args, options = {}) {
  log(`$ ${cmd} ${args.join(" ")}`);
  const res = spawnSync(cmd, args, { stdio: "inherit", ...options });
  if (res.error) fail(`Failed to start ${cmd}: ${res.error.message}`);
  if (res.status !== 0) fail(`${cmd} ${args.join(" ")} exited with code ${res.status}.`);
}

// Runs a command with captured output, redacting secrets before printing.
function runCaptured(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...options });
  if (res.stdout) process.stdout.write(redact(res.stdout));
  if (res.stderr) process.stderr.write(redact(res.stderr));
  if (res.error) fail(`Failed to start ${cmd}: ${res.error.message}`);
  return res;
}

function cloneSource(repoUrl, token, branch) {
  fs.rmSync(SOURCE_DIR, { recursive: true, force: true });

  // Pass the token as an HTTP Authorization header via GIT_CONFIG_* env vars
  // rather than embedding it in the URL or argv, so it never appears in the
  // clone's remote config, process list, or git's own output.
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  secrets.push(basic);

  const args = ["clone", "--depth", "1", "--single-branch"];
  if (branch) args.push("--branch", branch);
  args.push(repoUrl.href, SOURCE_DIR);

  log(`Cloning ${repoUrl.host}${repoUrl.pathname}${branch ? ` (branch ${branch})` : ""}`);
  const res = runCaptured("git", args, {
    cwd: ROOT,
    env: cleanEnv({
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `http.${repoUrl.origin}/.extraheader`,
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
    }),
  });

  if (res.status !== 0) {
    fs.rmSync(SOURCE_DIR, { recursive: true, force: true });
    fail(
      "Could not clone the private repository. Check that SOURCE_REPO_URL is " +
        "correct and SOURCE_REPO_TOKEN is valid with Contents: Read-only access."
    );
  }

  const rev = spawnSync("git", ["rev-parse", "HEAD"], { cwd: SOURCE_DIR, encoding: "utf8" });
  if (rev.status === 0) log(`Building commit ${rev.stdout.trim()}`);
}

function verifyOutput() {
  if (!fs.existsSync(OUT_DIR) || !fs.statSync(OUT_DIR).isDirectory()) {
    fail(
      `Expected static export at ${path.relative(ROOT, OUT_DIR)} but it does not exist. ` +
        'Ensure next.config sets output: "export".'
    );
  }
  if (fs.readdirSync(OUT_DIR).length === 0) {
    fail(`Static export directory ${path.relative(ROOT, OUT_DIR)} is empty.`);
  }
}

function main() {
  const repoUrl = parseRepoUrl(requireEnv("SOURCE_REPO_URL"));
  const token = requireEnv("SOURCE_REPO_TOKEN");
  secrets.push(token);
  const branch = (process.env.SOURCE_REPO_BRANCH || "").trim();

  cloneSource(repoUrl, token, branch);

  if (!fs.existsSync(path.join(SOURCE_DIR, "package-lock.json"))) {
    fail("Private repository has no package-lock.json; npm ci requires one.");
  }

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, ["ci"], { cwd: SOURCE_DIR, env: cleanEnv() });
  run(npm, ["run", "build"], { cwd: SOURCE_DIR, env: cleanEnv() });

  verifyOutput();
  log(`Static export ready at ${path.relative(ROOT, OUT_DIR)}`);
}

main();
