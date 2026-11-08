import { expect, test } from "nsh/test";
import { sampleCards } from "./data";
import { openApp, openSized } from "./testkit";

/**
 * Deleting asks nothing and offers a way back; a card made by 新建 and left
 * empty is not left behind.
 *
 * The offer is one line at the foot of the window. On the Mac it was a native
 * alert before the press landed; a card is kept as a tombstone with every field,
 * so the same press can be written again, and an offer that expires is both
 * faster than the dialog and reversible.
 */

/** 待办's card count in the sample board, as its label states it. */
const TODO = sampleCards().filter((c) => c.status === "todo").length;

test("撤销 puts a deleted card back", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.press("id:card-c3");
  await app.waitFor("id:inspector-title");
  await app.press("label:删除卡片");
  await app.wait(400);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(false);

  await app.press("id:undo-action");
  await app.wait(400);

  // The tombstone carried every field, so the card comes back whole — in the
  // column it was in, with the tag and the deadline it had.
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(true);
  expect(app.shows("id:col-todo >> text:写周报")).toBe(true);
  expect(app.shows("id:undo-toast")).toBe(false);
});

test("the offer to undo goes away by itself", async () => {
  // A clock the test moves: six seconds pass at once instead of in a test run.
  const app = await openSized(1280, 860, { clock: {} });
  if (!app) return;

  await app.press("id:card-c3");
  await app.waitFor("id:inspector-title");
  await app.press("label:删除卡片");
  await app.wait(400);
  expect(app.shows("id:undo-toast")).toBe(true);

  await app.wait(6500);

  // The offer expired and the delete stands: the card is gone for good.
  expect(app.shows("id:undo-toast")).toBe(false);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(false);
});

test("完成 in the panel is offered back", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.press("id:card-c3");
  await app.waitFor("id:inspector-title");
  await app.press("label:移到已完成");
  await app.wait(400);
  expect(app.texts()).toContain("已完成「写周报」");

  // The panel stays open over the board, so the offer is taken after closing it
  // — which is also the only moment it can be pressed.
  await app.press("label:关闭");
  await app.press("id:undo-action");
  await app.wait(400);

  expect(app.shows("id:col-todo >> id:card-c3")).toBe(true);
  expect(app.shows("id:col-done >> id:card-c3")).toBe(false);
});

test("a card made by 新建 and left empty is not left on the board", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  expect(app.shows(`id:head-todo >> text:${TODO}`)).toBe(true);

  await app.keyboard.press("mod+n");
  await app.waitFor("id:inspector-title");
  await app.keyboard.press("escape");
  await app.wait(400);

  // The blank card went with the panel: no 「未命名卡片」 and the column has the
  // cards it started with. Nothing is said about it — it never became a card.
  expect(app.shows("id:inspector-title")).toBe(false);
  expect(app.count("text:未命名卡片")).toBe(0);
  expect(app.shows(`id:head-todo >> text:${TODO}`)).toBe(true);
  expect(app.shows("id:undo-toast")).toBe(false);
});

test("a card made by 新建 and typed into stays", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.keyboard.press("mod+n");
  await app.waitFor("id:inspector-title");
  await app.type("id:inspector-title", "买牛奶");
  await app.keyboard.press("escape");
  await app.wait(400);

  // A title is what makes it a card, and it is on the board for good.
  expect(app.shows(`id:head-todo >> text:${TODO + 1}`)).toBe(true);
  expect(app.shows("id:col-todo >> text:买牛奶")).toBe(true);
});

test("新建 twice leaves one blank card, not two", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.keyboard.press("mod+n");
  await app.waitFor("id:inspector-title");
  await app.keyboard.press("mod+n");
  await app.wait(400);
  await app.keyboard.press("escape");
  await app.wait(400);

  // The panel moved to the second blank card, so the first one would never be
  // closed again: it goes as the second is made.
  expect(app.count("text:未命名卡片")).toBe(0);
  expect(app.shows(`id:head-todo >> text:${TODO}`)).toBe(true);
});

test("the close button dismisses the offer without taking it", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.press("id:card-c3");
  await app.waitFor("id:inspector-title");
  await app.press("label:删除卡片");
  await app.wait(400);

  await app.press("label:关闭提示");
  expect(app.shows("id:undo-toast")).toBe(false);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(false);
});

test("a completed row on the phone offers to come back", async () => {
  const { app, desktop } = await openApp();
  if (desktop) return;

  await app.press("id:checkbox-c2");
  await app.wait(400);
  expect(app.shows("id:phone-col-done >> text:阅读《逐根 K 线解读》并做笔记")).toBe(true);
  expect(app.texts()).toContain("已完成「阅读《逐根 K 线解读》并做笔记」");

  await app.press("id:undo-action");
  await app.wait(400);
  expect(app.shows("id:phone-col-todo >> text:阅读《逐根 K 线解读》并做笔记")).toBe(true);
});
