import { test } from "nsh/test";
import { canDraw, openSized } from "./testkit";

/**
 * Screenshot tests produce `.impeccable/review`'s evidence, so they need two
 * things a run may not have: a platform that draws, and a window of a chosen
 * size (a phone fills the screen and refuses `width`). Each returns early when
 * either is missing, and the real captures come from
 * `nsh test --target macos`.
 *
 * The light captures are pinned to the light scheme. Without it the app takes
 * whatever appearance the machine running the tests is in, and a dark Mac
 * silently produces dark "light" evidence.
 */
const LIGHT = { colorScheme: "light" as const };

test("mac board", async () => {
  const app = await openSized(1280, 820, LIGHT);
  if (!app || !(await canDraw(app))) return;
  await app.screenshot("mac-board.png");
});

test("mac board with a card open", async () => {
  const app = await openSized(1280, 820, LIGHT);
  if (!app || !(await canDraw(app))) return;
  await app.press("card-c2");
  await app.screenshot("mac-inspector.png");
});

test("phone column", async () => {
  const app = await openSized(390, 844, LIGHT);
  if (!app || !(await canDraw(app))) return;
  await app.screenshot("phone-390.png");
});

test("phone detail", async () => {
  const app = await openSized(390, 844, LIGHT);
  if (!app || !(await canDraw(app))) return;
  await app.press("row-c2");
  await app.screenshot("phone-detail.png");
});

test("phone capture", async () => {
  const app = await openSized(390, 844, LIGHT);
  if (!app || !(await canDraw(app))) return;
  await app.press("fab");
  await app.screenshot("phone-capture.png");
});

test("mac tag manager", async () => {
  const app = await openSized(1280, 820, LIGHT);
  if (!app || !(await canDraw(app))) return;
  await app.press("id:manage-tags");
  await app.waitFor("id:new-tag");
  await app.screenshot("mac-tags.png");
});

test("mac deadline calendar", async () => {
  const app = await openSized(1280, 820, LIGHT);
  if (!app || !(await canDraw(app))) return;
  await app.press("id:card-c3");
  await app.waitFor("id:inspector-title");
  await app.press("id:due-calendar");
  // Long enough for the popup's entrance to settle: a capture mid-fade shows
  // a see-through panel that is not what the user ever sees.
  await app.wait(1600);
  await app.screenshot("mac-calendar.png");
});

/**
 * The command palette, opened on a query.
 *
 * It is a raised object of its own — panel fill, the lifted shadow, a list of
 * rows — and whether it reads as one surface over the board or as a second
 * window with a list in it is a question only a picture answers.
 */
test("mac command palette", async () => {
  const app = await openSized(1280, 820, LIGHT);
  if (!app || !(await canDraw(app))) return;
  await app.keyboard.press("mod+k");
  await app.waitFor("id:palette-input");
  await app.type("id:palette-input", "学习");
  await app.wait(400);
  await app.screenshot("mac-palette.png");
});

/**
 * The keyboard's cursor, between two cards that do not have it.
 *
 * It is a fill and a shadow the open card does not have, and whether that reads
 * as "the keys are here" without becoming the loudest card on the board is a
 * question only a picture answers — the headless engine paints nothing.
 */
test("mac keyboard focus", async () => {
  const app = await openSized(1280, 820, LIGHT);
  if (!app || !(await canDraw(app))) return;
  // 待办's first two cards are c2 and c3, so the shot holds one focused card and
  // several unfocused ones in the same column.
  await app.keyboard.press("down");
  await app.keyboard.press("down");
  await app.screenshot("mac-focus.png");
});
