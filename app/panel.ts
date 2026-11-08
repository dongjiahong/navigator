/**
 * The open card's panel, as numbers.
 *
 * The panel is the one surface in the app that is sized by the window rather
 * than by its content, and the note inside it is the one field whose height is
 * not its text's: it takes whatever the panel has left. Both are arithmetic, so
 * both live here and are tested without a window — the engine reports no view
 * frames to a test, and "the note is the body of the panel" is a claim about
 * these numbers.
 */

/** Wide enough for a note at a comfortable measure, small enough to float. */
export const PANEL_MAX_W = 560;
/** Tall enough for a paragraph with the meta strip over it. */
export const PANEL_MAX_H = 720;
export const PANEL_MIN_W = 300;
export const PANEL_MIN_H = 320;

/** The panel's own size for a window this big. */
export function panelSize(window: { width: number; height: number }): { width: number; height: number } {
  return {
    width: Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, window.width - 80)),
    height: Math.max(PANEL_MIN_H, Math.min(PANEL_MAX_H, window.height - 96)),
  };
}

/**
 * The note's height before its box has been measured.
 *
 * `Input` has no height of its own, and the box around the note is `flex: 1`,
 * so the field's height is read back from the layout once the panel exists. The
 * first frame has no number yet, and a field of zero height that fills in a
 * moment later reads as a flicker, so it starts at a share of the panel: a
 * little under half of it, which is where the measured box lands for a one-line
 * title.
 */
export function noteShare(panelHeight: number): number {
  return Math.max(120, Math.round(panelHeight * 0.42));
}
