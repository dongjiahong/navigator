import { colorScheme } from "nsh";

export type Theme = ReturnType<typeof theme>;

/**
 * The board's palette: cool ivory paper under a steel-blue accent, so the
 * surface reads like a system window rather than a dashboard. Every colour is
 * defined for both appearances; dark is a scheme of its own, not a filter.
 */
function light() {
  return {
    dark: false,
    /** The desk the board sits on: cool ivory, lit from the top-left. */
    ground: "#EFF1F2",
    groundTint: "#F6F7F8",
    groundDeep: "#E4E7EA",
    /** Seeded light, and the tint a selected card takes. */
    light: "#FFFFFF",
    lightWarm: "#FCFCFA",
    /** The open card: paper pressed into the desk, not a fourth colour. A blue
     *  fill would outshout every tag on a board whose whole point is quiet. */
    select: "#E9EDF0",
    selectEdge: "#CFD6DB",
    /** Paper a card is printed on. */
    card: "#FFFFFF",
    cardHover: "#FFFFFF",
    cardPressed: "#F7F9FA",
    hairline: "rgba(22, 30, 38, 0.075)",
    hairlineSoft: "rgba(22, 30, 38, 0.055)",
    /** Divider between two columns, and the rule under a column's label. */
    divider: "#DDE2E5",
    text: "#1A1C1E",
    textSecondary: "#5A6067",
    textTertiary: "#666C73",
    accent: "#2E6DA4",
    /** Accent as a label on its own soft fill, deep enough to clear 4.5:1. */
    accentMuted: "#245F94",
    accentSoft: "#E4EDF5",
    danger: "#B23A32",
    dangerSoft: "rgba(178, 58, 50, 0.11)",
    warn: "#8A5A12",
    warnSoft: "rgba(138, 90, 18, 0.14)",
    ok: "#1F7A55",
    /** Selected row / chip fill. */
    chip: "rgba(22, 30, 38, 0.045)",
    /** Elevation comes from one tight shadow, never shadow plus border. */
    shadow: "0 0.5px 1px rgba(22, 30, 38, 0.09), 0 1.5px 3px rgba(22, 30, 38, 0.055)",
    shadowLift: "0 4px 10px rgba(22, 30, 38, 0.13), 0 18px 44px rgba(22, 30, 38, 0.17)",
    panel: "#FAFBFC",
    scrim: "rgba(16, 22, 28, 0.26)",
  };
}

function dark() {
  return {
    dark: true,
    ground: "#17191B",
    groundTint: "#1F2224",
    groundDeep: "#121415",
    light: "#31363A",
    lightWarm: "#2C3135",
    select: "#2B3136",
    selectEdge: "#3F474D",
    card: "#24282B",
    cardHover: "#2A2F32",
    cardPressed: "#2F3438",
    hairline: "rgba(255, 255, 255, 0.085)",
    hairlineSoft: "rgba(255, 255, 255, 0.055)",
    divider: "rgba(255, 255, 255, 0.10)",
    text: "#F0F2F4",
    textSecondary: "#AEB4BA",
    textTertiary: "#949BA2",
    accent: "#6FA9DC",
    accentMuted: "#A9CBEA",
    accentSoft: "rgba(111, 169, 220, 0.18)",
    danger: "#FF8377",
    dangerSoft: "rgba(255, 131, 119, 0.16)",
    warn: "#E3AE5E",
    warnSoft: "rgba(227, 174, 94, 0.18)",
    ok: "#63C99B",
    chip: "rgba(255, 255, 255, 0.06)",
    shadow: "0 0.5px 1px rgba(0, 0, 0, 0.42), 0 1.5px 3px rgba(0, 0, 0, 0.28)",
    shadowLift: "0 4px 12px rgba(0, 0, 0, 0.50), 0 20px 48px rgba(0, 0, 0, 0.60)",
    panel: "#1E2123",
    scrim: "rgba(0, 0, 0, 0.55)",
  };
}

