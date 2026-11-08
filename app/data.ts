import { signal } from "nsh";
import { HUES, type Hue } from "./theme";

export type Status = "todo" | "doing" | "done" | "archive";

export type Card = {
  id: string;
  title: string;
  notes: string;
  tags: string[];
  /** ISO local time, e.g. `2026-11-07T15:15`. */
  due?: string;
  status: Status;
  /**
   * Millis of the last write. Sync merges per card by this, so the newer edit
   * always wins no matter which device was offline and for how long.
   */
  updatedAt: number;
  /**
   * A removed card stays as a tombstone. Dropping it outright would let the
   * other device push its copy back on the next merge.
   */
  deleted?: boolean;
};

export const COLUMNS: { id: Status; label: string; short: string }[] = [
  { id: "todo", label: "待办", short: "待办" },
  { id: "doing", label: "进行中", short: "进行中" },
  { id: "done", label: "已完成", short: "已完成" },
  { id: "archive", label: "归档", short: "归档" },
];

/** A local `YYYY-MM-DDTHH:mm` stamp, `dayOffset` days from today. */
export function isoAt(dayOffset: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(hour)}:${p(minute)}`;
}

/** Millis → the local stamp a due is written as, `2026-11-12T14:30`. */
export function isoOf(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * The time of day a due carries, `18:00` while it has none: the due editor shows
 * a control in every state, so the field has a time to stand on before the first
 * press.
 */
export function dueTimeOf(iso: string | undefined): string {
  return iso && iso.length >= 16 ? iso.slice(11, 16) : "18:00";
}

/** The same day at another time of day; today, when there is no day yet. */
export function withDueTime(iso: string | undefined, time: string): string {
  const day = iso && iso.length >= 10 ? iso.slice(0, 10) : isoAt(0, 0).slice(0, 10);
  return `${day}T${time}`;
}

/**
 * The same time of day on another day. A due keeps its time when its day
 * changes: pressing 明天 after setting 14:30 means tomorrow at 14:30, not
 * tomorrow at nine.
 */
export function withDueDay(iso: string | undefined, dayOffset: number, hour: number): string {
  const time = iso && iso.length >= 16 ? iso.slice(11, 16) : `${String(hour).padStart(2, "0")}:00`;
  return `${isoAt(dayOffset, 0).slice(0, 10)}T${time}`;
}

/** The last stamp this device handed out. */
let lastStamp = 0;

/**
 * Millis now, the clock every write stamps its card with: strictly newer than
 * every stamp already on the board.
 *
 * `Date.now()` alone is not enough. A device whose clock runs ahead sends
 * stamps above this one's own, and a clock stepped back (NTP does it, phones do
 * it when they change networks) makes every edit for the next while look older
 * than the card it edits — the merge keeps the old copy and the edit is lost
 * without a word. Anchoring to the newest stamp on the board keeps "newest
 * wins" meaning "the last edit", on one device and across two.
 *
 * Read it before an update, never inside one: it reads the board.
 */
export function now(): number {
  let newest = lastStamp;
  for (const card of cards()) newest = Math.max(newest, card.updatedAt ?? 0);
  for (const tag of tags()) newest = Math.max(newest, tag.updatedAt ?? 0);
  lastStamp = Math.max(Date.now(), newest + 1);
  return lastStamp;
}

/**
 * A new row id: the millis it was made, then a short random tail.
 *
 * `c${Date.now()}` is enough on one device and collides the moment there are
 * two: a phone that captures a card in the same millisecond the Mac makes one
 * hands the merge two rows carrying one id, and the merge keeps one of them.
 * The tail turns that into a coincidence instead of a schedule. Ids are opaque
 * strings everywhere else, so the rows made before this keep working.
 */
export function newId(prefix: string): string {
  const tail = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${tail.padEnd(6, "0")}`;
}

/**
 * `2026-11-12T14:30` → millis since the epoch, in the device's own zone.
 *
 * Not `new Date(iso)`: a due is written without a zone, and some engines read a
 * bare `YYYY-MM-DDTHH:mm` as UTC, which would shift every reminder by the
 * device's offset.
 */
