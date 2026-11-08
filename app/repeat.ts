import type { Card, Repeat } from "./data";
import { fieldStamp } from "./fields";

/**
 * Repeating work, as arithmetic: the next deadline of a card that repeats, and
 * the card that completion makes.
 *
 * A repeating card is one field on the card (`repeat`) and one rule on the
 * board: completing it makes the next occurrence in 待办. Nothing here touches
 * the board — this file is pure, so the date rule, the successor's id and the
 * question "has anyone touched it yet" are all tested without a window.
 */

/** The cycle a card repeats on, in the order a press walks them. */
export const REPEATS: readonly Repeat[] = ["daily", "weekly", "monthly", "yearly"];

const LABEL: Record<Repeat, string> = {
  daily: "每天",
  weekly: "每周",
  monthly: "每月",
  yearly: "每年",
};

/** What the one chip says when the card does not repeat. */
export const NO_REPEAT = "不重复";

/**
 * The cycle after this one: 不重复 → 每天 → 每周 → 每月 → 每年 → 不重复.
 *
 * A press walks the five states in order, the way a tag's hue does. Five is a
 * count a press can walk through; a menu for it would be a second surface for a
 * decision this small.
 */
export function nextRepeat(repeat: Repeat | undefined): Repeat | undefined {
  if (!repeat) return REPEATS[0];
  const at = REPEATS.indexOf(repeat);
  return at >= 0 && at < REPEATS.length - 1 ? REPEATS[at + 1] : undefined;
}

/** The cycle as the interface says it: 每周, or 不重复. */
export function repeatLabel(repeat: Repeat | undefined): string {
  return repeat ? LABEL[repeat] : NO_REPEAT;
}

type Parts = { y: number; m: number; d: number; hh: number; mm: number };

const pad = (n: number) => String(n).padStart(2, "0");

/** `2026-11-15T14:00` → its parts, or `null` for text that is not a due. */
function partsOf(iso: string): Parts | null {
  const [day, time] = iso.split("T");
  const [y, m, d] = (day ?? "").split("-").map(Number);
  const [hh, mm] = (time ?? "00:00").split(":").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return { y, m, d, hh: Number.isFinite(hh) ? hh : 0, mm: Number.isFinite(mm) ? mm : 0 };
}

function isoOfParts(p: Parts): string {
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}`;
}

/** The parts as millis, in the device's own zone — as `epochOf` reads a due. */
function atOfParts(p: Parts): number {
  return new Date(p.y, p.m - 1, p.d, p.hh, p.mm, 0, 0).getTime();
}

/** How many days that month has, in that year. Day 0 of the next month is the
 *  last day of this one. */
function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/**
 * The next occurrence of `repeat` after the one at `p`, keeping the time of day.
 *
 * A day and a week step through the calendar rather than adding 24 hours, so a
 * deadline keeps its hour across a daylight-saving change. A month and a year
 * clamp to the end of a shorter month (1月31日 → 2月28日, 2月29日 → 2月28日).
 */
function step(p: Parts, repeat: Repeat): Parts {
  if (repeat === "daily" || repeat === "weekly") {
    const ahead = new Date(p.y, p.m - 1, p.d + (repeat === "weekly" ? 7 : 1), p.hh, p.mm);
    return { y: ahead.getFullYear(), m: ahead.getMonth() + 1, d: ahead.getDate(), hh: p.hh, mm: p.mm };
  }
  if (repeat === "monthly") {
    const y = p.m === 12 ? p.y + 1 : p.y;
    const m = p.m === 12 ? 1 : p.m + 1;
    return { y, m, d: Math.min(p.d, daysInMonth(y, m)), hh: p.hh, mm: p.mm };
  }
  const y = p.y + 1;
  return { y, m: p.m, d: Math.min(p.d, daysInMonth(y, p.m)), hh: p.hh, mm: p.mm };
}

/** Enough steps for a deadline left alone for a decade; a guard, not a rule. */
const MAX_STEPS = 4000;

/**
 * The next occurrence after `at`: the first one **strictly later** than the
 * moment the card was finished.
 *
 * It starts from the card's own deadline, not from today, so a card completed
 * three weeks late still makes exactly one card — the nearest occurrence ahead
 * of the press, at the hour the deadline always had. Completing ahead of time
 * makes the one after that deadline, because this occurrence is the one being
 * ticked off.
 *
 * **A month that clamped stays clamped.** 1月31日 repeats on 2月28日, and March
 * continues from 2月28日 rather than from the 31st, so a monthly card drifts to
 * the 28th. Remembering the original day would need a field the merge would
 * have to carry, for a card whose deadline the user can simply move.
 */
export function nextDue(due: string, repeat: Repeat, at: number): string {
  const start = partsOf(due);
  if (!start) return due;
  let p = step(start, repeat);
  for (let i = 1; i < MAX_STEPS && atOfParts(p) <= at; i += 1) p = step(p, repeat);
  return isoOfParts(p);
}

/**
 * The card a repeated deadline came from: an id without its `@…` and cycle.
 *
 * Chained completion must not grow the id forever, so every occurrence is named
 * after the card the chain started from: `c123@2026-11-15T14:00`,
 * `c123@2026-11-22T14:00`.
 */
export function rootId(cardId: string): string {
  const at = cardId.indexOf("@");
  return at < 0 ? cardId : cardId.slice(0, at);
}

/**
 * The next occurrence's id, from the card it came from and its deadline.
 *
 * **Deterministic on purpose.** Two devices can each complete the same card, or
 * the phone can complete it and the Mac make the next one when the change
 * arrives; a random id would give the board two copies of the same work. Both
 * devices derive the same deadline from the same card and its own completion
 * stamp, so they derive the same id and the merge keeps one card.
 */
export function successorId(cardId: string, due: string): string {
  return `${rootId(cardId)}@${due.slice(0, 16)}`;
}

/** What the next occurrence is, before it is written to the board. */
export type Successor = {
  id: string;
  title: string;
  notes: string;
  tags: string[];
  due: string;
  repeat: Repeat;
};

/**
 * The card that completing `card` makes, or `null` when it makes none.
 *
 * `at` is the moment the card was finished — its own `status` stamp, not the
 * clock: two devices that see the same completion compute the same occurrence.
 * A card with no deadline has nothing to repeat from, and a card that is not in
 * 已完成 has not been finished.
 */
export function successorOf(card: Card, at: number): Successor | null {
  if (card.deleted || card.status !== "done" || !card.repeat || !card.due) return null;
  const due = nextDue(card.due, card.repeat, at);
  return {
    id: successorId(card.id, due),
    title: card.title,
    notes: card.notes,
    tags: [...card.tags],
    due,
    repeat: card.repeat,
  };
}

/**
 * Whether a card is still exactly what was written when it was made — every
 * field stamped at its own `updatedAt`.
 *
 * The way back from a completion takes the next occurrence with it only while
 * this is true: once the user has typed in it or moved it, it is their card and
 * the undo leaves it alone.
 */
export function isUntouched(card: Card): boolean {
  const stamps = card.stamps;
  // A card written before fields carried stamps cannot say what was touched, and
  // every card this app makes carries them: absent means "not mine to remove".
  if (!stamps) return false;
  return Object.values(stamps).every((stamp) => stamp === undefined || stamp === card.updatedAt);
}

/** The status stamp of a finished card: when it was completed, for a successor. */
export function finishedAt(card: Card): number {
  return fieldStamp(card, "status");
}
