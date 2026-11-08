import { expect, test } from "nsh/test";
import { openApp, openSized } from "./testkit";
import {
  boardToJson,
  boardToMarkdown,
  exportName,
  parseBoard,
  planImport,
  planRestore,
  type BackupFixture,
} from "./backup";
import type { Card, Tag } from "./data";
import { mergeBoards } from "./merge";

/**
 * 导出、导入、从备份恢复。
 *
 * The part of this that can lose work is the decision, so every decision is a
 * pure function tested against the cases that matter: a card the import must
 * not overwrite, a card the restore must not resurrect, a card the restore must
 * not touch because it was made after the snapshot. The window tests cover the
 * rest — the verbs are where the palette says they are, a file that is not a
 * board changes nothing, and a snapshot really does come back.
 */

function card(patch: Partial<Card>): Card {
  return { id: "x", title: "x", notes: "", tags: [], status: "todo", updatedAt: 0, ...patch };
}

const TAGS: Tag[] = [
  { id: "work", label: "工作", hue: "blue", updatedAt: 0 },
  { id: "study", label: "学习", hue: "purple", updatedAt: 0 },
];

const CARDS: Card[] = [
  card({
    id: "a",
    title: "写周报",
    tags: ["work"],
    due: "2026-11-12T14:00",
    notes: "先列结构\n再补数据",
    updatedAt: 3,
  }),
  card({ id: "b", title: "读书", status: "done", tags: ["study"], updatedAt: 2 }),
  card({ id: "c", title: "去银行", status: "archive", updatedAt: 1 }),
  card({ id: "d", title: "已删除的卡", deleted: true, updatedAt: 0 }),
];

test("Markdown is one section per column, one line per card, notes as quotes", () => {
  const md = boardToMarkdown(CARDS, TAGS, new Date(2026, 10, 8, 14, 32));

  expect(md.startsWith("# 领航看板")).toBe(true);
  expect(md).toContain("导出时间 2026-11-08 14:32");
  // 待办: an open box, the tag by name, the deadline with its hour, and the
  // note under it where the card keeps it.
  expect(md).toContain("## 待办");
  expect(md).toContain("- [ ] 写周报 · #工作 · 截止 2026-11-12 14:00");
  expect(md).toContain("  > 先列结构\n  > 再补数据");
  // Finished and filed work is checked off: the file opens as the board it came
  // from in any editor that reads checkboxes.
  expect(md).toContain("## 已完成");
  expect(md).toContain("- [x] 读书 · #学习");
  expect(md).toContain("## 归档");
  expect(md).toContain("- [x] 去银行");
  // 进行中 has nothing in it, so it has no heading: a section with nothing
  // under it reads as one that failed to load.
  expect(md).not.toContain("## 进行中");
  // A removed card is not work.
  expect(md).not.toContain("已删除的卡");
  // One blank line between sections, not a wall of them.
  expect(md).not.toContain("\n\n\n");

  // A tag the file knows nothing about still names itself, and a card with no
  // title still has a line.
  const odd = boardToMarkdown(
    [card({ id: "e", title: "  ", tags: ["ghost"], notes: "", updatedAt: 0 })],
    [],
    new Date(2026, 10, 8, 9, 5),
  );
  expect(odd).toContain("- [ ] 未命名卡片 · #ghost");
});

test("JSON is the whole live board and reads back as the same board", () => {
  const text = boardToJson(CARDS, TAGS, 1000);
  const file = JSON.parse(text) as { version: number; exportedAt: number; cards: Card[]; tags: Tag[] };
  expect(file.version).toBe(1);
  expect(file.exportedAt).toBe(1000);
  // No tombstone travels in an export: the file is a document, not the store.
  expect(file.cards.map((c) => c.id)).toEqual(["a", "b", "c"]);
  expect(file.tags.length).toBe(2);

  const back = parseBoard(text);
  if ("error" in back) throw new Error(back.error);
  expect(back.board.cards.map((c) => c.title)).toEqual(["写周报", "读书", "去银行"]);
  expect(back.board.cards[0].due).toBe("2026-11-12T14:00");
  expect(back.board.cards[0].tags).toEqual(["work"]);
  expect(back.board.tags.map((t) => t.label)).toEqual(["工作", "学习"]);
});

