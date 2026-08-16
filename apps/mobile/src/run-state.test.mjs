import assert from "node:assert/strict";
import { createJiti } from "jiti";
import test from "node:test";

const jiti = createJiti(import.meta.url);
const { IDLE_RUN_STATE, applyRunEvent, beginPromptRun } = await jiti.import("./run-state.ts");

test("settles a normal prompt only after prompt_done", () => {
  let state = beginPromptRun(IDLE_RUN_STATE);
  ({ state } = applyRunEvent(state, "agent_start"));
  const agentSettled = applyRunEvent(state, "agent_settled");
  assert.equal(agentSettled.settled, false);
  const promptDone = applyRunEvent(agentSettled.state, "prompt_done");
  assert.equal(promptDone.settled, true);
});

test("keeps running when an extension agent starts before prompt_done", () => {
  let state = beginPromptRun(IDLE_RUN_STATE);
  ({ state } = applyRunEvent(state, "agent_start"));
  ({ state } = applyRunEvent(state, "agent_settled"));
  ({ state } = applyRunEvent(state, "agent_start"));
  const promptDone = applyRunEvent(state, "prompt_done");
  assert.equal(promptDone.settled, false);
  assert.equal(applyRunEvent(promptDone.state, "agent_settled").settled, true);
});

test("ignores duplicate settled events without an active agent", () => {
  assert.equal(applyRunEvent(IDLE_RUN_STATE, "agent_settled").settled, false);
});
