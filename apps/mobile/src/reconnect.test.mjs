import assert from "node:assert/strict";
import { createJiti } from "jiti";
import test from "node:test";

const jiti = createJiti(import.meta.url);
const { CONNECTED_SYNC_INTERVAL_MS, reconnectDelayMs } = await jiti.import("./reconnect.ts");

test("uses bounded exponential reconnect delays", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 20].map((attempt) => reconnectDelayMs(attempt)), [1000, 2000, 4000, 8000, 15000, 15000, 15000]);
  assert.equal(reconnectDelayMs(-2), 1000);
});

test("keeps connected state synchronized at a low frequency", () => {
  assert.equal(CONNECTED_SYNC_INTERVAL_MS, 15000);
});
