import { expect, test } from "nsh/test";
import { openApp, openPhone } from "./testkit";

/**
 * The board is always the whole board: 全部, one tag, or a search. The counts
 * in the column labels and the segment are the filtered ones, so a filter never
 * leaves a column saying 7 over two rows.
 */

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
  expect(app.shows("id:phone-col-todo >> text:阅读《逐根 K 线解读》并做笔记")).toBe(true);
  expect(app.shows("id:phone-col-todo >> text:写周报")).toBe(false);
  // And the line over the list says what is being shown, and why.
  expect(app.shows("id:filter-notice")).toBe(true);
  expect(app.texts()).toContain("正在筛选：学习");

  await app.press("id:phone-filter");
  await app.waitFor("id:filter-all");
  await app.press("id:filter-all");
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
