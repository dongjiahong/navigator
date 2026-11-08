import { expect, test } from "nsh/test";
import { appendItem, notePreview, parseChecklist, toggleItem } from "./checklist";
import { noteHeight, noteShare, panelSize } from "./panel";
import { openSized } from "./testkit";

/**
 * A checklist is a note that carries `[ ]` boxes, so everything about it is a
 * pure function of a string: what the items are, what flipping one does to the
 * text, and what a card's two-line preview shows of them.
 *
 * The tests below hold the editor to the one thing it must not do — reformat a
 * note it only wanted to tick — and then check the rows on a real window.
 */

test("the items are the note's own lines, with the box read as the state", () => {
  expect(parseChecklist("")).toEqual({ items: [], done: 0, total: 0 });
  expect(parseChecklist("只是一段备注")).toEqual({ items: [], done: 0, total: 0 });

  const list = parseChecklist("先看形态。\n- [ ] 单根 K 线\n- [x] 组合形态\n- [ ] 做笔记");
  expect(list.total).toBe(3);
  expect(list.done).toBe(1);
  expect(list.items.map((item) => item.line)).toEqual([1, 2, 3]);
  expect(list.items.map((item) => item.text)).toEqual(["单根 K 线", "组合形态", "做笔记"]);
  expect(list.items.map((item) => item.done)).toEqual([false, true, false]);

  // `*` is the other bullet people type, `[X]` is what a phone's keyboard gives
  // first, and an indent is a list that belongs to something.
  const other = parseChecklist("* [X] 大写\n  - [ ] 缩进的一项");
  expect(other.total).toBe(2);
  expect(other.done).toBe(1);
  expect(other.items[1].text).toBe("缩进的一项");

  // CRLF is a line ending, not part of the item.
  expect(parseChecklist("- [x] 一件事\r\n- [ ] 另一件").total).toBe(2);
  // The box has to be a box: a bracket in prose is prose.
  expect(parseChecklist("- [maybe] 不是清单").total).toBe(0);
});

test("flipping a box changes that box and nothing else", () => {
  expect(toggleItem("- [ ] 一件事", 0)).toBe("- [x] 一件事");
  expect(toggleItem("- [x] 一件事", 0)).toBe("- [ ] 一件事");
  expect(toggleItem("- [X] 一件事", 0)).toBe("- [ ] 一件事");
  // The indent, the bullet and the words after the box are the user's.
  expect(toggleItem("  * [ ]   两个空格之后的字", 0)).toBe("  * [x]   两个空格之后的字");
  // A CRLF note keeps its CRLFs, and yes, that means every line's ending.
  expect(toggleItem("一段\r\n- [ ] 一件事\r\n尾巴", 1)).toBe("一段\r\n- [x] 一件事\r\n尾巴");
  // A trailing empty line survives too.
  expect(toggleItem("- [ ] 一件事\n", 0)).toBe("- [x] 一件事\n");
  // A line that is not an item is left alone, and so is a line that is not there.
  expect(toggleItem("只是一段备注", 0)).toBe("只是一段备注");
  expect(toggleItem("- [ ] 一件事", 4)).toBe("- [ ] 一件事");
});

test("a new item goes on a line of its own", () => {
  expect(appendItem("")).toBe("- [ ] ");
  expect(appendItem("一段备注")).toBe("一段备注\n- [ ] ");
  // No double newline when the note already ends with one.
  expect(appendItem("一段备注\n")).toBe("一段备注\n- [ ] ");
  expect(appendItem("一段备注\r\n")).toBe("一段备注\r\n- [ ] ");
  // And it really is an item: the thing appended can be ticked.
  expect(parseChecklist(appendItem("x")).total).toBe(1);
});

test("a card's preview shows the words, never a row of empty boxes", () => {
  expect(notePreview("")).toBe("");
  expect(notePreview("先看形态。")).toBe("先看形态。");
  // Two items stay two lines: a preview of a list is two things, not one long
  // sentence.
  expect(notePreview("- [ ] 单根 K 线\n- [x] 组合形态")).toBe("单根 K 线\n组合形态");
  // Prose around the list keeps its place.
  expect(notePreview("先看形态。\n- [ ] 单根 K 线")).toBe("先看形态。\n单根 K 线");
});

test("the note keeps a floor under it when a checklist takes the space", () => {
  // A 620-point window: the panel is 524 tall, and the note's box is measured
  // under the checklist. Six rows can leave it small, never a stripe.
  const panel = panelSize({ width: 1280, height: 620 }).height;
  expect(noteHeight(0, panel)).toBe(noteShare(panel));
  expect(noteHeight(40, panel)).toBe(80);
  expect(noteHeight(80, panel)).toBe(80);
  expect(noteHeight(240, panel)).toBe(240);
});

