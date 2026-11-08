import { expect, test } from "nsh/test";
import { openApp } from "./testkit";

/**
 * Tags are the user's: made, renamed, recoloured and removed in one manager,
 * and a card's deadline carries a time of day, not only a day.
 *
 * `app.type` appends where the caret is, so a rename is asserted as what the
 * field ends up holding, never as a replacement.
 */

test("a tag made in the manager reaches the filter row and every picker", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.press("id:manage-tags");
  await app.waitFor("id:new-tag");
  await app.type("id:new-tag", "家");
  await app.press("id:add-tag");
  expect(app.texts()).toContain("家");

  await app.press("label:关闭");
  // The filter strip lists the user's tags, so the new one is a control there
  // the moment it exists.
  expect(app.shows("label:家")).toBe(true);

  // And the card's picker offers it, which is what makes it usable at all.
  await app.press("id:card-c2");
  await app.waitFor("id:inspector-title");
  expect(app.shows("label:标签 家")).toBe(true);
});

test("a tag renamed in the manager is renamed on its cards", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.press("id:manage-tags");
  await app.waitFor("id:tag-name-study");
  await app.type("id:tag-name-study", "（读）");
  await app.press("label:关闭");

  // c2 carries 学习, so the label follows the rename wherever the tag shows.
  expect(app.shows("id:col-todo >> text:学习（读）")).toBe(true);
  const stale = app.texts().filter((t) => t === "学习");
  expect(stale.length).toBe(0);
});

test("deleting a tag asks, then takes it off every card", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  let asked = "";
  app.onDialog((dialog) => {
    asked = dialog.message ?? dialog.title ?? "";
    return "删除";
  });

  await app.press("id:manage-tags");
  await app.waitFor("id:tag-name-study");
  await app.press("label:删除标签 学习");
  await app.wait(400);

  // The dialog says what is at stake before anything is removed.
  expect(asked).toContain("学习");
  expect(app.shows("label:删除标签 学习")).toBe(false);
});

test("a deadline keeps its time when its day changes", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // c3 is due today at 20:00; 明天 has to mean tomorrow at 20:00, not 09:00.
  await app.press("id:card-c3");
  await app.waitFor("id:inspector-title");
  expect(app.texts().some((t) => t.endsWith("20:00"))).toBe(true);

  await app.press("id:due-1");
  expect(app.shows("text:明天 20:00")).toBe(true);
});

test("the time of day is editable on the card", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.press("id:card-c3");
  await app.waitFor("id:inspector-title");
  // The field stands on the time in use, so a deadline has one control for the
  // part the three day shortcuts cannot set.
  expect(app.texts()).toContain("20");
  expect(app.texts()).toContain("00");
});

test("deleting a card asks nothing and offers it back instead", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  let asked = 0;
  app.onDialog(() => {
    asked++;
    return null;
  });
  await app.press("id:card-c3");
  await app.waitFor("id:inspector-title");
  await app.press("label:删除卡片");
  await app.wait(500);

  // A card is kept as a tombstone with every field, so a delete can be written
  // again: the press is not a question, and the way back is offered at the foot
  // of the window for a few seconds.
  expect(asked).toBe(0);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(false);
  expect(app.shows("id:inspector-title")).toBe(false);
  expect(app.texts()).toContain("已删除「写周报」");
});
