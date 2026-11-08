import { expect, test } from "nsh/test";
import { boardToJson, parseBoard } from "./backup";
import { dueLabel, epochOf, isoAt, remindsAt, type Card } from "./data";
import { reminderPlan } from "./deadline";
import { allFields } from "./fields";
import { mergeBoards } from "./merge";
import { REPEATS, isUntouched, nextDue, nextRepeat, repeatLabel, rootId, successorId, successorOf } from "./repeat";
import { openSized } from "./testkit";

/**
 * Repeating work: the date rule, the next occurrence's name, and the card a
 * completion makes.
 *
 * The date rule is arithmetic over a `YYYY-MM-DDTHH:mm` string, so it is tested
 * without a window. The card is arithmetic too — its id has to be the same on
 * both devices, which is a claim about a function, not about a screen — and the
 * last tests only check that the board does what the functions say.
 */

/** A due at the given local day, for a test that does not care about hours. */
const at = (iso: string) => epochOf(iso);

test("a day and a week step through the calendar and keep the hour", () => {
  // Completing a day early does not make today's occurrence again: this one was
  // just done, so the next is the day after the deadline.
  expect(nextDue("2026-11-15T14:00", "daily", at("2026-11-15T09:00"))).toBe("2026-11-16T14:00");
  // And a card finished five days late makes exactly one card, at the nearest
  // occurrence ahead of the press — not five.
  expect(nextDue("2026-11-10T08:00", "daily", at("2026-11-15T09:00"))).toBe("2026-11-16T08:00");
  expect(nextDue("2026-11-15T14:00", "weekly", at("2026-11-15T15:00"))).toBe("2026-11-22T14:00");
  // A week crossing a month end is still seven days.
  expect(nextDue("2026-11-28T07:30", "weekly", at("2026-11-28T08:00"))).toBe("2026-12-05T07:30");
  // The time of day is the user's, and it survives every cycle.
  expect(nextDue("2026-12-31T23:15", "daily", at("2026-12-31T23:30"))).toBe("2027-01-01T23:15");
});

test("a month clamps to the end of a shorter one, and a leap day to the 28th", () => {
  // 1月31日 in a 28-day February, and in a 29-day one.
  expect(nextDue("2026-01-31T14:00", "monthly", at("2026-02-01T00:00"))).toBe("2026-02-28T14:00");
  expect(nextDue("2024-01-31T14:00", "monthly", at("2024-02-01T00:00"))).toBe("2024-02-29T14:00");
  // December rolls into January of the next year.
  expect(nextDue("2026-12-31T09:00", "monthly", at("2026-12-31T10:00"))).toBe("2027-01-31T09:00");
  // 2月29日 only exists every fourth year.
  expect(nextDue("2024-02-29T09:00", "yearly", at("2024-03-01T00:00"))).toBe("2025-02-28T09:00");
  expect(nextDue("2024-12-31T18:00", "yearly", at("2025-01-01T00:00"))).toBe("2025-12-31T18:00");
});

test("a clamped month card drifts to the 28th, which is the known approximation", () => {
  // 1月31日 → 2月28日, and March continues from the 28th rather than from the
  // 31st: the original day would be a field the merge had to carry, for a
  // deadline the user can simply move.
  expect(nextDue("2026-01-31T14:00", "monthly", at("2026-03-01T00:00"))).toBe("2026-03-28T14:00");
  expect(nextDue("2026-01-31T14:00", "monthly", at("2026-04-01T00:00"))).toBe("2026-04-28T14:00");
});

test("the next occurrence is strictly later than the press", () => {
  // The boundary exactly: a completion at the moment of an occurrence moves on
  // to the one after it, so the card made is never one about to be due.
  expect(nextDue("2026-11-15T14:00", "daily", at("2026-11-16T14:00"))).toBe("2026-11-17T14:00");
  expect(nextDue("2026-11-15T14:00", "daily", at("2026-11-16T13:59"))).toBe("2026-11-16T14:00");
  // Text that is not a due is handed back rather than guessed at.
  expect(nextDue("不是日期", "daily", Date.now())).toBe("不是日期");
});

test("the next occurrence is named after the card the chain started from", () => {
  expect(rootId("c123")).toBe("c123");
  expect(rootId("c123@2026-11-15T14:00")).toBe("c123");
  // A chained id never grows: the root is everything before the first `@`.
  expect(rootId("c123@2026-11-15T14:00@2026-11-22T14:00")).toBe("c123");
  expect(successorId("c123", "2026-11-15T14:00")).toBe("c123@2026-11-15T14:00");
  expect(successorId("c123@2026-11-08T14:00", "2026-11-15T14:00")).toBe("c123@2026-11-15T14:00");
});

