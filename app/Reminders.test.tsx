import { expect, test } from "nsh/test";
import { openSized } from "./testkit";
import { epochOf, remindsAt, type Card } from "./data";
import { openApp } from "./testkit";

/**
 * Deadlines reach further than the pill on a card.
 *
 * On the Mac a due date becomes a real system notification, owned by the crate
 * (`Reminder`); on the phone no system notification can be posted at all, so a
 * deadline that comes due while the app is open puts a banner on the list.
 *
 * `epochOf` and `remindsAt` are the whole scheduling decision, so they are
 * tested as pure functions: they say which cards are worth a reminder and when
 * it fires.
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
