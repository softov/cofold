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

/** A `#rrggbb` colour's relative luminance, from 0 (black) to 1 (white), as WCAG measures it. */
export function luminance(color: string): number {
  const linear = (at: number) => {
    const value = parseInt(color.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
}

/** How far apart two `#rrggbb` colours read, from 1 (the same) to 21 (black on white), as WCAG measures it. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** How far a body's own tone moves from the body colour, toward black or toward white. */
const TONE = 0.5;
/** The least contrast a darker tone may have against the body before it goes lighter instead. */
const TONE_CONTRAST = 2;

/**
 * The body colour, darker, for a part drawn in the body's own tone, such as a
 * mouth: or lighter, on a body so dark that a darker shade would vanish, as a
 * black, navy or slate one. A colour that is not `#rrggbb` gets the face ink,
 * as nothing can be worked out from it.
 */
export function bodyTone(color: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return FACE_INK;
  const dark = darken(color, TONE);
  return contrast(color, dark) >= TONE_CONTRAST ? dark : lighten(color, TONE);
}

/** How far toward white the face goes on a body too dark for the ink. */
const LIGHT_INK = 0.7;

/**
 * The ink a face is drawn in on a filled body of this colour: `FACE_INK`, or a
 * light tone of the body on one so dark the ink would vanish into it, as a
 * black or navy body, where dark eyes cannot be seen at all.
 */
export function faceInk(color: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(color) || contrast(color, FACE_INK) >= TONE_CONTRAST) return FACE_INK;
  return lighten(color, LIGHT_INK);
}
