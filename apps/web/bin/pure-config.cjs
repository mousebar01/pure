/* eslint-disable @typescript-eslint/no-require-imports */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_USERNAME = "pi";

function getPureConfigPath(env = process.env) {
  return env.PURE_CONFIG_PATH
    || env.PI_PURE_CONFIG_PATH
    || path.join(os.homedir(), ".pi", "agent", "pure-config.json");
}

function validateUsername(username) {
  if (typeof username !== "string" || username.length === 0 || username.length > 128 || /[:\u0000-\u001f\u007f]/.test(username)) {
    throw new Error("Pure access username must be 1-128 characters without colon or control characters");
  }
  return username;
}

function validateConfig(parsed, configPath) {
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid Pure config at ${configPath}; remove the obsolete versioned config and create a new one`);
  }
  if (Object.prototype.hasOwnProperty.call(parsed, "version")) {
    throw new Error(`Invalid Pure config at ${configPath}; the version field is no longer supported, remove this config and restart Pure`);
  }
  if (Object.prototype.hasOwnProperty.call(parsed, "passwordHash") || Object.prototype.hasOwnProperty.call(parsed.auth || {}, "passwordHash")) {
    throw new Error(`Invalid Pure config at ${configPath}; passwordHash is no longer supported, set a new password in Pure settings`);
  }
  if (!parsed.auth || (parsed.auth.password !== null && typeof parsed.auth.password !== "string")) {
    throw new Error(`Invalid Pure config at ${configPath}; expected network and auth fields without a version`);
  }
  const mode = parsed.network?.mode;
  if (mode !== "local" && mode !== "lan") throw new Error(`Invalid Pure network mode at ${configPath}`);
  const username = validateUsername(parsed.auth.username);
  return {
    network: { mode },
    auth: { username, password: parsed.auth.password ?? null },
  };
}

function readPureConfig(env = process.env) {
  const configPath = getPureConfigPath(env);
  if (!fs.existsSync(configPath)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read Pure config at ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateConfig(parsed, configPath);
}

function assertEnvironment(env) {
  if (env.PURE_PASSWORD) {
    throw new Error("PURE_PASSWORD is no longer supported; put the password in a 0600 file and set PURE_PASSWORD_FILE.");
  }
  if (env.PURE_USERNAME !== undefined) validateUsername(env.PURE_USERNAME);
  if (env.PURE_PASSWORD_FILE) {
    const value = fs.readFileSync(env.PURE_PASSWORD_FILE, "utf8").trim();
    if (!value) throw new Error(`PURE_PASSWORD_FILE is empty: ${env.PURE_PASSWORD_FILE}`);
  }
}

function newConfig(env = process.env) {
  const username = validateUsername(env.PURE_USERNAME || DEFAULT_USERNAME);
  return {
    network: { mode: "local" },
    auth: { username, password: null },
  };
}

function ensurePureConfig(env = process.env) {
  assertEnvironment(env);
  const configPath = getPureConfigPath(env);
  const existing = readPureConfig(env);
  if (existing) return { config: existing, created: false };

  const config = newConfig(env);
  fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const content = `${JSON.stringify(config, null, 2)}\n`;
  try {
    fs.writeFileSync(configPath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    return { config: readPureConfig(env), created: false };
  }
  try { fs.chmodSync(configPath, 0o600); } catch { /* best effort on Windows */ }
  return { config, created: true };
}

function hasConfiguredCredential(env = process.env, config = readPureConfig(env)) {
  assertEnvironment(env);
  return Boolean(env.PURE_PASSWORD_FILE || config?.auth?.password);
}

module.exports = {
  DEFAULT_USERNAME,
  ensurePureConfig,
  getPureConfigPath,
  hasConfiguredCredential,
  readPureConfig,
  validateUsername,
};
