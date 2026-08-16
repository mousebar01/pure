export type ThemeMode = "light" | "dark";

export const lightColors = {
  canvas: "#ffffff",
  surface: "#ffffff",
  panel: "#f5f5f5",
  hover: "#eeeeee",
  selected: "#e8e8e8",
  ink: "#1a1a1a",
  muted: "#6b7280",
  faint: "#9ca3af",
  line: "#e0e0e0",
  accent: "#2563eb",
  accentPressed: "#1d4ed8",
  accentSoft: "#eff6ff",
  warm: "#d89b22",
  danger: "#dc2626",
  dangerSoft: "rgba(220,38,38,0.06)",
  tool: "#f9fafb",
  user: "#eff6ff",
  userBorder: "rgba(59,130,246,0.20)",
  subtle: "rgba(0,0,0,0.03)",
};

export const darkColors = {
  canvas: "#1a1a1a",
  surface: "#1a1a1a",
  panel: "#242424",
  hover: "#2e2e2e",
  selected: "#383838",
  ink: "#e8e8e8",
  muted: "#9ca3af",
  faint: "#6b7280",
  line: "#3a3a3a",
  accent: "#60a5fa",
  accentPressed: "#93c5fd",
  accentSoft: "#1e293b",
  warm: "#eab308",
  danger: "#f87171",
  dangerSoft: "rgba(248,113,113,0.08)",
  tool: "#1f2937",
  user: "#1e293b",
  userBorder: "rgba(96,165,250,0.20)",
  subtle: "rgba(255,255,255,0.04)",
};

export type ThemeColors = typeof lightColors;
export let colors: ThemeColors = lightColors;

export function setActiveTheme(mode: ThemeMode): ThemeColors {
  colors = mode === "dark" ? darkColors : lightColors;
  return colors;
}

export function getThemeColors(mode: ThemeMode): ThemeColors {
  return mode === "dark" ? darkColors : lightColors;
}

export const mono = "monospace" as const;
