import { expect, test } from "nsh/test";
import { openApp, openPhone } from "./testkit";

/**
 * The board a fresh install opens on is authored: fourteen written cards from
 * `data.ts`, not the user's own work. Once their own cards are there, the
 * samples are noise in every column, and the app says how to be rid of them —
 * on the Mac as a palette verb, on the phone in the sync sheet — for exactly as
 * long as some of them are still on the board.
 *
 * The clearing writes tombstones through `removeCard`, so it reaches the other
 * device the same way every delete does. It also asks first: a whole first board
 * is more than one line of 撤销 can offer back.
 */

test("the Mac clears the samples from the palette, and only the samples", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // A card of the user's own, made before the clearing: it carries an id the
  // sample set cannot contain, and it is what the clearing must leave alone.
  await app.press("id:new-card");
  await app.waitFor("id:inspector-title");
  await app.type("id:inspector-title", "自己的卡");
  await app.press("label:关闭");
  await app.wait(300);
  expect(app.texts()).toContain("自己的卡");

  await app.keyboard.press("mod+k");
  await app.waitFor("id:palette-input");
  await app.type("id:palette-input", "清除示例");
  await app.wait(300);
  expect(app.shows("id:cmd-clear-samples")).toBe(true);
  expect(app.texts()).toContain("14 张");

  // 取消 keeps the board whole.
  let asked = "";
  app.onDialog((dialog) => {
    asked = dialog.message ?? dialog.title ?? "";
    return "取消";
  });
  await app.keyboard.press("enter");
  await app.wait(400);
  expect(asked).toContain("14");
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(true);

  // 清除 takes the samples, and nothing else.
  app.onDialog(() => "清除");
  await app.keyboard.press("mod+k");
  await app.waitFor("id:palette-input");
  await app.type("id:palette-input", "清除示例");
  await app.wait(300);
  await app.keyboard.press("enter");
  await app.wait(600);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(false);
  expect(app.shows("id:col-done >> id:card-c10")).toBe(false);
  expect(app.shows("id:col-archive >> id:card-c13")).toBe(false);
  expect(app.texts()).toContain("自己的卡");

  // And the verb goes with the cards it was for: a way to clear nothing is a
  // question with no answer.
  await app.keyboard.press("mod+k");
  await app.waitFor("id:palette-input");
  await app.type("id:palette-input", "清除示例");
  await app.wait(300);
  expect(app.shows("id:cmd-clear-samples")).toBe(false);
});

test("the phone clears the samples from its sync sheet", async () => {
  const { app, titleBand } = await openPhone();
  // The sync target is in the phone's title row, which a sized desktop window
  // covers with its own title band: a press there belongs to the window, not to
  // the app. A phone has no such band, so this runs headless and on a device.
  if (!app || titleBand) return;

  expect(app.shows("id:phone-col-todo >> text:写周报")).toBe(true);

  await app.press("id:phone-sync");
  await app.waitFor("id:clear-samples");
  expect(app.texts()).toContain("清除示例数据（14 张）");

  app.onDialog(() => "清除");
  await app.press("id:clear-samples");
  await app.wait(600);
  expect(app.shows("id:phone-col-todo >> text:写周报")).toBe(false);
  expect(app.shows("id:clear-samples")).toBe(false);
});
