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
