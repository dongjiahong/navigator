import { expect, test } from "nsh/test";
import { openSized } from "./testkit";
import { noteShare, panelSize } from "./panel";

/**
 * The open card is a panel built around its note.
 *
 * The first version spent about 250 points on three captioned rows of chips —
 * status, tags, deadline — and then gave the note an estimated box that scrolled
 * its own text inside a panel that scrolled too. The panel is now sized by the
 * window, the note takes whatever is left of it, and the controls are three
 * uncaptioned lines above it.
 *
 * The engine reports no view frames to a test, so the note's size is held here
 * as the arithmetic it is (`panel.ts`), and as what the panel does with a long
 * note in it: nothing moves, and nothing is pushed off the surface.
 */

test("the panel is sized by the window, and the note takes most of it", () => {
  // A 1280 × 820 window: 820 - 96 is more than the ceiling, so the panel is at
  // its own maximum rather than filling the board.
  expect(panelSize({ width: 1280, height: 820 })).toEqual({ width: 560, height: 720 });
  // A short window keeps 80 points of board above and below the panel.
  expect(panelSize({ width: 1280, height: 620 })).toEqual({ width: 560, height: 524 });
  // A small window shrinks the panel, and neither side goes under its floor: a
  // panel narrower than 300 or shorter than 320 is not a panel but a stripe.
  expect(panelSize({ width: 400, height: 300 })).toEqual({ width: 320, height: 320 });

  // The note's field. The old panel gave it 96 points — four and a half lines —
  // and the note is now the body of the panel: a third of a 620-point window's
  // panel is a real paragraph even before the layout reports a measured height.
  expect(noteShare(panelSize({ width: 1280, height: 620 }).height)).toBeGreaterThanOrEqual(200);
  expect(noteShare(panelSize({ width: 1280, height: 820 }).height)).toBeGreaterThan(288);
});

test("a long note stays in its field and moves nothing else", async () => {
  // 620 points of window: the panel is 524 tall, which is the tight case — the
  // one where a caption per field used to leave the note a couple of lines.
  const app = await openSized(1280, 620);
  if (!app) return;

  await app.press("id:card-c2");
  await app.waitFor("id:inspector-note-area");

  // Forty lines of note. The field has a height and scrolls its own text, so the
  // panel around it does not grow, does not scroll, and does not push the meta
  // strip or the header's buttons off the surface.
  await app.type("id:inspector-notes", "很长的一段备注，".repeat(40));
  await app.wait(400);
  expect(app.value("id:inspector-notes")).toContain("很长的一段备注，");
  expect(app.shows("id:inspector-meta")).toBe(true);
  expect(app.shows("id:inspector-note-area")).toBe(true);
  expect(app.shows("label:归档卡片")).toBe(true);
  expect(app.shows("label:删除卡片")).toBe(true);
  expect(app.shows("label:关闭")).toBe(true);
});

test("the card is filed from the panel's own strip", async () => {
  const app = await openSized(1280, 820);
  if (!app) return;

  await app.press("id:card-c3");
  await app.waitFor("id:inspector-title");
  // 移到归档 sits in the header with 删除 and 关闭, rather than under a rule at
  // the foot of the panel where it cost the note a line of height.
  await app.press("label:归档卡片");
  await app.wait(400);

  expect(app.shows("id:col-archive >> id:card-c3")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(false);
});
