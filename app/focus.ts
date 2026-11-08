import type { ListRef } from "nsh";
import { signal } from "nsh";
import { COLUMNS, moveCard, type Card, type Status } from "./data";
import { filteredBoard } from "./filters";

/**
 * The board's keyboard cursor.
 *
 * A Mac is driven from the keyboard, and PRODUCT.md promises no action that
 * needs a mouse. The cursor is a card, plus where it sits — its column and its
 * row — rather than just an id: when the card it is on is deleted, completed
 * into another column or filtered out, the row it held is what names the card
 * to fall back to, so the next arrow key still moves from where the user was
 * rather than from nothing.
 *
 * All of it lives outside the components, for the same reason the drag does: a
 * cursor kept in a component body is reset on every render, and the board
 * re-renders on every keystroke elsewhere in the app.
 */
export type Focus = { id: string; status: Status; index: number };

export const focus = signal<Focus | null>(null);

export function focusId(): string | null {
  return focus()?.id ?? null;
}

/** The cursor's card, if the board still shows it. */
export function focusedCard(): Card | null {
  const id = focusId();
  return id ? filteredBoard().find((c) => c.id === id) ?? null : null;
}

/** The lists, by column: a cursor that leaves the viewport moves its list. */
export const lists = new Map<Status, ListRef>();

/**
 * The cards each list reports as on screen. A cursor movement to a card that is
 * already visible must not scroll anything: `scrollToIndex` would jump the
 * column under a reader who is walking down it with the arrow keys.
 */
const onScreen = new Map<Status, Set<string>>();

export function noteViewable(
  status: Status,
  changed: readonly { item: Card; isViewable: boolean }[],
): void {
  let set = onScreen.get(status);
  if (!set) onScreen.set(status, (set = new Set()));
  for (const item of changed) {
    if (item.isViewable) set.add(item.item.id);
    else set.delete(item.item.id);
  }
}

function columns(): Card[][] {
  const all = filteredBoard();
  return COLUMNS.map((c) => all.filter((x) => x.status === c.id));
}

/** The card at `row` of `col`, clamped to the column; `null` when it has none. */
function at(cols: Card[][], col: number, row: number): Focus | null {
  const c = Math.max(0, Math.min(COLUMNS.length - 1, col));
  const list = cols[c];
  if (!list || list.length === 0) return null;
  const i = Math.max(0, Math.min(row, list.length - 1));
  return { id: list[i].id, status: COLUMNS[c].id, index: i };
}

export type Direction = "up" | "down" | "left" | "right";

/**
 * One step of the cursor: up and down within a column, left and right into the
 * column beside it at the same row (or its last card, when it is shorter). The
 * first press from nowhere lands on the top card of 待办.
 */
export function moveFocus(dir: Direction): void {
  const cols = columns();
  const f = focus();
  let col = 0;
  let row = -1;
  if (f) {
    col = Math.max(0, COLUMNS.findIndex((c) => c.id === f.status));
    // The card's real row when it is still there, its remembered one when not.
    const found = cols[col].findIndex((c) => c.id === f.id);
    row = found >= 0 ? found : f.index;
  }
  if (dir === "up") row -= 1;
  else if (dir === "down") row += 1;
  else if (dir === "left") col -= 1;
  else col += 1;

  const next = at(cols, col, Math.max(0, row));
  if (!next) return; // nothing there: the cursor stays where it was
  focus.set(next);
  reveal(next, dir);
}

/** Puts the cursor on a card — the one a press opened, or the one a key moved. */
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
 * deleted, or filtered out by a search — keeps the *place*: the card now in
 * that row takes the cursor. That is what walking a column with Space means:
 * finish the top card and the next Space finishes the one that moved up,
 * instead of following the finished card into 已完成 and undoing the work. Only
 * when the whole column is gone does the cursor take the nearest one that has
 * cards, so the keys keep working on a board filtered down to nothing.
 *
 * A card that merely moved row inside its column (deleted above it) takes its
 * new row, so the cursor stays on the same card.
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
  let next = at(cols, home, f.index) ?? at(cols, home, 0);
  for (let step = 1; step < COLUMNS.length && !next; step += 1) {
    next = at(cols, home + step, 0) ?? at(cols, home - step, 0);
  }
  focus.set(next);
}

/**
 * Moves the cursor's card one column sideways, to the end of that column.
 *
 * This is the keyboard's drag, and it keeps the drag's bargain: the card is not
 * offered back, because the opposite key puts it where it was. `Cmd+[` and
 * `Cmd+]` are the only way to move a card with no pointer at all, so they have
 * to move it to a place the user can predict — the end of the target column,
 * which is where a drop below the last card lands it.
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
  reveal(next, step > 0 ? "right" : "left");
}

/**
 * Brings the cursor's card into view, and only when it is out of view: a list
 * that scrolls on every arrow key turns a walk down a column into a panting
 * single line. The card lands against the edge it came from, so one keypress
 * reads as one row of movement.
 */
export function reveal(f: Focus, dir: Direction): void {
  const list = lists.get(f.status);
  if (!list) return;
  if (onScreen.get(f.status)?.has(f.id)) return;
  list.scrollToIndex({
    index: f.index,
    animated: false,
    viewPosition: dir === "down" ? 1 : dir === "up" ? 0 : 0.5,
  });
}
