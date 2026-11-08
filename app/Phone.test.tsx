import { expect, test } from "nsh/test";
import { openApp } from "./testkit";

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
