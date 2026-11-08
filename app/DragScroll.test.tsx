import { expect, test } from "nsh/test";
import { canDraw, openSized } from "./testkit";

/**
 * A drag held against a column's edge.
 *
 * `dragAndHold` runs headless (and on Linux); a macOS or Android host cannot
 * replay it. So, like `DragHold.test.tsx`, this runs exactly where nothing
 * draws — and it is the only place the auto-scroll's *premise* can be observed,
 * since the pointer has to stand still inside the edge band for a second.
 *
 * The window is short on purpose: 待办's seven cards are taller than this
 * viewport, so the column under the pointer has somewhere to scroll to.
 */
test("a drag held against an edge keeps its target until the drop", async () => {
  const app = await openSized(1280, 600);
  if (!app) return;
  if (await canDraw(app)) return;

  // c1 starts in 进行中. Drag it into 待办 and rest in that column's bottom
  // band — 48 points up from the board's foot at 588 in a 600-point window.
  await app.dragAndHold("id:grip-c1", { x: -300, y: 430 });
  const held = app.texts().filter((t) => t === "回测里加一个「按考试号规则」的开关");
  expect(held.length).toBeGreaterThan(1);

  // Long enough for the auto-scroll to have run many frames, and for the seam
  // to have followed the content under a pointer that is not moving.
  await app.wait(700);
  await app.drop();
  await app.wait(300);

  // The drop still lands in the column under the pointer, and the board is not
  // left mid-drag or with a timer still running.
  expect(app.shows("id:col-todo >> id:card-c1")).toBe(true);
  expect(app.count("text:回测里加一个「按考试号规则」的开关")).toBe(1);
});
