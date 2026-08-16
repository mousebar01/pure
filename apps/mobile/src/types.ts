export interface SessionInfo {
  id: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  projectRoot?: string;
  worktreeBranch?: string;
}

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ImageBlock {
  type: "image";
  source?: { type?: string; data?: string; media_type?: string; url?: string };
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  deferred?: boolean;
  sourceBlockIndex?: number;
}

export interface ToolCallBlock {
  type: "toolCall";
  toolCallId?: string;
  toolName?: string;
  name?: string;
  input?: Record<string, unknown>;
  arguments?: Record<string, unknown>;
}

export type ContentBlock = TextBlock | ImageBlock | ThinkingBlock | ToolCallBlock;

export type AgentMessage =
  | { role: "user"; content: string | (TextBlock | ImageBlock)[]; timestamp?: number }
  | { role: "assistant"; content: ContentBlock[]; provider?: string; model?: string; errorMessage?: string; entryId?: string; timestamp?: number }
  | { role: "toolResult"; toolCallId?: string; toolName?: string; content: (TextBlock | ImageBlock)[]; isError?: boolean; timestamp?: number }
  | { role: "bashExecution"; command: string; output: string; exitCode?: number; timestamp?: number }
  | { role: "custom"; content: string | (TextBlock | ImageBlock)[]; customType?: string; display?: boolean; timestamp?: number };

export interface SessionContext {
  messages: AgentMessage[];
  entryIds: string[];
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
}

export interface SessionDetail {
  sessionId: string;
  info: SessionInfo | null;
  context: SessionContext;
}

export interface ConnectionConfig {
  profileId?: string;
  name?: string;
  serverUrl: string;
  password?: string;
  token?: string;
  deviceId?: string;
}

export interface MobileDeviceInfo {
  id: string;
  name: string;
  createdAt: string;
}

export type ToolPreset = "none" | "default" | "full";

export interface MobilePreferences {
  thinkingLevel: string;
  toolPreset: ToolPreset;
}

export interface NewSessionOptions {
  model?: { provider: string; modelId: string };
  thinkingLevel?: string;
  toolPreset: ToolPreset;
}

export interface AgentEvent {
  type: string;
  message?: AgentMessage;
  errorMessage?: string;
  toolName?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

export interface ModelsResponse {
  modelList: ModelInfo[];
  defaultModel: { provider: string; modelId: string } | null;
  thinkingLevels: Record<string, string[]>;
}

export interface DirectoryEntry {
  name: string;
  path: string;
}

export interface DirectoryBrowseResponse {
  path: string;
  parentPath: string | null;
  directories: DirectoryEntry[];
  drives?: DirectoryEntry[];
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  isMain: boolean;
}

export interface WorktreesResponse {
  projectRoot: string;
  isGit: boolean;
  isTopLevel: boolean;
  worktrees: WorktreeInfo[];
}
