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

/**
 * And in a short window, where the note is youngest: light is checked by the
 * same shot in `Shot.test.tsx`, and the question here is whether the three lines
 * of controls and a twenty-line note still separate in the dark panel.
 */
test("mac panel with a long note in a short window, dark", async () => {
  const app = await openSized(1280, 620, DARK);
  if (!app || !(await canDraw(app))) return;
  await app.press("card-c2");
  await app.waitFor("id:inspector-title");
  await app.type("id:inspector-title", "读完《逐根 K 线解读》的第二章，把形态整理成自己的话");
  await app.type("id:inspector-notes", "先看单根 K 线的四种形态，再看组合。\n".repeat(24));
  await app.wait(400);
  await app.screenshot("mac-inspector-tight-dark.png");
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
 * The filter row in the dark scheme, where a chosen chip is the accent's wash
 * under its muted twin: the surface and the ink both change, and the tags' own
 * dots sit between them.
 */
test("mac filter row dark", async () => {
  const app = await openSized(1280, 820, DARK);
  if (!app || !(await canDraw(app))) return;
  await app.press("label:工作");
  await app.press("label:学习");
  await app.press("label:今天");
  await app.wait(300);
  await app.screenshot("mac-filters-dark.png");
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
