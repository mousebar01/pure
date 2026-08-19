import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildLocalCandidates, isPrivateIpv4 } = await jiti.import("./discovery.ts");

test("only private IPv4 addresses are eligible for local discovery", () => {
  assert.equal(isPrivateIpv4("192.168.1.5"), true);
  assert.equal(isPrivateIpv4("10.0.0.12"), true);
  assert.equal(isPrivateIpv4("172.20.0.5"), true);
  assert.equal(isPrivateIpv4("8.8.8.8"), false);
});

test("local discovery stays inside the current /24", () => {
  const candidates = buildLocalCandidates("192.168.1.42");
  assert.equal(candidates.length, 254);
  assert.equal(candidates[0], "192.168.1.42");
  assert.equal(candidates.includes("192.168.2.42"), false);
  assert.deepEqual(buildLocalCandidates("127.0.0.1"), []);
});
