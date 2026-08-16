import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SessionDetail, SessionInfo } from "./types";
import { SESSION_CACHE_MAX, sessionCacheKey } from "./session-cache-key";

export async function readCachedSessions(serverUrl: string): Promise<{ sessions: SessionInfo[]; runningSessionIds: string[] } | null> {
  try {
    const raw = await AsyncStorage.getItem(sessionCacheKey(serverUrl, "sessions"));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sessions?: SessionInfo[] };
    if (!Array.isArray(parsed.sessions)) return null;
    return { sessions: parsed.sessions, runningSessionIds: [] };
  } catch {
    return null;
  }
}

export async function writeCachedSessions(serverUrl: string, sessions: SessionInfo[]): Promise<void> {
  try {
    await AsyncStorage.setItem(sessionCacheKey(serverUrl, "sessions"), JSON.stringify({ sessions: sessions.slice(0, SESSION_CACHE_MAX) }));
  } catch { /* cache failures must not affect the app */ }
}

export async function readCachedDetail(serverUrl: string, sessionId: string): Promise<SessionDetail | null> {
  try {
    const raw = await AsyncStorage.getItem(sessionCacheKey(serverUrl, "detail", sessionId));
    if (!raw) return null;
    return JSON.parse(raw) as SessionDetail;
  } catch {
    return null;
  }
}

export async function writeCachedDetail(serverUrl: string, detail: SessionDetail): Promise<void> {
  try {
    await AsyncStorage.setItem(sessionCacheKey(serverUrl, "detail", detail.sessionId), JSON.stringify(detail));
  } catch { /* cache failures must not affect the app */ }
}
