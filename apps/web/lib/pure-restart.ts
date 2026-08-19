import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getPureConfigPath } from "./pure-config";

export function getPureRestartRequestPath(): string {
  return process.env.PURE_RESTART_PATH || join(dirname(getPureConfigPath()), "pure-restart.request");
}

/** Ask the outer pure launcher to restart its Next.js child process. */
export function requestPureRestart(): void {
  const requestPath = getPureRestartRequestPath();
  mkdirSync(dirname(requestPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${requestPath}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify({ requestedAt: new Date().toISOString() })}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, requestPath);
  } finally {
    try { unlinkSync(temporaryPath); } catch { /* already renamed */ }
  }
}

export function isPureRestartSupported(): boolean {
  return process.env.PURE_SUPERVISOR === "1";
}

export function consumePureRestartRequest(): boolean {
  const requestPath = getPureRestartRequestPath();
  if (!existsSync(requestPath)) return false;
  try {
    unlinkSync(requestPath);
    return true;
  } catch {
    return false;
  }
}
