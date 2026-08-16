import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";

export type WebIconName =
  | "attachment"
  | "compact"
  | "model"
  | "thinking"
  | "tools";

const ICONS: Record<WebIconName, ComponentProps<typeof Ionicons>["name"]> = {
  attachment: "image-outline",
  compact: "contract-outline",
  model: "hardware-chip-outline",
  thinking: "bulb-outline",
  tools: "build-outline",
};

export function WebAlignedIcon({ name, color, size = 14 }: { name: WebIconName; color: string; size?: number }) {
  return <Ionicons name={ICONS[name]} color={color} size={size} />;
}
