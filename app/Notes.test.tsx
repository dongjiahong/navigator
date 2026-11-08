import { expect, test } from "nsh/test";
import { openApp, openSized } from "./testkit";
import { charsPerLine, fieldHeight, linksIn } from "./text";

/**
 * A card's title and note are the two fields a user writes prose in, so they are
 * the two fields that have to show what was written: a field with a fixed height
 * cuts the fifth line off, and a link buried in a note is a link nobody can
 * press.
 *
 * The height is measured from the text before the platform lays it out — `Input`
 * says nothing about how tall its content wants to be — so it is tested as the
 * pure function it is, at the limits the panel actually uses.
 */

test("a field is one line tall when empty and grows with what is typed", () => {
  const line = 20.5;
  // One line is the floor: an empty field still has to be a target.
  expect(fieldHeight("", line, 12, 30)).toBe(line + 6);
  expect(fieldHeight("短", line, 12, 30)).toBe(line + 6);
  // A string of exactly one line's worth is still one line; one character more
  // is two, so the last character is never cut off.
  expect(fieldHeight("字".repeat(30), line, 12, 30)).toBe(line + 6);
  expect(fieldHeight("字".repeat(31), line, 12, 30)).toBe(line * 2 + 6);
  expect(fieldHeight("字".repeat(95), line, 12, 30)).toBe(line * 4 + 6);
});

test("a field stops growing at its ceiling", () => {
  const line = 27;
  // The panel's title: three lines, then it stops. The note under it is the
  // panel's body, sized by the panel rather than by its text, so a long title
  // can no longer push the controls off the surface.
  expect(fieldHeight("字".repeat(19 * 3), line, 3, 19)).toBe(line * 3 + 6);
  expect(fieldHeight("字".repeat(19 * 40), line, 3, 19)).toBe(line * 3 + 6);
  // The cap is the caller's: a twelve-line field stops at twelve.
  expect(fieldHeight("字".repeat(28 * 12), 20.5, 12, 28)).toBe(20.5 * 12 + 6);
  expect(fieldHeight("字".repeat(28 * 120), 20.5, 12, 28)).toBe(20.5 * 12 + 6);
});

test("a line holds fewer characters at a larger size", () => {
  // The estimate errs tall on purpose: a CJK glyph is exactly one em wide, so a
  // line of `width / fontSize` is the true count, and the margin is what keeps
  // the field from cutting off the last of them.
  const at13 = charsPerLine(400, 13);
  const at20 = charsPerLine(400, 20);
  expect(at13).toBeGreaterThan(at20);
  expect(at13).toBeLessThan(Math.floor(400 / 13) + 1);
  // A field narrower than a few glyphs still counts as a field.
  expect(charsPerLine(20, 19.5)).toBe(4);
});

test("a note's links are found in the prose around them", () => {
  expect(linksIn("")).toEqual([]);
  expect(linksIn("没有链接的备注")).toEqual([]);
  expect(linksIn("看 https://space.bilibili.com/3546652709226701")).toEqual([
    "https://space.bilibili.com/3546652709226701",
  ]);
  // A Chinese comma right after a URL belongs to the sentence, not the URL.
  expect(linksIn("看 https://example.com/a，然后回来")).toEqual(["https://example.com/a"]);
  // And Chinese written straight on after a link, with no separator at all.
  expect(linksIn("见https://example.com/a然后回来")).toEqual(["https://example.com/a"]);
  // A full stop after a bare domain, inside brackets, and before a full-width
  // full stop are all the sentence's.
  expect(linksIn("(https://example.com/b). 再试 http://example.com/c。")).toEqual([
    "https://example.com/b",
    "http://example.com/c",
  ]);
  // A comma inside a path is not trailing punctuation.
  expect(linksIn("https://example.com/a,b?x=1&y=2")).toEqual(["https://example.com/a,b?x=1&y=2"]);
  // A bracket the URL opened belongs to it; one the sentence opened does not.
  expect(linksIn("https://zh.wikipedia.org/wiki/Foo_(bar)")).toEqual([
    "https://zh.wikipedia.org/wiki/Foo_(bar)",
  ]);
  // Two links, each once, in the order they were written.
  expect(linksIn("https://a.example/x 和 https://b.example/y 以及 https://a.example/x")).toEqual([
    "https://a.example/x",
    "https://b.example/y",
  ]);
  // A scheme with no host names nothing.
  expect(linksIn("https://")).toEqual([]);
  // Anything that is not http(s) is not a link the browser can take from here.
  expect(linksIn("mailto:someone@example.com ftp://example.com/x")).toEqual([]);
});

test("a long title is kept whole in the panel", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.press("id:card-c2");
  await app.waitFor("id:inspector-title");
  // A title longer than the three lines it is shown in: it is stored whole, the
  // field stops at three lines, and the note below it keeps its height.
  const title = "很长的标题".repeat(12);
  await app.type("id:inspector-title", title);
  expect(app.value("id:inspector-title")).toContain(title);
  expect(app.shows("id:inspector-note-area")).toBe(true);
});

test("a link typed into a note becomes a row that opens it", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.press("id:card-c2");
  await app.waitFor("id:inspector-notes");
  expect(app.count("id:note-link")).toBe(0);

  await app.type("id:inspector-notes", "参考 https://example.com/reading，看完再改");
  await app.wait(300);
  expect(app.count("id:note-link")).toBe(1);
  // The URL is offered without the Chinese comma that ended it.
  expect(app.texts()).toContain("https://example.com/reading");

  await app.press("label:打开链接 https://example.com/reading");
  expect(app.openedUrls()).toContain("https://example.com/reading");
});

test("the phone's detail sheet offers a note's link too", async () => {
  // c8's note is a bare link.
  const app = await openSized(390, 844);
  if (!app) return;

  await app.press("id:row-c8");
  await app.waitFor("id:detail-notes");
  expect(app.count("id:note-link")).toBe(1);
  await app.press("label:打开链接 https://space.bilibili.com/3546652709226701");
  expect(app.openedUrls()).toContain("https://space.bilibili.com/3546652709226701");
});
