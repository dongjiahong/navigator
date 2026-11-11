import { expect, test } from "nsh/test";
import { openSized } from "./testkit";
import { epochOf, remindsAt, type Card } from "./data";
import {
  HOURLY_MS,
  SPREAD_MS,
  applyResponse,
  hourlyDue,
  overdueNow,
  reminderPlan,
  spreadMoments,
} from "./deadline";
import { openApp } from "./testkit";

/**
 * Deadlines reach further than the pill on a card.
 *
 * On the Mac a due date becomes a real system notification, owned by the crate
 * (`Reminder`). The phone can post one now (`Notifications`) while the app is
 * running, and falls back to a banner when the permission is missing. These
 * tests keep to the pure decisions and the banner; the phone's system
 * notification is checked on an Android device, not by this headless runner.
 *
 * `epochOf`, `remindsAt`, `reminderPlan` and `applyResponse` are the whole
 * scheduling and answering decision, so they are tested as pure functions: they
 * say which cards are worth a reminder, when each one fires, and what the two
 * buttons on a notification do to the board.
 */

function card(patch: Partial<Card> = {}): Card {
  return { id: "x", title: "x", notes: "", tags: [], status: "todo", updatedAt: 0, ...patch };
}

test("a due time is read in the device's own zone", () => {
  const local = new Date(2026, 10, 12, 14, 30).getTime();
  expect(epochOf("2026-11-12T14:30")).toBe(local);
});

test("only open work with a deadline ahead gets a reminder", () => {
  const now = new Date(2026, 10, 12, 12, 0).getTime();
  expect(remindsAt(card({ due: "2026-11-12T14:30" }), now)).toBe(true);
  // Tomorrow at 09:00 is ahead too.
  expect(remindsAt(card({ due: "2026-11-13T09:00" }), now)).toBe(true);
  // A deadline that already passed is the board's problem, not the system's.
  expect(remindsAt(card({ due: "2026-11-12T11:00" }), now)).toBe(false);
  // Finished and archived work asks nothing of anyone.
  expect(remindsAt(card({ due: "2026-11-12T14:30", status: "done" }), now)).toBe(false);
  expect(remindsAt(card({ due: "2026-11-12T14:30", status: "archive" }), now)).toBe(false);
  // No deadline, no reminder.
  expect(remindsAt(card(), now)).toBe(false);
  // And a removed card reminds no one.
  expect(remindsAt(card({ due: "2026-11-12T14:30", deleted: true }), now)).toBe(false);
});

test("an early reminder is planned ahead of the deadline, and only when there is room", () => {
  const now = new Date(2026, 10, 12, 12, 0).getTime();
  const due = "2026-11-12T14:30";
  const at = epochOf(due);

  // Off by default: one notification, the deadline's own, at the deadline.
  expect(reminderPlan(card({ due }), now, 0)).toEqual({ at });
  // Fifteen minutes ahead is a second notification, at 14:15, beside the due
  // one — the deadline's reminder is not replaced by the early one.
  expect(reminderPlan(card({ due }), now, 15)).toEqual({ at, pre: at - 15 * 60_000 });

  // A card twenty minutes out has room for a fifteen-minute lead and none for
  // a thirty-minute one: a notification saying it is half an hour away when it
  // is twenty minutes away would be wrong.
  const soon = card({ due: "2026-11-12T12:20" });
  expect(reminderPlan(soon, now, 15)).toEqual({ at: epochOf(soon.due!), pre: now + 5 * 60_000 });
  expect(reminderPlan(soon, now, 30)).toEqual({ at: epochOf(soon.due!) });

  // Nothing the system should hold a reminder for gets an early one either.
  expect(reminderPlan(card({ due, status: "done" }), now, 15)).toEqual({});
  expect(reminderPlan(card({ due, status: "archive" }), now, 15)).toEqual({});
  expect(reminderPlan(card({ due: "2026-11-12T11:00" }), now, 15)).toEqual({});
  expect(reminderPlan(card({ due, deleted: true }), now, 15)).toEqual({});
  expect(reminderPlan(card(), now, 15)).toEqual({});
});

