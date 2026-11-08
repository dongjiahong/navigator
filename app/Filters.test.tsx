import { expect, test } from "nsh/test";
import { openApp, openPhone, openSized } from "./testkit";
import { dueBuckets, dueCounts } from "./filters";
import { attentionCount, type Card } from "./data";

/**
 * The board is always the whole board, narrowed by three questions at once:
 * whose work it is, when it is due, and the words in it. A card shows when it
 * answers all of them, the counts in the column labels are the filtered ones,
 * and a filter never leaves a column saying 7 over two rows.
 */

function card(patch: Partial<Card> = {}): Card {
  return { id: "x", title: "x", notes: "", tags: [], status: "todo", updatedAt: 0, ...patch };
}

/** A due written the way the app writes one: local, no zone. */
function at(day: number, hour: number, minute = 0): string {
  const d = new Date(2026, 10, 12, hour, minute);
  d.setDate(d.getDate() + day);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const NOW = new Date(2026, 10, 12, 12, 0).getTime();

test("a date condition is a day, a lateness and an absence, and only open work answers", () => {
  // Today at midnight is today; today at 23:59 is today and not yet late.
  expect(dueBuckets(card({ due: at(0, 0, 0) }), NOW)).toEqual(["overdue", "today"]);
  expect(dueBuckets(card({ due: at(0, 23, 59) }), NOW)).toEqual(["today"]);
  // A deadline that has gone is late whatever the day — yesterday 23:59 is the
  // boundary between 已逾期 and nothing of this day at all.
  expect(dueBuckets(card({ due: at(-1, 23, 59) }), NOW)).toEqual(["overdue"]);
  expect(dueBuckets(card({ due: at(1, 0, 0) }), NOW)).toEqual([]);
  // No deadline is its own condition, not a fourth kind of day.
  expect(dueBuckets(card(), NOW)).toEqual(["none"]);
  // Finished and filed work has no deadline to warn about.
  expect(dueBuckets(card({ status: "done", due: at(-1, 9) }), NOW)).toEqual([]);
  expect(dueBuckets(card({ status: "archive", due: at(0, 9) }), NOW)).toEqual([]);
  expect(dueBuckets(card({ due: at(0, 9), deleted: true }), NOW)).toEqual([]);
});

test("a deadline across midnight changes condition without being edited", () => {
  const tonight = card({ due: at(0, 23, 59) });
  const late = new Date(2026, 10, 12, 23, 59).getTime();
  const minuteLater = late + 60_000;
  // Earlier the same minute: today, and not yet late.
  expect(dueBuckets(tonight, late)).toEqual(["today"]);
  // One minute on: the same card is late, and no longer today.
  expect(dueBuckets(tonight, minuteLater)).toEqual(["overdue"]);
});

test("the counts over a board add each condition's own cards, never the view's", () => {
  const all = [
    card({ id: "t1", due: at(0, 9) }),
    card({ id: "t2", due: at(0, 21) }),
    card({ id: "l1", due: at(-3, 9) }),
    card({ id: "n1" }),
    card({ id: "f1", due: at(2, 9) }),
    card({ id: "d1", status: "done", due: at(0, 9) }),
  ];
  // t1 is today all day and late since 09:00, so it counts in both — the same
  // overlap the red and amber pills have on the board.
  expect(dueCounts(all, NOW)).toEqual({ today: 2, overdue: 2, none: 1 });
});

test("今天 plus 已逾期 is the Dock's number, except for a card due today and already past", () => {
  // The badge counts late and today, once each. The two filter chips count
  // their own cards, and a deadline today that its hour has passed is in both —
  // today all day, and late from its hour on. So the sum is the badge, plus one
  // for every such card.
  const overlaps = [card({ id: "a", due: at(0, 9) }), card({ id: "b", due: at(0, 10) })];
  const rest = [card({ id: "c", due: at(0, 23) }), card({ id: "d", due: at(-2, 9) }), card({ id: "e" })];
  const all = [...overlaps, ...rest];
  const counts = dueCounts(all, NOW);
  expect(attentionCount(all, NOW)).toBe(4);
  expect(counts.today + counts.overdue).toBe(6);
  expect(counts.today + counts.overdue - attentionCount(all, NOW)).toBe(overlaps.length);

  // A board where nothing today has gone yet: the two numbers agree exactly.
  const quiet = [card({ id: "c", due: at(0, 23) }), card({ id: "d", due: at(-2, 9) }), card({ id: "e" })];
  const quietCounts = dueCounts(quiet, NOW);
  expect(quietCounts.today + quietCounts.overdue).toBe(attentionCount(quiet, NOW));
});

test("a tag narrows the Mac board and 全部 restores it", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // c2 is 学习, c3 is 工作.
  expect(app.shows("id:col-todo >> id:card-c2")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(true);

  await app.press("label:学习");
  expect(app.shows("id:col-todo >> id:card-c2")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(false);

  await app.press("label:全部");
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(true);
});

test("several tags show the cards that carry any of them", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // 学习 is c2 and c8, 生活 is c6 and c7, 工作 is c3.
  await app.press("label:学习");
  await app.press("label:生活");
  expect(app.shows("id:col-todo >> id:card-c2")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c8")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c6")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c7")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(false);

  // A second press on a chosen tag takes it out; the other still narrows.
  await app.press("label:学习");
  expect(app.shows("id:col-todo >> id:card-c2")).toBe(false);
  expect(app.shows("id:col-todo >> id:card-c6")).toBe(true);
});

test("a date condition narrows the board, and pressing it again clears it", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // 今天 is c1, c3 and c4; c2 is tomorrow, c5 has no deadline.
  await app.press("label:今天");
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c2")).toBe(false);
  expect(app.shows("id:col-todo >> id:card-c5")).toBe(false);
  // Finished and filed work is not part of any of the three conditions.
  expect(app.shows("id:col-done >> id:card-c11")).toBe(false);
  expect(app.shows("id:col-done >> text:没有匹配的卡片")).toBe(true);
  expect(app.shows("id:col-archive >> text:没有匹配的卡片")).toBe(true);

  await app.press("label:今天");
  expect(app.shows("id:col-todo >> id:card-c2")).toBe(true);
});

