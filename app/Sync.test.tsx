import { expect, test } from "nsh/test";
import cases from "./merge-cases.json";
import { mergeBoards, mergeCard, sameBoard } from "./merge";
import { cards, type Card } from "./data";
import { applyEvent, peers, phase, statusLine } from "./sync";

/**
 * The merge, as the two devices run it.
 *
 * A card is reconciled field by field now: the newer of each field survives, so
 * a title typed on the Mac and a 完成 pressed on the phone in the same minute
 * both land. The cases live in `merge-cases.json`, which the crate's own tests
 * read too — the Mac merges what the phone sends before it answers, so the two
 * implementations must agree to the byte.
 */

function card(id: string, patch: Partial<Card> = {}): Card {
  return { id, title: id, notes: "", tags: [], status: "todo", updatedAt: 0, ...patch };
}

/** A value as text with its keys sorted, so two objects compare as data. */
function canon(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source)
    .filter((key) => source[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canon(source[key])}`).join(",")}}`;
}

test("the shared cases merge the same way here and in the crate", () => {
  for (const one of cases.cases) {
    const a = one.a as Card;
    const b = one.b as Card;
    const want = canon(one.merged);
    // Both orders: the merge is a reconciliation, not "the newer board wins",
    // and the device that asks must not change the answer.
    expect(canon(mergeCard(a, b))).toBe(want);
    expect(canon(mergeCard(b, a))).toBe(want);
  }
});

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

/**
 * The case the whole change is for: the Mac types a title while the phone presses
 * 完成 on the same card. Under the old whole-card rule one of the two was on the
 * floor; now both are on the card, on both devices.
 */
test("a title typed on the Mac and a 完成 pressed on the phone both survive", () => {
  const mac = card("a", {
    title: "Mac 写的新标题",
    updatedAt: 20,
    stamps: { title: 20, notes: 1, tags: 1, status: 1, deleted: 1, rank: 1 },
    rank: 1000,
  });
  const phone = card("a", {
    status: "done",
    updatedAt: 30,
    stamps: { title: 1, notes: 1, tags: 1, status: 30, deleted: 1, rank: 1 },
    rank: 1000,
  });

  const onMac = mergeBoards([mac], [phone])[0];
  const onPhone = mergeBoards([phone], [mac])[0];
  for (const merged of [onMac, onPhone]) {
    expect(merged.title).toBe("Mac 写的新标题");
    expect(merged.status).toBe("done");
    // The row's own stamp is the newest thing on either copy, which is what
    // keeps "this row changed" true for a field-level edit.
    expect(merged.updatedAt).toBe(30);
  }
  expect(canon(onMac)).toBe(canon(onPhone));
});

/**
 * A delete is a field, not a vanishing: the other device's edit made after it
 * keeps the card deleted but is not lost — it is inside the tombstone, ready for
 * the undo that brings the card back.
 */
test("a delete keeps the edit that came after it, hidden in the tombstone", () => {
  const deleted = card("a", {
    deleted: true,
    updatedAt: 30,
    stamps: { title: 1, notes: 1, tags: 1, status: 1, deleted: 30, rank: 1 },
    rank: 1000,
  });
  const edited = card("a", {
    notes: "删除之后补的备注",
    updatedAt: 40,
    stamps: { title: 1, notes: 40, tags: 1, status: 1, deleted: 1, rank: 1 },
    rank: 1000,
  });

  const tombstone = mergeBoards([deleted], [edited])[0];
  expect(tombstone.deleted).toBe(true);
  expect(tombstone.notes).toBe("删除之后补的备注");

  // 撤销删除 writes a fresh `deleted` stamp, which is what beats a tombstone.
  const restored = mergeBoards(
    [tombstone],
    [{ ...tombstone, deleted: false, updatedAt: 60, stamps: { ...tombstone.stamps, deleted: 60 } }],
  )[0];
  expect(restored.deleted).toBe(false);
  expect(restored.notes).toBe("删除之后补的备注");
});

test("a card with no field stamps merges as its updatedAt, and gains stamps", () => {
  // Both copies predate field stamps, so every field counts as written at the
  // card's own stamp: the newer card wins the fields they disagree on, which is
  // exactly how the older format merged, and nothing has to be migrated first.
  const old = card("a", { title: "同一个标题", notes: "旧备注", updatedAt: 10 });
  const newer = card("a", { title: "同一个标题", notes: "新的备注", updatedAt: 20 });
  const merged = mergeCard(old, newer);
  expect(merged.title).toBe("同一个标题");
  expect(merged.notes).toBe("新的备注");
  expect(merged.stamps!.title).toBe(20);
  expect(merged.stamps!.notes).toBe(20);
  expect(merged.updatedAt).toBe(20);
});

test("merging moves the row stamp to the newest field it decided on", () => {
  const a = card("a", { updatedAt: 10, stamps: { title: 10 } });
  const b = card("a", { updatedAt: 20, stamps: { tags: 20 } });
  const merged = mergeCard(a, b);
  const stamps = Object.values(merged.stamps!).filter((s): s is number => typeof s === "number");
  expect(merged.updatedAt).toBe(Math.max(a.updatedAt, b.updatedAt, ...stamps));

  // A field stamp is never newer than the row stamp it arrives with: the
  // board's "what changed" answer is the row stamp alone.
  for (const stamp of stamps) expect(stamp).toBeLessThanOrEqual(merged.updatedAt);

  // The same card before the other device's write compares as different, which
  // is how a field-level change reaches the screen at all.
  expect(sameBoard([merged], [a])).toBe(false);
});

/**
 * The crate pushes what a peer answered instead of the app polling a mailbox.
 * The event text is the agreement between the two sides — written in Rust and
 * read here — so these pin the format, not the merge (which has its own tests).
 */
test("a pushed rows event merges into the board on screen", () => {
  const before = cards();
  try {
    cards.set([card("a", { title: "本地", updatedAt: 10 })]);
    applyEvent(
      JSON.stringify({
        type: "rows",
        cards: [card("a", { title: "Mac 上改的", updatedAt: 20 })],
        tags: [],
        at: 20,
        stored: false,
      }),
    );
    expect(cards().map((c) => c.title)).toEqual(["Mac 上改的"]);
    // A body that does not parse is not a change: the next exchange carries the
    // same rows, and a bad event must not empty the board.
    applyEvent("not json");
    expect(cards().map((c) => c.title)).toEqual(["Mac 上改的"]);
  } finally {
    cards.set(before);
  }
});

test("a pushed status event is what the header draws", () => {
  const wasPeers = peers();
  const wasPhase = phase();
  try {
    applyEvent(
      JSON.stringify({
        type: "status",
        status: {
          peers: [{ addr: "10.0.0.5:8787", ok: true, at: 1, typed: false, pair: "ok" }],
          unreachable: false,
          at: 1,
          pair: "ok",
        },
      }),
    );
    expect(peers().length).toBe(1);
    expect(phase()).toBe("synced");
    // Only the part that does not depend on the test host's time zone.
    expect(statusLine().startsWith("已同步")).toBe(true);
  } finally {
    peers.set(wasPeers);
    phase.set(wasPhase);
  }
});
