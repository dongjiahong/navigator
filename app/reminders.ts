import { Notifications, effect, platform, signal } from "nsh";
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
 * The Mac's reminders go through the system's notification centre from the
 * crate (`Reminder`): a scheduled reminder is a real notification, with the
 * sound the user picked for the app in System Settings, that macOS delivers
 * even after Navigator quits.
 *
 * The phone can now post a notification too (`Notifications` of nsh's main),
 * but only while the app is running: the API shows one now, and nsh still has
 * no way to wake the app at a deadline. So the phone keeps a due card in the
 * app's own loop and hands it to the system when the permission is granted;
 * where the permission is denied or the platform cannot show one, the same
 * loop puts a line over the list instead. A notification the user presses
 * comes back through `Notifications.on("press")` and opens its card.
 *
 * What a deadline *asks* is decided in `deadline.ts`: which reminders a card
 * wants, what the lead time is, and what a notification's two buttons mean. This
 * module is the half that touches the system, so the decisions can be read by a
 * test without a notification centre to talk to.
 *
 * Everything here is Mac-only in effect for the scheduled reminders, and
 * Mac-only in what it keeps: the lead time is one number the user sets for
 * themselves, and 完成 / 推迟 1 小时 answer a notification. None of it is a
 * field on a card, so none of it syncs.
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
/**
 * Cards whose due reminder was handled for this run: dismissed from the
 * banner, or already shown as a system notification. Either way one card
 * speaks once per launch.
 */
const dismissed = new Set<string>();

/** The prefix the system knows a reminder by, before its card id. */
const PREFIX = "navigator.card.";

/**
 * The card a notification asked to have opened. The answer arrives in the
 * crate (Mac) or in `Notifications` (the phone), but the open card is the
 * shell's own state (`App.tsx` owns `selectedId`), so the request is left in
 * this signal for it to take.
 */
export const openRequested = signal<string | null>(null);

/**
 * Whether the Mac's notification centre owns the schedule. The phone's
 * `Notifications` only shows one now, so its due cards still go through the
 * app's own loop and the banner decision in `checkDue`.
 */
export function systemReminders(): boolean {
  return platform.os === "macos" && reminderState() === "granted";
}

/**
 * Asks the system once, then keeps the answer.
 *
 * The permission is the user's, not the app's: a denied answer is respected for
 * the rest of the run, and nothing here asks twice.
 */
export async function askForReminders(): Promise<void> {
  if (platform.os === "android") {
    try {
      let permission = await Notifications.permission();
      if (permission === "default") permission = await Notifications.requestPermission();
      reminderState.set(
        permission === "granted"
          ? "granted"
          : permission === "denied" || permission === "default"
            ? // A prompt that was dismissed is not an answer the app can wait on
              // again: the banner is the fallback, and the sheet's 测试 re-reads
              // the system after the user changes it.
              "denied"
            : permission === "unavailable"
              ? "unsupported"
              : "unknown",
      );
    } catch {
      // No notification capability, or a host without a notification centre:
      // the banner remains the phone's reminder.
      reminderState.set("unsupported");
    }
    // The first check waited for this answer; a card that came due while the
    // prompt was up gets its notification now.
    checkDue();
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

/** One line for the phone's 连到 Mac sheet: what the notification permission is. */
export function notificationLine(): string {
  switch (reminderState()) {
    case "granted":
      return "已允许，到点会在系统通知里提醒";
    case "denied":
      return "未允许。请在系统设置里打开通知";
    case "unsupported":
      return "此安装包不能发通知，需要 1.2.0 新包";
    default:
      return "尚未检查";
  }
}

/**
 * Posts one notification now, so the permission and the channel can be tested
 * without waiting for a deadline. It is also the first place the channel is
 * created: an Android app with no channel can leave its notification settings
 * looking empty even when the permission is declared.
 */
export async function testNotification(): Promise<void> {
  if (platform.os !== "android") return;
  if (reminderState() !== "granted") await askForReminders();
  if (reminderState() !== "granted") return;
  try {
    const taken = await Notifications.show({
      id: "navigator.test",
      title: "通知测试",
      body: "Navigator 可以发系统通知了。",
    });
    if (!taken) reminderState.set("denied");
  } catch {
    reminderState.set("unsupported");
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
  if (platform.os === "android") {
    try {
      // A press can be what launched the app; the module keeps it until this
      // listener is here. The id carries the card, so the shell can open it.
      Notifications.on("press", ({ id }) => {
        if (!id.startsWith(PREFIX)) return;
        const cardId = id.slice(PREFIX.length);
        dismissed.add(cardId);
        if (dueNow()?.id === cardId) dueNow.set(null);
        openRequested.set(cardId);
      });
      console.log("[navigator] reminders: Android notifications while the app is open");
    } catch (error) {
      console.log(`[navigator] reminders: ${error}`);
    }
    return;
  }
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
  if (!systemReminders()) return;
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
 * the app is open. With the notification permission it becomes a system
 * notification; otherwise it is one line over the list. Either way a card
 * speaks once per run.
 */
function checkDue() {
  if (systemReminders()) return;
  // The phone's answer is asynchronous: do not put a line up before the
  // permission says whether the system can show the card instead.
  if (platform.os === "android" && reminderState() === "unknown") return;
  const now = Date.now();
  for (const card of board()) {
    if (card.deleted || !card.due) continue;
    if (card.status === "done" || card.status === "archive") continue;
    const at = epochOf(card.due);
    if (at > now || now - at > RECENT_MS) continue;
    if (dismissed.has(card.id)) continue;
    const shown = dueNow();
    if (shown?.id === card.id) continue;
    const title = card.title || "未命名卡片";
    if (platform.os === "android" && reminderState() === "granted") {
      dismissed.add(card.id);
      void Notifications.show({
        id: `${PREFIX}${card.id}`,
        title: `到时间了：${title}`,
        body: (card.notes.trim() || "截止时间到了").slice(0, 120),
      })
        .then((taken) => {
          if (taken) return;
          // The permission went away between the read and the show: put the
          // line up instead and stop pretending the system will speak.
          reminderState.set("denied");
          dismissed.delete(card.id);
          dueNow.set({ id: card.id, title });
        })
        .catch(() => {
          reminderState.set("unsupported");
          dismissed.delete(card.id);
          dueNow.set({ id: card.id, title });
        });
      return;
    }
    dueNow.set({ id: card.id, title });
    return;
  }
}

export function dismissDue(): void {
  const shown = dueNow();
  if (shown) dismissed.add(shown.id);
  dueNow.set(null);
}

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
  if (!systemReminders()) return [];
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
  // The Mac's notification answers are polled; the phone's arrive through
  // `Notifications.on` instead, registered in `installReminders`.
  if (platform.os !== "android") takeResponses();
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
  // eventually. The phone's press arrives through the listener instead.
  if (platform.os !== "android") setInterval(takeResponses, ANSWER_MS);
}