test("无日期 is the cards with no deadline at all", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // c5, c7 and c9 carry no due; c3's is today.
  await app.press("label:无日期");
  expect(app.shows("id:col-todo >> id:card-c5")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c7")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c9")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(false);
});

test("the three questions are one filter: tag and date and search at once", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // 工作 and today is c1, c3 and c4; 周报 leaves c3.
  await app.press("label:工作");
  await app.press("label:今天");
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(true);
  await app.type("id:board-search", "周报");
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c1")).toBe(false);
  expect(app.shows("id:col-doing >> id:card-c4")).toBe(false);
  // 清除 puts all three back.
  await app.press("id:clear-filters");
  expect(app.shows("id:col-todo >> id:card-c2")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(true);
});

test("each date chip carries the board's count, and another filter does not move it", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // Today's three and the three with no deadline, over the whole board.
  expect(app.shows("id:date-today >> text:3")).toBe(true);
  expect(app.shows("id:date-none >> text:3")).toBe(true);

  // Narrowing to 学习 hides most of the board, and the counts still describe it.
  await app.press("label:学习");
  expect(app.shows("id:date-today >> text:3")).toBe(true);
  expect(app.shows("id:date-none >> text:3")).toBe(true);
});

test("a tag removed while it is filtering drops out of the selection", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  app.onDialog(() => "删除");
  await app.press("label:学习");
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(false);

  await app.press("id:manage-tags");
  await app.waitFor("id:tag-name-study");
  await app.press("label:删除标签 学习");
  await app.wait(400);

  // The tag is gone, and so is its grip on the board: a selection holding a
  // dead id would narrow the board to nothing with no chip to press to undo it.
  expect(app.shows("id:tag-filter-study")).toBe(false);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(true);
  expect(app.shows("id:clear-filters")).toBe(false);
});

