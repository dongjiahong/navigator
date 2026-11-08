import { Storage, signal } from "nsh";
import { dueTimeOf, epochOf, isoOf, remindsAt, type Card } from "./data";

/**
 * What a deadline asks of the system, and what its notification's buttons do.
 *
 * The decisions only: no native call is made here, so the same functions are
 * used by the loop that talks to `UNUserNotificationCenter` (`reminders.ts`) and
 * by a test that reads them on its own. `merge.ts` beside `sync.ts` is the same
 * split for the same reason.
 *
 * The four things a deadline can be answered with live here too, because they
 * are the vocabulary of the feature and not an implementation of it: which
 * reminders a card wants, what each button means, and the one setting that
 * changes the first of those.
 */

/** What one card wants from the system right now. */
export type ReminderPlan = {
  /** When the deadline's own notification fires, millis since the epoch. */
  at?: number;
  /** When the early one fires, when the lead time leaves room for it. */
  pre?: number;
};

/** A minute, the unit the lead time is given in. */
const MINUTE_MS = 60_000;

/**
 * The reminders one card deserves, and the whole of the scheduling decision —
 * which is why it is a pure function.
 *
 * Only open work with a deadline still ahead is planned at all; a finished,
 * archived, removed or overdue card asks nothing of the system. A card closer
 * than the lead time gets no early reminder: `due - N` is already in the past,
 * and a notification saying it is fifteen minutes away when it is three would be
 * wrong rather than merely useless.
 */
export function reminderPlan(card: Card, now: number, lead: number): ReminderPlan {
  if (!remindsAt(card, now)) return {};
  const at = epochOf(card.due!);
  if (!(lead > 0)) return { at };
  const pre = at - lead * MINUTE_MS;
  return pre > now ? { at, pre } : { at };
}

/** What a notification's button asks the board to do. */
export type Answer = "done" | "snooze" | "open";

/** One answer to a notification, as the system hands it over. */
export type Response = { id: string; action: string };

/** Snoozing puts the deadline an hour out from now. */
export const SNOOZE_MS = 60 * 60 * 1000;

/** What an answer means for one card. */
export type Applied = { done?: true; due?: string; open?: true };

/**
 * The whole judgement of an answer, as a pure function: what the card should
 * become, or `null` when there is nothing to do.
 *
 * `card` is `undefined` for work that has since been removed on either device:
 * a notification about a card that no longer exists must not resurrect it, and
 * a tombstone is not something an answer can undo. `now` is passed rather than
 * read so the snooze can be tested at a fixed clock.
 */
export function applyResponse(card: Card | undefined, action: string, now: number): Applied | null {
  if (!card || card.deleted) return null;
  switch (action) {
    case "done":
      return { done: true };
    case "snooze":
      return { due: isoOf(now + SNOOZE_MS) };
    case "open":
      return { open: true };
    default:
      // The system's dismiss is the third thing a notification can report, and
      // closing one is not an answer.
      return null;
  }
}

/** How far ahead of a deadline the early reminder fires: one of `LEAD_CHOICES`. */
export const leadMinutes = signal(0);

/** The lead times a reminder can be given, in minutes; `0` is off. */
export const LEAD_CHOICES: number[] = [0, 5, 15, 30, 60];

/** Where the lead time is kept. On this device only: it is not the board. */
const LEAD_KEY = "navigator.leadMinutes";

/**
 * Reads the lead time back from the device.
 *
 * The setting is the user's own, on the machine they are sitting at: it does not
 * ride in a card or a tag, so nothing about it crosses the network.
 */
export async function loadLead(): Promise<void> {
  try {
    const stored = Number(await Storage.getItem(LEAD_KEY));
    if (LEAD_CHOICES.includes(stored)) leadMinutes.set(stored);
  } catch {
    // No storage on this host: the setting stays off, and the board is intact.
  }
}

/**
 * Saves the lead time. The reminders follow on their own — `reminders.ts` watches
 * this signal — so choosing a value here does not have to know how a
 * notification is scheduled.
 */
export function setLeadMinutes(minutes: number): void {
  leadMinutes.set(minutes);
  void Storage.setItem(LEAD_KEY, String(minutes)).catch(() => {
    // Without storage the choice still holds for this run.
  });
}

/** The body an early reminder carries: the note, or the hour it is due. */
export function earlyBody(card: Card, lead: number): string {
  const notes = card.notes.trim();
  return (notes || `截止 ${dueTimeOf(card.due)}`).slice(0, 120);
}
