//! The board's own backups, and the way a board leaves and comes back.
//!
//! Once a day the whole document is copied to a JSON file beside the SQLite
//! one, and the copies past a week are dropped. The copy is the *whole*
//! document — cards, tags, and the tombstones a delete left behind — because a
//! snapshot that dropped the tombstones would resurrect every card removed
//! before it: a restore merges rows with a fresh stamp, so a row that no longer
//! says `deleted` is a card that comes back from the dead.
//!
//! A backup is not a second sync channel. Nothing reads one unless the user
//! asks to restore, the files live in the app's own data directory where
//! nothing else writes them, and the interface only calls `snapshot` — the
//! restore decision is made in TypeScript (`planRestore`), where it is a pure
//! function with tests.
//!
//! Two rules keep the folder honest:
//!
//! - **A day is written once.** The name carries the day, so a launch that
//!   finds today's file leaves it alone and reports `exists`: a board edited
//!   after the morning's snapshot does not need a new file, it needs tomorrow's.
//! - **A file name is a shape, not a path.** Only `navigator-YYYY-MM-DD.json`
//!   is ever read, which is what keeps a restore from being asked for
//!   `../../board.sqlite3` by a file the folder did not make.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

use crate::board;

/// How many daily snapshots are kept. A week of "the board as it was" is what a
/// user reaches for after a bad edit; older copies stop being read.
pub const KEEP: usize = 7;

const PREFIX: &str = "navigator-";
const SUFFIX: &str = ".json";

/// The folder the snapshots live in: under the board's own directory, so
/// deleting the app's data still deletes everything about it.
pub fn folder(dir: &str) -> PathBuf {
    Path::new(dir).join("backups")
}

/// `YYYY-MM-DD` with a real month and day: what a snapshot is named for.
pub fn is_day(day: &str) -> bool {
    let b = day.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    let digits = |from: usize, to: usize| b[from..to].iter().all(|c| c.is_ascii_digit());
    if !digits(0, 4) || !digits(5, 7) || !digits(8, 10) {
        return false;
    }
    // Read from the bytes: the digits are known to be ASCII by now, and a
    // string sliced at a byte offset could split a character and panic.
    let month = (b[5] - b'0') * 10 + (b[6] - b'0');
    let date = (b[8] - b'0') * 10 + (b[9] - b'0');
    (1..=12).contains(&month) && (1..=31).contains(&date)
}

/// `navigator-YYYY-MM-DD.json`, and nothing else. The day is fixed width, so a
/// name carrying a separator cannot pass: `navigator-../x.json` is seven bytes
/// of "day" and is refused before a path is ever built from it.
pub fn is_backup_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix(PREFIX) else {
        return false;
    };
    let Some(day) = rest.strip_suffix(SUFFIX) else {
        return false;
    };
    is_day(day)
}

/// A plain file name the interface may write into a folder: no separators, no
/// parent, nothing that starts a hidden file.
pub fn is_plain_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 120
        && !name.starts_with('.')
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains('\0')
}

/// The snapshot names in `names`, newest first. The date is fixed width and
/// zero-padded, so a plain descending sort *is* newest first.
pub fn newest_first(names: &[String]) -> Vec<String> {
    let mut kept: Vec<String> = names.iter().filter(|n| is_backup_name(n)).cloned().collect();
    kept.sort();
    kept.reverse();
    kept
}

/// The names past the retention window — the oldest copies, which go.
pub fn expired(names: &[String]) -> Vec<String> {
    newest_first(names).into_iter().skip(KEEP).collect()
}

fn millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The names in `folder`, valid or not; `expired` filters them.
fn names_in(folder: &Path) -> Vec<String> {
    let mut names = Vec::new();
    if let Ok(entries) = fs::read_dir(folder) {
        for entry in entries.flatten() {
            if let Some(name) = entry.file_name().to_str() {
                names.push(name.to_owned());
            }
        }
    }
    names
}

