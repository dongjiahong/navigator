import { Storage, platform, signal } from "nsh";
import { Board, Sync } from "app/native";
import { cards, tags, type Card, type Tag } from "./data";
import { mergeBoards, mergeTags, sameBoard, sameById } from "./merge";
import { flush, markSent, outgoing, rememberRows } from "./persist";

export { mergeBoards, mergeTags, sameBoard } from "./merge";

/**
 * Sync keeps the Mac and the phone on the same board.
 *
 * The Mac *is* the server: its Rust crate listens on the LAN while the app is
 * open, so there is no daemon to install and quitting the app really does stop
 * syncing.
 *
 * The phone finds it without an address to type. It broadcasts a probe on its
 * own network, the Mac answers, and the phone reads the Mac's address off that
 * answer — the same trick LocalSend uses, so a Mac that took a new DHCP lease
 * after a restart is found again on the next tick. Typing an address stays as
 * the fallback for a network that drops broadcasts.
 *
 * **The database is the document both devices meet in.** The Mac's file is the
 * board; the phone has a file of its own and pushes what changed there. Nothing
 * sends a whole board: each side says "here is what I changed, and the newest
 * stamp I have heard of", and gets back only what it is missing. A card created
 * while the phone was in a tunnel is therefore a few hundred bytes on the next
 * exchange, not the board.
 *
 * The merge is the part that has to be right. Both sides reconcile per card by
 * `updatedAt`, newest wins, with deletions kept as tombstones. That means a
 * phone that was offline for an hour cannot revert an edit made on the Mac, and
 * a delete on either side stays deleted.
 */

export type SyncPhase = "off" | "serving" | "synced" | "error";

/** Where a typed address lives, in the device's own storage. */
const ADDRESS_KEY = "navigator.macAddress";
/** `"0"` keeps this device on its own. */
const ENABLED_KEY = "navigator.syncEnabled";

export const phase = signal<SyncPhase>("off");
export const detail = signal<string>("");
/** The address of the Mac in use, or the one that was typed. */
export const endpoint = signal<string>("");
/** Millis of the last successful exchange, for the "已同步" line. */
export const syncedAt = signal<number>(0);

const PORT = 8787;
/** How often the Mac reads the file back for what the phone wrote into it. */
const HOST_MS = 2500;
/** How often the phone checks the mailbox. Reading two cells, not a network. */
const TICK_MS = 700;

/** The Mac runs the service; anything else talks to it. */
export function isHost(): boolean {
  return platform.os === "macos";
}

/** What a peer answers, and what the Mac's own file answers: changed rows, and
 * the newest stamp in the file. */
type Reply = { cards: Card[]; tags: Tag[]; at: number };

/** A reply out of the crate or the file. A body that does not parse is treated
 * as an empty one; the next tick asks again. */
function parseReply(text: string): Reply {
  try {
    const value = JSON.parse(text) as Partial<Reply> & Record<string, unknown>;
    return {
      cards: Array.isArray(value.cards) ? (value.cards as Card[]) : [],
      tags: Array.isArray(value.tags) ? (value.tags as Tag[]) : [],
      at: typeof value.at === "number" ? value.at : 0,
    };
  } catch {
    return { cards: [], tags: [], at: 0 };
  }
}

/** The newest stamp the other side has told us about: what it is missing starts
 * above it. 0 asks for the whole board, which is what a first contact wants. */
let heard = 0;
/**
 * How far below `heard` a question reaches.
 *
 * The two devices' clocks are not the same clock. A Mac set two minutes behind
 * the phone stamps its new card with a time the phone has already read past, and
 * a strict watermark would never ask for it — the card would simply never arrive.
 * Reaching back a few minutes costs re-sending the rows of the last few minutes,
 * which is nothing, and it cannot skip anything.
 */
const MARGIN = 5 * 60 * 1000;
/** What was handed to the crate and is still unanswered. Kept until the Mac
 * answers, because the crate's own retry pushes this same body again. */
let awaiting: { cards: Card[]; tags: Tag[] } | null = null;
/** When the phone last asked the Mac what it has. */
let askedAt = 0;
/** How often the phone asks even when it has nothing of its own to send. */
const POLL_MS = 3000;

/** The stamp to ask from: below what has been heard, by the margin above. */
function since(): number {
  return Math.max(0, heard - MARGIN);
}

/**
 * Merges what the other side has into the board on screen.
 *
 * `fromFile` marks rows this Mac read out of its own file, which are therefore
 * already stored. The phone's copy is different: its rows have to be written to
 * the phone's file, and `persist` sees them arrive and writes them.
 */
