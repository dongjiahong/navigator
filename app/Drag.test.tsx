import { expect, test } from "nsh/test";
import { openApp } from "./testkit";

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

  // Drag it one column to the right. The drag reads the grip, not the card, so
  // a press on the card body stays a press that opens the inspector.
  await app.drag("id:grip-c3", { x: 300, y: 40 });

  expect(app.shows("id:col-doing >> id:card-c3")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(false);
});

test("dragging back returns the card", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.drag("id:grip-c4", { x: -300, y: 20 });
  expect(app.shows("id:col-todo >> id:card-c4")).toBe(true);
  expect(app.shows("id:col-doing >> id:card-c4")).toBe(false);
});