/// Writes `text` as `name` unless a file of that name is already there; whether
/// it wrote. Written beside the target and renamed into place, so a launch that
/// dies mid-write leaves no half a backup to restore from.
fn write_new(folder: &Path, name: &str, text: &str) -> Result<bool, String> {
    let path = folder.join(name);
    if path.exists() {
        return Ok(false);
    }
    fs::create_dir_all(folder).map_err(|e| format!("{}: {e}", folder.display()))?;
    let temp = folder.join(format!(".{name}.tmp"));
    fs::write(&temp, text).map_err(|e| format!("{}: {e}", temp.display()))?;
    fs::rename(&temp, &path).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(true)
}

/// Drops the snapshots past the window; how many went.
fn rotate(folder: &Path) -> Result<usize, String> {
    let mut dropped = 0;
    for name in expired(&names_in(folder)) {
        if fs::remove_file(folder.join(&name)).is_ok() {
            dropped += 1;
        }
    }
    Ok(dropped)
}

/// How many rows of `key` in `doc` are still live.
fn live(doc: &Value, key: &str) -> usize {
    doc.get(key)
        .and_then(Value::as_array)
        .map(|rows| rows.iter().filter(|row| row.get("deleted") != Some(&Value::Bool(true))).count())
        .unwrap_or(0)
}

/// Writes today's snapshot of the open board, and returns the name it wrote,
/// `"exists"` when today's is already there, and `""` when there is nothing to
/// write to (a board in memory, a test).
///
/// `day` is the device's own day, `YYYY-MM-DD`, handed in by the interface: the
/// day a backup is named for is the day the user is living in, not UTC's.
pub fn snapshot(dir: &str, day: &str) -> Result<String, String> {
    if dir.trim().is_empty() || !is_day(day) {
        return Ok(String::new());
    }
    // The store holds the truth, not the list on screen: a change that reached
    // the file from the phone this morning is part of tonight's snapshot even
    // if this window never drew it.
    let all: Value = board::with(|db| board::all(&db.conn))
        .and_then(|text| serde_json::from_str(&text).map_err(|e| format!("bad board: {e}")))?;
    write_day(dir, day, &all)
}

/// Writes `all` — the document `board::all` reads out — as `day`'s snapshot, if
/// that file is not there yet; the name it wrote, or `exists`.
fn write_day(dir: &str, day: &str, all: &Value) -> Result<String, String> {
    let name = format!("{PREFIX}{day}{SUFFIX}");
    let folder = folder(dir);
    if !write_new(&folder, &name, &document(all))? {
        return Ok("exists".to_owned());
    }
    // Rotation is housekeeping: a folder that cannot be tidied must not turn
    // today's snapshot into a failure, and it is retried at the next launch.
    let _ = rotate(&folder);
    Ok(name)
}

/// The snapshot's text: the same shape an export has, so one parser reads both,
/// with the cards and tags exactly as the store holds them (tombstones and all).
fn document(all: &Value) -> String {
    let cards = all.get("cards").cloned().unwrap_or_else(|| json!([]));
    let tags = all.get("tags").cloned().unwrap_or_else(|| json!([]));
    json!({
        "version": 1,
        "exportedAt": millis(),
        "cards": cards,
        "tags": tags,
    })
    .to_string()
}

/// The backups on disk, newest first, as a JSON array of
/// `{ name, at, cards, tags }` — the day, when it was taken, and how much was in
/// it. A file that cannot be read or parsed is left out rather than listed as
/// an empty backup: offering a restore that would restore nothing is worse than
/// not offering it.
pub fn list(dir: &str) -> String {
    if dir.trim().is_empty() {
        return "[]".to_owned();
    }
    let folder = folder(dir);
    let mut rows: Vec<Value> = Vec::new();
    for name in newest_first(&names_in(&folder)) {
        let Ok(text) = fs::read_to_string(folder.join(&name)) else {
            continue;
        };
        let Ok(doc) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        rows.push(json!({
            "name": name,
            "at": at_of(&doc, &folder, &name),
            "cards": live(&doc, "cards"),
            "tags": live(&doc, "tags"),
        }));
    }
    Value::Array(rows).to_string()
}

