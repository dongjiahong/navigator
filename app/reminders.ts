import { effect, platform, signal } from "nsh";
import { Reminder } from "app/native";
import { board, epochOf, patchCard, remindsAt, setStatus } from "./data";
import {
  applyResponse,
  earlyBody,
  leadMinutes,
  loadLead,
  reminderPlan,
  spreadMoments,
  type Response,
} from "./deadline";

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
 *
 * What a deadline *asks* is decided in `deadline.ts`: which reminders a card
 * wants, what the lead time is, and what a notification's two buttons mean. This
 * module is the half that touches the system, so the decisions can be read by a
 * test without a notification centre to talk to.
 *
 * Everything here is Mac-only in effect, and Mac-only in what it keeps: the lead
 * time is one number the user sets for themselves, and 完成 / 推迟 1 小时 answer a
 * notification. None of it is a field on a card, so none of it syncs.
 */

export type ReminderState = "unknown" | "granted" | "denied" | "unsupported";

export const reminderState = signal<ReminderState>("unknown");

/** Windows where a due time counts as "just now" for the in-app banner. */
const RECENT_MS = 5 * 60 * 1000;
/** How often the app looks for a deadline that has come due while it is open. */
const TICK_MS = 20 * 1000;
/** How often the app asks whether the user answered a notification. */
const ANSWER_MS = 1000;

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
      // The board was read before the answer arrived, so nothing has been
      // handed to the system yet: the first schedule is now, not at the next
      // tick twenty seconds out.
      if (next === "granted") syncReminders();
      return;
    }
  }
}

/**
 * Takes the notification centre's delegate and registers the reminder's
 * category, before anything asks for permission.
 *
 * It has to be this early: a click on a notification's 完成 button can be what
 * launches the app, and the system hands that answer to a delegate that is
 * already set. Registering the category first is what gives every reminder the
 * two buttons at all — a notification naming a category the app never
 * registered comes with no actions.
 */
export function installReminders(): void {
  let installed = "unsupported";
  try {
    installed = Reminder.install() as string;
  } catch {
    // A process with no notification centre — a test runner — has nothing to
    // install; the board still opens.
    installed = "no-notification-centre";
  }
  // One line at launch, beside the board's own: whether the system is holding
  // this app's reminders at all is otherwise invisible from the window.
  console.log(`[navigator] reminders: ${installed}`);
}

/**
 * An early reminder is its own notification, under the card's own identifier
 * plus this suffix. The card's deadline keeps the bare identifier, so the two
 * never replace each other and the due notification is unchanged by the setting.
 */
const EARLY = ".pre";

/** What has been handed to the system, so an unchanged card is not re-sent. */
const pending = new Map<string, string>();
/** A stamp no card matches, so a slot is sent again on the next pass. */
const STALE = "";
/** The lead time the schedule was last planned against. */
let plannedLead = leadMinutes();

/**
 * Brings the system's schedule in line with the board: one reminder per open
 * card with a future deadline — and an early one ahead of it when the user asked
 * for a lead time — and none for the rest.
 *
 * Only a slot whose deadline or title changed is re-sent. Without that, every
 * keystroke in another card's notes would reschedule the whole board through
 * the native module. The two slots of a card are tracked apart, because they are
 * two notifications with two times: turning the lead time off must take the
 * early one back without touching the deadline's.
 */
