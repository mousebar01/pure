import assert from "node:assert/strict";
import { createJiti } from "jiti";
import test from "node:test";

const jiti = createJiti(import.meta.url);
const cache = await jiti.import("./session-cache-key.ts");

test("session cache exports bounded read/write helpers", () => {
  assert.equal(cache.SESSION_CACHE_MAX, 50);
  assert.equal(cache.sessionCacheKey("http://host:30001", "sessions"), "pure-mobile.cache.v1:http%3A%2F%2Fhost%3A30001:sessions:all");
  assert.notEqual(cache.sessionCacheKey("http://host:30001", "detail", "a"), cache.sessionCacheKey("http://host:30001", "detail", "b"));
});
