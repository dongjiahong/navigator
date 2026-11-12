import { Storage, lifecycle, platform, signal } from "nsh";
import { Board, Sync } from "app/native";
import { cards, tags, type Card, type Tag } from "./data";
import { mergeBoards, mergeTags, sameBoard, sameById } from "./merge";
import {
  digits,
  pairCode,
  pairLine,
  pairOpen,
  pairState,
  readPair,
  saveCode,
  storedCode,
} from "./pairing";
import { flush, markSent, outgoing, rememberRows } from "./persist";

export { mergeBoards, mergeTags, sameBoard } from "./merge";

/**
 * Sync keeps every device the user owns on the same board.
 *
 * A Mac *is* a server: its Rust crate listens on the LAN while the app is
 * running — closing the window hides it rather than quitting, which `desktop.ts`
 * sets up — so there is no daemon to install and quitting the app really does
 * stop syncing. With more than one Mac, every Mac is a server and every Mac also
 * watches: they find each other on the network and exchange boards directly.
 * The phone does not serve — its changes travel in the requests it sends — but
 * it syncs with every Mac it finds, so it is in step with all of them.
 *
 * Nobody types an address. Each device broadcasts a probe on its own network,
 * every serving device answers, and each answer's source address is where that
 * device is right now — the same trick LocalSend uses, so a Mac that took a new
 * DHCP lease after a restart is found again on the next probe. Typing an
 * address stays as the fallback for a network that drops broadcasts.
 *
 * **The database is the document each device meets the others in.** Every device
 * has a file of its own and pushes what changed there. Nothing sends a whole
 * board: each device says "here is what I changed", asks from the newest stamp
 * it heard from that peer, and gets back only what it is missing. A card created
 * while a device was in a tunnel is therefore a few hundred bytes on the next
 * exchange, not the board.
 *
 * The merge is the part that has to be right. Both sides reconcile per card, per
 * field, by stamp, newest wins, with deletions kept as tombstones. That means a
 * device that was offline for an hour cannot revert an edit made on another, and
 * a delete on any of them stays deleted.
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

// The code's state, and the line that says it, live in `pairing`: they are read
// by both devices, and by tests that must not import the crate.
export { pairLine, pairState };

const PORT = 8787;
/** How often a Mac also reads its own file back for what a peer wrote into it. */
const HOST_MS = 2500;
/**
 * How often this side hands the crate what changed here, when the peers' answers
 * are pushed. Nothing is polled for: the crate posts them as they arrive, so this
 * timer only carries the board's own edits the other way.
 */
const SEND_MS = 1200;
/** How often the app checks the mailbox, on an installed app that cannot push. */
const TICK_MS = 700;

/**
 * Whether the installed app pushes the peers' rows instead of being polled.
 *
 * An OTA package carries TSX only and runs on whatever build installed it, so
 * this file can be newer than the crate under it. The exports that carry the
 * push are therefore read off the module rather than imported by name — a named
 * import of an export an older build does not have is a module that fails to
 * load, not an `undefined` this can check — and `Sync.api()` says whether they
 * mean anything.
 */
let pushes = typeof Sync.api === "function" && Sync.api() >= 2;

/** The subscription to `Sync.onEvent`, once there is one. */
let stopPushes: (() => void) | null = null;

/**
 * The Mac runs a service; anything else only talks to one.
 *
 * Every Mac both serves and watches, so two Macs on one network are in step with
 * each other directly. A phone does not serve: its changes travel in the
 * requests it sends, and its answer carries the other side's. It watches all the
 * same, with one exchange per Mac it finds.
 */
export function isHost(): boolean {
  return platform.os === "macos";
}

/** What a peer answers, and what a Mac's own file answers: changed rows, and
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

/**
 * The newest stamp this device's own file has shown it.
 *
 * Only the file read needs it: each peer's watermark lives in the crate, because
 * there is one per peer, and a single number here would ask every Mac from the
 * newest of them.
 */
let fileHeard = 0;
/**
 * How far below `fileHeard` the file read reaches.
 *
 * Two devices' clocks are not the same clock. A peer set two minutes behind
 * stamps its new card with a time this device has already read past, and a
 * strict watermark would never ask for it — the card would simply never arrive.
 * Reaching back a few minutes costs re-reading the rows of the last few minutes,
 * which is nothing, and it cannot skip anything.
 */
const MARGIN = 5 * 60 * 1000;

/** The stamp to read this Mac's own file from. */
function fileSince(): number {
  return Math.max(0, fileHeard - MARGIN);
}

/** One device this one is in step with, as the crate reports it. */
export type PeerStatus = {
  addr: string;
  ok: boolean;
  at: number;
  typed: boolean;
  pair?: string;
  retry?: number;
};

