import { Storage } from "nsh";
import { homedir } from "os";
import process from "process";
import { Backup } from "app/native";
import { dayStamp, type BackupEntry, type BackupFixture } from "./backup";
import { boardOnDisk } from "./persist";

/**
 * Where a board file comes from and goes to: the data directory, the day's
 * snapshot, and the Downloads folder.
 *
 * Split from `backup.ts` because a test file is bundled on its own and only the
 * app bundle may load a native module — `Palette.test.tsx` imports the palette,
 * which needs the verbs, and the verbs' rules must not drag `app/native` into a
 * test bundle. Nothing here decides anything: each function is a call to the
 * crate (`src/backup.rs`) or to the platform, and the decision it wraps is a
 * pure function on the other side.
 */

/** The folder the daily snapshots live in, or `""` on a host without one. */
function backupDir(): string {
  return process.dataDir ?? "";
}

/** A backup folder handed to this launch instead of the app's own. */
const FIXTURE_KEY = "navigator.backups";

/** Where this launch's backups come from, once `adoptBackups` has read it. */
let fixture: BackupFixture | null = null;

/**
 * Reads where this launch's backups come from.
 *
 * `navigator.backups` is the same kind of switch `navigator.persist` is: a test
 * has no data directory — deliberately, since a test that could read the
 * developer's folder could restore the developer's board — and the restore rule
 * is worth testing through the sheet it is shown in, not only as a function.
 * The key holds `{ entries, docs }`: what the folder would list, and each file's
 * text.
 */
export async function adoptBackups(): Promise<void> {
  try {
    const text = await Storage.getItem(FIXTURE_KEY);
    fixture = text ? (JSON.parse(text) as BackupFixture) : null;
  } catch {
    // No storage on this host, or a fixture that is not readable: the app's own
    // folder is the answer either way.
    fixture = null;
  }
}

/**
 * What the launch does once, after the board is read: take the backups it can
 * see, and then snapshot today's board.
 */
export async function startBackups(): Promise<void> {
  await adoptBackups();
  snapshotBoard();
}

/**
 * The day's snapshot, written once a launch when the board has a file.
 *
 * Called after `hydrate`, so it copies the user's board rather than the samples
 * the app starts with. A failure is logged and nothing else: a backup is a
 * safety net, and one that takes the launch down with it is a net with a hole in
 * it.
 */
export function snapshotBoard(): void {
  // A board in memory (a test's, or a launch with no storage) has no folder to
  // write into, and must never reach the one the real app uses.
  if (!process.dataDir || !boardOnDisk()) return;
  try {
    const answer = Backup.snapshot(backupDir(), dayStamp(new Date()));
    console.log(`[navigator] backup: ${answer || "none"}`);
  } catch (error) {
    console.log(`[navigator] backup failed: ${error}`);
  }
}

/** The snapshots on disk, newest first; none on a host with no folder. */
function listBackups(): BackupEntry[] {
  const dir = backupDir();
  if (!dir) return [];
  try {
    return JSON.parse(Backup.list(dir)) as BackupEntry[];
  } catch {
    return [];
  }
}

/** The snapshots this launch can restore from, newest first. */
export function backupEntries(): BackupEntry[] {
  return fixture ? fixture.entries : listBackups();
}

/** One snapshot's text. */
export function backupText(name: string): string {
  return fixture ? (fixture.docs[name] ?? "") : Backup.read(backupDir(), name);
}

/** Where an export lands: the Downloads folder the platform gives the user. */
export function downloadsFolder(): string {
  return `${homedir()}/Downloads`;
}

/**
 * Writes an export into `dir` and answers with the path it wrote.
 *
 * The write is the crate's, not the interface's: a native process may write
 * anywhere the user can (with the platform's own permission prompt the first
 * time), where the script's `fs` is held to the app's data directory.
 */
export function writeExport(name: string, text: string, dir = downloadsFolder()): string {
  return Backup.write(dir, name, text);
}
