import { expect, test } from "nsh/test";
import { dueLabel, isoAt, newId } from "./data";

/**
 * The model's own rules, apart from any surface: ids that do not collide when
 * two devices make a row in the same millisecond, and a deadline read in the
 * device's own zone and named with its year when it is not this year's.
 */

test("ids made in the same millisecond do not collide", () => {
  // Two devices, one millisecond, one board: without the random tail the merge
  // keeps one row and the other card is silently gone.
  const seen = new Set<string>();
  for (let i = 0; i < 4000; i++) seen.add(newId("c"));
  expect(seen.size).toBe(4000);
});

test("an id carries its prefix", () => {
  const card = newId("c");
  const tag = newId("t");
  expect(card.startsWith("c")).toBe(true);
  expect(tag.startsWith("t")).toBe(true);
  // The stamp keeps ids in creation order, so a board read back is not shuffled.
  expect(card.length).toBeGreaterThan(8);
});

test("a deadline shows the hour it was written in the device's zone", () => {
  // A bare `YYYY-MM-DDTHH:mm` read as UTC would shift this hour by the
  // machine's offset, which is the bug `epochOf` exists to avoid.
  expect(dueLabel(isoAt(3, 14, 30)).text).toContain("14:30");
});

test("today, tomorrow and yesterday are named; a passed deadline says so", () => {
  expect(dueLabel(isoAt(0, 9, 30)).text).toContain("今天 09:30");
  expect(dueLabel(isoAt(1, 9, 30)).text).toContain("明天 09:30");

  const late = dueLabel(isoAt(-1, 18, 0));
  expect(late.text).toBe("已逾期 · 昨天 18:00");
  expect(late.tone).toBe("late");

  // Today, still ahead, is the amber one.
  expect(dueLabel(isoAt(0, 23, 59)).tone).toBe("soon");
});

test("a day in another year names the year", () => {
  const year = new Date().getFullYear();
  // A month months away from now, in this year: no year in the label.
  const month = new Date().getMonth() > 5 ? 1 : 7;
  const thisYear = dueLabel(`${year}-${String(month).padStart(2, "0")}-15T14:00`);
  expect(thisYear.text).toContain(`${month}月15日 14:00`);
  expect(thisYear.text).not.toContain("年");

  // Next January is not this January: 「1月5日」 alone would read as a date that
  // has already gone.
  const next = dueLabel(`${year + 1}-01-05T14:00`);
  expect(next.text).toBe(`${year + 1}年1月5日 14:00`);
  expect(next.tone).toBe("normal");
});
