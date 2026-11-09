import { expect, test } from "nsh/test";
import { openApp, openSized } from "./testkit";

/**
 * Dragging a card between columns is the Mac's signature move: it needs a
 * pointer and four columns in view. On the phone the same intent is a status
 * chip in the detail sheet, which the board test covers.
 */
test("dragging a card moves it to the doing column", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // c3 starts in 待办.
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(true);
  expect(app.shows("id:col-doing >> id:card-c3")).toBe(false);

  // Drag it one column to the right. The whole card is the handle, so the drag
  // starts on its body; a press that does not move is still a press that opens
  // the inspector, which the test below holds.
  await app.drag("id:card-c3", { x: 300, y: 40 });

  expect(app.shows("id:col-doing >> id:card-c3")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(false);
});

test("dragging back returns the card", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.drag("id:card-c4", { x: -300, y: 20 });
  expect(app.shows("id:col-todo >> id:card-c4")).toBe(true);
  expect(app.shows("id:col-doing >> id:card-c4")).toBe(false);
});

/**
 * The whole card is the handle, and a press is still a press.
 *
 * Dragging used to start only on an 18-point grip in the card's corner, which is
 * a small target for the board's most-used gesture and a strip the title could
 * not use. The grip is gone: the card takes the gesture once the pointer has
 * moved five points, so a click that does not move is still the click that opens
 * the card.
 */
test("a card drags from its body", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.drag("id:card-c3", { x: 300, y: 40 });
  expect(app.shows("id:col-doing >> id:card-c3")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(false);
});

/**
 * A deletion must not leave the cards below it undraggable.
 *
 * The list recycles a cell by changing the item its accessor reads, not by
 * remounting the card. The drag responder used to be cached by card id at
 * mount, so the card that moved into the deleted one's cell still dragged the
 * deleted id, and the gesture did nothing.
 */
test("a card that moves up after a deletion still drags", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // c2 is above c3 in 待办.
  await app.press("id:card-c2");
  await app.waitFor("id:inspector-title");
  await app.press("label:删除卡片");
  await app.wait(400);
  expect(app.shows("id:col-todo >> id:card-c2")).toBe(false);

  await app.drag("id:card-c3", { x: 300, y: 40 });
  expect(app.shows("id:col-doing >> id:card-c3")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(false);
});

test("a press on the card body opens it and moves nothing", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.press("id:card-c2");
  await app.waitFor("id:inspector-title");
  expect(app.value("id:inspector-title")).toContain("阅读《逐根 K 线解读》并做笔记");
  // A press that does not move is not a drag: the card is where it was.
  expect(app.shows("id:col-todo >> id:card-c2")).toBe(true);
});

/**
 * The drop lands where the seam was, not at the end of the column.
 *
 * A card's own `onLayout` reports its frame inside the list cell, so every row
 * claimed `y: 0` and every drop therefore landed after the last card — the board
 * could only ever append. Rows are summed from the cell heights now, and this is
 * the case that used to be impossible: a card dropped at the top of a column
 * goes first.
 */
/**
 * A drop lands in the column under the pointer, on any window.
 *
 * The four columns reach `COL_MAX` and stop, and the row they stand in is then
 * centred in whatever is left: a 2560-point window leaves nearly 550 points of
 * margin before 待办. Measuring a drop from the board's own edge counted that
 * margin as part of the first column, so a card dragged into 进行中 landed in
 * 归档 two columns over — the drag worked, and put the card somewhere the user
 * had not pointed at.
 */
test("a drop lands in the column under the pointer on a wide window", async () => {
  const app = await openSized(2560, 1440);
  if (!app) return;

  // c9 is 待办's last card; one column to the right is 进行中.
  await app.drag("id:card-c9", { x: 450, y: 0 });
  await app.wait(400);

  expect(app.shows("id:col-doing >> id:card-c9")).toBe(true);
  expect(app.shows("id:col-archive >> id:card-c9")).toBe(false);
});

test("a card dropped at the top of a column goes first, not last", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // c9 is 待办's last card; 进行中 starts with c1.
  await app.drag("id:card-c9", { x: 300, y: -600 });
  await app.wait(400);
  expect(app.shows("id:col-doing >> id:card-c9")).toBe(true);

  // The order is read through the keyboard, which is the only way a test can
  // see it: the cursor's row 0 in 进行中 is the card the drop put first.
  await app.keyboard.press("right");
  await app.keyboard.press("enter");
  await app.waitFor("id:inspector-title");
  expect(app.value("id:inspector-title")).toContain("研究并选择新的锻炼计划");
});
