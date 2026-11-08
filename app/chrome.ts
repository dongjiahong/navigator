import { Window, isAvailable as hasWindow, titleBar } from "nsh/desktop";

/**
 * How much of the window's top the platform keeps for itself.
 *
 * With the system title bar hidden, the app draws all the way to the window's
 * top edge and the traffic lights sit on the app's own ground — but AppKit still
 * keeps that strip for dragging, and **a press in it never reaches the app**. A
 * button drawn there is visible and dead, which is how the 新建 button and the
 * panel's close button first shipped.
 *
 * So the layout is in two parts: a spacer of `titleSpacer()` for the platform's
 * chrome, then `HEADER_ROW` of the app's own controls, immediately below it. The
 * band still starts at the window's very top, so the ground runs under the
 * lights and there is no seam; only the controls move down.
 */
const HEADER_ROW = 38;

/** The platform's title bar area: 0 on a phone, and in full screen. */
export function titleSpacer(): number {
  return hasWindow ? titleBar().height : 0;
}

/** A header band's full height, for the board and the panel alike. */
export function headerHeight(): number {
  return titleSpacer() + HEADER_ROW;
}

/**
 * Hides the system's title bar so the app fills the window to its top edge.
 *
 * Without this the window keeps a band of system chrome above the board, which
 * reads as a website in a browser rather than a Mac application. `hasWindow` is
 * false on the phone, where there is no window to style. The height asked for
 * selects AppKit's chrome size; the layout then follows `titleBar().height`,
 * which reports what AppKit actually gave.
 */
export function adoptWindowChrome() {
  if (!hasWindow) return;
  Window.setTitleBar({ style: "hidden", height: headerHeight() });
}
