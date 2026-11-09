import { expect, test } from "nsh/test";
import { openSized } from "./testkit";

/**
 * A deadline's day word follows the calendar, not the last edit.
 *
 * 明天 21:00 written on Monday evening has to read 今天 21:00 on Tuesday, and a
 * deadline has to turn amber and then red at its own hour, with nobody typing on
 * the board. The label is computed from the clock at the moment it is drawn, so
 * the clock is a signal the deadline-shaped views read — otherwise the board
 * only looked at the date when something else changed.
 */
test("a card due tomorrow reads 今天 once the clock passes midnight", async () => {
  // The last minute of 11月9日. Sample card c2 is due 11月10日 21:00, so it is
  // 明天 on this side of midnight and 今天 on the other.
  const at = new Date(2026, 10, 9, 23, 59, 0);
  const app = await openSized(1280, 860, { clock: { time: at.getTime() } });
  if (!app) return;

  expect(app.texts()).toContain("明天 21:00");

  // Two minutes of the manual clock, and nothing on the board has been touched.
  await app.wait(120_000);

  expect(app.texts()).toContain("今天 21:00");
  expect(app.texts()).not.toContain("明天 21:00");
});

test("the filters count the new day when the clock crosses it", async () => {
  // 11月9日 23:59: 今天 holds the cards due on the 9th. A minute later two of
  // them are yesterday's, and 今天 must say what it would say if the card had
  // been read afresh — the numbers are the board's own reading of the clock.
  const at = new Date(2026, 10, 9, 23, 59, 0);
  const app = await openSized(1280, 860, { clock: { time: at.getTime() } });
  if (!app) return;

  const counts = () => {
    const texts = app.texts();
    const at = texts.indexOf("今天");
    return texts[at + 1];
  };
  const before = counts();
  await app.wait(120_000);
  expect(counts()).not.toBe(before);
});