test("cards due at the same moment are handed over a banner apart", () => {
  const at = new Date(2026, 10, 12, 9, 0).getTime();
  const anHourOn = at + 60 * 60 * 1000;
  const slots = [
    { key: "b", at },
    { key: "a", at },
    { key: "c", at },
    { key: "d", at: anHourOn },
  ];

  // One banner at a time is all the system shows, and three cards delivered
  // inside a fifth of a second replace each other before any of them is read.
  // The first keeps the deadline's own minute and the ones beside it follow a
  // banner apart, in id order so two launches hand out the same times.
  const spread = spreadMoments(slots);
  expect(spread.map((slot) => [slot.key, slot.at])).toEqual([
    ["a", at],
    ["b", at + SPREAD_MS],
    ["c", at + 2 * SPREAD_MS],
    ["d", anHourOn],
  ]);

  // A plan is read more than once — by the effect and by the tick — so the
  // helper answers with its own copy and leaves the board's plan alone.
  expect(slots.map((slot) => slot.at)).toEqual([at, at, at, anHourOn]);
});

test("overdue work asks again an hour after the deadline, and keeps asking", () => {
  const due = "2026-11-12T09:00";
  const at = epochOf(due);
  const open = card({ due });

  // A deadline ahead is not overdue; the deadline itself is the boundary.
  expect(overdueNow(open, at - 1)).toBe(false);
  expect(overdueNow(open, at)).toBe(true);
  expect(overdueNow(open, at + HOURLY_MS)).toBe(true);

  // Finished, filed and removed work is not overdue whatever the clock says.
  expect(overdueNow(card({ due, status: "done" }), at + 1)).toBe(false);
  expect(overdueNow(card({ due, status: "archive" }), at + 1)).toBe(false);
  expect(overdueNow(card({ due, deleted: true }), at + 1)).toBe(false);
  expect(overdueNow(card(), at + 1)).toBe(false);

  // The first repeat is the hour after the deadline, not the deadline itself:
  // the deadline's own notification said that.
  expect(hourlyDue(open, at + 59 * 60_000)).toBe(false);
  expect(hourlyDue(open, at + HOURLY_MS)).toBe(true);
  // Having spoken, it waits its hour again — measured from the last time it
  // was heard, so a dismissed banner does not return on the next tick.
  expect(hourlyDue(open, at + HOURLY_MS + 30 * 60_000, at + HOURLY_MS)).toBe(false);
  expect(hourlyDue(open, at + 2 * HOURLY_MS, at + HOURLY_MS)).toBe(true);
  // An hour late is not an hour of speaking: the deadline is the start.
  expect(hourlyDue(open, at + 30 * 60_000, at + 30 * 60_000)).toBe(false);
});

test("an answer does what it says, and nothing for a card that is gone", () => {
  const now = new Date(2026, 10, 12, 12, 34, 30, 120).getTime();
  const open = card({ id: "a" });

  // 完成 finishes the card, through the same path the check circle uses.
  expect(applyResponse(open, "done", now)).toEqual({ done: true });
  // 推迟 1 小时 moves the deadline an hour out, to the minute: a due is written
  // without seconds, so the card shows 13:34 rather than 13:34:30.
  expect(applyResponse(open, "snooze", now)).toEqual({ due: "2026-11-12T13:34" });
  // The notification's own click asks for the card, and the shell opens it.
  expect(applyResponse(open, "open", now)).toEqual({ open: true });

  // Closing a notification is not an answer, an unknown action is not one
  // either, and a card removed on either device is a tombstone no button can
  // undo.
  expect(applyResponse(open, "dismiss", now)).toBeNull();
  expect(applyResponse(open, "", now)).toBeNull();
  expect(applyResponse(undefined, "done", now)).toBeNull();
  expect(applyResponse(card({ deleted: true }), "snooze", now)).toBeNull();
});