export function epochOf(iso: string): number {
  const [date, time] = iso.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time ?? "00:00").split(":").map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0).getTime();
}

/**
 * Whether the card deserves a reminder at `now`: a deadline still ahead, on
 * work that is still open. A finished or archived card has no reminder left,
 * and a deadline that has already passed is the board's problem — it shows an
 * overdue pill — not the system's.
 */
export function remindsAt(card: Card, now: number): boolean {
  if (card.deleted || !card.due) return false;
  if (card.status === "done" || card.status === "archive") return false;
  return epochOf(card.due) > now;
}

/**
 * The cards on the board that want attention now: late, or due today, on work
 * that is still open.
 *
 * This is the number the Dock carries, so it has to mean the same thing the
 * board says out loud — the red 已逾期 pill and the amber today pill, added up.
 * A card due today is counted whether or not its hour has passed (it is today's
 * work either way), a card due tomorrow is not, and finished or filed work asks
 * for nothing.
 */
export function attentionCount(all: Card[], at: number): number {
  const today = new Date(at);
  let count = 0;
  for (const card of all) {
    if (card.deleted || !card.due) continue;
    if (card.status === "done" || card.status === "archive") continue;
    const due = new Date(epochOf(card.due));
    if (due.getTime() < at) {
      count += 1;
      continue;
    }
    const sameDay =
      due.getFullYear() === today.getFullYear() &&
      due.getMonth() === today.getMonth() &&
      due.getDate() === today.getDate();
    if (sameDay) count += 1;
  }
  return count;
}

/** Sample board. Authored content, not a user's real data. */
export function sampleCards(): Card[] {
  const seed = Date.now();
  return [
    {
      id: "c1",
      title: "回测里加一个「按考试号规则」的开关",
      notes: "让考试号规则和回测一起跑，这样能直接看出这条规则能不能通过考试号。开关放在回测设置那一块。",
      tags: ["work"],
      due: isoAt(0, 18, 30),
      status: "doing",
      updatedAt: seed + 1,
    },
    {
      id: "c2",
      title: "阅读《逐根 K 线解读》并做笔记",
      notes: "主要看一些 K 线的形态。",
      tags: ["study"],
      due: isoAt(1, 21, 0),
      status: "todo",
      updatedAt: seed + 2,
    },
    {
      id: "c3",
      title: "写周报",
      notes: "",
      tags: ["work"],
      due: isoAt(0, 20, 0),
      status: "todo",
      updatedAt: seed + 3,
    },
    {
      id: "c4",
      title: "完成工作报告初稿",
      notes: "先把结构列出来，数据下周补。",
      tags: ["work"],
      due: isoAt(0, 15, 15),
      status: "doing",
      updatedAt: seed + 4,
    },
    {
      id: "c5",
      title: "联系三位老朋友",
      notes: "从 X 上的关注里找一位，再问问小红书上的那位。",
      tags: ["personal"],
      status: "todo",
      updatedAt: seed + 5,
    },
    {
      id: "c6",
      title: "整理衣橱，捐赠不穿的衣服",
      notes: "",
      tags: ["life"],
      due: isoAt(3, 14, 0),
      status: "todo",
      updatedAt: seed + 6,
    },
    {
      id: "c7",
      title: "计划一次欧洲背包旅行",
      notes: "西班牙、巴塞罗那。先定往返时间，再排城市。",
      tags: ["life", "personal"],
      status: "todo",
      updatedAt: seed + 7,
    },
    {
      id: "c8",
      title: "学习蚂蚁解析的视频并了解波浪理论",
      notes: "https://space.bilibili.com/3546652709226701",
      tags: ["study"],
      due: isoAt(2, 20, 0),
      status: "todo",
      updatedAt: seed + 8,
    },
    {
      id: "c9",
      title: "研究并选择新的锻炼计划",
      notes: "",
      tags: ["personal"],
      status: "todo",
      updatedAt: seed + 9,
    },
    {
      id: "c10",
      title: "晨间冥想 15 分钟",
      notes: "",
      tags: ["personal"],
      due: isoAt(-1, 7, 30),
      status: "done",
      updatedAt: seed + 10,
    },
    {
      id: "c11",
      title: "更新个人简历",
      notes: "把最近两个项目补进去。",
      tags: ["work", "urgent"],
      due: isoAt(-2, 18, 0),
      status: "done",
      updatedAt: seed + 11,
    },
    {
      id: "c12",
      title: "晚餐后散步 30 分钟",
      notes: "",
      tags: ["life"],
      due: isoAt(-1, 19, 30),
      status: "done",
      updatedAt: seed + 12,
    },
    {
      id: "c13",
      title: "看完《观海》第三季",
      notes: "",
      tags: ["life"],
      due: isoAt(-4, 21, 0),
      status: "archive",
      updatedAt: seed + 13,
    },
    {
      id: "c14",
      title: "Q3 复盘会准备",
      notes: "材料已归档到共享盘。",
      tags: ["work"],
      due: isoAt(-9, 14, 0),
      status: "archive",
      updatedAt: seed + 14,
    },
  ];
}

