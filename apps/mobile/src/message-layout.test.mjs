import assert from "node:assert/strict";
import { createJiti } from "jiti";
import test from "node:test";

const jiti = createJiti(import.meta.url);
const subject = () => jiti.import("./message-layout.ts");

const user = { role: "user", content: "开始" };
const toolCall = { role: "assistant", content: [{ type: "thinking", thinking: "先检查" }, { type: "toolCall", toolCallId: "tool-1", toolName: "read", input: { path: "a.ts" } }] };
const toolResult = { role: "toolResult", toolCallId: "tool-1", toolName: "read", content: [{ type: "text", text: "内容" }] };
const answer = { role: "assistant", content: [{ type: "thinking", thinking: "整理结论" }, { type: "text", text: "最终回答" }] };

test("folds completed process messages ahead of the final answer", async () => {
  const { buildChatList } = await subject();
  const items = buildChatList([user, toolCall, toolResult, answer], false);
  assert.deepEqual(items.map((item) => item.type), ["message", "process", "message"]);
  assert.equal(items[1].live, false);
  assert.equal(items[1].toolCallCount, 1);
  assert.equal(items[1].messages.length, 2);
  assert.equal(items[2].message.content[0].text, "最终回答");
});

test("keeps an active turn in an expanded live process group", async () => {
  const { buildChatList } = await subject();
  const items = buildChatList([user, toolCall, toolResult], true);
  assert.deepEqual(items.map((item) => item.type), ["message", "process"]);
  assert.equal(items[1].live, true);
});

test("pairs tool results without rendering them as standalone messages", async () => {
  const { buildChatList, collectToolResults } = await subject();
  const messages = [user, toolCall, toolResult, answer];
  assert.equal(buildChatList(messages, false).some((item) => item.type === "message" && item.message.role === "toolResult"), false);
  assert.equal(collectToolResults(messages).get("tool-1").content[0].text, "内容");
});

test("preserves deferred thinking and its original block index when splitting", async () => {
  const { buildChatList } = await subject();
  const deferredAnswer = { role: "assistant", entryId: "entry-1", content: [{ type: "thinking", thinking: "", deferred: true }, { type: "text", text: "最终回答" }] };
  const items = buildChatList([user, deferredAnswer], false);
  assert.equal(items[1].type, "process");
  assert.equal(items[1].messages[0].content[0].deferred, true);
  assert.equal(items[1].messages[0].content[0].sourceBlockIndex, 0);
  assert.equal(items[2].message.content[0].text, "最终回答");
});

test("shows the scroll affordance only when content is more than 80px away from the bottom", async () => {
  const { isScrollAwayFromBottom } = await subject();
  assert.equal(isScrollAwayFromBottom({ offset: 0, viewport: 0, content: 0 }), false);
  assert.equal(isScrollAwayFromBottom({ offset: 0, viewport: 800, content: 600 }), false);
  assert.equal(isScrollAwayFromBottom({ offset: 120, viewport: 800, content: 1000 }), false);
  assert.equal(isScrollAwayFromBottom({ offset: 119, viewport: 800, content: 1000 }), true);
  assert.equal(isScrollAwayFromBottom({ offset: -20, viewport: 800, content: 850 }), false);
});

test("uses hysteresis to keep the scroll affordance stable near the bottom", async () => {
  const { shouldShowScrollToBottom } = await subject();
  const metrics = (distance) => ({ offset: 1000 - 800 - distance, viewport: 800, content: 1000 });
  assert.equal(shouldShowScrollToBottom(metrics(31), false), false);
  assert.equal(shouldShowScrollToBottom(metrics(33), false), true);
  assert.equal(shouldShowScrollToBottom(metrics(17), true), true);
  assert.equal(shouldShowScrollToBottom(metrics(16), true), false);
});

test("uses the bottom tolerance when classifying the final scroll position", async () => {
  const { BOTTOM_TOLERANCE, isScrollAwayFromBottom } = await subject();
  assert.equal(isScrollAwayFromBottom({ offset: 183, viewport: 800, content: 1000 }, BOTTOM_TOLERANCE), true);
  assert.equal(isScrollAwayFromBottom({ offset: 184, viewport: 800, content: 1000 }, BOTTOM_TOLERANCE), false);
});

test("keeps message gaps and scroll thresholds explicit", async () => {
  const { BOTTOM_TOLERANCE, CHAT_BOTTOM_GAP, MESSAGE_SPACING, SCROLL_BUTTON_SHOW_DISTANCE } = await subject();
  assert.equal(CHAT_BOTTOM_GAP, 24);
  assert.equal(MESSAGE_SPACING, 16);
  assert.equal(BOTTOM_TOLERANCE, 16);
  assert.equal(SCROLL_BUTTON_SHOW_DISTANCE, 32);
});
