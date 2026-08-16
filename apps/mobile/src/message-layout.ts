import type { AgentMessage, ContentBlock } from "./types";

export const CHAT_BOTTOM_GAP = 24;
export const MESSAGE_SPACING = 16;
export const BOTTOM_TOLERANCE = 16;
export const SCROLL_BUTTON_SHOW_DISTANCE = 32;

export type ChatListItem =
  | { key: string; type: "message"; message: AgentMessage; streaming?: boolean }
  | { key: string; type: "process"; messages: AgentMessage[]; live: boolean; toolCallCount: number };

export function isScrollAwayFromBottom({ offset, viewport, content }: { offset: number; viewport: number; content: number }, threshold = 80): boolean {
  if (viewport <= 0 || content <= viewport) return false;
  const safeOffset = Math.max(0, offset);
  return content - safeOffset - viewport > threshold;
}

export function shouldShowScrollToBottom(
  metrics: { offset: number; viewport: number; content: number },
  currentlyVisible: boolean,
  showThreshold = SCROLL_BUTTON_SHOW_DISTANCE,
  hideThreshold = BOTTOM_TOLERANCE,
): boolean {
  return isScrollAwayFromBottom(metrics, currentlyVisible ? hideThreshold : showThreshold);
}

function isAnchor(message: AgentMessage): boolean {
  return message.role === "user" || (message.role === "custom" && message.customType === "compaction");
}

function splitAssistant(message: Extract<AgentMessage, { role: "assistant" }>): {
  answer: Extract<AgentMessage, { role: "assistant" }> | null;
  process: Extract<AgentMessage, { role: "assistant" }> | null;
} {
  const blocks = message.content
    .map((block, sourceBlockIndex) => block.type === "thinking" ? { ...block, sourceBlockIndex } : block)
    .filter((block) => block.type !== "thinking" || block.deferred || block.thinking.trim());
  const lastProcessIndex = blocks.findLastIndex((block) => block.type !== "text" && block.type !== "image");
  if (lastProcessIndex < 0) return { answer: blocks.length ? { ...message, content: blocks } : null, process: null };
  const processBlocks = blocks.slice(0, lastProcessIndex + 1);
  const answerBlocks = blocks.slice(lastProcessIndex + 1);
  return {
    process: processBlocks.length ? { ...message, content: processBlocks } : null,
    answer: answerBlocks.length || message.errorMessage ? { ...message, content: answerBlocks } : null,
  };
}

function hasFinalAnswer(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  return splitAssistant(message).answer?.content.some((block) => block.type === "image" || (block.type === "text" && block.text.trim())) ?? false;
}

function toolCalls(messages: AgentMessage[]): number {
  return messages.reduce((total, message) => total + (message.role === "assistant"
    ? message.content.filter((block) => block.type === "toolCall").length
    : message.role === "bashExecution" ? 1 : 0), 0);
}

function displayableProcess(message: AgentMessage): boolean {
  if (message.role === "toolResult") return false;
  if (message.role === "assistant") return message.content.some((block) => block.type !== "thinking" || block.deferred || block.thinking.trim());
  if (message.role === "custom") return message.display !== false;
  return message.role === "bashExecution";
}

export function buildChatList(messages: AgentMessage[], running: boolean): ChatListItem[] {
  const items: ChatListItem[] = [];
  let lastAnchor = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isAnchor(messages[index])) { lastAnchor = index; break; }
  }

  for (let index = 0; index < messages.length;) {
    const anchor = messages[index];
    if (!isAnchor(anchor)) {
      if (anchor.role !== "toolResult") items.push({ key: `message-${index}`, type: "message", message: anchor });
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < messages.length && !isAnchor(messages[end])) end += 1;
    let finalAssistant = -1;
    for (let candidate = end - 1; candidate > index; candidate -= 1) {
      if (hasFinalAnswer(messages[candidate])) { finalAssistant = candidate; break; }
    }
    if (finalAssistant < 0) {
      for (let candidate = end - 1; candidate > index; candidate -= 1) {
        if (messages[candidate].role === "assistant") { finalAssistant = candidate; break; }
      }
    }

    items.push({ key: `message-${index}`, type: "message", message: anchor });
    const live = running && index === lastAnchor && end === messages.length;
    if (live) {
      const processMessages = messages.slice(index + 1, end).filter(displayableProcess);
      if (processMessages.length) items.push({ key: `process-live-${index}`, type: "process", messages: processMessages, live: true, toolCallCount: toolCalls(processMessages) });
      index = end;
      continue;
    }

    if (finalAssistant < 0) {
      for (let candidate = index + 1; candidate < end; candidate += 1) {
        if (messages[candidate].role !== "toolResult") items.push({ key: `message-${candidate}`, type: "message", message: messages[candidate] });
      }
      index = end;
      continue;
    }

    const processMessages = messages.slice(index + 1, finalAssistant).filter(displayableProcess);
    const final = messages[finalAssistant];
    const split = final.role === "assistant" ? splitAssistant(final) : { process: null, answer: null };
    if (split.process) processMessages.push(split.process);
    if (processMessages.length) items.push({ key: `process-${index}-${finalAssistant}`, type: "process", messages: processMessages, live: false, toolCallCount: toolCalls(processMessages) });
    if (split.answer) items.push({ key: `message-${finalAssistant}-answer`, type: "message", message: split.answer });
    for (let candidate = finalAssistant + 1; candidate < end; candidate += 1) {
      if (messages[candidate].role !== "toolResult") items.push({ key: `message-${candidate}`, type: "message", message: messages[candidate] });
    }
    index = end;
  }
  return items;
}

export function collectToolResults(messages: AgentMessage[]): Map<string, Extract<AgentMessage, { role: "toolResult" }>> {
  const results = new Map<string, Extract<AgentMessage, { role: "toolResult" }>>();
  for (const message of messages) {
    if (message.role === "toolResult" && message.toolCallId) results.set(message.toolCallId, message);
  }
  return results;
}

export function textBlocks(blocks: ContentBlock[]): string {
  return blocks.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}
