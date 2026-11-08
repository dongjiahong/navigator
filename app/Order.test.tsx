import { expect, test } from "nsh/test";
import { addCard, board, cards, byStatus, moveCard, patchCard, seedRanks, type Card } from "./data";
import { orderOf } from "./changes";
import { mergeBoards } from "./merge";

/**
 * The order inside a column.
 *
 * A column's order used to be the order of the array it happened to be in, which
 * is a fact about one device. It is a number on the card now — `rank` — so the
 * order the Mac arranges is the order the phone shows, and a move reaches the
 * other device like any other edit.
 *
 * These tests drive the real model (`cards`, `moveCard`, …) rather than a copy
 * of it: the write points are where a field stamp can go wrong, and a rank that
 * is only a local detail is exactly the bug this is about.
 */

function card(id: string, patch: Partial<Card> = {}): Card {
  return { id, title: id, notes: "", tags: [], status: "todo", rank: 1000, updatedAt: 10, ...patch };
}

/** The board as one column shows it. */
function ids(status: "todo" | "doing" | "done" | "archive" = "todo"): string[] {
  return byStatus(status).map((c) => c.id);
}

test("a column is shown in rank order, not in the order of the array", () => {
  cards.set([
    card("b", { rank: 2000 }),
    card("a", { rank: 1000 }),
    card("c", { rank: 3000, status: "doing" }),
  ]);
  expect(ids("todo")).toEqual(["a", "b"]);
  expect(ids("doing")).toEqual(["c"]);
  // The order the file is written in comes from the same place.
  expect(orderOf(cards(), "todo")).toBe("a,b");
});

test("two cards on one rank are ordered by id, so both devices agree", () => {
  // A status pressed on the phone can land a card on a rank the column already
  // holds: the tie has to be broken by something both devices have.
  cards.set([card("z", { rank: 1000 }), card("y", { rank: 1000 })]);
  expect(ids()).toEqual(["y", "z"]);
});

test("a new card goes to the end of its column", () => {
  cards.set([card("a", { rank: 1000 }), card("b", { rank: 2000 })]);
  const made = addCard({ title: "新的", notes: "", tags: [] });
  expect(ids()).toEqual(["a", "b", made]);
  expect(board().find((c) => c.id === made)!.rank).toBe(3000);
  // A card is written whole when it is made: every field is as new as the card.
  expect(Object.values(board().find((c) => c.id === made)!.stamps!).every((s) => s > 0)).toBe(true);
});

test("a card moved to the top, the middle and the end lands in that row", () => {
  cards.set([card("a", { rank: 1000 }), card("b", { rank: 2000 }), card("c", { rank: 3000 }), card("d", { rank: 4000 })]);

  moveCard("d", "todo", 0);
  expect(ids()).toEqual(["d", "a", "b", "c"]);

  moveCard("d", "todo", 2);
  expect(ids()).toEqual(["a", "b", "d", "c"]);

  moveCard("d", "todo", 3);
  expect(ids()).toEqual(["a", "b", "c", "d"]);
});

test("a card that changed column takes a rank in the column it entered", () => {
  cards.set([card("a", { rank: 1000 }), card("b", { rank: 2000 }), card("x", { rank: 1500, status: "doing" })]);
  moveCard("x", "todo", 3);
  const moved = cards().find((c) => c.id === "x")!;
  expect(moved.status).toBe("todo");
  expect(moved.rank).toBe(3000);
  expect(ids()).toEqual(["a", "b", "x"]);
  // Both fields are stamped, or the other device would keep the card where it
  // was and lose the move.
  expect(moved.stamps!.status).toBe(moved.updatedAt);
  expect(moved.stamps!.rank).toBe(moved.updatedAt);
});

test("pressing a status puts the card at the end of the column it enters", () => {
  cards.set([card("a", { rank: 1000 }), card("b", { rank: 2000, status: "done" })]);
  patchCard("a", { status: "done" });
  expect(ids("done")).toEqual(["b", "a"]);
});

test("no room left between two ranks renumbers the column", () => {
  // Two neighbours a hair apart: a midpoint would be the same number again.
  cards.set([
    card("a", { rank: 1000 }),
    card("b", { rank: 1000 + 1e-9 }),
    card("c", { rank: 3000 }),
    card("d", { rank: 5000 }),
  ]);
  moveCard("d", "todo", 1);
  expect(ids()).toEqual(["a", "d", "b", "c"]);
  const ranks = byStatus("todo").map((c) => c.rank!);
  expect(ranks).toEqual([1000, 2000, 3000, 4000]);
  // Every card that was given a new rank is stamped for it: a renumbering is an
  // edit the other device has to see, not a local tidy-up.
  for (const c of byStatus("todo")) expect(c.stamps!.rank).toBe(c.updatedAt);
});

test("a card written before columns had ranks gets the places it already showed", () => {
  const old = [
    { id: "a", title: "a", notes: "", tags: [], status: "todo" as const, updatedAt: 5 },
    { id: "b", title: "b", notes: "", tags: [], status: "todo" as const, updatedAt: 6 },
    { id: "c", title: "c", notes: "", tags: [], status: "doing" as const, updatedAt: 7 },
    { id: "d", title: "d", notes: "", tags: [], status: "doing" as const, updatedAt: 8 },
  ];
  const ranked = seedRanks(old)!;
  expect(ranked.map((c) => c.rank)).toEqual([1000, 2000, 1000, 2000]);
  // The lowest stamp a field can carry: any real move beats it, and no card
  // looks edited for having been numbered.
  for (const c of ranked) expect(c.stamps!.rank).toBe(0);
  // A board that already has ranks is left alone, so an ordinary launch writes
  // nothing.
  expect(seedRanks(ranked)).toBe(null);
});

test("two devices that moved different cards end up in the same order", () => {
  const start = [card("a", { rank: 1000 }), card("b", { rank: 2000 }), card("c", { rank: 3000 })];

  // The Mac drags c to the top; the phone drags a to the bottom. Neither has
  // seen the other's move yet.
  cards.set(start);
  moveCard("c", "todo", 0);
  const mac = cards();

  cards.set(start);
  moveCard("a", "todo", 2);
  const phone = cards();

  // Both boards meet, in either direction, and both agree on the order.
  const onMac = mergeBoards(mac, phone).sort((x, y) => (x.status === y.status ? x.rank! - y.rank! : 0));
  const onPhone = mergeBoards(phone, mac).sort((x, y) => (x.status === y.status ? x.rank! - y.rank! : 0));
  expect(onMac.map((c) => c.id)).toEqual(onPhone.map((c) => c.id));
  expect(onMac.map((c) => c.id)).toEqual(["c", "b", "a"]);
});

test("a move on one device and a title on the other keeps both", () => {
  const start = [card("a", { rank: 1000 }), card("b", { rank: 2000 })];
  cards.set(start);
  moveCard("b", "todo", 0);
  const phone = cards();

  const mac = start.map((c) => (c.id === "a" ? { ...c, title: "Mac 写的标题", updatedAt: 40, stamps: { title: 40 } } : c));
  const merged = mergeBoards(mac, phone).sort((x, y) => x.rank! - y.rank!);
  expect(merged.map((c) => c.id)).toEqual(["b", "a"]);
  expect(merged.find((c) => c.id === "a")!.title).toBe("Mac 写的标题");
});
