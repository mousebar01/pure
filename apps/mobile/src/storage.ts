import * as SecureStore from "expo-secure-store";
import type { ConnectionConfig, MobilePreferences } from "./types";
import { DEFAULT_PREFERENCES, normalizePreferences } from "./preferences";

const CONNECTIONS_KEY = "pure-mobile.connections.v3";
const THEME_KEY = "pure-mobile.theme.v1";
const PREFERENCES_KEY = "pure-mobile.preferences.v1";
export async function loadConnection(): Promise<ConnectionConfig | null> {
  try {
    const profilesValue = await SecureStore.getItemAsync(CONNECTIONS_KEY);
    if (profilesValue) {
      const stored = JSON.parse(profilesValue) as { activeId?: string; profiles?: ConnectionConfig[] };
      const profiles = Array.isArray(stored.profiles) ? stored.profiles : [];
      const active = profiles.find((profile) => profile.profileId === stored.activeId) ?? profiles[0];
      if (active?.serverUrl) return active;
    }
    return null;
  } catch {
    return null;
  }
}

export async function loadConnections(): Promise<{ activeId?: string; profiles: ConnectionConfig[] }> {
  try {
    const value = await SecureStore.getItemAsync(CONNECTIONS_KEY);
    if (value) {
      const stored = JSON.parse(value) as { activeId?: string; profiles?: ConnectionConfig[] };
      const profiles = Array.isArray(stored.profiles) ? stored.profiles.filter((profile) => typeof profile?.serverUrl === "string") : [];
      return { activeId: stored.activeId, profiles };
    }
    return { profiles: [] };
  } catch {
    return { profiles: [] };
  }
}

export async function saveConnection(config: ConnectionConfig): Promise<void> {
  const stored = await loadConnections();
  const profileId = config.profileId || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const profile = { ...config, profileId, name: config.name?.trim() || new URL(config.serverUrl).hostname };
  const profiles = [...stored.profiles.filter((candidate) => candidate.profileId !== profileId && candidate.serverUrl !== profile.serverUrl), profile];
  await SecureStore.setItemAsync(CONNECTIONS_KEY, JSON.stringify({ activeId: profileId, profiles }), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearConnection(): Promise<void> {
  const stored = await loadConnections();
  const profiles = stored.profiles.filter((profile) => profile.profileId !== stored.activeId);
  await SecureStore.setItemAsync(CONNECTIONS_KEY, JSON.stringify({ activeId: profiles[0]?.profileId, profiles }), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
}

export async function selectConnection(profileId: string): Promise<ConnectionConfig | null> {
  const stored = await loadConnections();
  const profile = stored.profiles.find((candidate) => candidate.profileId === profileId) ?? null;
  if (!profile) return null;
  await SecureStore.setItemAsync(CONNECTIONS_KEY, JSON.stringify({ activeId: profileId, profiles: stored.profiles }), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  return profile;
}

export async function loadTheme(): Promise<"light" | "dark"> {
  try {
    const value = await SecureStore.getItemAsync(THEME_KEY);
    return value === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export async function saveTheme(theme: "light" | "dark"): Promise<void> {
  await SecureStore.setItemAsync(THEME_KEY, theme, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadPreferences(): Promise<MobilePreferences> {
  try {
    const value = await SecureStore.getItemAsync(PREFERENCES_KEY);
    if (!value) return DEFAULT_PREFERENCES;
    return normalizePreferences(JSON.parse(value) as Partial<MobilePreferences>);
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export async function savePreferences(preferences: MobilePreferences): Promise<void> {
  await SecureStore.setItemAsync(PREFERENCES_KEY, JSON.stringify(preferences), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}
