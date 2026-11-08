import { expect, test } from "nsh/test";
import { openApp, openSized } from "./testkit";
import { AUTO_ARCHIVE_DAYS, attentionCount, staleDone, type Card } from "./data";

/**
 * The board keeps itself tidy.
 *
 * Three rules, and none of them is a press the user makes: finished work leaves
 * 已完成 after a week, 归档 can be emptied in one confirmed move, and the count
 * of work that wants attention now sits on the Dock's icon. The first two are
 * removals — a card filed away, a column wiped — so the tests hold them to what
 * they promise: nothing disappears early, nothing goes without being asked, and
 * the number the badge shows is the number the board's own pills add up to.
 */

const DAY = 86_400_000;

function card(patch: Partial<Card> = {}): Card {
  return { id: "x", title: "x", notes: "", tags: [], status: "todo", updatedAt: 0, ...patch };
}

test("a card finished more than a week ago is stale; a fresh one is not", () => {
  const at = new Date(2026, 10, 12, 12, 0).getTime();
  const week = AUTO_ARCHIVE_DAYS * DAY;
  expect(AUTO_ARCHIVE_DAYS).toBe(7);

  const finished = (age: number, patch: Partial<Card> = {}) =>
    card({ status: "done", updatedAt: at - age, ...patch });

  // Six days, and exactly seven, are still 已完成: the delay is "older than a
  // week", not "a week old".
  expect(staleDone([finished(week - 1)], at)).toEqual([]);
  expect(staleDone([finished(week)], at)).toEqual([]);
  expect(staleDone([finished(week + 1)], at)).toEqual(["x"]);
  // Only finished work. Open work is not "done", and filed work is already
  // where it would go.
  expect(staleDone([card({ status: "todo", updatedAt: at - week * 2 })], at)).toEqual([]);
  expect(staleDone([card({ status: "doing", updatedAt: at - week * 2 })], at)).toEqual([]);
  expect(staleDone([finished(week * 2, { deleted: true })], at)).toEqual([]);
});

test("the badge counts late and today, and nothing else", () => {
  const at = new Date(2026, 10, 12, 12, 0).getTime();
  expect(attentionCount([], at)).toBe(0);
  // Due today: one whose hour has gone (late) and one still ahead (today's
  // work) both count, and each card only once.
  expect(attentionCount([card({ due: "2026-11-12T09:00" })], at)).toBe(1);
  expect(attentionCount([card({ due: "2026-11-12T20:00" })], at)).toBe(1);
  expect(
    attentionCount([card({ due: "2026-11-12T09:00" }), card({ due: "2026-11-12T20:00" })], at),
  ).toBe(2);
  // A deadline that has gone on an earlier day is late, whenever it was.
  expect(attentionCount([card({ due: "2026-11-09T18:00" })], at)).toBe(1);
  // Tomorrow asks nothing today, which is what makes the number about *now*.
  expect(attentionCount([card({ due: "2026-11-13T09:00" })], at)).toBe(0);
  // Finished, archived and removed work asks nothing of anyone.
  expect(attentionCount([card({ due: "2026-11-12T09:00", status: "done" })], at)).toBe(0);
  expect(attentionCount([card({ due: "2026-11-12T09:00", status: "archive" })], at)).toBe(0);
  expect(attentionCount([card({ due: "2026-11-12T09:00", deleted: true })], at)).toBe(0);
  // A card with no deadline is not late.
  expect(attentionCount([card()], at)).toBe(0);
});

test("finished work is filed away after a week, and nothing is offered back", async () => {
  const app = await openSized(1280, 820, { clock: {} });
  if (!app || !app.clock) return;
  expect(app.shows("id:col-done >> id:card-c10")).toBe(true);

  // The board is left alone for eight days: the hourly pass files the sample
  // board's finished cards, which were stamped when the app opened.
  await app.clock.fastForward(8 * DAY);
  await app.wait(300);

  expect(app.shows("id:col-archive >> id:card-c10")).toBe(true);
  expect(app.shows("id:col-done >> id:card-c10")).toBe(false);
  expect(app.shows("id:col-archive >> id:card-c11")).toBe(true);
  expect(app.shows("id:col-archive >> id:card-c12")).toBe(true);
  // Housekeeping is not a press the user just made: there is nothing to take
  // back, because the card is one column away rather than gone.
  expect(app.shows("id:undo-toast")).toBe(false);

  // A card finished now starts its own week, and stays where the user put it.
  await app.press("id:check-c2");
  await app.wait(400);
  expect(app.shows("id:col-done >> id:card-c2")).toBe(true);
});

test("清空归档 asks first, names the number, and keeps the cards when it is refused", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;
  expect(app.shows("id:col-archive >> id:card-c13")).toBe(true);
  expect(app.shows("id:col-archive >> id:card-c14")).toBe(true);

  // 取消 is the answer a dialog opens with: nothing is removed.
  app.onDialog(() => "取消");
  await app.press("id:clear-archive");
  await app.wait(400);
  const asked = app.dialogs()[0];
  expect(asked?.title).toBe("清空归档？");
  expect(asked?.message).toContain("2");
  expect(app.shows("id:col-archive >> id:card-c13")).toBe(true);
  expect(app.shows("id:col-archive >> id:card-c14")).toBe(true);

  // 清空 takes both, and the button goes with the cards it was for.
  app.onDialog(() => "清空");
  await app.press("id:clear-archive");
  await app.wait(400);
  expect(app.shows("id:col-archive >> id:card-c13")).toBe(false);
  expect(app.shows("id:col-archive >> id:card-c14")).toBe(false);
  expect(app.shows("id:clear-archive")).toBe(false);
  // The column says what an empty archive means rather than standing blank.
  expect(app.texts()).toContain("归档的卡片不会再打扰你");
});

test("清空归档 is offered only where there is something to empty", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;
  // Every other column's label row carries 新建 and nothing else.
  expect(app.count("id:clear-archive")).toBe(1);

  app.onDialog(() => "清空");
  await app.press("id:clear-archive");
  await app.wait(400);
  expect(app.shows("id:clear-archive")).toBe(false);
});
