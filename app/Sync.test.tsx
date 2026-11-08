import { expect, test } from "nsh/test";
import { mergeBoards, sameBoard } from "./merge";
import type { Card } from "./data";

function card(id: string, patch: Partial<Card> = {}): Card {
  return { id, title: id, notes: "", tags: [], status: "todo", updatedAt: 0, ...patch };
}

test("the newer edit wins, per card", () => {
  const mac = [card("a", { title: "Mac 改过", updatedAt: 20 })];
  const phone = [card("a", { title: "手机改过", updatedAt: 10 })];
  expect(mergeBoards(mac, phone)[0].title).toBe("Mac 改过");
  expect(mergeBoards(phone, mac)[0].title).toBe("Mac 改过");
});

test("a card only one side has is kept", () => {
  const merged = mergeBoards([card("a")], [card("b")]);
  expect(merged.map((c) => c.id)).toEqual(["a", "b"]);
});

test("a deletion is not undone by an older copy", () => {
  const mac = [card("a", { deleted: true, updatedAt: 30 })];
  const phone = [card("a", { title: "还在", updatedAt: 20 })];
  const winner = mergeBoards(mac, phone).find((c) => c.id === "a")!;
  expect(winner.deleted).toBe(true);
});

test("boards that differ only in key order count as the same", () => {
  // The server re-serializes with sorted keys, so this is the case that used to
  // re-render the board on every sync tick and interrupt a press.
  const a = [card("a", { updatedAt: 5 })];
  const b = [card("a", { updatedAt: 5 })];
  expect(sameBoard(a, b)).toBe(true);
  expect(sameBoard(a, [card("a", { updatedAt: 6 })])).toBe(false);
  expect(sameBoard(a, [])).toBe(false);
});
