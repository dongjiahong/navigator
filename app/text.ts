/**
 * Text the interface measures and reads: how tall a field has to be to show it,
 * and which links are in it.
 *
 * Both are pure functions of a string, so both are tested without a window.
 */

/**
 * A fixed height for a multiline field, from how many lines its text takes.
 *
 * `Input` has no height of its own, and a box tall enough for the longest card
 * would leave a hole under every short one — so the height is computed from the
 * text, capped at `maxLines`. Past the cap the outer `Scroll` carries the rest:
 * a card's note is not a document, and a panel that grows to its longest note
 * would push the fields under it off the screen.
 *
 * `perLine` is a rough count of the characters that fit a line at the field's
 * size.
 */
export function fieldHeight(text: string, lineHeight: number, maxLines: number, perLine: number): number {
  const lines = Math.max(1, Math.min(maxLines, Math.ceil([...text].length / perLine)));
  return lines * lineHeight + 6;
}

/**
 * How many characters of `fontSize` fit a line `width` points wide, rounded
 * down with a margin.
 *
 * A CJK character is exactly one em wide, so `width / fontSize` is the true
 * count for Chinese and an underestimate for Latin text. The extra 8% is there
 * so the estimate lands on the tall side: a field one line too tall is a little
 * air, and a field one line too short cuts a character off the bottom, which is
 * the bug this exists to fix.
 */
export function charsPerLine(width: number, fontSize: number): number {
  return Math.max(4, Math.floor(width / (fontSize * 1.08)));
}

/**
 * A URL in a note: `http(s)://` and the characters a URL is allowed to carry.
 *
 * The set is the ASCII one on purpose. Prose has no separator between a link and
 * the words after it — 「看 https://example.com/a，然后回来」 and
 * 「见https://example.com/a然后」 are both how Chinese is written — so the match
 * ends where a URL ends and a sentence begins. A host or a path written in CJK
 * is not matched: browsers percent-encode those, so a typed address is ASCII.
 */
const URL_IN_TEXT = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/gi;

/**
 * Punctuation that ends the sentence, not the URL. `).,;` are legitimate inside
 * a path, so only a *trailing* run is dropped, and a closing bracket is only
 * dropped when nothing opened it.
 */
const TRAILING = /[.,;:!?、。，；：！？…—–'"”’]+$/u;

/** The bracket a closing one pairs with. */
const CLOSERS: Record<string, string> = { ")": "(", "）": "（", "]": "[", "】": "【", "}": "{", ">": "<", "»": "«" };

/** How many times `char` is in `text`. */
function countOf(text: string, char: string): number {
  return [...text].filter((c) => c === char).length;
}

/**
 * The first URL of `raw`, without the sentence around it; `""` when it is not
 * one. A note is written in prose, and prose puts punctuation right up against
 * a link: `看 https://example.com/a，然后回来` and `(https://example.com/b).`
 * both carry a URL that ends before the punctuation does.
 */
function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const trimmed = url.replace(TRAILING, "");
    if (trimmed === url) break;
    url = trimmed;
  }
  // `…/Foo_(bar)` keeps its bracket, `(see …/b)` does not: a closer only
  // belongs to the URL when the URL opened it.
  for (;;) {
    const last = url[url.length - 1];
    const opener = CLOSERS[last];
    if (!opener || countOf(url, opener) >= countOf(url, last)) break;
    url = url.slice(0, -1);
  }
  // `https://` with nothing after it names nothing.
  const host = url.replace(/^https?:\/\//i, "");
  if (!host || host.startsWith("/")) return "";
  return url;
}

/**
 * The http(s) links in a note, in the order they were written, each once.
 *
 * A card's note is free text, so a link in it is a link the user typed rather
 * than one the app attached: the note is shown as it was written, and the links
 * in it are offered under it as rows that open in the browser.
 */
export function linksIn(text: string): string[] {
  const out: string[] = [];
  for (const match of text.match(URL_IN_TEXT) ?? []) {
    const url = trimUrl(match);
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}
