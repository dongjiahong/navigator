import { effect } from "nsh";
import { AUTO_ARCHIVE_DAYS, addCards, cards, type Draft } from "./data";
import { finishedAt, rootId, successorOf, type Successor } from "./repeat";

/**
 * The occurrence a completed repeating card makes.
 *
 * Finishing a card that repeats puts the next one at the foot of 待办 — always,
 * whichever column the press came from, and whether the press was made here or
 * arrived from the phone. So it is a rule over the board rather than a step in a
 * handler: the board is scanned after any change, and every finished repeating
 * card that has not made its next one makes it.
 *
 * Three things follow from that, and each is why it is written this way.
 *
 * **The next card's id is derived, never invented.** `repeat.ts` names it after
 * the card the chain started from and the next deadline, so the Mac and the
 * phone both call the same card the same thing. When they each make it, the
 * merge keeps one.
 *
 * **The next deadline is computed from the card, not from this device's clock.**
 * The `at` is the card's own `status` stamp — the moment it was finished, which
 * both devices agree on after they meet. A clock a few seconds apart would
 * otherwise pick a different occurrence, and the board would hold two.
 *
 * **A tombstone is enough.** A next card the user deleted is a row with that id
 * still on the board, so the rule finds it and makes nothing: deleting a
 * repeated card's next occurrence is the user saying "not this one", and the
 * board must not put it back.
 */

/** How far back a completion is still worth an occurrence: the auto-archive
 *  window, because work older than that has been filed and left alone. */
const WINDOW_MS = AUTO_ARCHIVE_DAYS * 86_400_000;

/**
 * Makes every missing occurrence, and returns the ids it made (none, when the
 * board already agrees with its own completions).
 *
 * Called once at launch — for a card completed while the app was closed, or by
 * the phone while this one slept — and then by the effect below after any change
 * of the board. Both runs are the same call, and a second run over the same
 * board writes nothing.
 */
export function spawnSuccessors(at = Date.now()): string[] {
  const all = cards();
  const known = new Set(all.map((card) => card.id));
  // The roots that already have an occurrence waiting in 待办 or 进行中. A chain
  // is one line of cards, so it has at most one of its own open ahead: without
  // this, moving a finished card's deadline would make a second one — the id
  // would differ because the deadline did.
  const open = new Set<string>();
  for (const card of all) {
    if (card.deleted || (card.status !== "todo" && card.status !== "doing")) continue;
    const root = rootId(card.id);
    if (root !== card.id) open.add(root);
  }
  const wanted: Successor[] = [];
  const cut = at - WINDOW_MS;
  for (const card of all) {
    const finished = finishedAt(card);
    if (finished < cut) continue;
    const next = successorOf(card, finished);
    if (!next || known.has(next.id) || open.has(rootId(card.id))) continue;
    // Every id this pass intends to make counts as known: two cards cannot be
    // the same work, but a pass that made one and then forgot would make it
    // twice.
    known.add(next.id);
    open.add(rootId(card.id));
    wanted.push(next);
  }
  if (!wanted.length) return [];
  const drafts: { card: Draft; id?: string }[] = wanted.map((next) => ({
    id: next.id,
    card: {
      title: next.title,
      notes: next.notes,
      tags: next.tags,
      due: next.due,
      repeat: next.repeat,
      images: next.images,
    },
  }));
  // One write for the whole pass: the board changes once, so the effect that is
  // watching it runs once more and finds nothing left to do.
  return addCards(drafts);
}

/**
 * Starts the rule: once over the board as it was read, then after every change.
 *
 * The effect is why a card completed on the phone makes its next occurrence on
 * the Mac as well — the change arrives, the board changes, the rule runs. It
 * reads `cards()` and writes to it, which is safe here only because the write
 * always removes the reason to run again: a second pass over the same board
 * makes nothing.
 */
export function startRecurrence(): void {
  spawnSuccessors();
  effect(() => {
    cards();
    spawnSuccessors();
  });
}
