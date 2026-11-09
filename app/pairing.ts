import { Storage, signal } from "nsh";

/**
 * The six digits that let a phone read this board.
 *
 * The Mac serves the board on its LAN, and a LAN at a coffee shop is everybody's
 * LAN. So the Mac keeps a code, shows it in its own title bar, and the phone
 * proves it knows it. The proof is the Rust side's (`app/src/auth.rs`); this
 * file is the part both the Mac and the phone can share without touching the
 * crate at all — where the digits are kept, what they look like, and what is
 * said about them — which is also why it imports nothing native: the words are
 * tested on their own, without a service to talk to.
 *
 * **Once per phone, not once per session.** The digits live in the device's own
 * storage, so a phone that has been paired stays paired across restarts; the
 * same key holds the Mac's code here and the phone's copy of it there, because
 * both are "the pairing code on this device" and neither device is both.
 *
 * The code is kept out of the board's file on purpose: the board is the user's
 * work, and a small setting does not belong in the same tables as their cards.
 */

/** The digits, in this device's own storage. */
const CODE_KEY = "navigator.pairCode";

/**
 * The code this device knows: the one the Mac answers to, or the one this phone
 * proves with. Empty until it is made (Mac) or typed in (phone).
 */
export const pairCode = signal("");

/** Whether the Mac's code is on screen. */
export const pairOpen = signal(false);

/**
 * Why an exchange is not happening, when it is the code's fault.
 *
 * `need` — this phone has never been given the Mac's six digits; `wrong` — the
 * Mac would not take the ones it has; `locked` — it guessed too often and the
 * Mac asked it to wait; `ok` — nothing in the way.
 */
export type PairState = "need" | "wrong" | "locked" | "ok";

/** What the pairing code is doing, if anything. */
export const pairState = signal<PairState>("ok");

/** Only the digits, and never more than six: what a code field accepts. */
export function digits(text: string): string {
  return text.replace(/\D/g, "").slice(0, 6);
}

/** Whether `text` is a whole code yet. */
export function canPair(text: string): boolean {
  return digits(text).length === 6;
}

/** A code as the Mac draws it: `482 913`, because six digits in a row are read
 * as one number. */
export function pairCodeLabel(code: string): string {
  const six = digits(code);
  return six.length === 6 ? `${six.slice(0, 3)} ${six.slice(3)}` : six;
}

/**
 * The pairing state a status body names.
 *
 * Anything else the crate might say — `ok`, a word from a newer version — reads
 * as `ok`: a phone that does not understand a warning should say nothing rather
 * than invent one, and the crate hands out the wait itself either way.
 */
export function readPair(status: { pair?: string }): PairState {
  const pair = status.pair;
  return pair === "need" || pair === "wrong" || pair === "locked" ? pair : "ok";
}

/**
 * What a pairing state says, or nothing when it is not in the way.
 *
 * A phone that has no code, or whose code the Mac refused, is the user's to fix
 * in one press — so it is said in the same one line, at the same quiet tone, as
 * every other thing sync has to say.
 */
export function pairLine(pair: PairState = pairState()): string {
  switch (pair) {
    case "need":
      return "需要配对码";
    case "wrong":
      return "配对码不对";
    case "locked":
      return "尝试太多次，稍后再试";
    default:
      return "";
  }
}

/** The code this phone has been given, or empty. */
export async function storedCode(): Promise<string> {
  return digits((await Storage.getItem(CODE_KEY)) ?? "");
}

/**
 * What one peer in the device list is doing, in one quiet word.
 *
 * The code comes before the connection: a device that answers and will not let
 * this one in is a device the user can fix in a moment, and "未连上" would send
 * them looking at the network instead.
 */
export function peerLine(peer: { ok: boolean; pair?: string }): string {
  if (peer.pair === "wrong") return "配对码不对";
  if (peer.pair === "locked") return "稍后再试";
  return peer.ok ? "已同步" : "未连上";
}

/** Keeps `code` on this device, and shows it wherever it is read. */
export async function saveCode(code: string): Promise<void> {
  await Storage.setItem(CODE_KEY, digits(code));
  pairCode.set(digits(code));
}

export function openPairPanel(): void {
  pairOpen.set(true);
}

export function closePairPanel(): void {
  pairOpen.set(false);
}
