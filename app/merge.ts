import type { Card, Tag } from "./data";

/**
 * The merge is the part of sync that has to be right, and it is pure: both
 * devices hold the whole board and reconcile per card by `updatedAt`, newest
 * wins, with deletions kept as tombstones.
 *
 * It lives apart from `sync.ts` so it can be tested without a native module.
 */

/** Anything the two devices exchange: a card, a tag. Both merge by id and stamp. */
type Stamped = { id: string; updatedAt?: number };

/**
 * Merge two lists, per item, newest `updatedAt` wins. Tombstones are ordinary
 * items here: a `deleted` copy with the newer stamp simply wins, which is what
 * keeps a removal removed.
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

/** Cards, per card, newest `updatedAt` wins. */
export function mergeBoards(local: Card[], remote: Card[]): Card[] {
  return mergeById(local, remote);
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
