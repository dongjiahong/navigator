import { expect, test } from "nsh/test";
import { changed, orderChanges, orderOf, stampOf } from "./changes";
import type { Card, Tag } from "./data";

/**
 * What gets written and what gets sent.
 *
 * The rules are small and every one of them has cost someone a lost edit or a
 * database write per keystroke, so they are tested apart from the store: a row
 * is written when its stamp moves, a tombstone is a change, and a column is
 * written whole when one of its cards moves.
 */

function card(id: string, patch: Partial<Card> = {}): Card {
  return { id, title: id, notes: "", tags: [], status: "todo", updatedAt: 0, ...patch };
}

test("a row is collected once, and only when its stamp moves", () => {
  const seen = new Map<string, string>();
  const board = [card("a", { updatedAt: 10 }), card("b", { updatedAt: 20 })];

  expect(changed(board, seen, false).map((c) => c.id)).toEqual(["a", "b"]);
  // Collecting without recording is a question, not a write: asking twice is
  // the same answer.
  expect(changed(board, seen, false).map((c) => c.id)).toEqual(["a", "b"]);

  expect(changed(board, seen, true).map((c) => c.id)).toEqual(["a", "b"]);
  expect(changed(board, seen, true)).toEqual([]);

  // A newer edit is a change; a title that arrives with the same stamp is not:
  // the stamp is the record of the write.
  expect(changed([card("a", { updatedAt: 11 })], seen, true).map((c) => c.id)).toEqual(["a"]);
  expect(changed([card("a", { updatedAt: 11, title: "别的" })], seen, true)).toEqual([]);
});

test("a tombstone is a change even when nothing else moved", () => {
  const seen = new Map<string, string>();
  const alive = card("a", { updatedAt: 10 });
  changed([alive], seen, true);
  // Deleting keeps the stamp on some paths: it must still be written, or the
  // card comes back on the next launch.
  const dead: Card = { ...alive, deleted: true };
  expect(changed([dead], seen, true).map((c) => c.id)).toEqual(["a"]);
  expect(stampOf(dead)).not.toBe(stampOf(alive));
});

test("a column is written whole, and only the column that moved", () => {
  const seen = new Map<string, string>();
  const board = [
    card("a"),
    card("b"),
    card("c", { status: "doing" }),
    card("gone", { deleted: true }),
  ];
  expect(orderOf(board, "todo")).toBe("a,b");
  expect(orderChanges(board, seen)).toEqual({ todo: ["a", "b"], doing: ["c"] });

  // Nothing moved: nothing to write.
  expect(orderChanges(board, seen)).toEqual({});

  // One card moving renumbers the rest, so the column goes whole.
  const moved = [card("b"), card("a"), card("c", { status: "doing" })];
  expect(orderChanges(moved, seen)).toEqual({ todo: ["b", "a"] });
});

test("a card that was only numbered for the first time is a change", () => {
  // The migration writes a rank without touching `updatedAt` — the lowest stamp
  // a field can carry — so the row stamp alone would never report it, and the
  // column's order would live on this device only.
  const seen = new Map<string, string>();
  const before = card("a", { updatedAt: 10 });
  changed([before], seen, true);
  expect(changed([{ ...before, rank: 1000, stamps: { rank: 0 } }], seen, true).map((c) => c.id)).toEqual(["a"]);
  // A rank that did not move is not a change.
  expect(changed([{ ...before, rank: 1000, stamps: { rank: 0 } }], seen, true)).toEqual([]);
});

test("a tag is a row like a card", () => {
  const seen = new Map<string, string>();
  const tag: Tag = { id: "work", label: "工作", hue: "blue", updatedAt: 5 };
  expect(changed([tag], seen, true).map((t) => t.label)).toEqual(["工作"]);
  expect(changed([{ ...tag, label: "工作（新）", updatedAt: 6 }], seen, true).length).toBe(1);
  expect(changed([{ ...tag, deleted: true, updatedAt: 7 }], seen, true).length).toBe(1);
});
