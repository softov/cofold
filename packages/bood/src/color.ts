import type { BoodMood, BoodScheme } from "./types.js";

/** The colours a person picks a body from. */
export const BOOD_COLORS = [
  "#f4f4f5",
  "#7a5230",
  "#d7263d",
  "#f26b0f",
  "#f59e0b",
  "#2f9e5b",
  "#2fa39a",
  "#2f6fdf",
  "#7c4fe0",
  "#d6338a",
  "#7a7a7a",
];

export const faceColors: Record<
  BoodScheme,
  {
    eyeRing: string;
    pupil: string;
    mouth: string;
    antenna: string;
    antennaDot: string;
  }
> = {
  dark: {
    eyeRing: "#DCDC00",
    pupil: "#004EEA",
    mouth: "#60a5fa",
    antenna: "#2563eb",
    antennaDot: "#b7c900",
  },
  light: {
    eyeRing: "#b7c900",
    pupil: "#004EEA",
    mouth: "#2563eb",
    antenna: "#2563eb",
    antennaDot: "#b7c900",
  },
};

/** The body colour when the mood has none of its own. */
export const bodyBaseColor: Record<BoodScheme, string> = {
  dark: "#2f9e5b",
  light: "#247a46",
};

const bodyColorByMood: Partial<Record<BoodMood, string>> = {
  thinking: "#7c3aed",
  planning: "#6366f1",
  executing: "#3b82f6",
  reflecting: "#8b5cf6",
  observing: "#0ea5e9",
  learning: "#10b981",
  waiting_external: "#475569",
  failed: "#ef4444",
  error: "#ef4444",
  sad: "#1e40af",
  surprised: "#f59e0b",
};

export function bodyColor(mood: BoodMood, scheme: BoodScheme): string {
  return bodyColorByMood[mood] ?? bodyBaseColor[scheme];
}

/** A `#rrggbb` colour moved `amount` (0 to 1) of the way to black. */
export function darken(color: string, amount: number): string {
  const channel = (at: number) =>
    Math.round(parseInt(color.slice(at, at + 2), 16) * (1 - amount))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/** A `#rrggbb` colour moved `amount` (0 to 1) of the way to white. */
export function lighten(color: string, amount: number): string {
  const channel = (at: number) => {
    const value = parseInt(color.slice(at, at + 2), 16);
    return Math.round(value + (255 - value) * amount)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/** The ink a filled body's face is drawn in. */
export const FACE_INK = "#0f172a";
