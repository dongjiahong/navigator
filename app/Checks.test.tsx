import { expect, test } from "nsh/test";
import { openApp } from "./testkit";

/**
 * The circle on a card is the Mac's one-tap way to finish work.
 *
 * The phone has had a 44-point circle since its first layout; on the Mac the
 * same job needed a press on the card, then a press on a status chip, then a
 * press to close the panel. The circle is the third place colour is spent on
 * the board (a green check for finished work) and the only new hit target, so
 * these tests hold it to both promises: it completes the card, and it does not
 * also open it.
 */

test("the circle completes a card without opening it", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  expect(app.shows("id:col-todo >> id:card-c3")).toBe(true);
  await app.press("id:check-c3");
  await app.wait(400);

  // One press finishes the card, and the panel stays shut: a tap that both
  // completed and opened would make every completion a window to dismiss.
  expect(app.shows("id:col-done >> id:card-c3")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(false);
  expect(app.shows("id:inspector-title")).toBe(false);
  // 已完成 hides the card, so it is offered back like any other completion.
  expect(app.texts()).toContain("已完成「写周报」");
});

test("the circle on a finished card brings it back to 待办", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // c10 is 已完成 in the sample board.
  expect(app.shows("id:col-done >> id:card-c10")).toBe(true);
  await app.press("id:check-c10");
  await app.wait(400);

  expect(app.shows("id:col-todo >> id:card-c10")).toBe(true);
  expect(app.shows("id:col-done >> id:card-c10")).toBe(false);
  // Nothing is offered back: the card is where the chip would have put it, and
  // the circle that moved it is still under the pointer.
  expect(app.shows("id:undo-toast")).toBe(false);
});

test("a card in 进行中 is completed by its circle", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // 进行中 is open work: its circle finishes rather than sending it to 待办.
  await app.press("id:check-c4");
  await app.wait(400);
  expect(app.shows("id:col-done >> id:card-c4")).toBe(true);
});
