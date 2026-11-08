import { COLUMNS, type Card, type Repeat, type Stamps, type Status, type Tag } from "./data";
import { MERGE_FIELDS, allFields } from "./fields";
import { REPEATS } from "./repeat";
import { HUES, type Hue } from "./theme";

/**
 * The board leaving the app, and coming back: the rules, and nothing else.
 *
 * Three things live here — the export a user takes to read or keep elsewhere,
 * the import that puts rows back, and the restore that puts a snapshot back —
 * and every decision any of them makes is a pure function over two arrays:
 * `boardToMarkdown`, `boardToJson`, `parseBoard`, `planImport`, `planRestore`.
 * This is the part where being wrong loses work, so none of it touches a file,
 * a signal or a native module: it is testable as the function it is, in a test
 * bundle that has no app to call into.
 *
 * The side of it that *does* touch the world — the day's snapshot, the folder
 * the exports land in, the backup folder a launch can see — is `backupStore.ts`
 * on purpose. A test file that imported this one must not pull `app/native` in
 * with it: a test is bundled on its own, and only the app bundle may load a
 * native module.
 *
 * Two orders of operation, and they are deliberately different:
 *
 * - **An import merges by stamp**, the same rule the phone's sync uses. A card
 *   this device already has keeps whichever copy was written last, so importing
 *   yesterday's export cannot undo this afternoon's edit.
 * - **A restore is a write with a fresh stamp.** A backup is what the user
 *   reached for *because* the board is wrong now, so its rows go back on top of
 *   what is there, stamped above every stamp on the board so they also win the
 *   merge on the other device. A card the backup does not have is never
 *   touched: the work made after the snapshot is the work a restore must not
 *   eat.
 */

/** What a board file is, whether it came from 导出 or from a daily snapshot. */
export const BOARD_VERSION = 1;

export type BoardFile = { version: number; exportedAt: number; cards: Card[]; tags: Tag[] };

/** A card and a tag list, the two things every rule here takes. */
export type Board = { cards: Card[]; tags: Tag[] };

/** What the folder of snapshots says about one of them. */
export type BackupEntry = { name: string; at: number; cards: number; tags: number };

/** A backup folder, and the text of each of its files. */
export type BackupFixture = { entries: BackupEntry[]; docs: Record<string, string> };

const pad = (n: number) => String(n).padStart(2, "0");

