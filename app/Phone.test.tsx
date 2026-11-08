import { expect, test } from "nsh/test";
import { openApp, openPhone } from "./testkit";

test("the phone list captures a card in a few taps", async () => {
  const { app, desktop } = await openApp();
  // This is the phone's surface; on a desktop window the board shows instead.
  if (desktop) return;

  expect(app.shows("id:phone-home")).toBe(true);

  await app.press("id:fab");
  await app.waitFor("id:capture-title");
  await app.type("id:capture-title", "买牛奶");
  await app.press("id:capture-save");
  await app.waitFor("text:买牛奶");
  expect(app.texts()).toContain("买牛奶");
});

test("a row completes in one tap", async () => {
  const { app, desktop } = await openApp();
  if (desktop) return;

  // c2 starts in 待办.
  expect(app.shows("id:phone-col-todo >> text:阅读《逐根 K 线解读》并做笔记")).toBe(true);
  await app.press("id:checkbox-c2");
  await app.wait(400);
  // The circle is the phone's fastest action: the row moves to 已完成.
  expect(app.shows("id:phone-col-done >> text:阅读《逐根 K 线解读》并做笔记")).toBe(true);
});

/**
 * The capture sheet's two pickers, which take the draft's setters.
 *
 * A signal's `set` called off its own signal throws 「not a live signal」, so
 * passing `draftTags.set` / `draftDue.set` as the callback made every chip on
 * the capture sheet dead: a tag could not be picked and a deadline could not be
 * set before the card was made. The phone had no other place to set either one
 * before the card existed, so this test is the only thing holding the two
 * wrappers in place.
 */
test("the capture sheet takes a tag and a day before the card exists", async () => {
  const { app } = await openPhone();
  if (!app) return;

  await app.press("id:fab");
  await app.waitFor("id:capture-title");
  await app.type("id:capture-title", "带标签和期限的卡");

  // No deadline yet: the picker says so, and pressing a day changes that.
  expect(app.shows("text:没有截止时间")).toBe(true);
  await app.press("id:due-0");
  await app.wait(300);
  expect(app.shows("text:没有截止时间")).toBe(false);
  // 今天 carries 18:00, and 清除 is what a set deadline offers.
  expect(app.shows("id:due-clear")).toBe(true);
  expect(app.texts().some((t) => t.endsWith("18:00"))).toBe(true);

  await app.press("label:标签 工作");
  await app.wait(300);

  await app.press("id:capture-save");
  await app.wait(500);

  // The card was made with both, not with a blank slate.
  const row = app.texts();
  expect(row).toContain("带标签和期限的卡");
  expect(row).toContain("工作");
  expect(row.some((t) => t.includes("18:00"))).toBe(true);
});

test("tapping a segment moves the list to that column", async () => {
  const { app, desktop } = await openApp();
  if (desktop) return;

  // The active column is set by the paged scroll's `onScroll`, never by the tab
  // press itself: the weight is 600 only on the tab whose page the list is
  // actually showing, so this fails if a tap lights the tab without scrolling.
  expect(app.spanStyle("id:segment-todo >> text:待办").fontWeight).toBe(600);
  expect(app.spanStyle("id:segment-doing >> text:进行中").fontWeight).toBe(500);

  await app.press("id:segment-doing");
  await app.wait(600);
  expect(app.spanStyle("id:segment-doing >> text:进行中").fontWeight).toBe(600);
  expect(app.spanStyle("id:segment-todo >> text:待办").fontWeight).toBe(500);

  await app.press("id:segment-todo");
  await app.wait(600);
  expect(app.spanStyle("id:segment-todo >> text:待办").fontWeight).toBe(600);
});

test("an existing card's title and notes are edited on the phone", async () => {
  const { app, desktop } = await openApp();
  if (desktop) return;

  await app.press("id:row-c3");
  await app.waitFor("id:detail-title", { timeout: 8000 });

  // Neither field is appended to by anything: c3's title is 写周报 and its
  // notes are empty, so what is read back is what the test typed.
  await app.type("id:detail-title", "（改）");
  expect(app.value("id:detail-title")).toContain("写周报（改）");
  await app.type("id:detail-notes", "补一句备注");
  expect(app.value("id:detail-notes")).toContain("补一句备注");

  await app.press("label:关闭");
  await app.wait(400);
  expect(app.shows("id:phone-col-todo >> text:写周报（改）")).toBe(true);
});