function adopt(reply: Reply, fromFile: boolean) {
  const nextCards = mergeBoards(cards(), reply.cards);
  const nextTags = mergeTags(tags(), reply.tags);
  // Only when something really changed: setting an equal board would rebuild
  // every cell for nothing, under the user's finger.
  if (!sameBoard(nextCards, cards())) cards.set(nextCards);
  if (!sameById(nextTags, tags())) tags.set(nextTags);
  if (fromFile) rememberRows(reply);
  heard = Math.max(heard, reply.at);
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the Mac's service. Harmless to call twice. */
export async function startHost(): Promise<void> {
  if (!isHost()) return;
  try {
    const bound = Sync.start(PORT);
    const url = Sync.address(bound);
    endpoint.set(url);
    phase.set("serving");
    detail.set(`手机连 ${url}`);
  } catch (error) {
    phase.set("error");
    detail.set(String(error));
  }
}

/**
 * The Mac's tick: its own edits go into the file, then whatever the phone wrote
 * there since the last tick comes back.
 *
 * This is a file read, not a merge of two boards: the phone's request has
 * already merged into the same rows, so there is nothing to reconcile here.
 */
function hostTick() {
  // A keystroke made a moment ago is this Mac's, not the phone's: write it
  // before reading back, or it would be re-adopted from the file as new.
  flush();
  let answer: string;
  try {
    answer = Board.since(since());
  } catch {
    return;
  }
  adopt(parseReply(answer), true);
  syncedAt.set(Date.now());
  phase.set("synced");
  detail.set(`手机连 ${endpoint()}`);
}

/** What the crate says about the Mac it is talking to. */
type Status = { peer: string; unreachable: boolean; at: number };

/** The phone's tick: save, take in what came back, hand over what changed. */
function tick() {
  // The phone's own file keeps it whole between launches; the exchange only
  // carries the difference.
  flush();

  const answer = Sync.inbox();
  if (answer) {
    adopt(parseReply(answer), false);
    if (awaiting) markSent(awaiting);
    awaiting = null;
    syncedAt.set(Date.now());
  }

  // Ask about the Mac's changes as well as telling it about this device's. A
  // phone with nothing to say still has something to hear, so an exchange is
  // made on a timer; without it a card added on the Mac would only reach the
  // phone the next time the phone was edited.
  if (!awaiting) {
    const pending = outgoing();
    const idle = Date.now() - askedAt >= POLL_MS;
    if (pending.cards.length || pending.tags.length || syncedAt() === 0 || idle) {
      awaiting = pending;
      askedAt = Date.now();
      Sync.offer(JSON.stringify({ cards: pending.cards, tags: pending.tags, since: since() }));
    }
  }

  let status: Status;
  try {
    status = JSON.parse(Sync.status()) as Status;
  } catch {
    return;
  }

  const url = status.peer ? `http://${status.peer}` : "";
  if (url !== endpoint()) endpoint.set(url);

  if (status.unreachable) {
    if (phase() !== "error") {
      phase.set("error");
      detail.set("连不上 Mac，正在重新查找");
    }
  } else if (!status.peer) {
    if (phase() !== "off" || detail() !== "正在查找 Mac") {
      phase.set("off");
      detail.set("正在查找 Mac");
    }
  } else {
    if (status.at && status.at !== syncedAt()) syncedAt.set(status.at);
    if (phase() !== "synced") {
      phase.set("synced");
      detail.set("");
    }
  }
}

/** Begin syncing, as host or as client. Safe to call more than once. */
export async function start(): Promise<void> {
  if (timer) return;
  // `"0"` turns sync off. Tests set it so a test board never merges with the Mac
  // app running beside it; a user who wants one device alone can set it too.
  const off = await Storage.getItem(ENABLED_KEY);
  if (off === "0") {
    phase.set("off");
    detail.set("同步已关闭");
    return;
  }
  if (isHost()) {
    await startHost();
    timer = setInterval(hostTick, HOST_MS);
    // Once at start, so a phone that wrote while the app was last open shows
    // up as the app opens rather than up to two and a half seconds later.
    hostTick();
    return;
  }
  // A typed address wins over discovery for this run; the crate drops it the
  // moment it stops answering and probes for the Mac again.
  const saved = await Storage.getItem(ADDRESS_KEY);
  if (saved) Sync.useAddress(saved);
  Sync.watch();
  timer = setInterval(tick, TICK_MS);
  tick();
}

/** Point the phone at a Mac by hand, for a network that drops broadcasts. */
export async function connectTo(address: string): Promise<void> {
  const typed = address.trim();
  if (!typed) return;
  await Storage.setItem(ADDRESS_KEY, typed);
  Sync.useAddress(typed);
  syncedAt.set(0);
  phase.set("synced");
  detail.set("");
}

/**
 * Exchanges with the Mac now, instead of on the next tick: what the phone's
 * pull-to-refresh asks for.
 *
 * It is the ordinary tick, run early — the idle wait is the only thing the
 * timer adds, and a pull is the user saying they are not waiting. Nothing else
 * changes hands: the same rows, the same stamp, the same merge.
 */
export function syncNow(): void {
  if (!timer) return;
  if (isHost()) {
    hostTick();
    return;
  }
  // Past the idle gate, so a board with nothing of its own to send still asks.
  askedAt = 0;
  tick();
}

/**
 * Wakes the discovery loop: the app is in front of the user again.
 *
 * A phone that spent the afternoon away came back on another network, where the
 * Mac it knew is not, and the loop has been backing off — three seconds, six,
 * twelve — the whole time. Coming back to the app is the moment worth a probe.
 */
export function nudgeSync(): void {
  if (!timer || isHost()) return;
  Sync.nudge();
}

/** A one-line status for the header. */
export function statusLine(): string {
  if (detail() === "同步已关闭") return "未同步";
  if (phase() === "error") return detail() || "同步出错";
  // "查找中" rather than "未连接": on a phone the first seconds are spent
  // probing the network, and that is not the same as being alone.
  if (phase() === "off") return detail() ? "查找中" : "未连接";
  const at = syncedAt();
  if (!at) return phase() === "serving" ? "等待手机" : "正在连接";
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `已同步 ${hm}`;
}