/** `2026-11-08`: the day a snapshot is named for, and the day of an export. */
export function dayStamp(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** `1432`: the hour and minute in an export's name. */
function clockStamp(at: Date): string {
  return `${pad(at.getHours())}${pad(at.getMinutes())}`;
}

/** `领航-20261108-1432.json` — one export, distinct in a folder that has many. */
export function exportName(kind: "json" | "markdown", at: Date): string {
  const extension = kind === "json" ? "json" : "md";
  return `领航-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${clockStamp(at)}.${extension}`;
}

/**
 * The board as a file: every card on it and every tag, never a tombstone.
 *
 * A removed card is not part of the board the user would recognise, and an
 * export is a document to read or to hand to someone else. The tombstones stay
 * in the daily snapshot, where a restore needs them; here they would be noise
 * in a JSON file and a card in a Markdown list that nobody can see on screen.
 */
export function boardToJson(cards: Card[], tags: Tag[], at = Date.now()): string {
  const file: BoardFile = {
    version: BOARD_VERSION,
    exportedAt: at,
    cards: cards.filter((c) => !c.deleted),
    tags: tags.filter((t) => !t.deleted),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * The board as Markdown: one section per column, one line per card.
 *
 * `- [ ]` is open work and `- [x]` is finished or filed, so the file opens in
 * any checkbox-aware editor as the board it came from. A tag keeps its `#` (it
 * is a tag, and that is how one is written by hand), a deadline keeps its hour,
 * and a note becomes a quote line under the card — the shape the card itself
 * has, top to bottom.
 *
 * An empty column is left out entirely: a heading with nothing under it reads
 * as a section that failed to load.
 */
export function boardToMarkdown(cards: Card[], tags: Tag[], at: Date = new Date()): string {
  const label = (id: string) => tags.find((t) => t.id === id && !t.deleted)?.label ?? id;
  const live = cards.filter((c) => !c.deleted);
  const lines = ["# 领航看板", "", `导出时间 ${dayStamp(at)} ${pad(at.getHours())}:${pad(at.getMinutes())}`, ""];
  for (const column of COLUMNS) {
    const rows = live.filter((c) => c.status === column.id);
    if (rows.length === 0) continue;
    lines.push(`## ${column.label}`, "");
    for (const card of rows) lines.push(...markdownCard(card, label));
    lines.push("");
  }
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

/** One card's lines: the box, the title, its tags, its deadline, its notes. */
function markdownCard(card: Card, label: (id: string) => string): string[] {
  // A title is one line in a list: a newline typed into one would break the
  // item it sits in.
  const title = card.title.replace(/\s+/g, " ").trim() || "未命名卡片";
  const parts = [title];
  const names = card.tags.map(label).filter((name) => name.length > 0);
  if (names.length) parts.push(names.map((name) => `#${name}`).join(" "));
  if (card.due) parts.push(`截止 ${card.due.replace("T", " ")}`);
  const box = card.status === "done" || card.status === "archive" ? "x" : " ";
  const out = [`- [${box}] ${parts.join(" · ")}`];
  for (const line of card.notes.split("\n")) {
    const text = line.trim();
    if (text) out.push(`  > ${text}`);
  }
  return out;
}

const STATUSES = COLUMNS.map((column) => column.id);

function asCard(item: unknown): Card | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const row = item as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id.trim()) return null;
  if (typeof row.title !== "string") return null;
  const status = STATUSES.includes(row.status as Status) ? (row.status as Status) : "todo";
  const card: Card = {
    id: row.id,
    title: row.title,
    notes: typeof row.notes === "string" ? row.notes : "",
    tags: Array.isArray(row.tags) ? row.tags.filter((id): id is string => typeof id === "string") : [],
    status,
    updatedAt: typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : 0,
  };
  if (typeof row.due === "string" && row.due) card.due = row.due;
  // A cycle without a deadline is not a cycle, and an unknown one is not this
  // version's: either way it is dropped rather than carried as a word nothing
  // reads.
  if (card.due && REPEATS.some((r) => r === row.repeat)) card.repeat = row.repeat as Repeat;
  // A file that came out of the daily snapshot carries tombstones, and they are
  // kept: merging one back has to know which ids were removed.
  if (row.deleted === true) card.deleted = true;
  // Where the card sits in its column, and when each field was last written: a
  // board that loses them comes back unordered, and every field of it merges as
  // if it had been written at the card's one stamp.
  if (typeof row.rank === "number" && Number.isFinite(row.rank)) card.rank = row.rank;
  if (row.stamps && typeof row.stamps === "object" && !Array.isArray(row.stamps)) {
    const own = row.stamps as Record<string, unknown>;
    const stamps: Stamps = {};
    for (const field of MERGE_FIELDS) {
      const at = own[field];
      if (typeof at === "number" && Number.isFinite(at)) stamps[field] = at;
    }
    if (Object.keys(stamps).length) card.stamps = stamps;
  }
  return card;
}

function asTag(item: unknown): Tag | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const row = item as Record<string, unknown>;
  if (typeof row.id !== "string" || !row.id.trim()) return null;
  if (typeof row.label !== "string") return null;
  const hue: Hue = HUES.some((h) => h.id === row.hue) ? (row.hue as Hue) : "blue";
  return {
    id: row.id,
    label: row.label,
    hue,
    updatedAt: typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : 0,
    ...(row.deleted === true ? { deleted: true } : {}),
  };
}

/**
 * What a text is: a board, or why it is not one.
 *
 * Strict, and on purpose. Every row is checked before a single one is applied,
 * so a file that is half a board leaves the board exactly as it was rather than
 * putting half of someone else's cards on it.
 */
export function parseBoard(text: string): { board: Board } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: "不是 JSON" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "不是一个看板对象" };
  }
  const file = value as Record<string, unknown>;
  if (file.version !== BOARD_VERSION) {
    return { error: `版本是 ${String(file.version)}，只认 ${BOARD_VERSION}` };
  }
  if (!Array.isArray(file.cards)) return { error: "没有 cards 数组" };
  if (file.tags !== undefined && !Array.isArray(file.tags)) return { error: "tags 不是数组" };

  const cards: Card[] = [];
  for (const [index, item] of file.cards.entries()) {
    const card = asCard(item);
    if (!card) return { error: `第 ${index + 1} 张卡片没有 id 或标题` };
    cards.push(card);
  }
  const tags: Tag[] = [];
  for (const [index, item] of (file.tags ?? []).entries()) {
    const tag = asTag(item);
    if (!tag) return { error: `第 ${index + 1} 个标签没有 id 或名字` };
    tags.push(tag);
  }
  return { board: { cards, tags } };
}

