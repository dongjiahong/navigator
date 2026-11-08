import type { Card, Tag } from "./data";
import { fieldStamp, fieldValue, MERGE_FIELDS, tieKey } from "./fields";

/**
 * The merge is the part of sync that has to be right, and it is pure: both
 * devices hold the whole board and reconcile per card, field by field.
 *
 * A card used to be one item with one stamp, so the newer copy won whole: the
 * title typed on the Mac and the 完成 pressed on the phone in the same minute
 * left one of the two on the floor. Each field carries its own stamp now, and
 * the two copies are taken apart and put back together field by field — the
 * newer title, the newer status, the newer note, all on one card.
 *
 * The same rules are implemented in the crate, in `board::merge_cards`, because
 * the Mac merges what the phone sends before it answers. `merge-cases.json`
 * holds the cases both implementations are held to, so the two cannot drift.
 *
 * It lives apart from `sync.ts` so it can be tested without a native module.
 */

/** Anything the two devices exchange: a card, a tag. Both merge by id and stamp. */
type Stamped = { id: string; updatedAt?: number };

/**
 * Two copies of one card, reconciled per field.
 *
 * The field is taken from whichever copy wrote it last; a field both wrote at
 * the same millisecond is decided by the larger JSON text of the two values, so
 * the answer is the same whichever device asks. `updatedAt` of the result is the
 * newest thing on either copy, which is what keeps the row-level answers ("has
 * this row changed", "send me everything since X") true for a field-level edit.
 */
export function mergeCard(a: Card, b: Card): Card {
  // Everything the merge does not decide — the id, and any field this version
  // does not know — comes from the newer copy.
  const merged: Record<string, unknown> = { ...((b.updatedAt ?? 0) > (a.updatedAt ?? 0) ? b : a) };
  const stamps: Record<string, number> = {};
  let newest = Math.max(a.updatedAt ?? 0, b.updatedAt ?? 0);

  for (const field of MERGE_FIELDS) {
    const sa = fieldStamp(a, field);
    const sb = fieldStamp(b, field);
    let value: unknown;
    let stamp: number;
    if (sa > sb) {
      value = fieldValue(a, field);
      stamp = sa;
    } else if (sb > sa) {
      value = fieldValue(b, field);
      stamp = sb;
    } else {
      // The same stamp is the ordinary case of the same value written once. It
      // is only a real tie when the two values differ, and then a rule both
      // devices run is what keeps them from flipping the board back and forth.
      const va = fieldValue(a, field);
      const vb = fieldValue(b, field);
      value = tieKey(va) >= tieKey(vb) ? va : vb;
      stamp = sa;
    }
    // An absent field is absent, not `null`: the card is written back to the
    // file and to the other device exactly as it would have been without it.
    if (value === undefined) delete merged[field];
    else merged[field] = value;
    stamps[field] = stamp;
    newest = Math.max(newest, stamp);
  }

  merged.stamps = stamps;
  merged.updatedAt = newest;
  return merged as Card;
}

/**
 * Merge two lists, per item, newest `updatedAt` wins. Tombstones are ordinary
 * items here: a `deleted` copy with the newer stamp simply wins, which is what
 * keeps a removal removed.
 *
 * Tags merge this way still — a tag is a name and a colour, and there is no
 * second device editing half of one.
 */
export function mergeById<T extends Stamped>(local: T[], remote: T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of local) byId.set(item.id, item);
  for (const item of remote) {
    const mine = byId.get(item.id);
    if (!mine || (item.updatedAt ?? 0) >= (mine.updatedAt ?? 0)) byId.set(item.id, item);
  }
  // Keep the local order for items both sides know, then append the rest.
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of local) {
    const winner = byId.get(item.id);
    if (winner && !seen.has(item.id)) {
      out.push(winner);
      seen.add(item.id);
    }
  }
  for (const item of remote) {
    if (!seen.has(item.id)) {
      const winner = byId.get(item.id)!;
      out.push(winner);
      seen.add(item.id);
    }
  }
  return out;
}

/**
 * Cards, per card and per field. The order is the local one with the cards only
 * the other side knows appended, which no view reads: a column's order is its
 * cards' ranks, not the order of this array.
 */
export function mergeBoards(local: Card[], remote: Card[]): Card[] {
  const byId = new Map<string, Card>();
  for (const card of remote) byId.set(card.id, card);
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const card of local) {
    const theirs = byId.get(card.id);
    out.push(theirs ? mergeCard(card, theirs) : card);
    seen.add(card.id);
  }
  for (const card of remote) {
    if (!seen.has(card.id)) {
      out.push(card);
      seen.add(card.id);
    }
  }
  return out;
}

/** The tag list the same way: a renamed or removed tag does not come back. */
export function mergeTags(local: Tag[], remote: Tag[]): Tag[] {
  return mergeById(local, remote);
}

/**
 * Whether two lists are the same list. Compared per item by identity and
 * stamp, never by JSON text: the server re-serializes objects with sorted keys,
 * so a string comparison reports a change on every tick and the resulting
 * `cards.set` would re-render the board under the user's finger.
 *
 * A field-level merge always raises `updatedAt` to the newest stamp it decided
 * on, so a card whose title came from the other device reads as changed here
 * even though the title itself is not part of the comparison.
 */
export function sameById<T extends Stamped>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((item) => [item.id, item]));
  for (const item of a) {
    const other = byId.get(item.id);
    if (!other) return false;
    if ((other.updatedAt ?? 0) !== (item.updatedAt ?? 0)) return false;
    if (!!(other as { deleted?: boolean }).deleted !== !!(item as { deleted?: boolean }).deleted) return false;
  }
  return true;
}

/** Whether two boards are the same board. */
export function sameBoard(a: Card[], b: Card[]): boolean {
  return sameById(a, b);
}