test("a file that is not a board is refused, and says which part is wrong", () => {
  const bad: [string, string][] = [
    ["not json at all", "不是 JSON"],
    ["[]", "不是一个看板对象"],
    ['{"version":2,"cards":[]}', "版本"],
    ['{"version":1}', "cards"],
    ['{"version":1,"cards":[{"title":"没有 id"}]}', "第 1 张"],
    ['{"version":1,"cards":[],"tags":[{"id":"t"}]}', "第 1 个标签"],
    ['{"version":1,"cards":[],"tags":"work"}', "tags"],
  ];
  for (const [text, says] of bad) {
    const parsed = parseBoard(text);
    if (!("error" in parsed)) throw new Error(`${text} should not parse`);
    expect(parsed.error).toContain(says);
  }
  // The smallest board there is, with what a foreign file may leave out.
  const thin = parseBoard('{"version":1,"cards":[{"id":"z","title":""}],"tags":[]}');
  if ("error" in thin) throw new Error(thin.error);
  expect(thin.board.cards[0]).toMatchObject({ id: "z", title: "", notes: "", tags: [], status: "todo", updatedAt: 0 });
});

test("an import adds what is missing, updates what is older, and leaves the rest", () => {
  const local = [
    card({ id: "a", title: "A", updatedAt: 10 }),
    card({ id: "b", title: "B", updatedAt: 20 }),
    card({ id: "gone", title: "G", deleted: true, updatedAt: 5 }),
  ];
  const incoming = [
    card({ id: "a", title: "A2", updatedAt: 11 }),
    // Older than what is here: this afternoon's edit is not undone by
    // yesterday's export.
    card({ id: "b", title: "B2", updatedAt: 19 }),
    // Removed here, so it is not on the board: the id is known but the card is
    // work the user asked back for.
    card({ id: "gone", title: "G2", updatedAt: 6 }),
    card({ id: "d", title: "D", updatedAt: 1 }),
  ];
  const plan = planImport(local, incoming);
  expect(plan.add.map((c) => c.id)).toEqual(["d"]);
  expect(plan.update.map((c) => c.id)).toEqual(["a", "gone"]);
  expect(plan.same.map((c) => c.id)).toEqual(["b"]);
});

test("a restore writes back what was lost, and nothing else", () => {
  const at = 5000;
  const local = {
    cards: [
      card({ id: "same", title: "同", updatedAt: 1 }),
      card({ id: "edited", title: "改坏了", updatedAt: 2 }),
      card({ id: "gone", title: "删了", deleted: true, updatedAt: 3 }),
      card({ id: "local", title: "备份之后新建", updatedAt: 4 }),
    ],
    tags: [{ id: "work", label: "工作", hue: "blue" as const, updatedAt: 1 }],
  };
  const backup = {
    cards: [
      card({ id: "same", title: "同", updatedAt: 1 }),
      card({ id: "edited", title: "原来的", updatedAt: 2 }),
      card({ id: "gone", title: "删了", updatedAt: 3 }),
      card({ id: "older", title: "备份里有、现在没有", updatedAt: 0 }),
      // Deleted before the snapshot: there is nothing to recover, and writing
      // it back would delete a card made since.
      card({ id: "tomb", title: "备份时就已删", deleted: true, updatedAt: 9 }),
    ],
    tags: [{ id: "extra", label: "额外", hue: "green" as const, updatedAt: 1 }],
  };

  const plan = planRestore(local, backup, at);
  // `same` is untouched, `tomb` is skipped, and `local` — the work made after
  // the snapshot — is not in the plan at all.
  expect(plan.cards.map((c) => c.id)).toEqual(["edited", "gone", "older"]);
  // Every restored row wins the merge: one stamp, minted above the board.
  for (const row of plan.cards) expect(row.updatedAt).toBe(at);
  expect(plan.cards.every((row) => !row.deleted)).toBe(true);
  expect(plan.tags.map((t) => t.id)).toEqual(["extra"]);

  // A row that differs only in its stamp is the same work: restoring it would
  // be a write nobody asked for.
  const stamps = planRestore(
    { cards: [card({ id: "same", title: "同", updatedAt: 999 })], tags: [] },
    { cards: [card({ id: "same", title: "同", updatedAt: 1 })], tags: [] },
    at,
  );
  expect(stamps.cards.length).toBe(0);
});

