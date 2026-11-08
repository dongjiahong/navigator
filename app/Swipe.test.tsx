import { expect, test } from "nsh/test";
import { openPhone } from "./testkit";

/**
 * A row is a control, not only a door.
 *
 * The check circle finishes work in one tap and is the phone's fastest action.
 * Beside it, a row does the same two writes without aiming at 23 points: right is
 * the circle's own meaning (完成, or 恢复到待办 on a row that is already finished),
 * left is 归档 — and 删除 in 归档, which is what that column is for. Both go
 * through `setStatus` / `removeWithUndo`, so both offer a way back in the same
 * line every other write does.
 *
 * **Two ways in, because a drag cannot always arrive.** The rows sit inside the
 * paged scroll that is the four columns, and a paged scroll keeps the horizontal
 * drags that still have a page to travel to. So a **held row** opens the writes
 * as a sheet (it always arrives, on every page), and the edge strips' **swipes**
 * are the fast path where the board has nowhere to page to — measured on a real
 * macOS host, a left swipe on 待办 was the pager's while the same swipe on 归档
 * reached the row.
 *
 * **A drag cannot start within a tenth of the pager's edge.** `app.drag` brings
 * the view it names "well inside" every scroll view around it before the finger
 * lands, and a point inside `min(10% of the scroll view, 48)` of that view's edge
 * sends it paging towards the middle. On a paged scroll that never converges: the
 * page snaps back, the strip is measured at the same edge again, and the step
 * fails as "did not come into view" after twenty tries — which is what these two
 * tests did for a 34-point trailing strip, 33 points from the edge of a 390-point
 * page. The trailing handle is 56 points for that reason (a thumb needs 44
 * anyway), and these are the numbers that keep the fast path reachable by a
 * finger and by a test alike.
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

  // The handles claim the touch only once it moves: a press that does not move
  // is the press that reads the card.
  await app.press("id:row-c3");
  await app.waitFor("id:detail-title", { timeout: 8000 });
  expect(app.value("id:detail-title")).toContain("写周报");
  await app.press("label:关闭");
  await app.wait(300);
  expect(app.shows("id:phone-col-todo >> text:写周报")).toBe(true);
});

/**
 * The fast path, where the pager has nowhere to go: page 1 rightwards, and the
 * archive's page leftwards.
 *
 * A paged scroll keeps the horizontal drags that still have a page to travel to,
 * so a left swipe on 待办 pages instead of acting (measured on a real macOS
 * host), while the same swipe on the last page reaches the row. Both of these
 * are the cases the gesture really works in, and both are asserted as such.
 */
test("a right swipe on 待办 completes the card, without the sheet", async () => {
  const { app } = await openPhone();
  if (!app) return;

  // There is no page to the left of 待办, so the drag is the row's.
  await app.drag("id:swipe-lead-c3", { x: 220 });
  await app.wait(400);
  expect(app.shows("id:phone-col-done >> text:写周报")).toBe(true);
  expect(app.shows("id:row-action-right")).toBe(false);
  expect(app.texts()).toContain("已完成「写周报」");
});

test("a left swipe on the archive's last page deletes, without the sheet", async () => {
  const { app } = await openPhone();
  if (!app) return;

  await app.press("id:segment-archive");
  await app.wait(600);
  expect(app.shows("id:phone-col-archive >> text:看完《观海》第三季")).toBe(true);

  await app.drag("id:swipe-trail-c13", { x: -220 });
  await app.wait(400);
  expect(app.shows("id:phone-col-archive >> text:看完《观海》第三季")).toBe(false);
  // No sheet was involved: the swipe wrote directly.
  expect(app.shows("id:row-action-left")).toBe(false);
  expect(app.texts()).toContain("已删除「看完《观海》第三季」");
});

/**
 * The end of a swipe is also the row's press, and the row under it is not the
 * card the finger swiped.
 *
 * A swipe that deletes or archives leaves another card in the slot the finger
 * is on, and the engine hands the lift to that row as a press. Measured on a
 * real Android device: the card was deleted correctly and the detail sheet of
 * the card that replaced it opened on top, naming a card the finger had never
 * touched. The row ignores a press that is a swipe's tail, and this is the test
 * that keeps it doing so.
 */
test("the end of a swipe does not open the card that took its place", async () => {
  const { app } = await openPhone();
  if (!app) return;

  await app.press("id:segment-archive");
  await app.wait(600);

  await app.drag("id:swipe-trail-c13", { x: -220 });
  await app.wait(400);
  expect(app.texts()).toContain("已删除「看完《观海》第三季」");
  // The next card in 归档 is Q3 复盘会准备, and it must not be open.
  expect(app.shows("id:phone-col-archive >> text:Q3 复盘会准备")).toBe(true);
  expect(app.shows("id:detail-title")).toBe(false);
});

test("a short sideways move on the strip is not an action", async () => {
  const { app } = await openPhone();
  if (!app) return;

  // Twelve points is a thumb slipping off the check circle, not a decision: the
  // row springs back, no sheet opens, and the card stays where it was. The
  // leading strip is the one armed on 待办, so it is the one worth slipping on.
  await app.drag("id:swipe-lead-c3", { x: 12 });
  await app.wait(300);
  expect(app.shows("id:phone-col-todo >> text:写周报")).toBe(true);
  expect(app.shows("id:undo-toast")).toBe(false);
  expect(app.shows("id:row-action-right")).toBe(false);
});

/**
 * The pager keeps the row's body, and this is the test that protects it.
 *
 * The rows fill the screen, so a pan that activated anywhere over one would take
 * the touch from the scroll that pages between the columns, and the board would
 * lose its four-way swipe. The strips at the row's two edges are small for that
 * reason: a drag over the body must not act on the card, and must not open it.
 */
test("a horizontal drag over a row's body acts on nothing", async () => {
  const { app } = await openPhone();
  if (!app) return;

  await app.drag("id:row-c3", { x: -300 });
  await app.wait(700);
  expect(app.shows("id:undo-toast")).toBe(false);
  expect(app.shows("id:detail-title")).toBe(false);
  expect(app.shows("id:row-action-right")).toBe(false);
  expect(app.shows("id:phone-col-todo >> text:写周报")).toBe(true);
});
