import assert from "node:assert/strict";
import { createJiti } from "jiti";
import test from "node:test";

const jiti = createJiti(import.meta.url);
const subject = () => jiti.import("./preferences.ts");

test("normalizes persisted mobile preferences", async () => {
  const { normalizePreferences } = await subject();
  assert.deepEqual(normalizePreferences({}), { thinkingLevel: "auto", toolPreset: "default" });
  assert.deepEqual(normalizePreferences({ thinkingLevel: "high", toolPreset: "full" }), { thinkingLevel: "high", toolPreset: "full" });
  assert.deepEqual(normalizePreferences({ thinkingLevel: "off", toolPreset: "invalid" }), { thinkingLevel: "off", toolPreset: "default" });
});