test("the calendar sets a deadline on any day", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // c3 starts due today at 20:00.
  await app.press("id:card-c3");
  await app.waitFor("id:inspector-title");
  expect(app.shows("id:due-calendar")).toBe(true);

  await app.press("id:due-calendar");
  await app.wait(400);

  // The calendar's days are named by their ISO date, which is how a day is
  // picked: a date three days out, so it is in this month's grid.
  const day = new Date();
  day.setDate(day.getDate() + 3);
  const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  await app.press(`label:${iso}`);
  await app.wait(400);

  // The card now carries that day, and the time it already had (20:00).
  const label = `${day.getMonth() + 1}月${day.getDate()}日`;
  expect(app.texts().some((t) => t.includes(label) && t.includes("20:00"))).toBe(true);
});

test("the command field is where the lead time is chosen", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // There is no settings page: the field that reaches every verb is where the
  // one number this app keeps is set. 提前 narrows the list to its five values.
  await app.keyboard.press("mod+k");
  await app.waitFor("id:palette-input");
  await app.type("id:palette-input", "提前");
  await app.wait(300);
  expect(app.shows("id:cmd-lead-0")).toBe(true);
  expect(app.shows("id:cmd-lead-15")).toBe(true);
  // Off is the default, and the row in use says so on its right.
  let texts = app.texts();
  let current = texts.indexOf("当前");
  expect(current).toBeGreaterThan(0);
  expect(texts[current - 1]).toBe("提前提醒：关闭");

  await app.press("id:cmd-lead-15");
  await app.wait(300);
  // The row does what every other row does: it runs and the field closes.
  expect(app.shows("id:palette-input")).toBe(false);
  // The choice is kept on this device's own storage, not on the board.
  await app.waitUntil(() => app.storage()["navigator.leadMinutes"] === "15");

  // Asked again, the value in use is the one now marked 当前.
  await app.keyboard.press("mod+k");
  await app.waitFor("id:palette-input");
  await app.type("id:palette-input", "提前");
  await app.wait(300);
  texts = app.texts();
  current = texts.indexOf("当前");
  expect(texts[current - 1]).toBe("提前提醒：15 分钟");
});

test("the phone says an overdue card an hour after its deadline", async () => {
  // c3 is due today at 20:00. Opening at 21:02 has passed the hour its first
  // overdue reminder falls on; the deadline's own banner was for 20:00.
  const at = new Date();
  at.setHours(21, 2, 0, 0);
  const app = await openSized(390, 844, { clock: { time: at.getTime() } });
  if (!app) return;
  expect(app.shows("id:phone-home")).toBe(true);

  await app.wait(21_000);
  expect(app.shows("id:due-banner")).toBe(true);
  expect(app.shows("id:due-banner >> text:写周报")).toBe(true);

  // Put away, the card just answered is quiet again until its next hour: a
  // line that follows is another overdue card, not this one coming straight
  // back on the next tick.
  await app.press("label:知道了");
  await app.wait(21_000);
  expect(app.shows("id:due-banner >> text:写周报")).toBe(false);
});

test("the phone shows a banner when a deadline comes due while it is open", async () => {
  // A fixed clock makes 今天 20:00 mean something: sample card c3 is due at
  // exactly that hour, and this opens the app a minute after it.
  const at = new Date();
  at.setHours(20, 1, 0, 0);
  const app = await openSized(390, 844, { clock: { time: at.getTime() } });
  if (!app) return;
  expect(app.shows("id:phone-home")).toBe(true);

  // The reminder loop looks at start and every twenty seconds after it; with
  // the manual clock, waiting moves it.
  await app.wait(21_000);
  expect(app.shows("id:due-banner")).toBe(true);
  expect(app.texts()).toContain("写周报");

  await app.press("label:知道了");
  expect(app.shows("id:due-banner")).toBe(false);
});
