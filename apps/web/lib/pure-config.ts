import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";

const DEFAULT_USERNAME = "pi";
export type PureNetworkMode = "local" | "lan";

export interface PureConfig {
  network: { mode: PureNetworkMode };
  auth: { username: string; password: string | null };
}

export interface PureConfigStatus {
  configured: boolean;
  source: "config" | "environment" | "none";
  passwordConfigured: boolean;
  passwordSource: "config" | "environment" | "none";
  password: string | null;
  username: string;
  networkMode: PureNetworkMode;
}

function configPath(): string {
  return process.env.PURE_CONFIG_PATH
    || process.env.PI_PURE_CONFIG_PATH
    || `${homedir()}/.pi/agent/pure-config.json`;
}

export function validateUsername(username: unknown): string {
  if (typeof username !== "string" || username.length === 0 || username.length > 128 || /[:\u0000-\u001f\u007f]/.test(username)) {
    throw new Error("Pure access username must be 1-128 characters without colon or control characters");
  }
  return username;
}

function assertEnvironment(): void {
  if (process.env.PURE_PASSWORD) {
    throw new Error("PURE_PASSWORD is no longer supported; put the password in a 0600 file and set PURE_PASSWORD_FILE.");
  }
  if (process.env.PURE_USERNAME !== undefined) validateUsername(process.env.PURE_USERNAME);
  if (process.env.PURE_PASSWORD_FILE) {
    const value = readFileSync(process.env.PURE_PASSWORD_FILE, "utf8").trim();
    if (!value) throw new Error(`PURE_PASSWORD_FILE is empty: ${process.env.PURE_PASSWORD_FILE}`);
  }
}

function validate(value: unknown, path: string): PureConfig {
  if (!value || typeof value !== "object") throw new Error(`Invalid Pure config at ${path}; remove the obsolete versioned config and create a new one`);
  const candidate = value as Partial<PureConfig>;
  if ("version" in candidate) {
    throw new Error(`Invalid Pure config at ${path}; the version field is no longer supported, remove this config and restart Pure`);
  }
  if ((candidate.auth && "passwordHash" in candidate.auth) || "passwordHash" in candidate) {
    throw new Error(`Invalid Pure config at ${path}; passwordHash is no longer supported, set a new password in Pure settings`);
  }
  if (!candidate.auth || (candidate.auth.password !== null && typeof candidate.auth.password !== "string")) {
    throw new Error(`Invalid Pure config at ${path}; expected network and auth fields without a version`);
  }
  const mode = candidate.network?.mode;
  if (mode !== "local" && mode !== "lan") throw new Error(`Invalid Pure network mode at ${path}`);
  const username = validateUsername(candidate.auth.username);
  return {
    network: { mode },
    auth: { username, password: candidate.auth.password ?? null },
  };
}

export function getPureConfigPath(): string {
  return configPath();
}

export function readPureConfig(): PureConfig | null {
  const path = configPath();
  if (!existsSync(path)) return null;
  try {
    return validate(JSON.parse(readFileSync(path, "utf8")), path);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid Pure config")) throw error;
    throw new Error(`Cannot read Pure config at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeConfig(config: PureConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
  } finally {
    try { unlinkSync(temporaryPath); } catch { /* already renamed */ }
  }
}

function newConfig(): PureConfig {
  return {
    network: { mode: "local" },
    auth: {
      username: validateUsername(process.env.PURE_USERNAME || DEFAULT_USERNAME),
      password: null,
    },
  };
}

export function ensurePureConfig(): { config: PureConfig; created: boolean } {
  assertEnvironment();
  const existing = readPureConfig();
  if (existing) return { config: existing, created: false };
  const config = newConfig();
  writeConfig(config);
  return { config, created: true };
}

export function getEffectiveUsername(config = readPureConfig()): string {
  return validateUsername(process.env.PURE_USERNAME || config?.auth.username || DEFAULT_USERNAME);
}

export function readExternalPassword(): string | null {
  assertEnvironment();
  if (!process.env.PURE_PASSWORD_FILE) return null;
  return readFileSync(process.env.PURE_PASSWORD_FILE, "utf8").trim();
}

export function setPurePassword(password: string): PureConfig {
  if (process.env.PURE_PASSWORD_FILE) {
    throw new Error("PURE_PASSWORD_FILE is configured; set the credential where it is managed.");
  }
  if (typeof password !== "string" || password.length < 12 || password.length > 512) {
    throw new Error("Pure access password must be 12-512 characters");
  }
  const config = readPureConfig() ?? newConfig();
  const nextConfig: PureConfig = { ...config, auth: { ...config.auth, password } };
  writeConfig(nextConfig);
  return nextConfig;
}

export function updatePureConfig(patch: { username?: string; networkMode?: PureNetworkMode }): PureConfig {
  const config = readPureConfig() ?? newConfig();
  const username = patch.username === undefined ? config.auth.username : validateUsername(patch.username);
  const mode = patch.networkMode === undefined ? config.network.mode : patch.networkMode;
  if (mode !== "local" && mode !== "lan") throw new Error("Pure network mode must be local or lan");
  const next: PureConfig = {
    ...config,
    network: { mode },
    auth: { ...config.auth, username },
  };
  writeConfig(next);
  return next;
}

export function getPureConfigStatus(): PureConfigStatus {
  const configured = readPureConfig();
  const source = process.env.PURE_PASSWORD_FILE || process.env.PURE_USERNAME ? "environment" : configured ? "config" : "none";
  const passwordConfigured = Boolean(process.env.PURE_PASSWORD_FILE || configured?.auth.password);
  const passwordSource = process.env.PURE_PASSWORD_FILE ? "environment" : passwordConfigured ? "config" : "none";
  return {
    configured: passwordConfigured,
    source,
    passwordConfigured,
    passwordSource,
    password: passwordSource === "config" ? configured?.auth.password ?? null : null,
    username: getEffectiveUsername(configured),
    networkMode: configured?.network.mode ?? "local",
  };
}
