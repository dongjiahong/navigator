import { expect, open, test } from "nsh/test";


test("卡片内中文输入", async () => {
  const app = await open("./App.tsx");
  await app.press("text:任务 #1");
  // `clear()` leaves the text on macOS (it deletes one character, not the
  // selection); select all with the platform's shortcut instead.
  // The field opens with the card's title; typing appends at the caret.
  await app.type("id:card-title-input", " 设计评审 中文输入");
  expect(app.value("id:card-title-input")).toContain("设计评审 中文输入");
  await app.press("text:完成");
  expect(app.texts().some((t) => t.includes("设计评审 中文输入"))).toBe(true);
});

test("跨列拖拽落位", async () => {
  const app = await open("./App.tsx");
  await app.drag("id:drag-0", { x: 330, y: 0 });
  await app.waitFor("text:/→ 进行中/");
  expect(app.texts().some((t) => t.includes("→ 进行中"))).toBe(true);
});

test("列表虚拟化与滚动", async () => {
  const app = await open("./App.tsx");
  const before = app.texts().filter((t) => t.startsWith("任务 #")).length;
  // 200 cards exist; only the cells near the viewport are mounted.
  expect(before).toBeLessThan(120);
  await app.scroll("id:col-0", 1200);
  const after = app.texts().filter((t) => t.startsWith("任务 #"));
  expect(after.length).toBeGreaterThan(0);
  expect(after).not.toContain("任务 #1");
});

test("探针 PanResponder", async () => {
  const app = await open("./App.tsx");
  await app.drag("id:probe", { x: 70, y: 0 });
  const up = app.texts().find((t) => t.startsWith("up "));
  // Touch input carries a little slop; the pan must still arrive.
  expect(Number(up?.slice(3).split(",")[0] ?? 0)).toBeGreaterThan(50);
});
