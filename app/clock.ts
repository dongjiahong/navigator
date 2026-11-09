import { signal } from "nsh";

/**
 * The wall clock, as a signal.
 *
 * A deadline's day is read off the clock, not off the card: 明天 09:00 becomes
 * 今天 09:00 at midnight, and 今天 09:00 turns red an hour later, with nobody
 * touching the board. The label is computed from `Date.now()` at the moment it
 * is drawn, so without something that changes nothing redraws it — a card
 * written yesterday evening still said 明天 the next morning, and the amber and
 * red pills were a day behind.
 *
 * So the clock is a signal, and the places that print a day read it where they
 * draw. Nothing else depends on it: it costs one number every half minute, and
 * only the deadline-shaped views look at it.
 */
export const clock = signal(Date.now());

/** How often the board looks again: often enough that a deadline never shows
 *  yesterday's word for more than half a minute. */
const TICK_MS = 30_000;

export function startClock(): void {
  setInterval(() => clock.set(Date.now()), TICK_MS);
}
