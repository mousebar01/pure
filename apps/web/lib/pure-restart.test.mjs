import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

test("writes and consumes a restart request through the shared config directory", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pure-restart-"));
  const previousConfig = process.env.PURE_CONFIG_PATH;
  const previousRestart = process.env.PURE_RESTART_PATH;
  process.env.PURE_CONFIG_PATH = join(directory, "pure-config.json");
  delete process.env.PURE_RESTART_PATH;
  try {
    const restart = await jiti.import("./pure-restart.ts");
    restart.requestPureRestart();
    const requestPath = restart.getPureRestartRequestPath();
    assert.equal(JSON.parse(readFileSync(requestPath, "utf8")).requestedAt !== undefined, true);
    assert.equal(restart.consumePureRestartRequest(), true);
  } finally {
    if (previousConfig === undefined) delete process.env.PURE_CONFIG_PATH;
    else process.env.PURE_CONFIG_PATH = previousConfig;
    if (previousRestart === undefined) delete process.env.PURE_RESTART_PATH;
    else process.env.PURE_RESTART_PATH = previousRestart;
    rmSync(directory, { recursive: true, force: true });
  }
});
