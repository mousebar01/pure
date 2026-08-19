import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);

test("keeps a new config unauthenticated until a custom password is set", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pure-auth-"));
  const previousPath = process.env.PURE_CONFIG_PATH;
  process.env.PURE_CONFIG_PATH = join(directory, "pure-config.json");
  try {
    const config = await jiti.import("./pure-config.ts");
    const auth = await jiti.import("./web-auth.ts");
    config.ensurePureConfig();
    config.updatePureConfig({ username: "operator" });
    assert.equal(config.getPureConfigStatus().passwordConfigured, false);
    assert.equal(auth.isWebPasswordEnabled(), false);
    config.setPurePassword("custom-password-123");
    assert.equal(config.getPureConfigStatus().passwordConfigured, true);
    assert.equal(config.getPureConfigStatus().passwordSource, "config");
    assert.equal(config.getPureConfigStatus().password, "custom-password-123");
    assert.equal(auth.isValidBasicAuthorization(`Basic ${Buffer.from("operator:custom-password-123", "utf8").toString("base64")}`), true);
    assert.equal(auth.isWebPasswordEnabled(), true);
    assert.equal(auth.isValidBasicAuthorization("Basic invalid"), false);
  } finally {
    if (previousPath === undefined) delete process.env.PURE_CONFIG_PATH;
    else process.env.PURE_CONFIG_PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  }
});
