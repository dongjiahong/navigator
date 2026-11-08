import { signal } from "nsh";
import { board, tagOf, type Card } from "./data";

/**
 * The view the board is narrowed to. Both devices read the same two signals, so
 * a filter set on the Mac is still there when the phone opens.
 */
export const searchQuery = signal("");
export const tagFilter = signal<string | null>(null);

export function isFiltering() {
  return searchQuery().trim() !== "" || tagFilter() !== null;
}

/** A card shows while it matches the one tag (if any) and the search text. */
export function matchesFilter(card: Card) {
  const tag = tagFilter();
  if (tag !== null && !card.tags.includes(tag)) return false;

  const needle = searchQuery().trim().toLowerCase();
  if (!needle) return true;

  // Tags are searchable by their displayed name, so typing 工作 finds the
  // cards tagged 工作 even when the word is nowhere in their text.
  const haystack = `${card.title}\n${card.notes}\n${card.tags.map((id) => tagOf(id).label).join(" ")}`;
  return haystack.toLowerCase().includes(needle);
}

/** Every card still on the board that the current filter lets through. */
export function filteredBoard() {
  return board().filter(matchesFilter);
}

export function clearFilters() {
  searchQuery.set("");
  tagFilter.set(null);
}
