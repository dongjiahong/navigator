import { signal } from "nsh";
import { board, boardTags, epochOf, tagOf, type Card } from "./data";

/**
 * The view the board is narrowed to. Both devices read the same three signals,
 * so a filter set on the Mac is still there when the phone opens.
 *
 * The three narrow the board together: a card shows when it carries any of the
 * selected tags, sits in the selected date condition, and matches the search.
 */
export const searchQuery = signal("");
/**
 * The tags the board is narrowed to. An empty list is every tag; several are
 * "any of them", because a user narrowing to 工作 and 学习 means either.
 */
export const tagFilters = signal<string[]>([]);

/** One of the three date conditions a card can be narrowed to. */
export type DueCondition = "today" | "overdue" | "none";

/** The date condition in force; `null` is every day. */
export const dueFilter = signal<DueCondition | null>(null);

/** What each condition is called, wherever it is named. */
export const DUE_LABEL: Record<DueCondition, string> = {
  today: "今天",
  overdue: "已逾期",
  none: "无日期",
};

/**
 * The tag selection that is still a tag on the board.
 *
 * A removed tag drops out by itself rather than being pruned from the signal: a
 * tag is removed from another component (the manager, the other device), and a
 * filter left holding its id would count as a filter while showing no chip —
 * a board silently narrowed to nothing. Reading the live list is the one rule,
 * so every reader agrees.
 */
export function selectedTags(): string[] {
  const live = new Set(boardTags().map((tag) => tag.id));
  return tagFilters().filter((id) => live.has(id));
}

/** Adds a tag to the selection, or takes it out when it is already in. */
export function toggleTagFilter(id: string): void {
  const now = tagFilters();
  tagFilters.set(now.includes(id) ? now.filter((each) => each !== id) : [...now, id]);
}

/** Takes every tag out of the selection, and leaves the date and the search alone. */
export function clearTagFilters(): void {
  tagFilters.set([]);
}

/** Sets the date condition; `null` shows every day. */
export function setDueFilter(next: DueCondition | null): void {
  dueFilter.set(next);
}

export function isFiltering() {
  return searchQuery().trim() !== "" || selectedTags().length > 0 || dueFilter() !== null;
}

/**
 * The filter, in words: 「工作、学习 · 已逾期」, or with a search,
 * 「工作 · 「周报」」.
 *
 * One line, built from what is actually being applied, so the notice over the
 * phone's list and the palette's hints say the same thing the strip does.
 */
export function filterSummary(): string {
  const parts: string[] = [];
  const tags = selectedTags().map((id) => tagOf(id).label);
  if (tags.length > 0) parts.push(tags.join("、"));
  const due = dueFilter();
  if (due !== null) parts.push(DUE_LABEL[due]);
  const words = searchQuery().trim();
  if (words) parts.push(`「${words}」`);
  return parts.join(" · ");
}

/** A date condition a card answers to. */
export type DueBucket = "today" | "overdue" | "none";

/** Work that is still open: finished and filed cards carry no deadline. */
function isOpen(card: Card): boolean {
  return !card.deleted && card.status !== "done" && card.status !== "archive";
}

/**
 * The date conditions `card` answers to, at `now`.
 *
 * Two, for one moment: a deadline set for today at 09:00 is 今天 all day and
 * 已逾期 from 09:00 on, which is the same judgement the amber and red pills make
 * — `epochOf` and "before now", never a second reading of the clock. Settled
 * work answers to none of them: a finished card's time is history, and the
 * columns it lives in have no deadline to warn about.
 */
export function dueBuckets(card: Card, now: number): DueBucket[] {
  if (!isOpen(card)) return [];
  if (!card.due) return ["none"];

  const at = epochOf(card.due);
  const out: DueBucket[] = [];
  if (at < now) out.push("overdue");

  const due = new Date(at);
  const today = new Date(now);
  if (
    due.getFullYear() === today.getFullYear() &&
    due.getMonth() === today.getMonth() &&
    due.getDate() === today.getDate()
  ) {
    out.push("today");
  }
  return out;
}

/** Whether the card falls under the date condition `filter`. */
export function inDueFilter(card: Card, filter: DueCondition, now: number): boolean {
  return dueBuckets(card, now).includes(filter);
}

/**
 * How many cards on the board each condition holds.
 *
 * Counted over every open card on the board, not over what another filter has
 * already hidden: the number beside 今天 says how much work is due today, and a
 * chip whose count moved when a tag was picked would be counting the view
 * rather than the board.
 */
export function dueCounts(all: Card[], now: number): Record<DueCondition, number> {
  const counts: Record<DueCondition, number> = { today: 0, overdue: 0, none: 0 };
  for (const card of all) for (const bucket of dueBuckets(card, now)) counts[bucket] += 1;
  return counts;
}

/** A card shows while it carries any selected tag, sits in the date group, and matches the search. */
export function matchesFilter(card: Card, now: number = Date.now()) {
  const tags = selectedTags();
  if (tags.length > 0 && !card.tags.some((id) => tags.includes(id))) return false;

  const due = dueFilter();
  if (due !== null && !inDueFilter(card, due, now)) return false;

  const needle = searchQuery().trim().toLowerCase();
  if (!needle) return true;

  // Tags are searchable by their displayed name, so typing 工作 finds the
  // cards tagged 工作 even when the word is nowhere in their text.
  const haystack = `${card.title}\n${card.notes}\n${card.tags.map((id) => tagOf(id).label).join(" ")}`;
  return haystack.toLowerCase().includes(needle);
}

/** Every card still on the board that the current filter lets through. */
export function filteredBoard(now: number = Date.now()) {
  // One reading of the clock for the whole board: two cards are never judged
  // against two different "now"s on the same frame.
  return board().filter((card) => matchesFilter(card, now));
}

export function clearFilters() {
  searchQuery.set("");
  tagFilters.set([]);
  dueFilter.set(null);
}