export const cards = signal<Card[]>(sampleCards());

/**
 * A tag is the user's, not the app's: a name and one of the palette's five
 * hues. It carries a stamp and a tombstone like a card does, because tags sync
 * the same way — a tag renamed or removed on one device must not come back from
 * the other.
 */
export type Tag = {
  id: string;
  label: string;
  hue: Hue;
  updatedAt: number;
  deleted?: boolean;
};

export function sampleTags(): Tag[] {
  return [
    { id: "work", label: "工作", hue: "blue", updatedAt: 0 },
    { id: "personal", label: "个人", hue: "green", updatedAt: 0 },
    { id: "study", label: "学习", hue: "purple", updatedAt: 0 },
    { id: "life", label: "生活", hue: "amber", updatedAt: 0 },
    { id: "urgent", label: "紧急", hue: "red", updatedAt: 0 },
  ];
}

export const tags = signal<Tag[]>(sampleTags());

/** Every tag still in use, without tombstones. */
export function liveTags(all: Tag[]): Tag[] {
  return all.filter((t) => !t.deleted);
}

/** The tags as they show. Views read this, never `tags`. */
export function boardTags(): Tag[] {
  return liveTags(tags());
}

/**
 * The tag an id names. A card can arrive from the other device a tick before its
 * tag does, so an unknown id draws as itself instead of as someone else's tag.
 */
export function tagOf(id: string): Tag {
  return tags().find((t) => t.id === id && !t.deleted) ?? { id, label: id, hue: "blue", updatedAt: 0 };
}

/** The first hue no tag uses yet, so the five stay distinct without a picker. */
function nextHue(): Hue {
  const used = new Set(boardTags().map((t) => t.hue));
  return (HUES.find((h) => !used.has(h.id)) ?? HUES[boardTags().length % HUES.length]).id;
}

export function addTag(label: string): void {
  const text = label.trim();
  if (!text) return;
  const stamp = now();
  const hue = nextHue();
  tags.update((all) => [...all, { id: newId("t"), label: text, hue, updatedAt: stamp }]);
}

export function patchTag(id: string, patch: Partial<Pick<Tag, "label" | "hue">>) {
  const stamp = now();
  tags.update((all) => all.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: stamp } : t)));
}

/**
 * Removing a tag also strips it from the cards that carry it: the id would
 * otherwise point at nothing. Each touched card is stamped, so the strip reaches
 * the other device through the card merge.
 */
export function removeTag(id: string) {
  const stamp = now();
  tags.update((all) => all.map((t) => (t.id === id ? { ...t, deleted: true, updatedAt: stamp } : t)));
  cards.update((all) =>
    all.map((c) =>
      c.tags.includes(id) ? { ...c, tags: c.tags.filter((x) => x !== id), updatedAt: stamp } : c,
    ),
  );
}

export function byStatus(status: Status): Card[] {
  return cards().filter((c) => c.status === status);
}

export function addCard(partial: Pick<Card, "title" | "notes" | "tags" | "due">) {
  const id = newId("c");
  const stamp = now();
  cards.update((all) => [
    ...all,
    { id, status: "todo", updatedAt: stamp, ...partial },
  ]);
  return id;
}

