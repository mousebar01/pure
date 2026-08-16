import type { MobilePreferences } from "./types";

export const DEFAULT_PREFERENCES: MobilePreferences = { thinkingLevel: "auto", toolPreset: "default" };

export function normalizePreferences(value: Partial<MobilePreferences>): MobilePreferences {
  const toolPreset = value.toolPreset === "none" || value.toolPreset === "full" ? value.toolPreset : "default";
  return { thinkingLevel: typeof value.thinkingLevel === "string" ? value.thinkingLevel : "auto", toolPreset };
}