export function theme() {
  return colorScheme() === "dark" ? dark() : light();
}

/**
 * The five hues a tag may carry: the only saturated colour the board allows.
 * Each is defined twice — a light value that clears 4.5:1 on white paper, and a
 * dark value that clears it on the dark card. The same hue in both would fail
 * one of them. Tags themselves are the user's (see `data.ts`); this is the
 * palette they draw from.
 */
export const HUES = [
  { id: "blue", light: "#2E6DA4", dark: "#79B4E8" },
  { id: "green", light: "#1F7A55", dark: "#63C99B" },
  { id: "purple", light: "#5F53A8", dark: "#A99BEA" },
  { id: "amber", light: "#96622A", dark: "#D9A566" },
  { id: "red", light: "#B23A32", dark: "#FF8A80" },
] as const;

export type Hue = (typeof HUES)[number]["id"];

/** The hue in the appearance in use. */
export function hueColor(hue: Hue): string {
  const found = HUES.find((h) => h.id === hue) ?? HUES[0];
  return colorScheme() === "dark" ? found.dark : found.light;
}

/**
 * An accent label sitting on an accent wash — a chip, a tinted button.
 *
 * The wash lifts the ground under the label, which costs contrast: the plain
 * accent measures 4.30–4.37:1 in light and 3.83:1 on the dark selected chip,
 * under the 4.5:1 floor. `accentMuted` is the twin for exactly that surface and
 * clears it at every wash strength this app uses — 5.00–5.56:1 light,
 * 5.67–8.28:1 dark.
 */
export function onAccentWash(): string {
  return theme().accentMuted;
}

/**
 * Content drawn *on* a filled accent surface — a button label, a glyph.
 *
 * Light fills with the deep accent, so its content is white (5.47:1). Dark's
 * accent is a pale blue, and white on it is 2.50:1: a dark scheme fills with the
 * bright accent and draws near-black content on it (7.42:1), which is also how
 * the phone's finished-check already worked.
 */
export function onAccentFill(): string {
  return colorScheme() === "dark" ? "#0D1418" : "#FFFFFF";
}

/**
 * Content drawn on a filled semantic surface that is not the accent: the
 * phone's swipe bands, green and red.
 *
 * The same rule as `onAccentFill()`, for the same reason — light mode's fills
 * are deep, so their content is white (5.29:1 on `ok`, 5.93:1 on `danger`), and
 * dark mode's are pale, so theirs is near-black (9.16:1 and 7.75:1). The neutral
 * band is not here: it is `select`, not a fill, and takes `textSecondary`
 * (5.40:1 light, 6.29:1 dark).
 */
export function onFill(): string {
  return colorScheme() === "dark" ? "#0D1418" : "#FFFFFF";
}

/**
 * Type: the platform's own scale. Titles carry no weight to make up for a weak
 * layout — they are regular weight, like a list row in a native app, and the
 * hierarchy comes from size, colour and space.
 */
export const TYPE = {
  /** Mac board column label. */
  columnLabel: { fontSize: 12.5, fontWeight: "600" as const, letterSpacing: 0.3 },
  /** Mac card title. */
  cardTitle: { fontSize: 14, fontWeight: "400" as const, lineHeight: 20.5, letterSpacing: 0.05 },
  /** Mac inspector title. */
  inspectorTitle: { fontSize: 19.5, fontWeight: "600" as const, lineHeight: 27, letterSpacing: 0 },
  body: { fontSize: 13, fontWeight: "400" as const, lineHeight: 20.5 },
  /** Phone card title: one step larger, for touch. */
  phoneTitle: { fontSize: 16.5, fontWeight: "400" as const, lineHeight: 23.5, letterSpacing: 0 },
  meta: { fontSize: 12, fontWeight: "500" as const, letterSpacing: 0.1 },
  metaPhone: { fontSize: 12.5, fontWeight: "500" as const, letterSpacing: 0.1 },
};