test("a search matches a card's title", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.type("id:board-search", "周报");
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c2")).toBe(false);
});

test("a search matches a card's notes", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // 「波浪理论」 is only in c8's notes.
  await app.type("id:board-search", "波浪理论");
  expect(app.shows("id:col-todo >> id:card-c8")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(false);
});

test("a search matches a tag's name and 清除 brings the board back", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // 紧急 is c11's tag, and the word is nowhere in its own text.
  await app.type("id:board-search", "紧急");
  expect(app.shows("id:col-done >> id:card-c11")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(false);

  await app.press("id:clear-filters");
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(true);
});

test("nothing matching says so in every column", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.type("id:board-search", "没有这张卡");
  expect(app.shows("id:col-todo >> id:card-c1")).toBe(false);
  expect(app.shows("text:没有匹配的卡片")).toBe(true);
});

/**
 * The row at the board's narrowest window: four columns at their floor is 1106
 * points, which is where the filter strip has the least room to give.
 *
 * What must survive is the search field and the date group; what gives is the
 * tag strip, which puts the tags that do not fit behind 更多 rather than
 * scrolling sideways or pushing the field off the edge.
 */
test("the filter row gives its tags, never its search, in a narrow window", async () => {
  const app = await openSized(1106, 800);
  if (!app) return;

  expect(app.shows("id:board-search")).toBe(true);
  expect(app.shows("id:date-today")).toBe(true);
  expect(app.shows("id:date-overdue")).toBe(true);
  expect(app.shows("id:date-none")).toBe(true);

  // Six more tags, four characters each, so the strip cannot hold them all.
  await app.press("id:manage-tags");
  await app.waitFor("id:new-tag");
  for (const name of ["家庭杂务", "读书笔记", "户外运动", "财务整理", "旅行清单", "末位标签"]) {
    await app.type("id:new-tag", name);
    await app.press("id:add-tag");
    await app.wait(150);
  }
  await app.press("label:关闭");
  await app.wait(300);

  expect(app.shows("id:tags-more")).toBe(true);
  expect(app.shows("id:board-search")).toBe(true);

  // The ones that did not fit are still reachable, one press away.
  await app.press("id:tags-more");
  await app.waitFor("id:tags-more-sheet");
  await app.wait(400);
  expect(app.shows("text:末位标签")).toBe(true);

  // A tag chosen from behind 更多 leaves 更多 on, so the strip says a filter is
  // in force even when the chip that holds it does not fit.
  await app.press("text:末位标签");
  await app.wait(300);
  expect(app.spanStyle("id:tags-more >> text:更多").fontWeight).toBe(600);
  await app.press("text:末位标签");
  await app.wait(300);
  expect(app.spanStyle("id:tags-more >> text:更多").fontWeight).toBe(500);

  await app.press("label:完成");
  await app.wait(300);
  expect(app.shows("id:tags-more-sheet")).toBe(false);
});

