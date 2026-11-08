/**
 * A checklist in a note, as text: `- [ ] 事项` and `- [x] 事项` lines.
 *
 * A checklist is a way of writing a note, not a field on a card. That decision
 * is what keeps it free: the merge already carries a note, the file already
 * stores it, the export already writes it, and a card whose checklist is edited
 * on the phone and on the Mac reconciles the way every other note does. The
 * price is that the marker is text the user could also type by hand — which is
 * the point.
 *
 * Everything here is a pure function of a string, so the parsing, the toggle and
 * the append are all tested without a window. A **line** is half of what
 * `split(/(\r\n|\n|\r)/)` gives; `toggleItem` rebuilds the string with those
 * separators untouched, so CRLF and indentation survive a press.
 */

export type ChecklistItem = {
  /** Which line of the note it is, counting from 0 — what `toggleItem` takes. */
  line: number;
  /** The item's text, without the bullet or the box. */
  text: string;
  done: boolean;
};

export type Checklist = {
  items: ChecklistItem[];
  done: number;
  total: number;
};

/**
 * One item: optional indent, `-` or `*`, the box, then the text.
 *
 * `[X]` counts as done as well as `[x]`: a capital is what a phone's keyboard
 * gives you first, and an item typed on the phone must not read as unfinished
 * because of it.
 */
const ITEM = /^(\s*)[-*][ \t]+\[([ xX])\][ \t]*(.*)$/;

/** The lines of a note, with their separators dropped: `toggleItem`'s indexing. */
function linesOf(notes: string): string[] {
  return notes.split(/\r\n|\n|\r/);
}

/** The checklist lines of a note, and how many of them are ticked. */
export function parseChecklist(notes: string): Checklist {
  const items: ChecklistItem[] = [];
  linesOf(notes).forEach((text, line) => {
    const found = ITEM.exec(text);
    if (!found) return;
    const mark = found[2];
    items.push({ line, text: found[3] ?? "", done: mark === "x" || mark === "X" });
  });
  return { items, done: items.filter((item) => item.done).length, total: items.length };
}

/**
 * The note with `line`'s box flipped, and nothing else changed.
 *
 * The rest of the line — its indent, its bullet, the text after the box — is
 * kept byte for byte, and so is every other line and every separator: the note
 * is the user's prose, and a checklist press must not be a re-format of it.
 */
export function toggleItem(notes: string, line: number): string {
  const parts = notes.split(/(\r\n|\n|\r)/);
  const at = line * 2;
  const raw = parts[at];
  if (raw === undefined || !ITEM.test(raw)) return notes;
  parts[at] = raw.replace(/\[([ xX])\]/, (_, mark: string) => (mark === " " ? "[x]" : "[ ]"));
  return parts.join("");
}

/** A new item at the foot of the note, on a line of its own. */
export function appendItem(notes: string): string {
  if (!notes) return "- [ ] ";
  return /(\r|\n)$/.test(notes) ? `${notes}- [ ] ` : `${notes}\n- [ ] `;
}

/**
 * The note as a card's two-line preview shows it: the boxes taken off, and the
 * lines kept as lines.
 *
 * A card is 250 points wide, and a note that is mostly a checklist would spend
 * its preview on `- [ ]` five times. The words are what the row is for, so the
 * marker goes and the line stays: two lines of a list read as two things, and a
 * preview that ran them together would read as one long sentence.
 */
export function notePreview(notes: string): string {
  return linesOf(notes)
    .map((line) => {
      const found = ITEM.exec(line);
      return found ? (found[3] ?? "") : line;
    })
    .join("\n")
    .trim();
}
