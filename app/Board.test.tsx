import { expect, test } from "nsh/test";
import { openApp } from "./testkit";

test("the open card can be edited and closed", async () => {
  const { app, desktop } = await openApp();
  expect(app.shows("text:领航")).toBe(true);

  if (desktop) {
    await app.press("id:card-c2");
    await app.waitFor("id:inspector-title");
    await app.type("id:inspector-title", "（已读）");
    expect(app.value("id:inspector-title")).toContain("已读");
    await app.press("label:关闭");
    expect(app.shows("id:inspector-title")).toBe(false);
  } else {
    // On the phone the same card opens as a sheet that reads its content and
    // offers the taps; the sheet is presented natively, so it lands a moment
    // after the press.
    await app.press("id:row-c2");
    await app.waitFor("id:detail-title", { timeout: 8000 });
    expect(app.shows("text:阅读《逐根 K 线解读》并做笔记")).toBe(true);
    // Moving it with a chip is the phone's edit, and it closes the sheet.
    await app.press("label:移到进行中");
    await app.wait(500);
    await app.press("label:关闭");
    expect(app.shows("id:detail-title")).toBe(false);
  }
});

test("a new card is added and titled", async () => {
  const { app, desktop } = await openApp();
  if (desktop) {
    await app.press("id:new-card");
    await app.waitFor("id:inspector-title");
    await app.type("id:inspector-title", "买牛奶");
    expect(app.value("id:inspector-title")).toContain("买牛奶");
  } else {
    await app.press("id:fab");
    await app.waitFor("id:capture-title");
    await app.type("id:capture-title", "买牛奶");
    await app.press("id:capture-save");
    expect(app.shows("text:买牛奶")).toBe(true);
  }
});