test("a restored card wins every field against the tombstone that removed it", () => {
  // The merge is per field. A restore that kept the backup's own older stamps
  // would lose each field to the delete, and "restored" would change nothing.
  const gone = card({
    id: "g",
    title: "删了",
    deleted: true,
    updatedAt: 90,
    stamps: { title: 10, notes: 10, tags: 10, due: 10, status: 10, deleted: 90, rank: 10 },
  });
  const inBackup = card({
    id: "g",
    title: "原来的标题",
    updatedAt: 10,
    rank: 2000,
    stamps: { title: 10, notes: 10, tags: 10, due: 10, status: 10, deleted: 10, rank: 10 },
  });
  const plan = planRestore({ cards: [gone], tags: [] }, { cards: [inBackup], tags: [] }, 5000);
  const merged = mergeBoards([gone], plan.cards)[0];
  expect(merged.deleted).toBeFalsy();
  expect(merged.title).toBe("原来的标题");
  expect(merged.rank).toBe(2000);
});

test("a board file keeps its columns' order and its field stamps", () => {
  const text = boardToJson(
    [card({ id: "r", title: "有序", rank: 3000, stamps: { title: 7, rank: 8 }, updatedAt: 8 })],
    [],
    1,
  );
  const parsed = parseBoard(text);
  if ("error" in parsed) throw new Error(parsed.error);
  const back = parsed.board.cards[0];
  expect(back.rank).toBe(3000);
  expect(back.stamps?.title).toBe(7);
  expect(back.stamps?.rank).toBe(8);
});

test("an export is named for the day and the hour it was taken", () => {
  const at = new Date(2026, 10, 8, 14, 32);
  expect(exportName("json", at)).toBe("领航-20261108-1432.json");
  expect(exportName("markdown", at)).toBe("领航-20261108-1432.md");
});

test("the palette offers the board's paperwork", async () => {
  const { app, desktop } = await openApp();
  if (!desktop) return;

  await app.keyboard.press("mod+k");
  await app.waitFor("id:palette-input");
  expect(app.shows("id:cmd-export-json")).toBe(true);
  expect(app.shows("id:cmd-export-markdown")).toBe(true);
  expect(app.shows("id:cmd-import")).toBe(true);
  expect(app.shows("id:cmd-restore")).toBe(true);
  // They are the last rows, under the everyday verbs: 新建 is still first.
  const rows = app.texts();
  expect(rows).toContain("导出看板（JSON）");
  expect(rows).toContain("导出看板（Markdown）");
  expect(rows).toContain("从剪贴板导入看板");
  expect(rows).toContain("从备份恢复…");
});

test("a clipboard that is not a board changes nothing and says why", async () => {
  const app = await openSized(1280, 860, { clipboard: '{"version":1,"cards":[{"title":"没有 id"}]}' });
  if (!app) return;

  await app.keyboard.press("mod+k");
  await app.waitFor("id:palette-input");
  await app.type("id:palette-input", "导入");
  await app.wait(300);
  await app.keyboard.press("enter");
  await app.wait(500);

  // No question is asked about a file that cannot be read, and nothing was
  // written: the board is exactly the board.
  expect(app.dialogs().length).toBe(0);
  expect(app.shows("id:backup-notice")).toBe(true);
  expect(app.texts().join(" ")).toContain("不是看板 JSON");
  expect(app.shows("id:col-todo >> id:card-c3")).toBe(true);
  expect(app.texts()).toContain("写周报");
});