export function patchCard(id: string, patch: Partial<Card>) {
  const stamp = now();
  cards.update((all) =>
    all.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: stamp } : c)),
  );
}

export function moveCard(id: string, status: Status, index: number) {
  const stamp = now();
  cards.update((all) => {
    const card = all.find((c) => c.id === id);
    if (!card) return all;
    const rest = all.filter((c) => c.id !== id);
    const target = rest.filter((c) => c.status === status);
    const before = rest.filter((c) => c.status !== status);
    target.splice(Math.max(0, Math.min(index, target.length)), 0, {
      ...card,
      status,
      updatedAt: stamp,
    });
    return [...before, ...target];
  });
}

/**
 * Removing keeps a tombstone instead of dropping the row: a dropped id would be
 * pushed straight back by the other device on the next merge.
 */
export function removeCard(id: string) {
  const stamp = now();
  cards.update((all) =>
    all.map((c) => (c.id === id ? { ...c, deleted: true, updatedAt: stamp } : c)),
  );
}

/**
 * Puts a removed card back. The tombstone kept every field, so a restore is
 * the same row with a fresh stamp — which is also what beats the tombstone on
 * the other device: undo is an ordinary edit, not a case in the merge.
 */
export function restoreCard(id: string) {
  const stamp = now();
  cards.update((all) =>
    all.map((c) => (c.id === id ? { ...c, deleted: false, updatedAt: stamp } : c)),
  );
}

/**
 * A card with nothing in it yet.
 *
 * 新建 opens a blank card to type into; closing that panel without typing
 * should leave the board exactly as it was, rather than a 「未命名卡片」 in 待办
 * that nobody decided to make. A title, a note, a tag or a deadline is what
 * makes it a card, and then it stays.
 */
export function isBlank(card: Card): boolean {
  return !card.deleted && !card.title.trim() && !card.notes.trim() && card.tags.length === 0 && !card.due;
}

/** A way back from what just happened: at most one at a time. */
export const undoable = signal<{ label: string; undo: () => void } | null>(null);

/** How long the way back is offered. */
const UNDO_MS = 6000;

let undoTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Offers to take the last action back, for a few seconds.
 *
 * One at a time: a second offer replaces the first rather than stacking. The
 * toast is one line at the foot of the window, and two lines of 「已删除」 with
 * two 撤销 buttons is a decision nobody wants to make at speed.
 */
export function offerUndo(label: string, undo: () => void): void {
  if (undoTimer) clearTimeout(undoTimer);
  undoable.set({ label, undo });
  undoTimer = setTimeout(dismissUndo, UNDO_MS);
}

/** Closes the offer: its time ran out, or the user said no. */
export function dismissUndo(): void {
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = null;
  undoable.set(null);
}

/** Takes the offer. It closes first, so the undo cannot offer itself again. */
export function takeUndo(): void {
  const offer = undoable();
  dismissUndo();
  offer?.undo();
}

/** A card's title, or the name a card with no title shows as. */
function nameOf(card: Card): string {
  return card.title.trim() || "未命名卡片";
}

/**
 * Removes a card and offers a way back.
 *
 * Deleting no longer asks first: the tombstone carries every field, so a delete
 * is a row that can be written again, and one line saying so is cheaper than a
 * native alert standing between the press and its outcome. 标签 is the other
 * way round — removing a tag strips it from cards the user is not looking at —
 * and it still asks.
 */
export function removeWithUndo(id: string): void {
  const card = cards().find((c) => c.id === id && !c.deleted);
  if (!card) return;
  removeCard(id);
  offerUndo(`已删除「${nameOf(card)}」`, () => restoreCard(id));
}

/**
 * Moves a card from a control — a status chip, a check circle — and offers to
 * take the move back when it hides the work.
 *
 * 已完成 and 归档 are the two columns a card is hard to find in again; a move
 * back to 待办 or 进行中 needs no offer, because the chip that made it is still
 * under the pointer. Dragging is not offered either: the board itself is the
 * way back.
 */
