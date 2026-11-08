import type { Card, Stamps } from "./data";

/**
 * The card's fields, and when each was last written.
 *
 * A card used to be one thing to the merge: the copy with the newer `updatedAt`
 * won whole, so a title typed on the Mac and a 完成 pressed on the phone in the
 * same minute lost one of the two. Each field now carries its own stamp, and two
 * copies are reconciled field by field — the newer one of each survives.
 *
 * `id` is not in the list: it is the key, not a value. Everything else a card
 * holds is, including `deleted` (a delete is a field written on the card, not a
 * card that vanished) and `rank` (where the card sits in its column).
 */
export type MergeField = "title" | "notes" | "tags" | "due" | "status" | "deleted" | "rank";

/** Every mergeable field, in the order this file writes them down. */
export const MERGE_FIELDS: readonly MergeField[] = [
  "title",
  "notes",
  "tags",
  "due",
  "status",
  "deleted",
  "rank",
];

/**
 * When a field was last written.
 *
 * A card written before fields had stamps of their own has only `updatedAt`,
 * and that is what all of its fields answer: the older format merges exactly as
 * it did, and the first write to any field gives that field the stamp it
 * should have had.
 */
export function fieldStamp(card: Card, field: MergeField): number {
  const own = card.stamps?.[field];
  return typeof own === "number" ? own : card.updatedAt ?? 0;
}

/**
 * A field's value with "absent" spelled the one way both sides can compare.
 *
 * `deleted` is read as a boolean: a card that has never been deleted and one
 * that says `deleted: false` are the same card, and a merge that treated them
 * as different would hand every card a first edit it never had.
 */
export function fieldValue(card: Card, field: MergeField): unknown {
  const raw = (card as unknown as Record<string, unknown>)[field];
  return field === "deleted" ? !!raw : raw;
}

/** Every field stamped at one moment: a card is written whole when it is made. */
export function allFields(stamp: number): Stamps {
  const stamps: Stamps = {};
  for (const field of MERGE_FIELDS) stamps[field] = stamp;
  return stamps;
}

/**
 * Two field values as the text the tie between two equal stamps is decided on.
 *
 * A tie means both devices wrote the same field at the same millisecond, which
 * happens across two clocks only by accident — but it must still end the same
 * way on both, or the board would flip each time two copies met. The larger
 * text wins; `null` stands for "no value", so an absent deadline and one side's
 * absence compare the same way everywhere.
 *
 * The two implementations agree on the text because a value here is a string, a
 * boolean, a number or a list of strings: both print a whole number without a
 * decimal point, and both print an array in its own order.
 */
export function tieKey(value: unknown): string {
  const text = JSON.stringify(value);
  return text === undefined ? "null" : text;
}