test("an import asks with its counts, then adds only what is older", async () => {
  // One card this board has never seen, one copy of a card it has — older than
  // the copy on the board, so it must lose.
  const file = boardToJson(
    [
      card({ id: "imported", title: "从文件来的卡", tags: ["work"], status: "todo", updatedAt: 123 }),
      card({ id: "c3", title: "旧标题", tags: ["work"], status: "todo", updatedAt: 1 }),
    ],
    TAGS,
    123,
  );
  const app = await openSized(1280, 860, { clipboard: file });
  if (!app) return;
  app.onDialog(() => "导入");

  await app.keyboard.press("mod+k");
  await app.waitFor("id:palette-input");
  await app.type("id:palette-input", "导入");
  await app.wait(300);
  await app.keyboard.press("enter");
  await app.wait(600);

  const asked = app.dialogs()[0];
  expect(asked?.title).toBe("导入看板？");
  expect(asked?.message).toContain("导入 1 张新卡");
  expect(asked?.message).toContain("更新 0 张");
  // The new card is on the board…
  expect(app.shows("id:col-todo >> id:card-imported")).toBe(true);
  expect(app.texts()).toContain("从文件来的卡");
  // …and the card it also carried, older than the one here, did not overwrite
  // it: the merge is by stamp, the same rule the phone syncs by.
  expect(app.texts()).toContain("写周报");
  expect(app.texts()).not.toContain("旧标题");
  expect(app.texts().join(" ")).toContain("已导入 1 张新卡");
});

test("a snapshot comes back over the cards that changed, and never over the new ones", async () => {
  const fixture: BackupFixture = {
    entries: [
      { name: "navigator-2026-11-07.json", at: 1000, cards: 3, tags: 1 },
      { name: "navigator-2026-11-06.json", at: 900, cards: 2, tags: 1 },
    ],
    docs: {
      "navigator-2026-11-07.json": JSON.stringify({
        version: 1,
        exportedAt: 1000,
        cards: [
          // The card that was edited since the snapshot.
          card({ id: "c3", title: "写周报（备份里的样子）", tags: ["work"], updatedAt: 1 }),
          // A card that was there and is gone now.
          card({ id: "revive", title: "被删掉的卡", tags: [], updatedAt: 2 }),
          // Deleted before the snapshot: nothing to bring back.
          card({ id: "c4", title: "备份时就已删", deleted: true, updatedAt: 3 }),
        ],
        tags: [{ id: "extra", label: "额外", hue: "green", updatedAt: 1 }],
      }),
      "navigator-2026-11-06.json": '{"version":1,"cards":[]}',
    },
  };
  const app = await openSized(1280, 860, {
    // A test's board stays in memory, and the backup folder it sees is this
    // one: it must never be able to restore the developer's own board.
    storage: {
      "navigator.syncEnabled": "0",
      "navigator.persist": "0",
      "navigator.backups": JSON.stringify(fixture),
    },
  });
  if (!app) return;
  app.onDialog(() => "恢复");

  await app.keyboard.press("mod+k");
  await app.waitFor("id:palette-input");
  await app.type("id:palette-input", "恢复");
  await app.wait(300);
  await app.keyboard.press("enter");
  await app.waitFor("id:backup-2026-11-07");
  // Newest first, and only the day and what was in it — no file names, no
  // timestamps to read.
  expect(app.texts()).toContain("2026-11-07");
  expect(app.texts()).toContain("2026-11-06");

  await app.press("id:backup-2026-11-07");
  await app.wait(600);

  const asked = app.dialogs()[0];
  expect(asked?.title).toBe("从备份恢复？");
  expect(asked?.message).toContain("2 张卡片");
  expect(asked?.message).toContain("1 个标签");

  // The edited card is back as the snapshot had it…
  expect(app.texts()).toContain("写周报（备份里的样子）");
  // …the removed one is back…
  expect(app.texts()).toContain("被删掉的卡");
  // …the card deleted before the snapshot stays deleted…
  expect(app.texts()).not.toContain("备份时就已删");
  // …and the cards the snapshot never knew are untouched: a restore is for
  // what was lost, not for what was added after it.
  expect(app.texts()).toContain("联系三位老朋友");
  expect(app.shows("id:col-todo >> id:card-c5")).toBe(true);
  expect(app.texts().join(" ")).toContain("已恢复 2 张卡");
});