export function syncReminders(): void {
  if (reminderState() !== "granted") return;
  const now = Date.now();
  const lead = leadMinutes();
  /** Every slot the board wants, before the shared moments are spread out. */
  const planned: { key: string; at: number; words: string; title: string; body: string }[] = [];

  for (const card of board()) {
    if (!remindsAt(card, now)) continue;
    const plan = reminderPlan(card, now, lead);
    const title = card.title || "未命名卡片";
    // The words a slot is recognised by are the deadline and the title, never
    // the notes: a note is not what a notification says past its first line,
    // and re-sending on every keystroke would be a native call per letter.
    if (plan.at !== undefined) {
      planned.push({
        key: card.id,
        at: plan.at,
        words: `${card.due}|${card.title}`,
        title,
        body: (card.notes.trim() || "截止时间到了").slice(0, 120),
      });
    }
    if (plan.pre !== undefined) {
      planned.push({
        key: `${card.id}${EARLY}`,
        at: plan.pre,
        words: `${card.due}|${card.title}|${lead}`,
        title: `${lead} 分钟后到期：${title}`,
        body: earlyBody(card, lead),
      });
    }
  }

  // One banner at a time is all the system shows, so cards due together are
  // handed over a banner apart — see `spreadMoments`. The slot's own time is
  // part of what the system was told, so a spread counts as a new schedule.
  const wants = new Map<string, { at: number; stamp: string; title: string; body: string }>();
  for (const slot of spreadMoments(planned)) {
    wants.set(slot.key, { at: slot.at, stamp: `${slot.at}|${slot.words}`, title: slot.title, body: slot.body });
  }

  for (const [key, want] of wants) {
    if (pending.get(key) === want.stamp) continue;
    try {
      Reminder.schedule(key, want.title, want.body, want.at);
      pending.set(key, want.stamp);
    } catch {
      // A refused notification is the system's call, not a reason to break the
      // board; the card still shows its overdue pill.
    }
  }
  for (const key of [...pending.keys()]) {
    if (wants.has(key)) continue;
    try {
      Reminder.cancel(key);
    } catch {
      // Same: nothing to undo, nothing to report.
    }
    pending.delete(key);
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
 * The card a notification asked to have opened. The answer arrives in the crate
 * and is picked up here, but the open card is the shell's own state (`App.tsx`
 * owns `selectedId`), so the request is left in this signal for it to take.
 */
export const openRequested = signal<string | null>(null);

/** Applies one answer to the board. */
function handleResponse(answer: Response): void {
  const card = board().find((c) => c.id === answer.id && !c.deleted);
  const applied = applyResponse(card, answer.action, Date.now());
  if (!applied || !card) return;
  if (applied.done) setStatus(card.id, "done");
  if (applied.due) patchCard(card.id, { due: applied.due });
  if (applied.open) openRequested.set(card.id);
}

/**
 * Takes what the user answered since the last look, and applies it.
 *
 * The crate's delegate queue is the only channel: the notification centre calls
 * its delegate on the main thread, which is not where this module runs, and a
 * click can arrive minutes after the app was brought back. Asking once a second
 * is cheap — an empty list is one native call — and it keeps both buttons and
 * the click itself feeling immediate.
 */
function takeResponses(): void {
  let raw = "";
  try {
    raw = Reminder.takeResponses() as string;
  } catch {
    return;
  }
  if (!raw) return;
  let answers: unknown;
  try {
    answers = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(answers)) return;
  for (const answer of answers as Response[]) handleResponse(answer);
}

/** The prefix the system knows a reminder by, before its card id. */
const PREFIX = "navigator.card.";

/**
 * The ids the system holds, or `null` while its answer is still on its way.
 *
 * The answer is asynchronous and the crate keeps the last one it received, so a
 * second call answers with the list from the moment before: asking again after a
 * short wait is what makes this a report of now rather than of before what the
 * caller just did. `null` and `[]` are different answers, and the difference is
 * what a caller reconciling against the system has to know.
 */
async function heldIds(): Promise<string[] | null> {
  let answer = Reminder.pending() as string;
  for (let i = 0; i < 20 && !answer; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    answer = Reminder.pending() as string;
  }
  if (!answer) return null;
  await new Promise((resolve) => setTimeout(resolve, 300));
  const fresh = Reminder.pending() as string;
  const ids = JSON.parse(fresh || answer) as string[];
  return ids.map((id) => id.replace(PREFIX, ""));
}

/**
 * The cards the system holds a reminder for, as the system itself reports them.
 * A test uses it to prove a reminder really reached the system rather than only
 * this module's bookkeeping.
 *
 * The card's early reminder is its own request and comes back as its own id,
 * `<id>.pre`, so a caller can tell the two apart.
 */
export async function pendingReminders(): Promise<string[]> {
  if (reminderState() !== "granted") return [];
  return (await heldIds()) ?? [];
}

/**
 * Makes the system's list match this launch's plan: takes back what the board no
 * longer wants, and puts back what it asked for and the system does not have.
 *
 * Two things need this, and neither is visible to the `pending` map. A reminder
 * left from an earlier run — an early one scheduled before the lead time was
 * switched off, or one for a card deleted while the app was closed — is in the
 * system's list and in nothing else. And a request can be lost at a launch:
 * quitting and reopening straight away makes the notification daemon tear the
 * old registration down while the new one is adding requests, and the requests
 * it has not finished processing are dropped without an error. Neither is
 * something the app can prevent; both are something it can notice, and the
 * daemon settles within a moment, so this looks again rather than believing one
 * answer.
 */
async function reconcile(): Promise<void> {
  if (!systemReminders()) return;
  /** Whether this launch's first look already found the system's list short. */
  let reported = false;
  for (let pass = 0; pass < 3; pass++) {
    const held = await heldIds();
    // Nothing to compare against: the system has not answered.
    if (!held) return;
    const now = Date.now();
    const lead = leadMinutes();
    const wanted = new Set<string>();
    for (const card of board()) {
      if (!remindsAt(card, now)) continue;
      const plan = reminderPlan(card, now, lead);
      if (plan.at !== undefined) wanted.add(card.id);
      if (plan.pre !== undefined) wanted.add(`${card.id}${EARLY}`);
    }
    for (const id of held) {
      if (wanted.has(id)) continue;
      try {
        Reminder.cancel(id);
      } catch {
        // Same as everywhere else: the board is not the system's to manage.
      }
    }
    let missing = 0;
    for (const id of wanted) {
      // `includes` on a list this short is cheaper than a set, and the two are
      // compared id by id either way.
      if (held.includes(id)) continue;
      // Forgetting the stamp is all it takes: the next pass sends it again,
      // under the same identifier, so a reminder that is merely late is not
      // stacked twice.
      pending.delete(id);
      missing += 1;
    }
    if (!missing) return;
    // Said once per launch: a reminder the system does not hold is a deadline
    // nothing will announce, and the later passes are this same repair settling.
    if (!reported) {
      console.log(`[navigator] reminders: put back ${missing} the system did not hold`);
      reported = true;
    }
    syncReminders();
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

/**
 * Starts the reminder loop. Called once by the app; the effect watches the
 * board without making the tree depend on it, so a keystroke does not rebuild
 * the shell around a focused input.
 */
export function startReminders(): void {
  // Once at start, so a deadline that came due while the app was closed shows as
  // the app opens rather than up to twenty seconds later. It waits for the two
  // answers the schedule depends on: the permission, and the lead time off the
  // device — planning before either arrives would plan the wrong thing and then
  // have to plan it again.
  void (async () => {
    await askForReminders();
    await loadLead();
    syncReminders();
    // A moment for the adds to land, so what is missing is missing rather than
    // merely not there yet.
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await reconcile();
  })();
  checkDue();
  takeResponses();
  setInterval(() => {
    syncReminders();
    checkDue();
  }, TICK_MS);
  // A card whose deadline is set for later today gets its reminder as soon as it
  // is edited, and the lead time reaches every card as soon as it is chosen: the
  // early slot is marked for re-sending, and a card that no longer wants one is
  // cancelled by the pass that follows.
  effect(() => {
    board();
    const lead = leadMinutes();
    if (lead !== plannedLead) {
      plannedLead = lead;
      for (const key of [...pending.keys()]) {
        if (key.endsWith(EARLY)) pending.set(key, STALE);
      }
    }
    syncReminders();
  });
  // Answers are polled more often than the board is looked at: a notification is
  // the one thing that happens while the app is behind another window, and a
  // press on 完成 should read as a press, not as something that happened
  // eventually. The phone has no notification to answer.
  if (platform.os !== "android") setInterval(takeResponses, ANSWER_MS);
}
