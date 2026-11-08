import { expect, test } from "nsh/test";
import { openApp } from "./testkit";
import { rankCommands } from "./palette";
import type { Card, Tag } from "./data";

/**
 * Cmd+K: one field over the board that either names a card or runs one of the
 * board's verbs.
 *
 * The ranking is the palette's whole judgement, so it is tested as the pure
 * function it is — what Enter would take is the row the list puts first. The
 * window tests hold the rest: the shortcut opens it, the keys walk it, Enter
 * acts, and Escape and the board behind it behave.
 */

function card(patch: Partial<Card>): Card {
  return { id: "x", title: "x", notes: "", tags: [], status: "todo", updatedAt: 0, ...patch };
}

const TAGS: Tag[] = [
  { id: "work", label: "工作", hue: "blue", updatedAt: 0 },
  { id: "life", label: "生活", hue: "amber", updatedAt: 0 },
];

const CARDS: Card[] = [
  card({ id: "a", title: "写周报", tags: ["work"], updatedAt: 3 }),
  card({ id: "b", title: "晨间冥想", notes: "先看一眼周报的模板", tags: ["life"], updatedAt: 2 }),
  card({ id: "c", title: "整理衣橱", tags: ["life"], status: "archive", updatedAt: 1 }),
  card({ id: "d", title: "已删除的周报", tags: ["work"], deleted: true, updatedAt: 0 }),
];

test("with nothing typed the palette offers the verbs, not every card", () => {
  const rows = rankCommands("", CARDS, TAGS);
  expect(rows.every((row) => row.kind !== "open")).toBe(true);
  expect(rows[0].label).toBe("新建卡片");
  // The tags, the tag manager and the filter are all one press away.
  expect(rows.map((row) => row.label)).toContain("标签管理");
  expect(rows.map((row) => row.label)).toContain("按标签筛选：工作");
  expect(rows.map((row) => row.label)).toContain("清除筛选");
  // 归档 has cards, so it can be emptied from here too.
  expect(rows.map((row) => row.label)).toContain("清空归档");
  // A removed card is not a card to jump to.
  expect(rows.some((row) => row.cardId === "d")).toBe(false);
});

test("a query puts the cards it matches above the verbs", () => {
  const rows = rankCommands("周报", CARDS, TAGS);
  // Three cards mention 周报 — a title, a note and a removed one — but only the
  // two that are still on the board are offered, title match first.
  expect(rows[0]).toMatchObject({ kind: "open", cardId: "a", label: "写周报", hint: "待办" });
  expect(rows[1]).toMatchObject({ kind: "open", cardId: "b" });
  expect(rows.some((row) => row.cardId === "d")).toBe(false);
  // The verbs that do not match what was typed step aside, so the list is the
  // cards a query is looking for — not every card under a wall of verbs.
  expect(rows.every((row) => row.kind === "open")).toBe(true);
  // A verb that does match is still there, under the cards.
  const typed = rankCommands("新建", CARDS, TAGS);
  expect(typed.some((row) => row.kind === "new")).toBe(true);
});

test("a card is found by its tag's name, and by letters in order", () => {
  const byTag = rankCommands("生活", CARDS, TAGS).map((row) => row.cardId);
  expect(byTag[0]).toBe("b");
  expect(byTag[1]).toBe("c");
  // 周 in 周报: a query that is not a substring still finds the title.
  expect(rankCommands("周", CARDS, TAGS)[0].cardId).toBe("a");
  // Nothing matches, and the verbs that do not match are gone too.
  expect(rankCommands("zzz", CARDS, TAGS)).toEqual([]);
});

test("a tag command carries the tag and its hue; 清空归档 only when there is a pile", () => {
  const rows = rankCommands("生活", [], TAGS);
  const tag = rows.find((row) => row.kind === "tag" && row.tagId === "life");
  expect(tag).toMatchObject({ label: "按标签筛选：生活", hue: "amber" });

  const empty = rankCommands("", [], TAGS);
  expect(empty.some((row) => row.kind === "clear-archive")).toBe(false);
  const withArchive = rankCommands("", [card({ id: "z", status: "archive" })], TAGS);
  expect(withArchive.find((row) => row.kind === "clear-archive")?.hint).toBe("1 张");
});

test("at most eight cards are offered", () => {
  const many = Array.from({ length: 20 }, (_, i) => card({ id: `m${i}`, title: `周报 ${i}` }));
  const rows = rankCommands("周报", many, TAGS).filter((row) => row.kind === "open");
  expect(rows.length).toBe(8);
});

