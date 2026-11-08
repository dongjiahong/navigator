import { expect, test } from "nsh/test";
import { MIN_WINDOW } from "./geom";
import { chipWidth, dateGroupWidth, fitChips, tagBudget } from "./strip";

/**
 * The filter row's arithmetic, apart from the window it is drawn in.
 *
 * One row holds the date group, the tags, the manager, 清除 and the search, and
 * the tags are the part that gives. These are the two rules that has to keep:
 * whatever the budget, the tags never take more room than they are given — so
 * the search field is never pushed off the window — and 全部, the way out of the
 * tag selection, is never one of the chips left out.
 */

const TAGS = ["全部", "工作", "个人", "学习", "生活", "紧急"].map((label, i) => ({
  id: `${i}`,
  label,
  dot: i > 0,
}));

const DATES = [
  { label: "今天", count: 3 },
  { label: "已逾期", count: 0 },
  { label: "无日期", count: 12 },
];

test("a chip's width follows its text, its dot and its count", () => {
  expect(chipWidth({ id: "a", label: "工作" })).toBeGreaterThan(chipWidth({ id: "a", label: "工" }));
  expect(chipWidth({ id: "a", label: "工作", dot: true })).toBeGreaterThan(
    chipWidth({ id: "a", label: "工作" }),
  );
  // Digits are counted in tabular figures, so a two-digit count is wider than a
  // one-digit one and the chip is never drawn narrower than its number.
  expect(chipWidth({ id: "a", label: "今天", count: 12 })).toBeGreaterThan(
    chipWidth({ id: "a", label: "今天", count: 1 }),
  );
  // A CJK glyph is one em: four characters are four times one.
  expect(chipWidth({ id: "a", label: "工作生活" }) - chipWidth({ id: "a", label: "工作" })).toBe(2 * 11.5);
});

test("what fits is taken in order, and the rest is counted", () => {
  const all = fitChips(TAGS, 10_000);
  expect(all.hidden).toBe(0);
  expect(all.shown.map((chip) => chip.label)).toEqual(TAGS.map((chip) => chip.label));

  const narrow = fitChips(TAGS, chipWidth(TAGS[0]) + chipWidth(TAGS[1]) + 7 + chipWidth({ id: "more", label: "更多", count: 99 }) + 7);
  // 全部 and 工作, and no room for a third without hiding it.
  expect(narrow.shown.map((chip) => chip.label)).toEqual(["全部", "工作"]);
  expect(narrow.hidden).toBe(TAGS.length - 2);
});

test("全部 stays even when the budget cannot hold it", () => {
  const nothing = fitChips(TAGS, 0);
  expect(nothing.shown.map((chip) => chip.label)).toEqual(["全部"]);
  expect(nothing.hidden).toBe(TAGS.length - 1);
});

test("room is kept for 更多 before a card is taken", () => {
  // Exactly as wide as 全部 plus 工作, with nothing left for the 更多 chip: 工作
  // would push the count of hidden tags off the row, so it waits its turn.
  const tight = chipWidth(TAGS[0]) + 7 + chipWidth(TAGS[1]);
  expect(fitChips(TAGS, tight).shown.map((chip) => chip.label)).toEqual(["全部"]);
});

test("the tag strip's budget shrinks with the window and never goes negative", () => {
  const dateGroup = dateGroupWidth(DATES);
  const wide = tagBudget(1280, { clear: true, dateGroup });
  const narrow = tagBudget(MIN_WINDOW, { clear: true, dateGroup });
  expect(wide).toBeGreaterThan(narrow);
  expect(narrow).toBeGreaterThan(0);
  // 清除 only exists while something is filtered; the tags get its room back.
  expect(tagBudget(MIN_WINDOW, { clear: false, dateGroup })).toBeGreaterThan(narrow);
  expect(tagBudget(400, { clear: true, dateGroup })).toBe(0);
});

test("the row's fixed parts are what the window has left after the tags", () => {
  const dateGroup = dateGroupWidth(DATES);
  for (const width of [MIN_WINDOW, 1106, 1280, 1600]) {
    const budget = tagBudget(width, { clear: true, dateGroup });
    const rest = width - budget;
    // Padding, six gaps, the hairline, 标签, 清除, the search field and the slack
    // that keeps the estimate on the safe side.
    expect(rest).toBeGreaterThanOrEqual(dateGroup + 2 * 20 + 6 * 8 + 1 + 60 + 42 + 190);
    // Nothing is spent twice: the strip gets exactly the remainder.
    expect(budget + rest).toBe(width);
  }
});
