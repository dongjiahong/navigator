import { test } from "nsh/test";
import { canDraw, openSized } from "./testkit";

/**
 * The dark captures need a drawing platform (the headless engine paints
 * nothing, which is how these files once came out byte-identical to the light
 * ones under a "dark" name) and a window of a chosen size, which a phone
 * refuses. Each returns early without them; `nsh test --target macos` produces
 * the real files.
 */
const DARK = { colorScheme: "dark" as const };

test("mac board dark", async () => {
  const app = await openSized(1280, 820, DARK);
  if (!app || !(await canDraw(app))) return;
  await app.screenshot("mac-dark.png");
});

test("mac inspector dark", async () => {
  const app = await openSized(1280, 820, DARK);
  if (!app || !(await canDraw(app))) return;
  await app.press("card-c2");
  await app.waitFor("id:inspector-title");
  await app.screenshot("mac-inspector-dark.png");
});

test("phone dark", async () => {
  const app = await openSized(390, 844, DARK);
  if (!app || !(await canDraw(app))) return;
  await app.screenshot("phone-dark.png");
});

test("phone capture dark", async () => {
  const app = await openSized(390, 844, DARK);
  if (!app || !(await canDraw(app))) return;
  await app.press("id:fab");
  await app.screenshot("phone-capture-dark.png");
});

test("mac tag manager dark", async () => {
  const app = await openSized(1280, 820, DARK);
  if (!app || !(await canDraw(app))) return;
  await app.press("id:manage-tags");
  await app.waitFor("id:new-tag");
  await app.screenshot("mac-tags-dark.png");
});

test("mac deadline calendar dark", async () => {
  const app = await openSized(1280, 820, DARK);
  if (!app || !(await canDraw(app))) return;
  await app.press("id:card-c3");
  await app.waitFor("id:inspector-title");
  await app.press("id:due-calendar");
  await app.wait(400);
  await app.screenshot("mac-calendar-dark.png");
});

/**
 * The keyboard's cursor in the dark scheme, where its fill is a step off the
 * card and the contrast question is a real one: the open card's fill is the
 * same token in dark, so if the two won't separate here they won't separate at
 * all.
 */
test("mac keyboard focus dark", async () => {
  const app = await openSized(1280, 820, DARK);
  if (!app || !(await canDraw(app))) return;
  await app.keyboard.press("down");
  await app.keyboard.press("down");
  await app.screenshot("mac-focus-dark.png");
});