/** What an import would do, by card. */
export type ImportPlan = { add: Card[]; update: Card[]; same: Card[] };

/**
 * What importing `incoming` would change: cards this board does not have, cards
 * it has an older copy of, and cards that are already the same.
 *
 * A card this device has *removed* counts as an update, not a same: the row is
 * there as a tombstone, so the id is known, but it is not on the board, and an
 * imported copy that is newer than the tombstone is a card the user asked for.
 */
export function planImport(local: Card[], incoming: Card[]): ImportPlan {
  const mine = new Map(local.map((card) => [card.id, card]));
  const plan: ImportPlan = { add: [], update: [], same: [] };
  for (const card of incoming) {
    const here = mine.get(card.id);
    if (!here) plan.add.push(card);
    else if (here.deleted || (card.updatedAt ?? 0) > (here.updatedAt ?? 0)) plan.update.push(card);
    else plan.same.push(card);
  }
  return plan;
}

/** Whether two rows are the same work, whatever their stamps say. */
function sameCard(a: Card, b: Card): boolean {
  return (
    a.id === b.id &&
    a.title === b.title &&
    a.notes === b.notes &&
    a.status === b.status &&
    (a.due ?? "") === (b.due ?? "") &&
    (a.repeat ?? "") === (b.repeat ?? "") &&
    a.tags.join("\u0000") === b.tags.join("\u0000")
  );
}

function sameTag(a: Tag, b: Tag): boolean {
  return a.id === b.id && a.label === b.label && a.hue === b.hue;
}

/** The rows to write to put a backup back, each stamped at `at`. */
export type RestorePlan = Board;

/**
 * What a restore writes: every card and tag in `backup` that is missing from
 * the board, removed from it, or different from it — as the backup had it, with
 * `at` for a stamp.
 *
 * Three rules, and each one is a way a restore could eat work instead of
 * restoring it:
 *
 * 1. **A live row the backup does not have is never touched.** The cards made
 *    after the snapshot are the newest work on the board; a restore is for what
 *    was lost, not for what was added.
 * 2. **A tombstone in the backup is skipped.** A card deleted *before* the
 *    snapshot has nothing to recover, and writing it back would delete a card
 *    the user made since.
 * 3. **`at` is now, minted above every stamp on the board.** A restore is a
 *    write, so it has to win the merge on the other device; a row restored with
 *    the stamp it had in the backup would lose to the tombstone that removed it.
 */
export function planRestore(local: Board, backup: Board, at: number): RestorePlan {
  const myCards = new Map(local.cards.map((card) => [card.id, card]));
  const cards: Card[] = [];
  for (const card of backup.cards) {
    if (card.deleted) continue;
    const here = myCards.get(card.id);
    if (here && !here.deleted && sameCard(here, card)) continue;
    // Every field is stamped `at`, not only the card: the merge compares field
    // by field, and the backup's own older stamps would lose each of them to the
    // tombstone or the edit being undone.
    cards.push({ ...card, deleted: false, updatedAt: at, stamps: allFields(at) });
  }
  const myTags = new Map(local.tags.map((tag) => [tag.id, tag]));
  const tags: Tag[] = [];
  for (const tag of backup.tags) {
    if (tag.deleted) continue;
    const here = myTags.get(tag.id);
    if (here && !here.deleted && sameTag(here, tag)) continue;
    tags.push({ ...tag, deleted: false, updatedAt: at });
  }
  return { cards, tags };
}
