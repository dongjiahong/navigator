import { cards, COLUMNS, type Status } from "./data";
import { filteredBoard } from "./filters";

export const PAD_X = 16;
export const PAD_Y = 12;
/** Wide enough that the gutter between columns reads as air, not as a grid: it
 *  must exceed PAD_X, or four columns tile the page instead of standing in it. */
export const COL_GAP = 30;
/** A card keeps a readable measure. The window is held above the width where
 *  four columns reach this floor; with the inspector open they compress rather
 *  than move a scrollbar under the board. */
export const COL_MIN = 246;
export const COL_MAX = 336;
export const HDR_H = 38;
/** The narrowest window that shows four columns at COL_MIN without scrolling. */
export const MIN_WINDOW = COL_MIN * 4 + COL_GAP * 3 + PAD_X * 2;

/** A column's list: the air above its first row, the air between two rows, and
 *  the height assumed for a row no cell has measured yet. */
export const ROW_TOP = 2;
export const ROW_GAP = 7;
export const ROW_EST = 92;

type Row = { id: string; status: Status; y: number; h: number };
type Band = { top: number; height: number };

/**
 * Board geometry, kept outside the components so a drag survives every render:
 * the board's page origin, each column's scroll offset, where each column's list
 * sits, and where each card sits. Handlers read these; never a style, so the
 * drag never re-renders them.
 *
 * Everything here comes from `onLayout`, which reports a view's frame inside its
 * *parent*: the board's place in the window, a list's y under a column's label,
 * a cell's height. Neither a `ref` nor a card's own frame helps — a ref is never
 * delivered to a plain `View` on this engine, and inside a list cell a card's
 * origin is always 0 — so a row's y is summed from the heights above it and the
 * list's spacing.
 */
export const boardGeom = {
  /** Column width for the current window, set by the board on each render. */
  colW: 288,
  /** Height of a column's label row, above its first card. */
  headerH: HDR_H,
  /**
   * Where the columns stand, in the window's coordinates: the board's own place
   * plus the offset of the row that holds them.
   *
   * The row is centred once the window is wider than four columns, their
   * gutters and the page margins — a 2560-point window leaves it nearly 550
   * points in. A drop measured from the board alone therefore counted those
   * points as part of the first column, and a card dragged into 进行中 landed in
   * 归档 two columns over. `pageX` / `pageY` are measured from here.
   */
  left: 0,
  top: 0,
  /** The board's origin inside its parent. */
  boardX: 0,
  boardY: 0,
  /** The columns' row inside the board. */
  rowX: 0,
  rowY: 0,
  scrollY: [0, 0, 0, 0],
  bands: new Map<Status, Band>(),
  heights: new Map<string, number>(),
  /** Each column's y inside the board's row, from the column's `onLayout`. */
  columnY: new Map<Status, number>(),
  setOrigin(x: number, y: number) {
    this.boardX = x;
    this.boardY = y;
    this.left = this.boardX + this.rowX;
    this.top = this.boardY + this.rowY;
  },
  setRowOrigin(x: number, y: number) {
    this.rowX = x;
    this.rowY = y;
    this.left = this.boardX + this.rowX;
    this.top = this.boardY + this.rowY;
  },
  setBand(status: Status, band: Band) {
    this.bands.set(status, band);
  },
  setColumn(status: Status, y: number) {
    this.columnY.set(status, y);
  },
  setRow(id: string, row: { status: Status; y: number; h: number }) {
    if (row.h > 0) this.heights.set(id, row.h);
  },
  /** Where a column's list viewport starts, in the window's coordinates. */
  bandTop(status: Status): number {
    return this.top + (this.columnY.get(status) ?? 0) + (this.bands.get(status)?.top ?? HDR_H);
  },
  /** The height a column's list shows, once it has been laid out. */
  bandHeight(status: Status): number {
    return this.bands.get(status)?.height ?? 0;
  },
  /** Rows still on the board, each with its place in its column's content. */
  rows(): Row[] {
    const gone = new Set(cards().filter((c) => c.deleted).map((c) => c.id));
    for (const id of [...this.heights.keys()]) if (gone.has(id)) this.heights.delete(id);
    // The list draws the filtered board in its order, so the rows are summed in
    // that order: a column's y values are only right while they follow what is
    // actually stacked there.
    const shown = filteredBoard();
    const out: Row[] = [];
    for (const col of COLUMNS) {
      let y = ROW_TOP;
      for (const card of shown) {
        if (card.status !== col.id) continue;
        const h = this.heights.get(card.id) ?? ROW_EST;
        out.push({ id: card.id, status: col.id, y, h });
        y += h + ROW_GAP;
      }
    }
    return out;
  },
};
