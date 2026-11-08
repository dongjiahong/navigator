import { effect } from "nsh";
import { Dock } from "app/native";
import { attentionCount, board } from "./data";

/** How often the count is read again while nothing on the board changes. */
const TICK_MS = 60_000;

/**
 * The number on the Mac's Dock icon.
 *
 * The board is a window that is often behind another window, and a glance at the
 * Dock is all the attention it gets while work is going on elsewhere. The count
 * is the board's own — late, or due today, and still open — so the badge and the
 * red and amber pills say the same thing; `attentionCount` is the one place that
 * decides it.
 *
 * Nothing waits for this. The badge is a decoration on a glance: it is written
 * after the board changed, it is a no-op on the phone and in a test process, and
 * a refused one changes nothing about the board.
 */
export function startBadge(): void {
  /** The number the icon carries, so an unchanged board does not write twice. */
  let shown = -1;
  const apply = () => {
    const count = attentionCount(board(), Date.now());
    if (count === shown) return;
    shown = count;
    try {
      Dock.setBadge(count);
    } catch {
      // No Dock to badge (Android, a bare test executable): the board is whole
      // without it.
    }
  };
  // Reading the board here, in an effect rather than in a component body, is
  // what keeps the shell from re-rendering on every keystroke (see DESIGN's rule
  // on effects).
  effect(() => {
    board();
    apply();
  });
  // A deadline turns late at its own hour with nobody typing, so the clock alone
  // has to bring the number up to date.
  setInterval(apply, TICK_MS);
  // Said once, at launch. A badge is a decoration on a glance, and a decoration
  // that quietly does nothing is worse than one that is absent: `status` names
  // why when it names one (`no-bundle` under `nsh test`, `unsupported` on the
  // phone, `off-main` if the interface ever leaves the main thread).
  console.log(`[navigator] dock badge: ${Dock.status()}`);
}
