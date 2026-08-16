export const SESSION_CACHE_MAX = 50;

export function sessionCacheKey(serverUrl: string, kind: "sessions" | "detail", id?: string): string {
  return `pure-mobile.cache.v1:${encodeURIComponent(serverUrl)}:${kind}:${id ? encodeURIComponent(id) : "all"}`;
}
