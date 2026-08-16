const DEFAULT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const;

export const CONNECTED_SYNC_INTERVAL_MS = 15_000;

export function reconnectDelayMs(attempt: number, delays: readonly number[] = DEFAULT_DELAYS_MS): number {
  const normalizedAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return delays[Math.min(normalizedAttempt, delays.length - 1)] ?? 15_000;
}