export function setStatus(id: string, status: Status): void {
  const card = cards().find((c) => c.id === id && !c.deleted);
  if (!card || card.status === status) return;
  const before = card.status;
  patchCard(id, { status });
  if (status !== "done" && status !== "archive") return;
  offerUndo(`${status === "archive" ? "已归档" : "已完成"}「${nameOf(card)}」`, () =>
    patchCard(id, { status: before }),
  );
}

/** Every card still on the board, without tombstones. */
export function liveCards(all: Card[]): Card[] {
  return all.filter((c) => !c.deleted);
}

/**
 * How long finished work stays in 已完成 before it is filed away.
 *
 * 已完成 is a place to look at what was just done, not a second archive: work
 * left there for a week has stopped being news, and a column that only grows
 * makes the two cards that matter this afternoon hard to find.
 */
export const AUTO_ARCHIVE_DAYS = 7;

const AUTO_ARCHIVE_MS = AUTO_ARCHIVE_DAYS * 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * The finished cards older than the archive delay, by id.
 *
 * There is no `doneAt`: adding a field would mean a column in the file and a
 * rule in the merge for a number nobody reads. `updatedAt` is the stand-in —
 * finishing a card writes it, so the time a card has sat in 已完成 is the time
 * since its last write, and a card finished a week ago and untouched since reads
 * exactly right. A card touched this morning starts its week again, which is
 * the forgiving direction: nothing disappears from 已完成 the day after it was
 * finished.
 */
export function staleDone(all: Card[], at: number): string[] {
  return all
    .filter((c) => !c.deleted && c.status === "done" && at - c.updatedAt > AUTO_ARCHIVE_MS)
    .map((c) => c.id);
}

/**
 * Files away the work that has sat in 已完成 for longer than the delay.
 *
 * Written as an ordinary patch with a fresh stamp, not through `setStatus`:
 * this is housekeeping the user did not just press, so there is nothing to
 * offer back — the card is in 归档, one column to the left of where it was, and
 * moving it back is a drag. Running it on both devices is harmless: the first
 * run stamps the card, the other finds nothing stale, and the merge sees an
 * ordinary edit either way.
 */
export function archiveStaleDone(at = Date.now()): void {
  for (const id of staleDone(cards(), at)) patchCard(id, { status: "archive" });
}

/** Runs the filing once at launch, then once an hour while the app is open. */
export function startAutoArchive(): void {
  archiveStaleDone();
  setInterval(() => archiveStaleDone(), HOUR_MS);
}

/** The board as it shows: no tombstones. Views read this, never `cards`. */
export function board(): Card[] {
  return liveCards(cards());
}

/**
 * "今天 15:15" / "明天 09:00" / "11月12日 14:00" / "2027年1月5日 14:00" /
 * "已逾期 · 昨天 18:00".
 *
 * The day is read through `epochOf`, never `new Date(iso)`: a due is written
 * without a zone, and an engine that reads a bare stamp as UTC would show the
 * wrong hour on every card outside Greenwich.
 */
export function dueLabel(iso: string): { text: string; tone: "normal" | "soon" | "late" } {
  const due = new Date(epochOf(iso));
  const current = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(due) - startOfDay(current)) / 86_400_000);
  const hm = `${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}`;
  const overdue = due.getTime() < current.getTime();
  // A deadline in another year names that year: 「1月5日」 on a board read in
  // December would be this year's January, which has already gone.
  const sameYear = due.getFullYear() === current.getFullYear();
  const day =
    days === 0
      ? "今天"
      : days === 1
        ? "明天"
        : days === -1
          ? "昨天"
          : `${sameYear ? "" : `${due.getFullYear()}年`}${due.getMonth() + 1}月${due.getDate()}日`;
  // The time always shows: a deadline the user set to 14:00 and an app that
  // answers "11月12日" has thrown away the only part they cared about.
  const text = `${day} ${hm}`;
  if (overdue) return { text: `已逾期 · ${text}`, tone: "late" };
  if (days === 0) return { text, tone: "soon" };
  return { text, tone: "normal" };
}