test("the cycle walks the five states in order, and back to none", () => {
  expect(REPEATS).toEqual(["daily", "weekly", "monthly", "yearly"]);
  expect(nextRepeat(undefined)).toBe("daily");
  expect(nextRepeat("daily")).toBe("weekly");
  expect(nextRepeat("weekly")).toBe("monthly");
  expect(nextRepeat("monthly")).toBe("yearly");
  expect(nextRepeat("yearly")).toBe(undefined);
  expect(repeatLabel(undefined)).toBe("不重复");
  expect(repeatLabel("weekly")).toBe("每周");
});

/** A finished repeating card, as the board holds one. */
function finished(patch: Partial<Card> = {}): Card {
  return {
    id: "c1",
    title: "晨跑三公里",
    notes: "- [ ] 出门",
    tags: ["life"],
    due: "2026-11-15T07:00",
    repeat: "daily",
    status: "done",
    updatedAt: 100,
    stamps: allFields(100),
    ...patch,
  };
}

test("only a finished card with a deadline and a cycle makes another", () => {
  const next = successorOf(finished(), 100);
  expect(next).not.toBeNull();
  expect(next).toEqual({
    id: "c1@2026-11-16T07:00",
    title: "晨跑三公里",
    notes: "- [ ] 出门",
    tags: ["life"],
    due: "2026-11-16T07:00",
    repeat: "daily",
  });
  // A card that has not been finished has not happened yet.
  expect(successorOf(finished({ status: "todo" }), 100)).toBeNull();
  // Nothing to repeat from, nothing to repeat on.
  expect(successorOf(finished({ due: undefined }), 100)).toBeNull();
  expect(successorOf(finished({ repeat: undefined }), 100)).toBeNull();
  // A tombstone makes nothing, even if its fields still say done.
  expect(successorOf(finished({ deleted: true }), 100)).toBeNull();
});

test("two devices that see one completion name the same card", () => {
  // The phone finishes the card at 100; the Mac sees the same completion — and
  // computes the deadline from the card's own stamp, not from its clock, so a
  // clock a second apart picks the same occurrence.
  const onPhone = successorOf(finished(), 100)!;
  const onMac = successorOf({ ...finished(), stamps: allFields(100), updatedAt: 100 }, 100)!;
  expect(onMac.id).toBe(onPhone.id);

  // Written to each board with that device's own stamps, the two rows merge into
  // one card — which is the whole reason the id is derived rather than invented.
  const written = (stamp: number): Card => ({
    ...onPhone,
    status: "todo",
    rank: 2000,
    updatedAt: stamp,
    stamps: allFields(stamp),
  });
  const merged = mergeBoards([written(100)], [written(140)]);
  expect(merged.length).toBe(1);
  expect(merged[0].id).toBe("c1@2026-11-16T07:00");
  expect(merged[0].title).toBe("晨跑三公里");
});

test("a card nobody has touched is untouched, and one field's edit is not", () => {
  expect(isUntouched(finished({ status: "todo" }))).toBe(true);
  // A title typed after it was made is the user's card, not the completion's.
  expect(isUntouched(finished({ status: "todo", title: "改过的标题", updatedAt: 200 }))).toBe(false);
  // A card written before fields carried stamps cannot say, and is left alone.
  expect(isUntouched({ id: "x", title: "", notes: "", tags: [], status: "todo", updatedAt: 1 })).toBe(false);
});

test("the next occurrence is work the reminders pick up without another rule", () => {
  // The board's schedule reads every open card with a deadline ahead, so the
  // card a completion makes is a reminder like any other — the fields it
  // carries are what the rule already reads.
  const next = successorOf(finished(), 100)!;
  const card: Card = { ...next, status: "todo", rank: 2000, updatedAt: 100, stamps: allFields(100) };
  const now = epochOf("2026-11-15T08:00");
  expect(remindsAt(card, now)).toBe(true);
  expect(reminderPlan(card, now, 0).at).toBe(epochOf("2026-11-16T07:00"));
  // And the copy it came from, now finished, is no longer scheduled.
  expect(remindsAt(finished(), now)).toBe(false);
});