test("the lead time is five rows, and the one in use carries 当前", () => {
  const off = rankCommands("提前", CARDS, TAGS, 0);
  expect(off.map((row) => row.label)).toEqual([
    "提前提醒：关闭",
    "提前提醒：5 分钟",
    "提前提醒：15 分钟",
    "提前提醒：30 分钟",
    "提前提醒：60 分钟",
  ]);
  // One row is the value in use, and it is the only one that says so.
  expect(off.map((row) => row.hint)).toEqual(["当前", undefined, undefined, undefined, undefined]);
  // Typing the number reaches it rather than a verb that merely starts with 提前.
  const typed = rankCommands("30 分钟", CARDS, TAGS, 30);
  expect(typed[0]).toMatchObject({ kind: "lead", lead: 30, hint: "当前", label: "提前提醒：30 分钟" });
});

test("Cmd+K opens the palette and Enter opens the card it names", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.keyboard.press("mod+k");
  await app.waitFor("id:palette-input");
  // Nothing typed yet: the verbs, with 新建卡片 on top.
  expect(app.shows("id:cmd-new")).toBe(true);

  await app.type("id:palette-input", "写周报");
  await app.wait(300);
  expect(app.shows("id:cmd-card-c3")).toBe(true);

  await app.keyboard.press("enter");
  await app.waitFor("id:inspector-title");
  expect(app.value("id:inspector-title")).toContain("写周报");
  // The palette put itself away: a field left floating over the card it opened
  // would be two answers to one question.
  expect(app.shows("id:palette-input")).toBe(false);
});

test("the arrows walk the list and Enter runs the row they are on", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.keyboard.press("mod+k");
  await app.waitFor("id:palette-input");
  // Two cards answer to 学习: 学习蚂蚁解析… by its title, and 阅读《逐根…》
  // through the 学习 tag. The title match is the first row.
  await app.type("id:palette-input", "学习");
  await app.wait(300);
  expect(app.shows("id:cmd-card-c8")).toBe(true);

  // One arrow down moves to the second row, which is the card the tag found.
  await app.keyboard.press("down");
  await app.wait(200);
  await app.keyboard.press("enter");
  await app.waitFor("id:inspector-title");
  expect(app.value("id:inspector-title")).toContain("阅读《逐根 K 线解读》并做笔记");
  // The palette closed with the card it opened.
  expect(app.shows("id:palette-input")).toBe(false);
});

test("Enter takes the first row when no arrow has moved", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.keyboard.press("mod+k");
  await app.waitFor("id:palette-input");
  await app.type("id:palette-input", "学习");
  await app.wait(300);
  // No arrow: the title match is where Enter lands.
  await app.keyboard.press("enter");
  await app.waitFor("id:inspector-title");
  expect(app.value("id:inspector-title")).toContain("学习蚂蚁解析");
});

test("Escape puts the palette away and leaves the board as it was", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.keyboard.press("mod+k");
  await app.waitFor("id:palette-input");
  await app.keyboard.press("escape");
  await app.wait(400);

  expect(app.shows("id:palette-input")).toBe(false);
  // No card was opened behind it by the same Escape.
  expect(app.shows("id:inspector-title")).toBe(false);
  expect(app.shows("id:col-todo >> id:card-c2")).toBe(true);
});

test("Cmd+K again closes what it opened", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.keyboard.press("mod+k");
  await app.waitFor("id:palette-input");
  await app.keyboard.press("mod+k");
  await app.wait(300);
  expect(app.shows("id:palette-input")).toBe(false);
});

test("the board's keys stay out of the palette's way", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.keyboard.press("mod+k");
  await app.waitFor("id:palette-input");
  // Space and Backspace are typing here; the board behind must not finish or
  // delete the card its cursor is on.
  await app.keyboard.press("down");
  await app.keyboard.press("space");
  await app.wait(400);

  expect(app.shows("id:undo-toast")).toBe(false);
  expect(app.shows("id:col-todo >> id:card-c2")).toBe(true);
});

test("the palette's verbs do what they say", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  // A tag narrows the board to it, from the keyboard.
  await app.keyboard.press("mod+k");
  await app.waitFor("id:palette-input");
  await app.type("id:palette-input", "按标签筛选：学习");
  await app.wait(300);
  await app.keyboard.press("enter");
  await app.wait(400);
  expect(app.shows("id:col-todo >> id:card-c2")).toBe(true);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(false);

  // And 清除筛选 puts it back.
  await app.keyboard.press("mod+k");
  await app.waitFor("id:palette-input");
  await app.type("id:palette-input", "清除筛选");
  await app.wait(300);
  await app.keyboard.press("enter");
  await app.wait(400);
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(true);
});

test("新建卡片 from the palette makes a card like the button does", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.keyboard.press("mod+k");
  await app.waitFor("id:palette-input");
  await app.keyboard.press("enter");
  await app.waitFor("id:inspector-title");
  // The new card is blank and open, exactly as 新建 leaves it.
  expect(app.value("id:inspector-title")).toBe("");
  await app.type("id:inspector-title", "买牛奶");
  await app.press("label:关闭");
  await app.wait(300);
  expect(app.texts()).toContain("买牛奶");
});