/** Types a checklist into the open card's note and reads the number back. */
const LIST = "\n- [ ] 单根 K 线\n- [x] 组合形态\n- [ ] 做笔记";

test("the panel ticks a note's checklist, and the card counts it", async () => {
  const app = await openSized(1280, 820);
  if (!app) return;

  await app.press("id:card-c2");
  await app.waitFor("id:inspector-notes");
  // The note is still a plain field: the checklist is typed into it.
  await app.type("id:inspector-notes", LIST);
  await app.waitFor("id:checklist-toggle-2");

  // Three items, one ticked — and the card on the board says so in its meta row.
  expect(app.shows("id:checklist")).toBe(true);
  expect(app.shows("id:checklist-toggle-2")).toBe(true);
  await app.press("label:关闭");
  await app.waitFor("id:col-todo >> text:1/3");
  expect(app.shows("id:col-todo >> text:1/3")).toBe(true);

  // A press is a write to the note: the item's own line flips, the rest stays.
  await app.press("id:card-c2");
  await app.waitFor("id:inspector-notes");
  await app.press("label:组合形态");
  await app.wait(400);
  expect(app.value("id:inspector-notes")).toContain("- [ ] 组合形态");
  // Ticking a box is an edit, not a status change: nothing is offered back.
  expect(app.shows("id:undo-toast")).toBe(false);

  // ＋ adds an item at the foot of the same note.
  await app.press("id:checklist-add");
  await app.wait(400);
  expect(app.value("id:inspector-notes")).toContain("- [ ] ");
  await app.press("label:关闭");
  await app.waitFor("id:col-todo >> text:0/4");
  expect(app.shows("id:col-todo >> text:0/4")).toBe(true);
});

test("a note with more than six items says how many are left", async () => {
  const app = await openSized(1280, 820);
  if (!app) return;

  await app.press("id:card-c2");
  await app.waitFor("id:inspector-notes");
  const many = Array.from({ length: 8 }, (_, i) => `\n- [ ] 第 ${i + 1} 项`).join("");
  await app.type("id:inspector-notes", many);
  // The rows appear when the note has been patched and re-read; waiting for the
  // sixth is the real condition, where a fixed pause only holds on an idle machine.
  await app.waitFor("id:checklist-toggle-6");

  // Six rows are shown and the rest are counted; the rows are not the editor.
  expect(app.shows("id:checklist-toggle-6")).toBe(true);
  expect(app.shows("id:checklist-toggle-7")).toBe(false);
  expect(app.texts()).toContain("还有 2 项，在备注里编辑");
});

test("a checklist in a short window leaves the note a field, not a stripe", async () => {
  // 620 points of window: the tightest panel this app is used at 1240 wide.
  const app = await openSized(1280, 620);
  if (!app) return;

  await app.press("id:card-c2");
  await app.waitFor("id:inspector-notes");
  await app.type("id:inspector-notes", Array.from({ length: 6 }, (_, i) => `\n- [ ] 第 ${i + 1} 项`).join(""));
  await app.waitFor("id:checklist-toggle-5");

  // The note is still there to type in, the rows are under it, and the panel's
  // own controls are still on the surface: nothing has been pushed off.
  expect(app.shows("id:inspector-notes")).toBe(true);
  expect(app.value("id:inspector-notes")).toContain("第 6 项");
  expect(app.shows("id:checklist-toggle-5")).toBe(true);
  expect(app.shows("id:checklist-add")).toBe(true);
  expect(app.shows("label:关闭")).toBe(true);
  expect(app.shows("label:删除卡片")).toBe(true);
});

test("the phone's sheet ticks the same checklist", async () => {
  const app = await openSized(390, 844);
  if (!app) return;

  await app.press("id:row-c2");
  await app.waitFor("id:detail-notes");
  await app.type("id:detail-notes", LIST);
  await app.waitFor("id:checklist-toggle-2");

  expect(app.shows("id:checklist-toggle-2")).toBe(true);
  await app.press("label:组合形态");
  await app.wait(400);
  expect(app.value("id:detail-notes")).toContain("- [ ] 组合形态");

  // The row behind the sheet counts it, too.
  await app.press("label:关闭");
  await app.waitFor("id:phone-col-todo >> text:0/3");
  expect(app.shows("id:phone-col-todo >> text:0/3")).toBe(true);
});