test("a cycle survives an export and an import", () => {
  // The field is part of the card, so the file that leaves the app carries it;
  // an import that dropped it would bring a recurring card back as a one-off.
  const card: Card = {
    ...finished({ status: "todo" }),
    id: "c9",
    repeat: "monthly",
  };
  const text = boardToJson([card], [], 1000);
  const parsed = parseBoard(text);
  if ("error" in parsed) throw new Error(parsed.error);
  expect(parsed.board.cards[0].repeat).toBe("monthly");
  // A cycle on a card with no deadline is not a cycle, and is dropped.
  const loose = parseBoard(boardToJson([{ ...card, due: undefined }], [], 1000));
  if ("error" in loose) throw new Error(loose.error);
  expect(loose.board.cards[0].repeat).toBe(undefined);
});

/**
 * The board's own behaviour, on a real window: completing a repeating card
 * makes the next one at the foot of 待办, once, with the fields the card had.
 */
test("completing a repeating card makes the next one in 待办", async () => {
  const app = await openSized(1280, 820);
  if (!app) return;

  await app.press("id:card-c2");
  await app.waitFor("id:inspector-title");
  // 不重复 → 每天, a press at a time.
  await app.press("id:due-repeat");
  await app.wait(200);
  expect(app.shows("label:重复：每天")).toBe(true);
  await app.press("label:关闭");
  await app.wait(300);

  await app.press("id:check-c2");
  await app.wait(600);

  const next = nextDue(isoAt(1, 21, 0), "daily", Date.now());
  const made = `id:card-c2@${next}`;
  // The card itself moved to 已完成, and the next occurrence is in 待办 with the
  // note, the tag and the deadline it will come back on.
  expect(app.shows("id:col-done >> id:card-c2")).toBe(true);
  expect(app.shows(`id:col-todo >> ${made}`)).toBe(true);
  expect(app.count("id:col-todo >> text:阅读《逐根 K 线解读》并做笔记")).toBe(1);
  expect(app.shows(`id:col-todo >> ${made} >> text:${dueLabel(next).text}`)).toBe(true);
  expect(app.shows(`id:col-todo >> ${made} >> text:学习`)).toBe(true);
  expect(app.shows(`id:col-todo >> ${made} >> text:主要看一些 K 线的形态。`)).toBe(true);

  // And the cycle came with it: the occurrence repeats too, so finishing it
  // makes the one after that.
  await app.press(`id:col-todo >> ${made}`);
  await app.waitFor("id:inspector-title");
  expect(app.shows("label:重复：每天")).toBe(true);

  // The toast says when it comes back, in the same line as what happened.
  expect(app.texts()).toContain(`已完成「阅读《逐根 K 线解读》并做笔记」，下次 ${dueLabel(next).text}`);
});

test("the rule is idempotent: a second look at the board makes nothing", async () => {
  const app = await openSized(1280, 820);
  if (!app) return;

  await app.press("id:card-c3");
  await app.waitFor("id:inspector-title");
  await app.press("id:due-repeat"); // c3 repeats daily
  await app.wait(200);
  await app.press("label:关闭");
  await app.wait(200);
  await app.press("id:check-c3");
  await app.wait(600);
  expect(app.count("id:col-todo >> text:写周报")).toBe(1);

  // Any other change runs the rule again over the same board.
  await app.press("id:card-c2");
  await app.waitFor("id:inspector-title");
  await app.type("id:inspector-title", "（再看看）");
  await app.wait(600);

  expect(app.count("id:col-todo >> text:写周报")).toBe(1);
  const next = nextDue(isoAt(0, 20, 0), "daily", Date.now());
  expect(app.count(`id:col-todo >> id:card-c3@${next}`)).toBe(1);
});

test("a next occurrence the user deleted is not put back", async () => {
  const app = await openSized(1280, 820);
  if (!app) return;

  await app.press("id:card-c3");
  await app.waitFor("id:inspector-title");
  await app.press("id:due-repeat");
  await app.wait(200);
  await app.press("label:关闭");
  await app.wait(200);
  await app.press("id:check-c3");
  await app.wait(600);

  // The tombstone is a row with the same id, so the rule finds it and makes
  // nothing: deleting the next one is the user saying "not this time".
  await app.press("id:col-todo >> text:写周报");
  await app.waitFor("id:inspector-title");
  await app.press("label:删除卡片");
  await app.wait(600);
  expect(app.count("id:col-todo >> text:写周报")).toBe(0);

  // Another change of the board runs the rule again, and it stays deleted.
  await app.press("id:card-c2");
  await app.waitFor("id:inspector-title");
  await app.type("id:inspector-title", "（再看看）");
  await app.wait(600);
  expect(app.count("id:col-todo >> text:写周报")).toBe(0);
});

