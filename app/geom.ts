import { cards, type Status } from "./data";

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

type Ref = { measure(): Promise<{ pagePosition: { x: number; y: number } } | null> } | undefined;

/**
 * Board geometry, kept outside the components so a drag survives every render:
 * the board's page origin, each column's scroll offset, and where each card
 * sits. Handlers read these; never a style, so the drag never re-renders them.
 */
export const boardGeom = {
  /** Column width for the current window, set by the board on each render. */
  colW: 288,
  /** Height of a column's label row, above its first card. */
  headerH: HDR_H,
  left: 0,
  top: 0,
  scrollY: [0, 0, 0, 0],
  ref: undefined as Ref,
  rows_: new Map<string, { status: Status; y: number; h: number }>(),
  setRow(id: string, row: { status: Status; y: number; h: number }) {
    this.rows_.set(id, row);
  },
  /** Rows still on the board, in the columns that hold them now. */
  rows(): { id: string; status: Status; y: number; h: number }[] {
    const live = new Set(cards().map((c) => c.id));
    for (const id of [...this.rows_.keys()]) if (!live.has(id)) this.rows_.delete(id);
    return [...this.rows_.entries()].map(([id, r]) => ({ id, ...r }));
  },
};

export function measureBoard() {
  boardGeom.ref?.measure().then((m) => {
    if (!m) return;
    boardGeom.left = m.pagePosition.x;
    boardGeom.top = m.pagePosition.y;
  });
}
