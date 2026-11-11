import { expect, test } from "nsh/test";
import { openApp, openSized } from "./testkit";

/**
 * A card can carry a picture.
 *
 * The picture is a `data:` URL on the card itself, so it syncs, exports and
 * backs up with the fields around it. These tests drive the two ways one gets
 * there — the system's picker and a paste — and the one way it leaves.
 */

const TINY_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

test("a picture picked for a card is shown on it and can be taken away", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.press("id:card-c3");
  await app.waitFor("id:inspector-title");
  expect(app.shows("id:image-add")).toBe(true);

  app.onPick(() => [{ name: "shot.png", type: "image/png", data: TINY_PNG }]);
  await app.press("id:image-add");
  await app.waitFor("id:image-0");
  expect(app.shows("id:image-remove-0")).toBe(true);

  // A tile is a press to see the picture whole, and the picture closes without
  // the panel under it moving.
  await app.press("id:image-0");
  await app.waitFor("id:image-viewer");
  await app.press("label:关闭图片");
  await app.wait(300);
  expect(app.shows("id:image-viewer")).toBe(false);

  await app.press("id:image-remove-0");
  expect(app.shows("id:image-0")).toBe(false);
});

test("a screenshot pasted into a card's note becomes its picture", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.press("id:card-c3");
  await app.waitFor("id:inspector-title");
  await app.paste("id:inspector-notes", { files: ["./icon.png"] });
  await app.waitFor("id:image-0");
  expect(app.shows("id:image-remove-0")).toBe(true);
});

test("a picture attached on the phone's capture sheet lands on the card", async () => {
  const app = await openSized(390, 844);
  if (!app) return;
  await app.waitFor("id:phone-home");

  await app.press("id:fab");
  await app.waitFor("id:capture-title");
  app.onPick(() => [{ name: "shot.png", type: "image/png", data: TINY_PNG }]);
  await app.press("id:image-add");
  await app.waitFor("id:image-0");
  await app.type("id:capture-title", "带图的任务");
  await app.press("id:capture-save");

  // The captured card carries it: opening the row shows the tile on the sheet.
  await app.press("text:带图的任务");
  await app.waitFor("id:detail-title");
  expect(app.shows("id:image-0")).toBe(true);
});
