import { expect, test } from "nsh/test";
import { openPhone } from "./testkit";

/**
 * A row is a control, not only a door.
 *
 * The check circle finishes work in one tap. Beside it, a held row opens a sheet
 * with the writes that have no room on the row: 完成 / 恢复, 归档 / 删除, 打开.
 * The sheet is the only path to 归档 and 删除 besides the detail sheet.
 *
 * A row has no swipe. The rows sit inside the paged scroll that is the four
 * columns, so a horizontal drag belongs to the page turn; a row that claimed it
 * would cost the board its way between columns.
 */

test("a held row offers 完成", async () => {
  const { app } = await openPhone();
  if (!app) return;

  // c3 is 待办's 写周报.
  await app.longPress("id:row-c3");
  await app.waitFor("id:row-action-right");
  // The sheet names the card, so a press two rows down is not a guess.
  expect(app.texts()).toContain("写周报");
  await app.press("id:row-action-right");
  await app.wait(400);
  expect(app.shows("id:phone-col-done >> text:写周报")).toBe(true);
  expect(app.shows("id:phone-col-todo >> text:写周报")).toBe(false);
  // The write offers itself back, in the same line every other write does.
  expect(app.texts()).toContain("已完成「写周报」");
});

test("a held row offers 归档", async () => {
  const { app } = await openPhone();
  if (!app) return;

  await app.longPress("id:row-c3");
  await app.waitFor("id:row-action-left");
  expect(app.texts()).toContain("归档");
  await app.press("id:row-action-left");
  await app.wait(400);
  expect(app.shows("id:phone-col-archive >> text:写周报")).toBe(true);
  expect(app.shows("id:phone-col-todo >> text:写周报")).toBe(false);
  expect(app.texts()).toContain("已归档「写周报」");
});

test("a held finished card offers 恢复, not 完成", async () => {
  const { app } = await openPhone();
  if (!app) return;

  await app.press("id:segment-done");
  await app.wait(600);
  await app.longPress("id:row-c10");
  await app.waitFor("id:row-action-right");
  expect(app.texts()).toContain("恢复");
  await app.press("id:row-action-right");
  await app.wait(400);
  expect(app.shows("id:phone-col-todo >> text:晨间冥想 15 分钟")).toBe(true);
});

test("in 归档 a held row offers 删除, and it can be taken back", async () => {
  const { app } = await openPhone();
  if (!app) return;

  await app.press("id:segment-archive");
  await app.wait(600);
  expect(app.shows("id:phone-col-archive >> text:看完《观海》第三季")).toBe(true);

  await app.longPress("id:row-c13");
  await app.waitFor("id:row-action-left");
  expect(app.texts()).toContain("删除");
  await app.press("id:row-action-left");
  await app.wait(400);
  expect(app.shows("id:phone-col-archive >> text:看完《观海》第三季")).toBe(false);
  expect(app.texts()).toContain("已删除「看完《观海》第三季」");

  await app.press("id:undo-action");
  await app.wait(300);
  expect(app.shows("id:phone-col-archive >> text:看完《观海》第三季")).toBe(true);
});

test("a tap on a row still opens it", async () => {
  const { app } = await openPhone();
  if (!app) return;

  // A press that does not move is the press that reads the card.
  await app.press("id:row-c3");
  await app.waitFor("id:detail-title", { timeout: 8000 });
  expect(app.value("id:detail-title")).toContain("写周报");
  await app.press("label:关闭");
  await app.wait(300);
  expect(app.shows("id:phone-col-todo >> text:写周报")).toBe(true);
});

/**
 * A horizontal drag over a row belongs to the pager, never to the card.
 *
 * The rows fill the screen, so a pan that acted on the card anywhere over one
 * would take the touch from the scroll that pages between the columns, and the
 * board would lose its four-way swipe. This is the test that keeps the gesture
 * gone: the card stays in 待办 and nothing was written.
 */
test("a horizontal drag over a row does not act on the card", async () => {
  const { app } = await openPhone();
  if (!app) return;

  await app.drag("id:row-c3", { x: -300 });
  await app.wait(700);
  expect(app.shows("id:phone-col-todo >> text:写周报")).toBe(true);
  expect(app.texts()).not.toContain("已完成「写周报」");
  expect(app.texts()).not.toContain("已归档「写周报」");
  expect(app.shows("id:undo-toast")).toBe(false);
  expect(app.shows("id:detail-title")).toBe(false);
});
