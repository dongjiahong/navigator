import { expect, test } from "nsh/test";
import { openApp } from "./testkit";

/**
 * The board from the keyboard.
 *
 * PRODUCT.md promises no action that needs a mouse. These tests hold the Mac to
 * it: the arrow keys walk the board, Enter reads a card, Space finishes it,
 * Cmd+Backspace deletes it and Cmd+] / Cmd+[ move it between columns — and none
 * of that may fire while a field has the keyboard, which is the difference
 * between a shortcut and an app that eats what you type.
 */

test("the arrow keys walk the board and Enter opens the card", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // No cursor yet: the first down lands on 待办's first card, c2.
  await app.keyboard.press("down");
  await app.keyboard.press("enter");
  await app.waitFor("id:inspector-title");
  expect(app.value("id:inspector-title")).toContain("阅读《逐根 K 线解读》并做笔记");
});

test("down walks the column and right crosses into the next one", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // 待办 starts c2, c3; 进行中 starts c1, c4.
  await app.keyboard.press("down");
  await app.keyboard.press("down");
  await app.keyboard.press("right");
  await app.keyboard.press("enter");
  await app.waitFor("id:inspector-title");
  expect(app.value("id:inspector-title")).toContain("完成工作报告初稿");
});

test("space finishes the focused card", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.keyboard.press("down");
  await app.keyboard.press("space");
  await app.wait(400);

  expect(app.shows("id:col-done >> id:card-c2")).toBe(true);
  expect(app.texts()).toContain("已完成「阅读《逐根 K 线解读》并做笔记」");
});

test("the cursor hands over to the next card when its own is finished", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // Finish c2 with the keyboard: it leaves 待办, and the cursor takes the card
  // that moved up into its row — c3 — so the next space finishes that one.
  await app.keyboard.press("down");
  await app.keyboard.press("space");
  await app.wait(400);
  await app.keyboard.press("space");
  await app.wait(400);

  expect(app.shows("id:col-done >> id:card-c2")).toBe(true);
  expect(app.shows("id:col-done >> id:card-c3")).toBe(true);
});

test("Cmd+Backspace deletes the focused card and offers it back", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.keyboard.press("down");
  await app.keyboard.press("mod+backspace");
  await app.wait(400);

  expect(app.shows("id:col-todo >> id:card-c2")).toBe(false);
  expect(app.texts()).toContain("已删除「阅读《逐根 K 线解读》并做笔记」");

  await app.press("id:undo-action");
  await app.wait(400);
  expect(app.shows("id:col-todo >> id:card-c2")).toBe(true);
});

test("Cmd+] and Cmd+[ move the focused card between columns", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.keyboard.press("down");
  await app.keyboard.press("mod+]");
  await app.wait(400);
  // The end of 进行中, the same place a drop below its last card lands a card.
  expect(app.shows("id:col-doing >> id:card-c2")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c2")).toBe(false);

  // The cursor went with it: the next key acts on the card it moved.
  await app.keyboard.press("mod+[");
  await app.wait(400);
  expect(app.shows("id:col-todo >> id:card-c2")).toBe(true);
});

test("Cmd+F puts the caret in the search field, and Escape empties it", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.keyboard.press("mod+f");
  // The field has the keyboard: the next key is typed into it, not read as a
  // board shortcut.
  await app.keyboard.press("z");
  expect(app.value("id:board-search")).toContain("z");

  await app.keyboard.press("escape");
  await app.wait(300);
  expect(app.value("id:board-search")).toBe("");
  // Nothing matched 「z」, so every column said so; the board is whole again.
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(true);
});

test("the board's keys stay out of the way of typing", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // In the search field the arrows are the caret's and the space is a space.
  await app.type("id:board-search", "周报");
  await app.keyboard.press("space");
  await app.wait(300);
  expect(app.value("id:board-search")).toContain("周报 ");

  // Enter submits the field rather than opening a card behind it.
  await app.keyboard.press("enter");
  await app.wait(300);
  expect(app.shows("id:inspector-title")).toBe(false);
  // And nothing was finished or deleted by the keys that went past.
  expect(app.shows("id:undo-toast")).toBe(false);
});

test("the board's keys wait while the card is open", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.keyboard.press("down");
  await app.keyboard.press("enter");
  await app.waitFor("id:inspector-title");

  // A dialog owns the screen: the arrows are not walking the board behind it.
  await app.keyboard.press("down");
  await app.keyboard.press("escape");
  await app.wait(400);
  expect(app.shows("id:inspector-title")).toBe(false);

  // The cursor is still on the card Enter opened — c2, not c3.
  await app.keyboard.press("space");
  await app.wait(400);
  expect(app.texts()).toContain("已完成「阅读《逐根 K 线解读》并做笔记」");
});
