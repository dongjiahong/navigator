/**
 * The Mac's filter strip, measured.
 *
 * One row holds the date conditions, a hairline, the user's tags, the tag
 * manager, 清除 and the search field — and it never scrolls sideways and never
 * pushes the search off the window. The tag chips are what gives: as many fit
 * as fit, and the rest go behind 更多.
 *
 * That decision needs a width for a chip before the layout engine has drawn it,
 * so the widths are estimated here, from the text and the chip's own padding.
 * The estimate is the number the strip is sized by; anything it gets wrong is
 * absorbed by the strip's own `overflow: hidden` and the spacer beside it, which
 * is why every constant is rounded up.
 */

/** A chip the strip draws: its label, and the dot or the count that follows it. */
export type ChipSpec = {
  id: string;
  label: string;
  /** A tag's 6px dot, with the air around it. */
  dot?: boolean;
  /** A count drawn after the label, in tabular figures. */
  count?: number;
};

/** The air between two chips, and the Mac chip's own metrics (`FilterChip`). */
const CHIP_GAP = 7;
const CHIP_PAD = 9;
const DOT = 6;
const DOT_GAP = 6;
const COUNT_GAP = 5;
const FONT = 11.5;

/**
 * How wide `text` is at `fontSize` points.
 *
 * A CJK character is exactly one em, which is the true number for a chip's
 * Chinese label; Latin and digits are counted at a little over half an em. The
 * estimate is not asked to be exact — it is asked to be honest about the chips
 * that fit, and a chip that is 2 points wider than the estimate is clipped by
 * the strip rather than pushing the search off the window.
 */
export function glyphWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      code >= 0x20000;
    width += wide ? fontSize : fontSize * 0.58;
  }
  return width;
}

/** How much room a chip takes in a row, without the air after it. */
export function chipWidth(chip: ChipSpec): number {
  let width = CHIP_PAD * 2 + glyphWidth(chip.label, FONT);
  if (chip.dot) width += DOT + DOT_GAP;
  if (chip.count !== undefined) width += COUNT_GAP + glyphWidth(String(chip.count), FONT);
  return width;
}

/**
 * How many of `chips` fit a strip `budget` points wide, and how many are left
 * over.
 *
 * The first `pinned` chips stay whatever the budget says — 全部 is the way out
 * of the tag selection, and a filter strip that hides the way out is a trap.
 * Everything after them is taken in order while it fits, with room kept for the
 * 更多 chip that will offer the rest.
 */
export function fitChips<T extends ChipSpec>(
  chips: T[],
  budget: number,
  pinned = 1,
): { shown: T[]; hidden: number } {
  const shown: T[] = [];
  let used = 0;
  for (let i = 0; i < chips.length; i++) {
    const chip = chips[i];
    const width = chipWidth(chip) + (i === 0 ? 0 : CHIP_GAP);
    const behind = chips.length - i - 1;
    // Two digits is all a count of tags in one strip will need; the reserve is
    // the same whether one tag or ninety are hidden, so the decision does not
    // depend on its own answer.
    const reserve = behind > 0 ? CHIP_GAP + chipWidth({ id: "more", label: "更多", count: 99 }) : 0;
    if (i >= pinned && used + width + reserve > budget) break;
    shown.push(chip);
    used += width;
  }
  return { shown, hidden: chips.length - shown.length };
}

/** The date group's labels and counts, as the strip lays them out. */
export function dateGroupWidth(labels: { label: string; count: number }[]): number {
  let width = 0;
  for (const chip of labels) width += chipWidth({ id: chip.label, label: chip.label, count: chip.count });
  return width + CHIP_GAP * Math.max(0, labels.length - 1);
}

/** The filter bar's own side padding. */
export const BAR_PAD = 20;
/** The air between the bar's children. */
export const BAR_GAP = 8;
/** The search field's fixed width, and the air the row needs beside it. */
export const SEARCH_W = 190;
const DIVIDER = 1;
/** The 标签 button beside the strip: 9px of padding, an 11pt glyph, and its word. */
const MANAGER = 60;
/** 清除: 8px of padding and two characters. */
const CLEAR = 42;
/** What the estimate is allowed to be wrong by, so the row can never overflow. */
const SLACK = 8;

/**
 * How wide the tag strip may be in a `width`-point window.
 *
 * Everything else in the row is a fixed size — the date chips' own estimate, a
 * hairline, the manager, the clear button, the search field — so what is left is
 * the tags' room. The search field is what must never be the thing that gives:
 * it is a tool the user reaches for without looking, and a field half off the
 * window is worse than a chip behind 更多.
 */
export function tagBudget(
  width: number,
  options: { clear?: boolean; dateGroup: number },
): number {
  // Children: date group, hairline, strip, spacer, 标签, [清除], search.
  const gaps = (options.clear ? 6 : 5) * BAR_GAP;
  const fixed =
    BAR_PAD * 2 +
    gaps +
    DIVIDER +
    MANAGER +
    (options.clear ? CLEAR : 0) +
    SEARCH_W +
    SLACK +
    options.dateGroup;
  return Math.max(0, Math.round(width - fixed));
}