/** Every device this one is in step with, newest report first. */
export const peers = signal<PeerStatus[]>([]);

/**
 * Merges what the other side has into the board on screen.
 *
 * `fromFile` marks rows this Mac read out of its own file, which are therefore
 * already stored. A peer's copy is different: its rows have to be written to
 * this device's file, and `persist` sees them arrive and writes them.
 */
function adopt(reply: Reply, fromFile: boolean) {
  const nextCards = mergeBoards(cards(), reply.cards);
  const nextTags = mergeTags(tags(), reply.tags);
  // Only when something really changed: setting an equal board would rebuild
  // every cell for nothing, under the user's finger.
  if (!sameBoard(nextCards, cards())) cards.set(nextCards);
  if (!sameById(nextTags, tags())) tags.set(nextTags);
  if (fromFile) {
    rememberRows(reply);
    fileHeard = Math.max(fileHeard, reply.at);
  }
}

/**
 * One event from the crate, as `Sync.onEvent` hands it over.
 *
 * `rows` is a peer's answer — or, on a Mac, the phone's request, already written
 * into this device's file (`stored`). Apply it exactly as a polled answer would
 * have been applied; nothing else about the merge changes.
 *
 * Exported for the test that pins the wire format to what the crate sends: the
 * two are written on different sides of the interface and only meet here.
 */
export function applyEvent(text: string) {
  let event: { type?: string; cards?: Card[]; tags?: Tag[]; at?: number; stored?: boolean; status?: Status };
  try {
    event = JSON.parse(text) as typeof event;
  } catch {
    return;
  }
  if (event.type === "rows") {
    adopt(
      {
        cards: Array.isArray(event.cards) ? event.cards : [],
        tags: Array.isArray(event.tags) ? event.tags : [],
        at: typeof event.at === "number" ? event.at : 0,
      },
      event.stored === true,
    );
  } else if (event.type === "status" && event.status) {
    applyStatus(event.status);
  }
}

