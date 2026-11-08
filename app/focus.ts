import type { ListRef } from "nsh";
import { signal } from "nsh";
import { COLUMNS, moveCard, type Card, type Status } from "./data";
import { filteredBoard } from "./filters";
import { boardGeom } from "./geom";

/**
 * The board's keyboard cursor.
 *
 * A Mac is driven from the keyboard, and PRODUCT.md promises no action that
 * needs a mouse. The cursor is a card, plus where it sits — its column and its
 * row — rather than just an id: when the card it is on is completed away,
 * deleted or filtered out, the row it held is what names the card that takes
 * over, so the next key still moves from where the reader was.
 *
 * All of it lives outside the components, for the same reason the drag does: a
 * cursor kept in a component body is reset on every render, and the board
 * re-renders on every keystroke elsewhere in the app.
 */
export type Focus = { id: string; status: Status; index: number };

export type Direction = "up" | "down" | "left" | "right";

export const focus = signal<Focus | null>(null);

/** The columns' lists, for bringing a card the keys reached into view. */
export const lists = new Map<Status, ListRef>();

export function focusId(): string | null {
  return focus()?.id ?? null;
}

/** The cursor's card, while the board still shows it. */
export function focusedCard(): Card | null {
  const id = focusId();
  return id ? filteredBoard().find((c) => c.id === id) ?? null : null;
}

/** The columns as they show, in the palette's order. */
function columns(): Card[][] {
  const all = filteredBoard();
  return COLUMNS.map((c) => all.filter((x) => x.status === c.id));
}

/** The card at `row` of column `col`, both clamped; `null` when it has none. */
function at(cols: Card[][], col: number, row: number): Focus | null {
  const c = Math.max(0, Math.min(COLUMNS.length - 1, col));
  const list = cols[c];
  if (!list || list.length === 0) return null;
  const i = Math.max(0, Math.min(row, list.length - 1));
  return { id: list[i].id, status: COLUMNS[c].id, index: i };
}

/**
 * One step of the cursor: up and down inside a column, left and right into the
 * column beside it at the same row — or at its last card, when it is shorter.
 * The first press from nowhere lands on 待办's first card.
 */
export function moveFocus(dir: Direction): void {
  const cols = columns();
  const f = focus();
  // From nowhere, a down or a right lands on the first card; the other two have
  // nowhere to go and leave the board alone.
  let col = 0;
  let row = 0;
  if (f) {
    col = Math.max(0, COLUMNS.findIndex((c) => c.id === f.status));
    // The card's real row while it is there, the remembered one once it is not.
    const found = cols[col].findIndex((c) => c.id === f.id);
    row = found >= 0 ? found : f.index;
  } else {
    row = -1;
  }
  if (dir === "up") row -= 1;
  else if (dir === "down") row += 1;
  else if (dir === "left") col -= 1;
  else col += 1;

  const next = at(cols, col, Math.max(0, row));
  if (!next) return; // nothing there: the cursor stays where it was
  focus.set(next);
  reveal(next);
}

/**
 * Puts the cursor away without moving it anywhere else.
 *
 * A press with the pointer is not the keyboard: a card clicked and then closed
 * kept the cursor's pressed-paper fill for good, because opening it from the
 * board also set the cursor on it. The cursor is the *keyboard's* mark, so a
 * pointer press takes it away and the next arrow key brings it back — from the
 * top of 待办, where the keys start when they have no card of their own.
 */
export function clearFocus(): void {
  if (focus() !== null) focus.set(null);
}

/** Puts the cursor on a card — the one the keyboard opened, or the palette did. */
export function adopt(id: string): void {
  const cols = columns();
  for (let c = 0; c < cols.length; c++) {
    const i = cols[c].findIndex((x) => x.id === id);
    if (i >= 0) {
      focus.set({ id, status: COLUMNS[c].id, index: i });
      return;
    }
  }
}

/**
 * Keeps the cursor true after the board changed under it.
 *
 * A cursor on a card that left its column — completed into 已完成, archived,
 * deleted, or filtered out by a search — keeps the *place*: the card now in that
 * row takes the cursor. That is what walking a column with Space means: finish
 * the top card and the next Space finishes the one that moved up, rather than
 * following the finished card into 已完成 and undoing the work. Only when the
 * column is empty does the cursor take the nearest one that has cards, so the
 * keys still work on a board filtered down to nearly nothing.
 *
 * A card that only moved row inside its column (one above it was deleted) takes
 * its new row, so the cursor stays on the same card.
 */
export function keepFocus(): void {
  const f = focus();
  if (!f) return;
  const cols = columns();
  const home = Math.max(0, COLUMNS.findIndex((c) => c.id === f.status));
  const row = cols[home].findIndex((c) => c.id === f.id);
  if (row >= 0) {
    if (row !== f.index) focus.set({ id: f.id, status: f.status, index: row });
    return;
  }
  const row0 = Math.min(f.index, Math.max(0, cols[home].length - 1));
  let next = at(cols, home, row0);
  for (let step = 1; step < COLUMNS.length && !next; step += 1) {
    next = at(cols, home + step, 0) ?? at(cols, home - step, 0);
  }
  focus.set(next);
}

/**
 * Moves the cursor's card one column sideways, to the end of that column.
 *
 * This is the keyboard's drag, and it keeps the drag's bargain: no 撤销 offer,
 * because the opposite key puts the card back. Cmd+[ and Cmd+] are the only way
 * to move work with no pointer at all, so they have to land it somewhere the
 * user can predict — the end of the target column, where a drop below the last
 * card puts it.
 */
export function shiftFocus(step: number): void {
  const card = focusedCard();
  if (!card) return;
  const from = COLUMNS.findIndex((c) => c.id === card.status);
  const to = from + step;
  if (to < 0 || to >= COLUMNS.length) return;
  const status = COLUMNS[to].id;
  const end = filteredBoard().filter((c) => c.status === status).length;
  moveCard(card.id, status, end);
  const cols = columns();
  const row = Math.max(0, cols[to].findIndex((c) => c.id === card.id));
  const next = { id: card.id, status, index: row };
  focus.set(next);
  reveal(next);
}

/**
 * Moves the cursor's card into view, and only when it is not already there in
 * full: a column that recentres itself on every arrow key turns a walk down it
 * into a panting single line. The card lands against the edge it was walking
 * towards, so one keypress reads as one row of movement.
 *
 * It settles rather than making one guess. A card below the fold has never been
 * laid out, so its height is the estimate until it first appears, and the first
 * scroll is short by however much the real card differs from the guess. Two
 * passes later the heights are real and the card is where it belongs; a pass on
 * a card already in view scrolls nothing.
 */
export function reveal(f: Focus, pass = 0): void {
  const list = lists.get(f.status);
  const idx = COLUMNS.findIndex((c) => c.id === f.status);
  const view = boardGeom.bandHeight(f.status);
  if (!list || idx < 0 || view <= 0) return;
  const row = boardGeom.rows().find((r) => r.id === f.id);
  if (!row) return;
  const current = boardGeom.scrollY[idx];
  // A few points of air, so the card does not arrive flush against the edge.
  const top = Math.max(0, row.y - 4);
  const bottom = row.y + row.h + 4;
  if (top >= current && bottom <= current + view) return;
  list.scrollToOffset({ offset: top < current ? top : Math.max(top, bottom - view) });
  if (pass < 2) setTimeout(() => reveal(f, pass + 1), 60);
}
