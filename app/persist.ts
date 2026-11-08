import { Storage, effect, lifecycle } from "nsh";
import process from "process";
import { Board } from "app/native";
import { changed, forgetOrder, orderChanges, orderOf, stampOf } from "./changes";
import { board, boardTags, COLUMNS, cards, seedRanks, tags, type Card, type Tag } from "./data";

/**
 * The board's file, and the only place the interface writes it.
 *
 * The whole board lives in SQLite, through the crate: `hydrate` reads it once at
 * launch, and `startPersist` writes each change a third of a second after the
 * user makes it. A board of a thousand cards is a few hundred kilobytes, so a
 * change is written as the handful of rows that changed rather than the file.
 *
 * Saves are debounced because a keystroke in a title is a change: without the
 * wait, typing a sentence would write the row thirty times. Leaving the app is
 * the one moment the wait is not allowed, so the lifecycle flushes instead.
 *
 * **A stamp is the record of a write.** A row is written when its `id` and
 * `updatedAt` differ from the last time it was written; nothing else is
 * compared, for the same reason the merge is per card — a JSON comparison
 * reports a change that did not happen.
 */

/** `"0"` keeps the board in memory: a test must not reach the user's board. */
const OFF_KEY = "navigator.persist";
/** How long a change waits for its neighbours before the row is written. */
const SAVE_MS = 300;
/** A write the file refused is tried again after this. */
const RETRY_MS = 2000;

/** Whether the board has a file at all. */
let onDisk = false;
/** Whether this launch has opened the store: a board in memory is emptied once,
 * not on every read of it. */
let opened = false;

/** What is in the file, by list and id. */
const savedCard = new Map<string, string>();
const savedTag = new Map<string, string>();
/** What the Mac has already been told, by list and id. */
const sentCard = new Map<string, string>();
const sentTag = new Map<string, string>();
/** Each column's order as the file has it, so an unchanged column is not written. */
const savedOrder = new Map<string, string>();

/** Marks the board on screen as written: the launch baseline. */
export function rememberBoard(): void {
  for (const card of cards()) savedCard.set(card.id, stampOf(card));
  for (const tag of tags()) savedTag.set(tag.id, stampOf(tag));
  for (const column of COLUMNS) savedOrder.set(column.id, orderOf(cards(), column.id));
}

/**
 * Rows that came out of the file, so they are already written there.
 *
 * Only the stamps are recorded, never the column orders: a card the phone moved
 * changes the order this Mac shows, and the Mac still has to write that order
 * to its own file. Marking it written here would lose the move at the next
 * launch.
 */
export function rememberRows(fresh: { cards: Card[]; tags: Tag[] }): void {
  for (const card of fresh.cards) savedCard.set(card.id, stampOf(card));
  for (const tag of fresh.tags) savedTag.set(tag.id, stampOf(tag));
}

/**
 * Writes what changed, now. Returns whether the file took everything: a save
 * that failed keeps its rows unwritten, and `sync` must not then treat them as
 * already stored.
 *
 * The store is written either way, on disk or in memory: a test gets the same
 * SQL and the same JSON, just somewhere that is thrown away.
 */
export function flush(): boolean {
  const freshCards = changed(cards(), savedCard, true);
  const freshTags = changed(tags(), savedTag, true);
  const order = orderChanges(cards(), savedOrder);

  if (!freshCards.length && !freshTags.length && !Object.keys(order).length) return true;
  try {
    Board.save(JSON.stringify({ cards: freshCards, tags: freshTags, order }));
    return true;
  } catch {
    // A full disk or a moved directory: forget the stamps so the rows are
    // written again, and come back to them rather than losing the edit.
    for (const card of freshCards) savedCard.delete(card.id);
    for (const tag of freshTags) savedTag.delete(tag.id);
    for (const status of Object.keys(order)) forgetOrder(savedOrder, status);
    schedule(RETRY_MS);
    return false;
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;

function schedule(ms: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    flush();
  }, ms);
}

/** What this device has changed and the Mac has not been told, once. */
export function outgoing(): { cards: Card[]; tags: Tag[] } {
  return {
    cards: changed(cards(), sentCard, false),
    tags: changed(tags(), sentTag, false),
  };
}

/** The Mac has these now, so they need not be sent again. */
export function markSent(sent: { cards: Card[]; tags: Tag[] }): void {
  for (const card of sent.cards) sentCard.set(card.id, stampOf(card));
  for (const tag of sent.tags) sentTag.set(tag.id, stampOf(tag));
}

/**
 * Opens the board's file and puts it on screen.
 *
 * A board that has been saved before wins over the sample cards, even when it
 * is empty: the user emptied it, and filling it again would undo that. Only a
 * first run — no file, or one that was never written — is filled with the
 * samples, which is also what gets saved.
 *
 * The read is synchronous once storage has answered, so the window opens on the
 * user's board; the samples it starts with are not what the first frame shows.
 */
export async function hydrate(): Promise<void> {
  let off: string | null = null;
  try {
    off = await Storage.getItem(OFF_KEY);
  } catch {
    // No storage on this host: the board still opens, in memory.
  }
  const wanted = off !== "0";
  const dir = process.dataDir;
  onDisk = wanted && !!dir;
  // Which file this launch is using is the one thing worth logging when a
  // launch on a device has to be explained from `adb logcat`.
  console.log(`[navigator] board dir: ${dir ?? "(none)"}, file: ${onDisk ? "on" : "off"}`);
  try {
    Board.open(onDisk ? dir! : "");
  } catch {
    // A file that cannot be opened must not take the app with it: the board
    // works for this run and the next launch tries the file again.
    onDisk = false;
    Board.open("");
  }
  // A run without a file is not a failure, but it is silent data loss at the
  // next launch, so say so once rather than let it look like a normal start.
  if (wanted && !onDisk) console.log("[navigator] no board file: this run's board is in memory");
  // A board in memory has nothing to carry over from the last launch, so it
  // starts empty — once per launch. That is also what keeps one test app's
  // board out of the next one's: the store is one per process, and every test
  // app is a launch.
  if (!onDisk && !opened) Board.clear();
  opened = true;

  const loaded = JSON.parse(Board.load()) as { cards: Card[]; tags: Tag[]; seeded: boolean };
  if (loaded.seeded) {
    cards.set(loaded.cards);
    tags.set(loaded.tags);
  } else {
    // A first run: the samples are what the app starts with, and they are what
    // the file is written from — so the next launch opens on the same board.
    Board.save(JSON.stringify({ cards: cards(), tags: tags() }));
  }
  rememberBoard();
  // A column's order is its cards' ranks, and a board written before that was
  // true has none. Each card is given the place it already shows, with the
  // lowest stamp a field can carry, so nothing looks edited for it and the
  // user's next move beats it. It is one `cards.set`, so the debounce below
  // writes the whole board once instead of a row at a time.
  const ranked = seedRanks(cards());
  if (ranked) cards.set(ranked);
  // The one line that answers "did this launch read the user's board or the
  // samples", which is otherwise impossible to tell from the window when the
  // board happens to look like the samples.
  console.log(
    `[navigator] board: ${loaded.seeded ? "read" : "first run"}, ` +
      `${board().length} cards, ${boardTags().length} tags`,
  );
}

/** Writes every change from now on; called once, by the app. */
export function startPersist(): void {
  effect(() => {
    cards();
    tags();
    schedule(SAVE_MS);
  });
  // Backgrounding or quitting is not a change: it is the deadline the debounce
  // was waiting for, so the last keystroke is not the one that is lost.
  effect(() => {
    if (lifecycle() !== "active") flush();
  });
}