test("the phone filters by tag and by search", async () => {
  const { app, titleBand } = await openPhone();
  // Both controls are in the phone's title row; a sized desktop window covers
  // that row with its own title band, so this runs headless and on a device.
  if (!app || titleBand) return;

  // The tag strip is a funnel in the title bar now, and the sheet it opens: the
  // list is the phone's only screen, so a filter is one press away rather than a
  // row of chips standing over it all day.
  await app.press("id:phone-filter");
  await app.waitFor("id:filter-tag-study");
  await app.press("id:filter-tag-study");
  // The sheet stays up for the next tag: several tags mean "any of them".
  expect(app.shows("id:filter-tag-study")).toBe(true);
  await app.press("id:filter-done");
  await app.wait(300);
  expect(app.shows("id:phone-col-todo >> text:阅读《逐根 K 线解读》并做笔记")).toBe(true);
  expect(app.shows("id:phone-col-todo >> text:写周报")).toBe(false);
  // And the line over the list says what is being shown, and why.
  expect(app.shows("id:filter-notice")).toBe(true);
  expect(app.texts()).toContain("正在筛选：学习");

  await app.press("id:phone-filter");
  await app.waitFor("id:filter-all");
  await app.press("id:filter-all");
  await app.press("id:filter-done");
  await app.wait(300);
  expect(app.shows("id:phone-col-todo >> text:写周报")).toBe(true);
  expect(app.shows("id:filter-notice")).toBe(false);

  // The field is behind the lens; typing into it narrows the same list.
  expect(app.shows("id:phone-search")).toBe(false);
  await app.press("id:phone-search-toggle");
  await app.waitFor("id:phone-search");
  await app.type("id:phone-search", "周报");
  expect(app.shows("id:phone-col-todo >> text:写周报")).toBe(true);
  expect(app.shows("id:phone-col-todo >> text:阅读《逐根 K 线解读》并做笔记")).toBe(false);

  await app.press("id:clear-filters");
  expect(app.shows("id:phone-col-todo >> text:阅读《逐根 K 线解读》并做笔记")).toBe(true);
});

test("several tags on the phone read as several, and a date condition sits beside them", async () => {
  const { app, titleBand } = await openPhone();
  if (!app || titleBand) return;

  await app.press("id:phone-filter");
  await app.waitFor("id:filter-tag-study");
  await app.press("id:filter-tag-study");
  await app.press("id:filter-tag-life");
  await app.press("id:filter-done");
  await app.wait(300);
  // Both tags are in force, named in the order they were picked.
  expect(app.texts()).toContain("正在筛选：学习、生活");

  // The date group is the fourth section of the same sheet, one at a time.
  await app.press("id:phone-filter");
  await app.waitFor("id:filter-due-today");
  await app.press("id:filter-due-today");
  await app.press("id:filter-due-none");
  await app.press("id:filter-done");
  await app.wait(300);
  expect(app.texts()).toContain("正在筛选：学习、生活 · 无日期");
  expect(app.shows("id:phone-col-todo >> text:计划一次欧洲背包旅行")).toBe(true);
  expect(app.shows("id:phone-col-todo >> text:阅读《逐根 K 线解读》并做笔记")).toBe(false);

  // 清除全部 empties every one of the three in a press.
  await app.press("id:phone-filter");
  await app.waitFor("id:filter-clear-all");
  await app.press("id:filter-clear-all");
  await app.press("id:filter-done");
  await app.wait(300);
  expect(app.shows("id:filter-notice")).toBe(false);
  expect(app.shows("id:phone-col-todo >> text:写周报")).toBe(true);
});

test("the phone's search folds away, and takes the search with it", async () => {
  const { app, titleBand } = await openPhone();
  if (!app || titleBand) return;

  await app.press("id:phone-search-toggle");
  await app.waitFor("id:phone-search");
  await app.type("id:phone-search", "周报");
  expect(app.shows("id:phone-col-todo >> text:阅读《逐根 K 线解读》并做笔记")).toBe(false);

  // Folding the field away empties it: a field nobody can see must never be
  // filtering a list.
  await app.press("id:phone-search-toggle");
  await app.wait(200);
  expect(app.shows("id:phone-search")).toBe(false);
  expect(app.shows("id:phone-col-todo >> text:阅读《逐根 K 线解读》并做笔记")).toBe(true);

  // The same fold, from the field's own button, once it has been emptied.
  await app.press("id:phone-search-toggle");
  await app.waitFor("id:phone-search");
  await app.press("id:phone-search-close");
  await app.wait(200);
  expect(app.shows("id:phone-search")).toBe(false);
});
