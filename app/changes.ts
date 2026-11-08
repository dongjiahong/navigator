import { COLUMNS, type Card, type Tag } from "./data";

/**
 * What changed, and what has not.
 *
 * The board is written and sent by the rows that changed, not by the whole
 * board, and "changed" has one definition: the row's stamp and whether it is a
 * tombstone differ from the last time it was written (or sent). Nothing here
 * compares JSON: the engine re-serializes objects with sorted keys, so a text
 * comparison reports a change that did not happen, and writing on every tick
 * would put the database in the way of the user's typing.
 *
 * Pure functions over the lists, so they can be tested without a store.
 */

/** A row's identity for "did this change". */
export function stampOf(row: Card | Tag): string {
  return `${row.updatedAt ?? 0}:${row.deleted ? 1 : 0}`;
}

/**
 * The rows whose id and stamp are not in `seen`. With `remember`, they are
 * recorded as seen — the caller then owns the write, and un-records them if it
 * fails.
 */
export function changed<T extends Card | Tag>(all: readonly T[], seen: Map<string, string>, remember: boolean): T[] {
  const out: T[] = [];
  for (const row of all) {
    const stamp = stampOf(row);
    if (seen.get(row.id) === stamp) continue;
    if (remember) seen.set(row.id, stamp);
    out.push(row);
  }
  return out;
}

/** A column's live cards, ids in the order the board shows them. */
export function orderOf(all: readonly Card[], status: string): string {
  const out: string[] = [];
  for (const card of all) {
    if (card.status === status && !card.deleted) out.push(card.id);
  }
  return out.join(",");
}

/**
 * The columns whose card order moved, each as its full list of ids: one card
 * moving renumbers every card after it, so a half-order would place it wrong.
 *
 * `seen` is updated with the columns it returns, so an order is written once.
 */
export function orderChanges(all: readonly Card[], seen: Map<string, string>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const column of COLUMNS) {
    const joined = orderOf(all, column.id);
    if (seen.get(column.id) === joined) continue;
    seen.set(column.id, joined);
    // A column with no cards has no order to write: the rows it had are gone.
    if (joined) out[column.id] = joined.split(",");
  }
  return out;
}

/** Forgets an order the store refused, so the next flush writes it again. */
export function forgetOrder(seen: Map<string, string>, status: string): void {
  seen.delete(status);
}
