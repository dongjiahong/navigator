import { expect, test } from "nsh/test";
import { canDraw, openSized } from "./testkit";

/**
 * The mid-drag seam, which is only observable while a drag is held.
 *
 * `dragAndHold` runs headless (and on Linux); a macOS or Android host cannot
 * replay it. So this is the mirror image of the screenshot tests: it runs where
 * nothing draws. `openSized` still fails on a phone, where the app fills the
 * screen and will not take a size.
 */
test("a lifted card draws the drop seam", async () => {
  const app = await openSized(1280, 860);
  if (!app) return;
  if (await canDraw(app)) return;

  await app.dragAndHold("id:card-c3", { x: 300, y: 40 });

  // The lifted card and its title travel with the pointer while the card
  // itself is still counted in its column until the drop.
  const texts = app.texts();
  expect(texts.filter((t) => t === "写周报").length).toBeGreaterThan(1);

  await app.drop();
  expect(app.shows("id:col-doing >> id:card-c3")).toBe(true);
});