/** Listens for the crate's events, and draws the state it is in now. */
function subscribe(): void {
  if (stopPushes) return;
  try {
    stopPushes = Sync.onEvent(applyEvent);
  } catch (error) {
    // The export is there but would not take a listener: poll instead, which is
    // what every build before this one does.
    console.log(`[navigator] cannot subscribe to sync events: ${error}`);
    pushes = false;
    return;
  }
  // The events that follow are changes from here, so the state as it stands is
  // read once rather than waited for.
  readStatus();
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start this Mac's service. Harmless to call twice. */
export async function startHost(): Promise<void> {
  if (!isHost()) return;
  try {
    // The code before the port: a Mac that is listening without one admits
    // nobody, and a device with the right digits could never prove it.
    await ensureHostCode();
    const bound = Sync.start(PORT);
    const url = Sync.address(bound);
    endpoint.set(url);
    phase.set("serving");
    detail.set(`其它设备连 ${url}`);
  } catch (error) {
    phase.set("error");
    detail.set(String(error));
  }
}

/** What the crate says about the devices this one is talking to. */
type Status = {
  peer?: string;
  peers?: PeerStatus[];
  unreachable: boolean;
  at: number;
  pair?: string;
  retry?: number;
};

/**
 * One tick, on either device: save what changed, show what the peers said, and
 * hand the crate what is new.
 *
 * On an app that pushes, the peers' rows and the status arrive as events, so
 * this only carries this device's own changes the other way — and is therefore
 * safe to skip while the app is not in front of the user, which is the whole
 * point of not polling: a board nobody is looking at has nothing to repaint.
 *
 * A Mac reads its own file as well. That is not a merge of two boards: a peer's
 * request has already merged into the same rows, so there is nothing to
 * reconcile there, only rows written by a thread instead of by this one.
 */
function tick() {
  if (!pushes && lifecycle() !== "active") return;

  flush();

  if (isHost()) {
    try {
      adopt(parseReply(Board.since(fileSince())), true);
    } catch {
      // A file that cannot be read this tick is read on the next.
    }
  }

  if (!pushes) {
    const answer = Sync.inbox();
    if (answer) {
      adopt(parseReply(answer), false);
      syncedAt.set(Date.now());
    }
  }

  // Tell the crate what changed here. It carries the rows to every peer, keeps
  // them for a peer that did not answer, and asks each peer what it has — a
  // round trip that runs on the crate's own timer, so a device with nothing to
  // say still hears.
  const pending = outgoing();
  if (pending.cards.length || pending.tags.length) {
    markSent(pending);
    Sync.offer(JSON.stringify({ cards: pending.cards, tags: pending.tags }));
  }

  if (!pushes) readStatus();
}

/** Where sync stands, from the crate: peers, code, last exchange. */
function readStatus() {
  let status: Status;
  try {
    status = JSON.parse(Sync.status()) as Status;
  } catch {
    return;
  }
  applyStatus(status);
}

/** Draws a status, whether it was pushed or polled. */
function applyStatus(status: Status) {
  const list = Array.isArray(status.peers) ? status.peers : [];
  // The same list, compared row by row: reading it into the signal every 700 ms
  // would repaint the sheet under the user's finger for nothing.
  const before = peers();
  const changed =
    list.length !== before.length ||
    list.some((peer, index) => {
      const old = before[index];
      return (
        !old ||
        old.addr !== peer.addr ||
        old.ok !== peer.ok ||
        old.at !== peer.at ||
        old.typed !== peer.typed ||
        old.pair !== peer.pair ||
        old.retry !== peer.retry
      );
    });
  if (changed) peers.set(list);

  // A Mac's address is its own service, which the pairing panel shows. Any
  // other device's is the typed Mac if there is one, and otherwise whichever
  // peer answered first.
  if (!isHost()) {
    const typed = list.find((peer) => peer.typed);
    const url = typed?.addr ?? list[0]?.addr ?? "";
    // A peer that just went quiet is still the address the user would want to
    // see in the sheet, so an empty list does not wipe the last one.
    if (url && !endpoint().endsWith(url)) endpoint.set(`http://${url}`);
  }

  // The code, before the connection: a peer that answers and will not let this
  // device in is a different thing from one that is not there, and it is the
  // one the user can fix in a moment.
  const pairing = readPair(status);
  if (pairState() !== pairing) pairState.set(pairing);

  if (status.at && status.at !== syncedAt()) syncedAt.set(status.at);

  if (status.unreachable) {
    if (phase() !== "error") {
      phase.set("error");
      detail.set("连不上 Mac，正在重新查找");
    }
    return;
  }
  if (!list.length) {
    // A Mac with no peer is not idle: it is serving, waiting for one to appear.
    const waiting = isHost();
    const wantPhase = waiting ? "serving" : "off";
    const wantDetail = waiting ? `其它设备连 ${endpoint()}` : "正在查找 Mac";
    if (phase() !== wantPhase) phase.set(wantPhase);
    if (detail() !== wantDetail) detail.set(wantDetail);
    return;
  }
  if (phase() !== "synced") {
    phase.set("synced");
    detail.set("");
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
  }
  // A typed address wins over discovery for the device it names; the crate
  // keeps it beside whatever a probe finds, so one Mac typed by hand does not
  // hide the others.
  const saved = await Storage.getItem(ADDRESS_KEY);
  if (saved) Sync.useAddress(saved);
  // The digits a previous pairing left behind. On a Mac the service answers to
  // them too, so the first device to make a code hands it to the next one, and
  // every device on the board proves itself with the same six digits.
  const code = isHost() ? await ensureHostCode() : await storedCode();
  try {
    Sync.setCode(code);
  } catch (error) {
    console.log(`[navigator] the pairing code could not be adopted: ${error}`);
  }
  if (!code) pairState.set("need");
  // Listening before the exchange thread starts: a row delivered in the first
  // second is pushed to this subscription, and a row delivered before it is
  // waiting in the crate's mailbox for it.
  if (pushes) subscribe();
  Sync.watch();
  timer = setInterval(tick, isHost() ? HOST_MS : pushes ? SEND_MS : TICK_MS);
  // Once at start, so a peer that wrote while the app was last open shows up as
  // the app opens rather than up to a couple of seconds later.
  tick();
}

/** Point this device at a Mac by hand, for a network that drops broadcasts. */
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
 * Pairs this device with the board whose six digits were typed, and starts.
 *
 * The digits are the only thing standing between a device and the board, and
 * every device on one board uses the same six: a new Mac types the code shown on
 * an old one, and from then on both answer to it. The address is optional — a
 * device that has the code finds the others on its own.
 *
 * `false` when the text is not six digits, so the sheet knows not to close on
 * a press that could not have done anything.
 */
export async function pairWith(code: string): Promise<boolean> {
  const six = digits(code);
  if (six.length !== 6) return false;
  try {
    // The crate takes the digits as this device's answer; a refusal here is a
    // code that is not six digits, which the field already prevents.
    Sync.setCode(six);
    // A machine that serves answers to the same digits it proves with: that is
    // what lets the second Mac join the first one's board instead of keeping a
    // board of its own.
    if (isHost()) Sync.hostCode(six);
  } catch (error) {
    console.log(`[navigator] pairing code refused: ${error}`);
    return false;
  }
  await saveCode(six);
  // A new code is a new attempt: the refusal and the lockout went with the old
  // digits, in the crate and here.
  pairState.set("ok");
  syncedAt.set(0);
  if (phase() !== "off" && !isHost()) {
    phase.set("off");
    detail.set("正在查找 Mac");
  }
  tick();
  return true;
}

/**
 * The Mac's code, made and kept the first time it is wanted.
 *
 * Called before the service starts, so a Mac that is serving always has one: a
 * Mac with no code admits nobody, which is the safe way round — but it would
 * also mean a device that could never pair.
 */
export async function ensureHostCode(): Promise<string> {
  try {
    const saved = await storedCode();
    if (saved) {
      // The crate is told which digits it answers to; the storage is the
      // record, and the crate only holds it while the port is open.
      Sync.hostCode(saved);
      pairCode.set(saved);
      return saved;
    }
    return await regenerateHostCode();
  } catch (error) {
    // No code, no pairing: the board stays closed to the network until the app
    // can make one, and the Mac's own board is untouched by that.
    console.log(`[navigator] no pairing code: ${error}`);
    return "";
  }
}

/**
 * A new code, kept, and the old one stops working as it is made.
 *
 * The old digits are the only thing that opened the door, so replacing them is
 * how the user says "no more": every device that knew them is asked for the new
 * ones on its next exchange. The whole board has one code, so the new digits
 * have to be typed on every device the user wants to keep in step.
 */
export async function regenerateHostCode(): Promise<string> {
  const code = digits(Sync.newCode());
  Sync.hostCode(code);
  // The machine proving itself answers to the new digits too, or it would serve
  // the board under one code and be refused by its peers under another.
  Sync.setCode(code);
  await saveCode(code);
  return code;
}

/** Puts the Mac's code on screen, making one first if it has never had one. */
export async function openPairCode(): Promise<void> {
  const code = await ensureHostCode();
  if (code) pairOpen.set(true);
}

/**
 * Exchanges with the peers now, instead of on the next tick: what the phone's
 * pull-to-refresh asks for.
 *
 * It is the ordinary tick, run early — the crate's own timer is the only thing
 * the pull skips. Nothing else changes hands: the same rows, the same stamps,
 * the same merge.
 */
export function syncNow(): void {
  if (!timer) return;
  Sync.nudge();
  tick();
}

/**
 * Wakes the discovery loop: the app is in front of the user again.
 *
 * A phone that spent the afternoon away came back on another network, where the
 * Macs it knew are not, and the loop has been backing off — three seconds, six,
 * twelve — the whole time. Coming back to the app is the moment worth a probe,
 * on a Mac as well as on a phone: the other Mac may have been opened while this
 * one was in the background.
 */
export function nudgeSync(): void {
  if (!timer) return;
  Sync.nudge();
}

/** A one-line status for the header. */
export function statusLine(): string {
  if (detail() === "同步已关闭") return "未同步";
  // The code first: a device that answers and will not let this one in has not
  // "failed to sync", and telling the user it had would send them looking at
  // the network for something the pairing sheet fixes in one press.
  const pairing = pairLine();
  if (pairing) return pairing;
  if (phase() === "error") return detail() || "同步出错";
  const list = peers();
  if (!list.length) {
    // "查找中" rather than "未连接": the first seconds are spent probing the
    // network, and that is not the same as being alone.
    if (phase() === "off") return detail() ? "查找中" : "未连接";
    if (phase() === "serving") return "等待设备";
    return syncedAt() ? syncedLine(syncedAt()) : "正在连接";
  }
  const reachable = list.filter((peer) => peer.ok).length;
  if (!reachable) {
    // Every known device is failing: the crate is probing again, and the line
    // says the same thing it always did about a Mac that went away.
    return detail() || "连不上 Mac，正在重新查找";
  }
  // One device behind is news worth saying, and what the user can do about it
  // differs: a code that is wrong is one press away from fixed, a closed Mac is
  // not.
  const behind = list.filter((peer) => !peer.ok);
  if (behind.length) {
    if (behind.every((peer) => peer.pair === "wrong")) return `${behind.length} 台配对码不对`;
    if (behind.every((peer) => peer.pair === "locked")) return `${behind.length} 台稍后再试`;
    return `${behind.length} 台未连上`;
  }
  return reachable > 1 ? `已同步 ${reachable} 台` : syncedLine(syncedAt());
}

/** `已同步 14:03`, the one line a working board gets. */
function syncedLine(at: number): string {
  if (!at) return "已同步";
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `已同步 ${hm}`;
}