/// When a snapshot was taken: the stamp in the file, or the file's own time for
/// one written before the stamp existed.
fn at_of(doc: &Value, folder: &Path, name: &str) -> i64 {
    if let Some(at) = doc.get("exportedAt").and_then(Value::as_i64) {
        return at;
    }
    fs::metadata(folder.join(name))
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// One backup's text. `name` must be a backup name: a restore cannot be asked
/// for a path.
pub fn read(dir: &str, name: &str) -> Result<String, String> {
    if dir.trim().is_empty() {
        return Err("this board has no folder to keep backups in".to_owned());
    }
    if !is_backup_name(name) {
        return Err(format!("`{name}` is not a backup name"));
    }
    let path = folder(dir).join(name);
    fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Writes an export into `dir` and answers with the path it wrote. The
/// interface builds the name (it is the one that knows the day and the hour);
/// this only refuses a name that is a path in disguise.
pub fn write(dir: &str, name: &str, text: &str) -> Result<String, String> {
    if dir.trim().is_empty() {
        return Err("there is nowhere to write it".to_owned());
    }
    if !is_plain_name(name) {
        return Err(format!("`{name}` is not a file name"));
    }
    let folder = Path::new(dir);
    fs::create_dir_all(folder).map_err(|e| format!("{}: {e}", folder.display()))?;
    let path = folder.join(name);
    fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A folder of this test's own, so nothing it writes can reach the app's.
    fn scratch(tag: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("navigator-backup-{tag}-{stamp}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn names(days: &[&str]) -> Vec<String> {
        days.iter().map(|d| format!("navigator-{d}.json")).collect()
    }

    #[test]
    fn only_a_well_formed_backup_name_is_one() {
        assert!(is_backup_name("navigator-2026-11-08.json"));
        assert!(!is_backup_name("navigator-2026-1-08.json"));
        assert!(!is_backup_name("navigator-20261108.json"));
        assert!(!is_backup_name("board.sqlite3"));
        assert!(!is_backup_name("navigator-2026-11-08.json.bak"));
        assert!(!is_backup_name("navigator-2026-13-08.json"));
        assert!(!is_backup_name("navigator-2026-11-32.json"));
        // A day that is a digit string but not a date is not a backup either.
        assert!(!is_backup_name("navigator-0000-00-00.json"));
    }

    #[test]
    fn a_name_cannot_climb_out_of_the_folder() {
        for name in [
            "../board.sqlite3",
            "../../etc/passwd",
            "navigator-2026-11-08.json/../x.json",
            "navigator-../x.json",
            "/navigator-2026-11-08.json",
            "",
        ] {
            assert!(!is_backup_name(name), "{name} must not be a backup name");
        }
        // `read` refuses before it ever builds a path.
        let dir = scratch("read");
        assert!(read(dir.to_str().unwrap(), "../board.sqlite3").is_err());
        assert!(read(dir.to_str().unwrap(), "navigator-2026-11-08.json").is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_newest_seven_stay_and_the_rest_go() {
        let all = names(&[
            "2026-11-01",
            "2026-11-02",
            "2026-11-03",
            "2026-11-04",
            "2026-11-05",
            "2026-11-06",
            "2026-11-07",
            "2026-11-08",
            "2026-11-09",
        ]);
        assert_eq!(KEEP, 7);
        assert_eq!(
            newest_first(&all),
            names(&[
                "2026-11-09",
                "2026-11-08",
                "2026-11-07",
                "2026-11-06",
                "2026-11-05",
                "2026-11-04",
                "2026-11-03",
                "2026-11-02",
                "2026-11-01",
            ])
        );
        assert_eq!(expired(&all), names(&["2026-11-02", "2026-11-01"]));
        // Seven is not eight: nothing is dropped until the eighth day.
        let week = names(&[
            "2026-11-03",
            "2026-11-04",
            "2026-11-05",
            "2026-11-06",
            "2026-11-07",
            "2026-11-08",
            "2026-11-09",
        ]);
        assert_eq!(expired(&week), Vec::<String>::new());
        // A folder that holds something else is not counted against the week.
        let mixed = [all.clone(), vec!["board.sqlite3".to_owned(), ".navigator-2026-11-01.json.tmp".to_owned()]].concat();
        assert_eq!(expired(&mixed), names(&["2026-11-02", "2026-11-01"]));
    }

    #[test]
    fn a_day_is_written_once_and_a_younger_one_is_not_overwritten() {
        let dir = scratch("once");
        let today = "navigator-2026-11-08.json";
        assert!(write_new(&dir, today, "{\"cards\":[]}").unwrap());
        // The second launch of the day finds the file and leaves it alone.
        assert!(!write_new(&dir, today, "{\"cards\":[1]}").unwrap());
        assert_eq!(fs::read_to_string(dir.join(today)).unwrap(), "{\"cards\":[]}");
        // Tomorrow is a new file, and nothing was left behind mid-write.
        assert!(write_new(&dir, "navigator-2026-11-09.json", "{}").unwrap());
        let left: Vec<String> = names_in(&dir);
        assert_eq!(left.len(), 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rotation_keeps_a_week_of_files() {
        let dir = scratch("rotate");
        for day in [
            "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07",
            "2026-11-08", "2026-11-09",
        ] {
            write_new(&dir, &format!("navigator-{day}.json"), "{}").unwrap();
        }
        // Something that is not a backup is not rotation's business.
        write_new(&dir, "notes.txt", "hands off").unwrap();
        assert_eq!(rotate(&dir).unwrap(), 2);
        let left = names_in(&dir);
        assert_eq!(left.len(), 8);
        assert!(left.contains(&"notes.txt".to_owned()));
        assert!(!left.contains(&"navigator-2026-11-01.json".to_owned()));
        assert!(!left.contains(&"navigator-2026-11-02.json".to_owned()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_board_with_no_folder_snapshots_nothing() {
        assert_eq!(snapshot("", "2026-11-08").unwrap(), "");
        // A day that is not a day would name a file a restore refuses.
        let dir = scratch("nodir");
        assert_eq!(snapshot(dir.to_str().unwrap(), "2026-1-8").unwrap(), "");
        assert_eq!(list(""), "[]");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_snapshot_is_the_whole_document_and_can_be_listed() {
        let dir = scratch("store");
        let dir_text = dir.to_str().unwrap().to_owned();
        // The document the store reads out, tombstones and all: a restore
        // writes its rows with a fresh stamp, so a card that stopped saying
        // `deleted` would come back with everything else the file had.
        let all = json!({
            "seeded": true,
            "cards": [
                {"id": "c1", "title": "写周报", "status": "todo", "updatedAt": 1},
                {"id": "c2", "title": "删掉的", "status": "todo", "updatedAt": 2, "deleted": true},
            ],
            "tags": [{"id": "work", "label": "工作", "hue": "blue", "updatedAt": 1}],
        });

        assert_eq!(write_day(&dir_text, "2026-11-08", &all).unwrap(), "navigator-2026-11-08.json");
        // The second launch of the day leaves the file alone.
        assert_eq!(write_day(&dir_text, "2026-11-08", &all).unwrap(), "exists");

        let text = read(&dir_text, "navigator-2026-11-08.json").unwrap();
        assert!(text.contains("\"deleted\":true"));
        assert!(text.contains("\"version\":1"));

        let listed: Value = serde_json::from_str(&list(&dir_text)).unwrap();
        let rows = listed.as_array().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["name"], "navigator-2026-11-08.json");
        // One card on the board, because the tombstone is not a card; the tag
        // counts as itself.
        assert_eq!(rows[0]["cards"], 1);
        assert_eq!(rows[0]["tags"], 1);
        assert!(rows[0]["at"].as_i64().unwrap() > 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_export_name_cannot_be_a_path() {
        assert!(is_plain_name("领航-20261108-1432.md"));
        assert!(!is_plain_name("../ledger.md"));
        assert!(!is_plain_name("a/b.md"));
        assert!(!is_plain_name(""));
        let dir = scratch("write");
        assert!(write(dir.to_str().unwrap(), "../escape.md", "x").is_err());
        let path = write(dir.to_str().unwrap(), "领航-20261108-1432.md", "x").unwrap();
        assert!(Path::new(&path).ends_with("领航-20261108-1432.md"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "x");
        let _ = fs::remove_dir_all(&dir);
    }
}
