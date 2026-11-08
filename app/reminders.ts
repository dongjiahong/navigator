import { effect, platform, signal } from "nsh";
import { Reminder } from "app/native";
import { board, epochOf, remindsAt, type Card } from "./data";

/**
 * Deadlines that leave the app.
 *
 * nsh has no notification API, so the Mac's reminders go through the system's
 * notification centre from the crate (`Reminder`): a scheduled reminder is a
 * real notification, with the sound the user picked for the app in System
 * Settings, that macOS delivers even after Navigator quits.
 *
 * The phone cannot post one. Android 13 and newer only let an app notify if its
 * manifest asks for `POST_NOTIFICATIONS`, and `nsh package` writes that manifest
 * with `INTERNET` alone and has no way to add to it — so `Reminder.status()` is
 * `unsupported` there, and this module reminds from inside the app instead,
 * with a banner while it is open. Pretending otherwise would be a notification
 * the system silently drops.
 */

export type ReminderState = "unknown" | "granted" | "denied" | "unsupported";

export const reminderState = signal<ReminderState>("unknown");

/** Windows where a due time counts as "just now" for the in-app banner. */
const RECENT_MS = 5 * 60 * 1000;
/** How often the app looks for a deadline that has come due while it is open. */
const TICK_MS = 20 * 1000;

/** The card the banner is about, or `null`. */
export const dueNow = signal<{ id: string; title: string } | null>(null);
/** Cards dismissed for this run, so a banner does not come back on every tick. */
const dismissed = new Set<string>();

/** Whether reminders go through the system or only show inside the app. */
export function systemReminders(): boolean {
  return reminderState() === "granted";
}

/**
 * Asks the system once, then keeps the answer.
 *
 * The permission is the user's, not the app's: a denied answer is respected for
 * the rest of the run, and nothing here asks twice.
 */
export async function askForReminders(): Promise<void> {
  if (platform.os === "android") {
    reminderState.set(Reminder.status() as ReminderState);
    return;
  }
  const asked = Reminder.request() as string;
  reminderState.set(asked as ReminderState);
  // The system answers asynchronously; the answer is read back a few times
  // rather than watched, because there is no event to listen to.
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const next = Reminder.status() as ReminderState;
    if (next !== "unknown") {
      reminderState.set(next);
      return;
    }
  }
}

/** What has been handed to the system, so an unchanged card is not re-sent. */
const pending = new Map<string, string>();

/**
 * Brings the system's schedule in line with the board: one reminder per open
 * card with a future deadline, none for the rest.
 *
 * Only a card whose deadline or title changed is re-sent. Without that, every
 * keystroke in another card's notes would reschedule the whole board through
 * the native module.
 */
export function syncReminders(): void {
  if (reminderState() !== "granted") return;
  const now = Date.now();
  const wants = new Map<string, Card>();
  for (const card of board()) if (remindsAt(card, now)) wants.set(card.id, card);

  for (const [id, card] of wants) {
    const stamp = `${card.due}|${card.title}`;
    if (pending.get(id) === stamp) continue;
    const body = card.notes.trim() ? card.notes.trim() : "截止时间到了";
    try {
      Reminder.schedule(id, card.title || "未命名卡片", body.slice(0, 120), epochOf(card.due!));
      pending.set(id, stamp);
    } catch {
      // A refused notification is the system's call, not a reason to break the
      // board; the card still shows its overdue pill.
    }
  }
  for (const id of [...pending.keys()]) {
    if (wants.has(id)) continue;
    try {
      Reminder.cancel(id);
    } catch {
      // Same: nothing to undo, nothing to report.
    }
    pending.delete(id);
  }
}

/**
 * The phone's reminder: a deadline that came due in the last few minutes, while
 * the app is open, put in one banner. Dismissing it holds for the run.
 */
function checkDue() {
  if (systemReminders()) return;
  const now = Date.now();
  for (const card of board()) {
    if (card.deleted || !card.due) continue;
    if (card.status === "done" || card.status === "archive") continue;
    const at = epochOf(card.due);
    if (at > now || now - at > RECENT_MS) continue;
    if (dismissed.has(card.id)) continue;
    const shown = dueNow();
    if (shown?.id === card.id) continue;
    dueNow.set({ id: card.id, title: card.title || "未命名卡片" });
    return;
  }
}

export function dismissDue(): void {
  const shown = dueNow();
  if (shown) dismissed.add(shown.id);
  dueNow.set(null);
}

/**
 * The cards the system holds a reminder for, as the system itself reports
 * them. `pending()` answers asynchronously, so this asks a few times before
 * giving up; a test uses it to prove a reminder really reached the system
 * rather than only this module's bookkeeping.
 */
export async function pendingReminders(): Promise<string[]> {
  if (reminderState() !== "granted") return [];
  for (let i = 0; i < 20; i++) {
    const answer = Reminder.pending() as string;
    if (answer) {
      const ids = JSON.parse(answer) as string[];
      return ids.map((id) => id.replace("navigator.card.", ""));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return [];
}

/**
 * Starts the reminder loop. Called once by the app; the effect watches the
 * board without making the tree depend on it, so a keystroke does not rebuild
 * the shell around a focused input.
 */
export function startReminders(): void {
  void askForReminders();
  // Once at start, so a deadline that came due while the app was closed shows
  // as the app opens rather than up to twenty seconds later.
  syncReminders();
  checkDue();
  setInterval(() => {
    syncReminders();
    checkDue();
  }, TICK_MS);
  // A card whose deadline is set for later today gets its reminder as soon as
  // it is edited, not at the next tick.
  effect(() => {
    board();
    syncReminders();
  });
}
