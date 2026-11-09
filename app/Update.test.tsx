import { expect, test } from "nsh/test";
import { openApp } from "./testkit";
import { versionLabel } from "./updates";

/**
 * 检查更新 answers on the board, not in the row that started it.
 *
 * The palette only carries the verb: before this, a check on the Mac either
 * said nothing anywhere or left its answer inside the palette. The answer is a
 * line at the foot of the board — the version that is running, what the check
 * found, why it failed — and it is up only while a check is being answered.
 */

test("a version and a build are one label, and a missing half still reads", () => {
  // The whole point of the line: the name a person can match to a release
  // next to the number that decides whether it installs.
  expect(versionLabel("0.1.6", 7)).toBe("0.1.6 (build 7)");
  expect(versionLabel("0.1.6", null)).toBe("0.1.6");
  expect(versionLabel(null, 7)).toBe("build 7");
  // A development run has neither, and says nothing rather than "undefined".
  expect(versionLabel(undefined, undefined)).toBe("");
});

test("the palette's 检查更新 puts its answer on the board", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // No standing status line: the board is the board until a check is asked for.
  expect(app.shows("id:update-toast")).toBe(false);

  await app.keyboard.press("mod+k");
  await app.waitFor("id:palette-input");
  await app.type("id:palette-input", "检查更新");
  await app.wait(300);
  await app.keyboard.press("enter");
  await app.wait(500);

  // This shell runs no packages, which is the one answer a headless run can
  // give; what the test holds is where the answer lands and that it names the
  // running version's line above it.
  expect(app.shows("id:update-toast")).toBe(true);
  expect(app.shows("id:update-toast-version")).toBe(true);
  expect(app.texts()).toContain("此安装包不支持 OTA，需要安装新的 APK");
  // The toast carries the press that answers it, not only the sentence.
  expect(app.shows("id:update-toast-action")).toBe(true);
});
