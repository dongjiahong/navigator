import { cleanup, effect, platform } from "nsh";
import { Application, Tray, currentWindow, isAvailable as hasWindow } from "nsh/desktop";
import { statusLine } from "./sync";

/**
 * The Mac keeps serving with its window out of the way.
 *
 * Sync runs in the app's own process — there is no daemon to install — so
 * quitting the app is what stops a Mac from serving. Closing the window and
 * quitting used to be the same thing, which made "the Mac is in step while the
 * app is open" the honest description. On macOS the window now hides instead,
 * with a menu-bar icon that brings it back and is the way to quit: the Mac is in
 * step while the app is running, which is what the user means by leaving it
 * open.
 *
 * Only the desktop app has a window to hide and a menu bar to sit in; on a phone
 * this does nothing, and closing the app there still stops it syncing — Android
 * freezes a backgrounded app on its own schedule, which no app-side flag can
 * override.
 */

/** The menu-bar glyph: a compass, drawn as a template on macOS so the menu bar
 * paints it in its own text colour in either appearance. */
const ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
      '<g fill="none" stroke="#000" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">' +
      '<circle cx="12" cy="12" r="8.4"/>' +
      '<path d="M15.7 8.3l-2.15 5.25-5.25 2.15 2.15-5.25z"/>' +
      "</g></svg>",
  );

/**
 * Hides the main window on close instead of quitting, and puts the app in the
 * menu bar. Call it once, from the root component's body (a window is only
 * there while a component renders).
 */
export function keepServing(): void {
  if (!hasWindow || platform.os !== "macos") return;
  let win;
  try {
    win = currentWindow();
  } catch {
    return;
  }

  // The close press still arrives — nsh just does not act on it — so closing
  // the window is hide, and the app (and the port it serves on) stays alive.
  win.set({ closeOnPress: false });
  const stop = win.on("closePress", () => win.hide());
  const show = () => {
    win.show();
    win.focus();
  };

  // The status is in the menu because that is where a hidden app is read: a
  // wrong code or a Mac that is no longer reachable is visible without opening
  // the window the user just closed.
  effect(() => {
    const line = statusLine();
    Tray.set({
      icon: ICON,
      tooltip: `Navigator · ${line}`,
      onClick: show,
      menu: [
        { label: "打开 Navigator", onSelect: show },
        { type: "separator" },
        { label: line, disabled: true },
        { type: "separator" },
        // The one way out with the window closed (⌘Q also works while the app
        // has the keyboard).
        { label: "退出 Navigator", onSelect: () => Application.quit() },
      ],
    });
  });

  cleanup(() => {
    stop();
    Tray.set(null);
    win.set({ closeOnPress: true });
  });
}
