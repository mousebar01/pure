import EventSource, { type EventSourceListener } from "react-native-sse";
import { encode as encodeBase64 } from "js-base64";
import type { AgentEvent, ConnectionConfig, DirectoryBrowseResponse, MobileDeviceInfo, ModelsResponse, NewSessionOptions, SessionDetail, SessionInfo, WorktreesResponse } from "./types";

const TOOL_PRESETS = {
  none: [],
  default: ["read", "bash", "edit", "write"],
  full: ["bash", "read", "edit", "write", "grep", "find", "ls"],
} as const;

export function normalizeServerUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) return `http://${trimmed}`;
  return trimmed;
}

export type ConnectionStage = "address" | "network" | "authentication" | "server" | "version";

export class ConnectionError extends Error {
  constructor(readonly stage: ConnectionStage, message: string, readonly status?: number) {
    super(message);
    this.name = "ConnectionError";
  }
}

export function connectionErrorMessage(cause: unknown): string {
  if (cause instanceof ConnectionError) return cause.message;
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/network request failed|fetch failed|load failed/i.test(message)) return "无法访问服务器。请确认手机与电脑网络互通，并检查地址和端口。";
  return message;
}

export function buildAuthorizationHeader(config: ConnectionConfig): string | null {
  if (config.token) return `Bearer ${config.token}`;
  if (config.password) return `Basic ${encodeBase64(`pi:${config.password}`)}`;
  return null;
}

export class PiApi {
  readonly serverUrl: string;
  private readonly authHeader: string | null;

  constructor(config: ConnectionConfig) {
    try {
      this.serverUrl = new URL(normalizeServerUrl(config.serverUrl)).toString().replace(/\/$/, "");
    } catch {
      throw new ConnectionError("address", "服务器地址无效，请输入完整的 IP、域名和端口。");
    }
    this.authHeader = buildAuthorizationHeader(config);
  }

  private headers(json = false): Record<string, string> {
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(this.authHeader ? { Authorization: this.authHeader } : {}),
    };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.serverUrl}${path}`, { ...init, headers: { ...this.headers(Boolean(init?.body)), ...(init?.headers ?? {}) } });
    } catch {
      throw new ConnectionError("network", `无法访问 ${this.serverUrl}。请确认手机和电脑网络互通，并检查地址和端口。`);
    }
    const body = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) {
      if (response.status === 401) throw new ConnectionError("authentication", "认证失败。请检查密码，或重新扫码配对。", 401);
      if (response.status === 403) throw new ConnectionError("server", "服务器拒绝了此地址。请检查 PURE_ALLOWED_HOSTS 配置。", 403);
      if (response.status === 404 && path === "/api/health") throw new ConnectionError("version", "这不是兼容的 pure 服务，或服务端版本过旧。", 404);
      throw new ConnectionError("server", body.error ?? `服务器返回 ${response.status}`, response.status);
    }
    return body;
  }

  async health(): Promise<void> {
    await this.request<{ ok: boolean }>("/api/health");
  }

  async pairDevice(name: string): Promise<{ token: string; device: { id: string; name: string; createdAt: string } }> {
    return this.request("/api/mobile/devices", { method: "POST", body: JSON.stringify({ name }) });
  }

  async redeemPairing(id: string, secret: string, name: string): Promise<{ token: string; device: { id: string; name: string; createdAt: string } }> {
    return this.request("/api/mobile/pairing/redeem", { method: "POST", body: JSON.stringify({ id, secret, name }) });
  }

  async currentDevice(): Promise<MobileDeviceInfo> {
    return (await this.request<{ device: MobileDeviceInfo }>("/api/mobile/device")).device;
  }

  async revokeCurrentDevice(): Promise<void> {
    await this.request("/api/mobile/device", { method: "DELETE" });
  }

  async sessions(): Promise<{ sessions: SessionInfo[]; runningSessionIds: string[] }> {
    return this.request("/api/sessions");
  }

  async session(id: string): Promise<SessionDetail> {
    // Thinking text is small compared with the surrounding session payload and
    // must be available immediately for the native process-row preview.
    return this.request(`/api/sessions/${encodeURIComponent(id)}?deferMedia=1`);
  }

  async thinking(sessionId: string, entryId: string, blockIndex: number): Promise<string> {
    const body = await this.request<{ thinking: string }>(`/api/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/thinking?blockIndex=${blockIndex}`);
    return body.thinking;
  }

  async renameSession(id: string, name: string): Promise<void> {
    await this.request(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
  }

  async agentState(id: string): Promise<{ running: boolean; state?: { isStreaming?: boolean; isPromptRunning?: boolean; isCompacting?: boolean } }> {
    return this.request(`/api/agent/${encodeURIComponent(id)}`);
  }

  async command<T = unknown>(id: string, command: Record<string, unknown>): Promise<T> {
    const body = await this.request<{ success?: boolean; data?: T; error?: string }>(`/api/agent/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify(command),
    });
    if (body.error) throw new Error(body.error);
    return body.data as T;
  }

  async createSession(cwd: string, options: NewSessionOptions): Promise<{ sessionId: string; model: { provider: string; modelId: string } | null; thinkingLevel?: string }> {
    const body = await this.request<{ sessionId?: string; model?: { provider: string; modelId: string } | null; thinkingLevel?: string; error?: string }>("/api/agent/new", {
      method: "POST",
      body: JSON.stringify({
        cwd,
        type: "ensure_session",
        toolNames: [...TOOL_PRESETS[options.toolPreset]],
        ...(options.model ? { provider: options.model.provider, modelId: options.model.modelId } : {}),
        ...(options.thinkingLevel && options.thinkingLevel !== "auto" ? { thinkingLevel: options.thinkingLevel } : {}),
      }),
    });
    if (!body.sessionId) throw new Error(body.error ?? "服务器没有返回会话 ID");
    return { sessionId: body.sessionId, model: body.model ?? null, thinkingLevel: body.thinkingLevel };
  }

  async defaultCwd(): Promise<string> {
    const body = await this.request<{ cwd: string }>("/api/default-cwd", { method: "POST" });
    return body.cwd;
  }

  async browseCwd(path?: string): Promise<DirectoryBrowseResponse> {
    return this.request(`/api/cwd/browse${path ? `?path=${encodeURIComponent(path)}` : ""}`);
  }

  async validateCwd(cwd: string): Promise<string> {
    const body = await this.request<{ cwd: string }>("/api/cwd/validate", {
      method: "POST",
      body: JSON.stringify({ cwd }),
    });
    return body.cwd;
  }

  async worktrees(cwd: string): Promise<WorktreesResponse> {
    return this.request(`/api/worktrees?cwd=${encodeURIComponent(cwd)}`);
  }

  async models(cwd: string): Promise<ModelsResponse> {
    return this.request(`/api/models?cwd=${encodeURIComponent(cwd)}`);
  }

  events(id: string, onEvent: (event: AgentEvent) => void, onError: () => void): () => void {
    const source = new EventSource<"message">(
      `${this.serverUrl}/api/agent/${encodeURIComponent(id)}/events`,
      { headers: this.headers() },
    );
    const messageListener: EventSourceListener<"message"> = (event) => {
      if (event.type !== "message" || !event.data) return;
      try { onEvent(JSON.parse(event.data) as AgentEvent); } catch { /* ignore malformed frames */ }
    };
    const errorListener: EventSourceListener<"error"> = () => onError();
    source.addEventListener("message", messageListener);
    source.addEventListener("error", errorListener);
    return () => source.close();
  }
}

export function normalizedServerUrl(value: string): string {
  return normalizeServerUrl(value);
}
