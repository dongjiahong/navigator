import { expect, test } from "nsh/test";
import { canPair, digits, pairCodeLabel, pairLine, readPair } from "./pairing";
import { canDraw, openApp, openSized } from "./testkit";

/**
 * The pairing code: six digits the Mac shows and the phone proves it knows.
 *
 * The proof itself is the Rust crate's (`app/src/auth.rs`), and the handshake is
 * driven over a real loopback socket there — including the refusal and the
 * lockout, and a card crossing in each direction. What is left here is the part
 * a user touches: the digits, the one line that is said about them, and the two
 * windows they are typed into or read from.
 */

/**
 * A phone that syncs, pointed at a port nothing answers on.
 *
 * Sync has to be on for the pairing state to exist at all, and an address is
 * set so the crate never broadcasts: a test must not reach a Mac app that
 * happens to be open on the developer's machine.
 */
const SYNC_ON = {
  "navigator.syncEnabled": "1",
  "navigator.persist": "0",
  "navigator.macAddress": "127.0.0.1:9",
};

/** The code as the Mac draws it, out of the texts on screen. */
function shownCode(app: { texts(): string[] }): string {
  return app.texts().find((text) => /^\d{3} \d{3}$/.test(text.trim())) ?? "";
}

test("a code is six digits, read as two groups of three", () => {
  // Whatever a thumb lands on, the field keeps digits and six of them.
  expect(digits("482 913")).toBe("482913");
  expect(digits("48a2-91x3")).toBe("482913");
  expect(digits("4829137")).toBe("482913");
  expect(canPair("482 913")).toBe(true);
  expect(canPair("482 91")).toBe(false);
  expect(canPair("")).toBe(false);

  // Two groups, because six digits in a row are read as one number. Leading
  // zeros are digits like any other: 000 042 is a code, not 42.
  expect(pairCodeLabel("482913")).toBe("482 913");
  expect(pairCodeLabel("000042")).toBe("000 042");
  expect(pairCodeLabel("")).toBe("");
});

test("a pairing state is said in one line, beside everything else sync says", () => {
  expect(pairLine("need")).toBe("需要配对码");
  expect(pairLine("wrong")).toBe("配对码不对");
  expect(pairLine("locked")).toBe("尝试太多次，稍后再试");
  // Nothing in the way: the line belongs to sync again.
  expect(pairLine("ok")).toBe("");

  // The state comes from the crate's status body, so the word it sends is what
  // the line says — and a word this app does not know says nothing at all.
  expect(readPair({ pair: "wrong" })).toBe("wrong");
  expect(readPair({ pair: "locked" })).toBe("locked");
  expect(readPair({ pair: "need" })).toBe("need");
  expect(readPair({})).toBe("ok");
  expect(readPair({ pair: "something-new" })).toBe("ok");
  expect(pairLine(readPair({ pair: "wrong" }))).toBe("配对码不对");
});

test("the Mac makes a code, shows it in the title bar, and keeps it", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.press("id:pair-code-open");
  await app.waitFor("id:pair-code-digits");
  const code = shownCode(app);
  expect(code).not.toBe("");
  // The digits are the device's, not the window's: a phone pairs once, not once
  // per launch.
  expect(app.storage()["navigator.pairCode"]).toBe(code.replace(" ", ""));
});

test("a new code is asked for, and a cancel leaves the old one working", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.press("id:pair-code-open");
  await app.waitFor("id:pair-code-digits");
  const before = shownCode(app);
  const kept = app.storage()["navigator.pairCode"];

  // The question names what it costs: every paired phone has to be told again.
  let asked = "";
  app.onDialog((dialog) => {
    asked = `${dialog.title ?? ""} ${dialog.message ?? ""}`;
    return "取消";
  });
  await app.press("id:pair-regenerate");
  await app.wait(400);
  expect(asked).toContain("重新输入");
  expect(shownCode(app)).toBe(before);
  expect(app.storage()["navigator.pairCode"]).toBe(kept);

  // And taken, it replaces the digits and what is stored with them.
  app.onDialog(() => "重新生成");
  await app.press("id:pair-regenerate");
  await app.waitUntil(() => shownCode(app) !== before, { timeout: 4000 });
  const after = shownCode(app);
  expect(after).not.toBe(before);
  expect(app.storage()["navigator.pairCode"]).toBe(after.replace(" ", ""));
});

test("Cmd+K reaches the code too", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.keyboard.press("mod+k");
  await app.waitFor("id:palette-input");
  await app.type("id:palette-input", "配对码");
  await app.wait(300);
  expect(app.shows("id:cmd-pair")).toBe(true);

  await app.keyboard.press("enter");
  await app.waitFor("id:pair-code-digits");
  expect(shownCode(app)).not.toBe("");
});

test("a phone that has never been given the digits says so", async () => {
  const app = await openSized(390, 844, { storage: SYNC_ON });
  if (!app) return;
  // Where a window really draws, that process is the Mac: the app is the
  // service there, not a phone, so there is no pairing state to look at.
  if (await canDraw(app)) return;

  // One quiet line in the header, where sync says everything it has to say.
  await app.waitUntil(() => app.texts().includes("需要配对码"), { timeout: 4000 });
});

test("the phone takes the six digits once and keeps them", async () => {
  const app = await openSized(390, 844, { storage: SYNC_ON });
  if (!app) return;
  // On a host that draws a real window the phone's title row sits under the
  // platform's own drag area, which swallows the press: that says nothing about
  // the app, so the test steps aside rather than failing there.
  if (await canDraw(app)) return;

  await app.waitUntil(() => app.texts().includes("需要配对码"), { timeout: 4000 });
  expect(app.storage()["navigator.pairCode"]).toBe(undefined);

  await app.press("id:phone-sync");
  await app.waitFor("id:link-code");

  // Half a code pairs with nothing. The button is not `disabled` — it keeps its
  // shape and its label — but its accessibility state says it cannot fire, and
  // that is what a press reads, so the press never lands.
  await app.type("id:link-code", "48291");
  await app.wait(200);
  await expect(app.press("id:link-save")).rejects.toMatchObject({
    code: "ERR_NSH_TEST_DISABLED",
  });
  expect(app.shows("id:link-code")).toBe(true);
  expect(app.storage()["navigator.pairCode"]).toBe(undefined);

  // The sixth digit, and the sheet goes: a pairing that worked does not linger
  // over the board it just unlocked.
  await app.type("id:link-code", "3");
  await app.wait(200);
  await app.press("id:link-save");
  await app.waitUntil(() => !app.shows("id:link-code"), { timeout: 4000 });
  expect(app.storage()["navigator.pairCode"]).toBe("482913");
  await app.waitUntil(() => !app.texts().includes("需要配对码"), { timeout: 4000 });
});
