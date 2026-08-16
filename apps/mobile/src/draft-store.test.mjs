import assert from "node:assert/strict";
import { createJiti } from "jiti";
import test from "node:test";

const jiti = createJiti(import.meta.url);
const { draftStorageKey } = await jiti.import("./draft-key.ts");

test("isolates drafts by server and session", () => {
  assert.notEqual(draftStorageKey("http://host-a:30001", "session-1"), draftStorageKey("http://host-b:30001", "session-1"));
  assert.notEqual(draftStorageKey("http://host-a:30001", "session-1"), draftStorageKey("http://host-a:30001", "session-2"));
  assert.equal(draftStorageKey("http://host-a:30001"), "pure-mobile.draft.v1:http%3A%2F%2Fhost-a%3A30001:new");
});
