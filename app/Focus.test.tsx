import { expect, test } from "nsh/test";
import { canDraw, openApp, openSized } from "./testkit";

/**
 * The keyboard's cursor is the keyboard's.
 *
 * A card clicked open and then closed stayed in the panel's pressed-paper fill
 * for good, because opening it from the board also put the cursor on it: the
 * cursor still names that card after the panel closes, and its fill is the same
 * token the open card takes. The cursor is a mark the arrow keys leave, so a
 * press with the pointer takes it away — and the next arrow key brings it back.
 *
 * The headless runs hold the rule itself (Space has no card to act on after a
 * press). The last test holds the pixels, because "the card is white again" is
 * a claim about what the board looks like.
 */

test("a press on a card leaves no cursor behind", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.press("id:card-c2");
  await app.waitFor("id:inspector-title");
  await app.press("label:关闭");
  await app.wait(400);

  // The press was the pointer's: nothing carries the cursor's fill any more, and
  // Space has no card to finish.
  await app.keyboard.press("space");
  await app.wait(400);
  expect(app.shows("id:col-done >> id:card-c2")).toBe(false);
  expect(app.shows("id:undo-toast")).toBe(false);

  // The first arrow key after that starts the walk again, from 待办's first card.
  await app.keyboard.press("down");
  await app.keyboard.press("space");
  await app.wait(400);
  expect(app.shows("id:col-done >> id:card-c2")).toBe(true);
});

test("a press on the board itself puts the cursor away", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.keyboard.press("down");
  // The air between the second and third columns — the board's own sheet, never
  // a card. The band above it is not usable here: on the Mac it is the window's
  // title bar, and a press there drags the window instead of reaching the app.
  await app.press("id:board");
  await app.keyboard.press("space");
  await app.wait(400);

  expect(app.shows("id:undo-toast")).toBe(false);
  expect(app.shows("id:col-done >> id:card-c2")).toBe(false);
});

/**
 * And the picture: the same board before a card is opened and after it is
 * closed, to the pixel.
 *
 * Dark is the appearance where it can go wrong: the cursor's fill (`#2B3136`)
 * and a hover (`#2A2F32`) are both a step off the card (`#24282B`), so a card
 * left in either state shows. The pointer is parked on the band above the board
 * in both captures, so neither hover nor a lingering press explains a difference
 * — only a fill that should have gone.
 */
test("a card opened and closed comes back to plain paper", async () => {
  const app = await openSized(1280, 820, { colorScheme: "dark" });
  if (!app || !(await canDraw(app))) return;

  await app.hover("id:title-band");
  const before = await app.screenshot();

  await app.press("id:card-c2");
  await app.waitFor("id:inspector-title");
  await app.press("label:关闭");
  await app.wait(600);
  await app.hover("id:title-band");
  const after = await app.screenshot();

  expect(after).toEqual(before);
});
