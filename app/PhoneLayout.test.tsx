import { expect, test } from "nsh/test";
import { openPhone } from "./testkit";

/**
 * The phone's own surface, on every target that can lay it out: a 390-point
 * window is the phone on a desktop as well as on a device.
 *
 * The list is what the phone is for, so the head of the screen is the title bar
 * and the column's switch and nothing else: the search field and the tag strip
 * used to stand over the list all day and are now a lens and a funnel. The sheet
 * can stay up for a batch of cards, and 归档 can be emptied from the foot of its
 * own list.
 */

test("the phone's list starts under the title bar, not under its filters", async () => {
  const { app } = await openPhone();
  if (!app) return;

  // The two controls the head used to carry are folded away by default.
  expect(app.shows("id:phone-search")).toBe(false);
  expect(app.shows("id:filter-tag-study")).toBe(false);
  expect(app.shows("id:filter-notice")).toBe(false);
  // The list is there, and so are the ways back to both controls.
  expect(app.shows("id:phone-col-todo >> text:写周报")).toBe(true);
  expect(app.shows("id:phone-search-toggle")).toBe(true);
  expect(app.shows("id:phone-filter")).toBe(true);
});

test("连续添加 keeps the sheet up, and the next card goes straight in", async () => {
  const { app } = await openPhone();
  if (!app) return;

  await app.press("id:fab");
  await app.waitFor("id:capture-title");

  // Off by default: one card, then the sheet is done.
  await app.type("id:capture-title", "买牛奶");
  await app.press("id:capture-save");
  await app.wait(400);
  expect(app.shows("id:capture-title")).toBe(false);

  // Turned on, the sheet stays for the next line: the field is emptied and ready,
  // and the button says it fired.
  await app.press("id:fab");
  await app.waitFor("id:capture-title");
  await app.press("id:capture-keep");
  await app.type("id:capture-title", "买鸡蛋");
  await app.press("id:capture-save");
  await app.wait(200);
  expect(app.shows("id:capture-title")).toBe(true);
  expect(app.value("id:capture-title")).not.toContain("买鸡蛋");
  expect(app.texts()).toContain("已添加");

  // The second card goes in without opening anything again.
  await app.type("id:capture-title", "买面包");
  await app.press("id:capture-save");
  await app.wait(400);
  expect(app.texts()).toContain("买鸡蛋");
  expect(app.texts()).toContain("买面包");
});

test("the phone empties 归档 from the foot of its own list", async () => {
  const { app } = await openPhone();
  if (!app) return;

  await app.press("id:segment-archive");
  await app.wait(600);
  expect(app.shows("id:phone-col-archive >> text:看完《观海》第三季")).toBe(true);

  // 取消 is the answer a dialog opens with: nothing is removed.
  app.onDialog(() => "取消");
  await app.press("id:clear-archive");
  await app.wait(400);
  expect(app.dialogs()[0]?.title).toBe("清空归档？");
  expect(app.shows("id:phone-col-archive >> text:看完《观海》第三季")).toBe(true);

  app.onDialog(() => "清空");
  await app.press("id:clear-archive");
  await app.wait(400);
  expect(app.shows("id:phone-col-archive >> text:看完《观海》第三季")).toBe(false);
  // The button goes with the cards it was for, and the column says what an empty
  // archive means.
  expect(app.shows("id:clear-archive")).toBe(false);
  expect(app.texts()).toContain("这里还是空的");
});

/**
 * Pulling a column past its top is the phone's refresh gesture, and it lands
 * where the platform's own control does: `onRefresh` on the list.
 *
 * The exchange itself cannot run here — the test app has sync switched off, so
 * there is no Mac and no thread to nudge. What this holds is that the gesture is
 * wired and that it is harmless: a pull refreshes instead of scrolling, and it
 * is neither a swipe on a card nor a card opened.
 */
test("pulling a column past its top does not act on a card", async () => {
  const { app } = await openPhone();
  if (!app) return;

  await app.drag("id:phone-col-todo", { y: 260 });
  await app.wait(500);
  expect(app.shows("id:undo-toast")).toBe(false);
  expect(app.shows("id:detail-title")).toBe(false);
  expect(app.shows("id:phone-col-todo >> text:写周报")).toBe(true);
  // And the column is still the column showing.
  expect(app.spanStyle("id:segment-todo >> text:待办").fontWeight).toBe(600);
});
