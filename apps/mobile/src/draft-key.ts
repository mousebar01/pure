const DRAFT_PREFIX = "pure-mobile.draft.v1";

export function draftStorageKey(serverUrl: string, sessionId?: string): string {
  return `${DRAFT_PREFIX}:${encodeURIComponent(serverUrl)}:${sessionId || "new"}`;
}