test("undoing a completion takes the next occurrence with it", async () => {
  const app = await openSized(1280, 820);
  if (!app) return;

  await app.press("id:card-c3");
  await app.waitFor("id:inspector-title");
  await app.press("id:due-repeat");
  await app.wait(200);
  await app.press("label:移到已完成");
  await app.wait(600);
  expect(app.count("id:col-todo >> text:写周报")).toBe(1);

  // The panel is over the board, and the offer is at the foot of the window.
  await app.press("label:关闭");
  await app.press("id:undo-action");
  await app.wait(600);

  // The card is back in 待办 and the occurrence it made is gone: an undo that
  // left a copy behind would be a duplicate nobody asked for.
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(true);
  expect(app.shows("id:col-done >> id:card-c3")).toBe(false);
  expect(app.count("id:col-todo >> text:写周报")).toBe(1);
  const next = nextDue(isoAt(0, 20, 0), "daily", Date.now());
  expect(app.count(`id:col-todo >> id:card-c3@${next}`)).toBe(0);
});

test("moving a finished card's deadline does not make a second occurrence", async () => {
  const app = await openSized(1280, 820);
  if (!app) return;

  await app.press("id:card-c3");
  await app.waitFor("id:inspector-title");
  await app.press("id:due-repeat");
  await app.wait(200);
  await app.press("label:移到已完成");
  await app.wait(600);
  expect(app.count("id:col-todo >> text:写周报")).toBe(1);

  // The card is finished, and its deadline is history — but the panel still
  // edits it. A new deadline would name a different occurrence, so the rule has
  // to know that the chain already has one waiting rather than make a second.
  await app.press("id:due-1");
  await app.wait(600);
  expect(app.count("id:col-todo >> text:写周报")).toBe(1);
  expect(app.count("id:col-done >> text:写周报")).toBe(1);
});

test("the chain keeps going: finishing the occurrence makes the one after it", async () => {
  const app = await openSized(1280, 820);
  if (!app) return;

  await app.press("id:card-c3");
  await app.waitFor("id:inspector-title");
  await app.press("id:due-repeat");
  await app.wait(200);
  await app.press("label:关闭");
  await app.wait(200);
  await app.press("id:check-c3");
  await app.wait(600);

  const first = `card-c3@${nextDue(isoAt(0, 20, 0), "daily", Date.now())}`;
  await app.press(`id:col-todo >> id:${first}`);
  await app.waitFor("id:inspector-title");
  await app.press("label:移到已完成");
  await app.wait(600);

  // One card in 待办, and the two finished ones in 已完成: the chain advances
  // one occurrence per completion instead of stopping at the first.
  expect(app.count("id:col-todo >> text:写周报")).toBe(1);
  expect(app.count("id:col-done >> text:写周报")).toBe(2);
  // The occurrence left open is the third of the chain, not the second again.
  const third = `id:card-c3@${nextDue(nextDue(isoAt(0, 20, 0), "daily", Date.now()), "daily", Date.now())}`;
  expect(app.count(`id:col-todo >> ${third}`)).toBe(1);
});

test("clearing the deadline clears the cycle with it", async () => {
  const app = await openSized(1280, 820);
  if (!app) return;

  await app.press("id:card-c3");
  await app.waitFor("id:inspector-title");
  await app.press("id:due-repeat");
  await app.wait(200);
  expect(app.shows("id:due-repeat")).toBe(true);

  await app.press("id:due-clear");
  await app.wait(300);
  // No deadline, so nothing to repeat from: the chip has nothing to show.
  expect(app.shows("id:due-repeat")).toBe(false);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(true);
});

test("the phone repeats a card the same way", async () => {
  const app = await openSized(390, 844);
  if (!app) return;

  await app.press("id:row-c2");
  await app.waitFor("id:detail-notes");
  await app.press("id:due-repeat");
  await app.wait(200);
  expect(app.shows("label:重复：每天")).toBe(true);
  await app.press("label:关闭");
  await app.wait(300);

  await app.press("id:checkbox-c2");
  await app.wait(600);

  const next = nextDue(isoAt(1, 21, 0), "daily", Date.now());
  expect(app.count("id:phone-col-todo >> text:阅读《逐根 K 线解读》并做笔记")).toBe(1);
  expect(app.shows(`id:phone-col-todo >> text:${dueLabel(next).text}`)).toBe(true);
});
