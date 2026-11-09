//! The board on disk.
//!
//! One SQLite file holds the whole document: every card and tag as the JSON the
//! interface knows, plus the three columns the store itself needs — `updated_at`
//! (the merge stamp), `status` and `ord` (the card's place in its column).
//!
//! + **`body` is the card**, not a set of columns. The interface owns the card's
//!   shape, so adding a field there must not be a database migration; the stamp
//!   and the status are duplicated out because a merge and a load both need them
//!   without parsing every row.
//! + **A card is merged per field, not overwritten.** The row already stored and
//!   the incoming copy are put together by `merge_cards`, the same rule the
//!   interface runs: the newer of each field wins, so a title typed on the Mac
//!   and a 完成 pressed on the phone both survive. `merge-cases.json` holds the
//!   cases both implementations are run against.
//! + **`ord` is a cache.** A column's order is its cards' `rank`, which travels
//!   with the card to the other device; `ord` is only the fallback for a card
//!   written before a column had a rank, and a load sorts by rank regardless.
//! + **`meta.seeded`** separates "first run" from "the user deleted every card":
//!   only the first may fill the board with the sample cards.

use std::path::Path;
use std::sync::{Mutex, OnceLock};

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde_json::{Map, Value, json};

/// A card's place in the board's order: the four columns, then anything else.
const RANK: &str = "CASE status WHEN 'todo' THEN 0 WHEN 'doing' THEN 1 WHEN 'done' THEN 2 \
                    WHEN 'archive' THEN 3 ELSE 4 END";

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS cards (
  id         TEXT PRIMARY KEY,
  body       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  status     TEXT NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  ord        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cards_updated ON cards(updated_at);
CREATE TABLE IF NOT EXISTS tags (
  id         TEXT PRIMARY KEY,
  body       TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  ord        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tags_updated ON tags(updated_at);
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
";

/// The open connection and the file it came from.
pub struct Db {
    pub conn: Connection,
    pub path: String,
}

static DB: OnceLock<Mutex<Db>> = OnceLock::new();

fn failed(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Opens the board's file in `dir`, creating it and its schema. `""` keeps the
/// board in memory, which is what a test gets: nothing it does can reach the
/// board the app is showing.
///
/// The first call opens the store and every later one reports the same file:
/// two connections to one SQLite file would let a write from one block the
/// other for no gain, since every caller in this process goes through one lock.
pub fn open(dir: &str) -> Result<String, String> {
    if let Some(db) = DB.get() {
        return Ok(db.lock().map_err(failed)?.path.clone());
    }
    let (conn, path) = if dir.trim().is_empty() {
        (Connection::open_in_memory().map_err(failed)?, ":memory:".to_owned())
    } else {
        std::fs::create_dir_all(dir).map_err(|e| format!("{dir}: {e}"))?;
        let path = Path::new(dir).join("board.sqlite3");
        let conn = Connection::open(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        (conn, path.display().to_string())
    };
    // WAL lets the sync thread read while a save is writing; `NORMAL` is
    // durable across a process crash, which is all a board needs.
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=2000;")
        .map_err(failed)?;
    conn.execute_batch(SCHEMA).map_err(failed)?;
    let reported = path.clone();
    DB.set(Mutex::new(Db { conn, path }))
        .map_err(|_| "the board was opened twice".to_owned())?;
    Ok(reported)
}

/// Runs `f` on the open store, one caller at a time.
pub fn with<R>(f: impl FnOnce(&mut Db) -> Result<R, String>) -> Result<R, String> {
    let db = DB.get().ok_or_else(|| "the board is not open".to_owned())?;
    let mut guard = db.lock().map_err(failed)?;
    f(&mut guard)
}

/// A card's or tag's stamp, 0 for one that has none.
pub fn stamp(item: &Value) -> i64 {
    match item.get("updatedAt") {
        Some(Value::Number(n)) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)).unwrap_or(0),
        _ => 0,
    }
}

/// The fields a card is merged on, one at a time. Kept in step with
/// `app/fields.ts`: `id` is the key rather than a value, and everything else a
/// card holds — including `deleted`, `rank` and `repeat` — is a field both
/// devices may have written.
const MERGE_FIELDS: [&str; 8] = ["title", "notes", "tags", "due", "repeat", "status", "deleted", "rank"];

/// When one field of a card was last written.
///
/// A card written before fields had stamps of their own has only `updatedAt`,
/// and that is the answer for all of its fields: the older format merges
/// exactly as it did, and the first write to a field gives it the stamp it
/// should have had.
///
/// One exception, and it is a field a card cannot clear: a card with no `rank`
/// has never been numbered, whatever its stamps say. The stamp such a card may
/// still carry is the residue of the merge that erased its place, and reading it
/// as a write makes the erasure permanent — the migration numbers the card again
/// on every launch and every merge takes the number away again. A cleared
/// deadline is the other case: the card that cleared it carries the field's own
/// stamp, so its absence is a real write and it wins. Kept in step with
/// `app/fields.ts`.
fn field_stamp(card: &Value, field: &str) -> i64 {
    if field == "rank" && !matches!(card.get("rank"), Some(Value::Number(_))) {
        return -1;
    }
    match card.get("stamps").and_then(|s| s.get(field)) {
        Some(Value::Number(n)) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)).unwrap_or_else(|| stamp(card)),
        _ => stamp(card),
    }
}

/// One field's value, `null` for a field the card does not have.
fn field_value(card: &Value, field: &str) -> Value {
    match field {
        // Absent and `false` are the same card: a merge that told them apart
        // would hand every card a first edit it never had.
        "deleted" => Value::Bool(card.get("deleted").and_then(Value::as_bool).unwrap_or(false)),
        _ => card.get(field).cloned().unwrap_or(Value::Null),
    }
}

/// A value as the text the tie between two equal stamps is decided on.
///
/// Both implementations agree on the text because a field here is a string, a
/// boolean, a number or a list of strings: each prints a whole number without a
/// decimal point, and a list in its own order. The interface's `tieKey` is the
/// same rule, and `merge-cases.json` holds the cases both are run against.
fn tie_key(value: &Value) -> String {
    value.to_string()
}

/// Whether `a` is the value a tie is decided on.
///
/// The interface compares the two texts with JavaScript's `>=`, which orders by
/// UTF-16 code unit. Comparing them as UTF-8 bytes would agree on every
/// character of the basic plane and disagree above it, where an emoji lives —
/// and a title with an emoji in it is not a rare title.
fn tie_wins(a: &Value, b: &Value) -> bool {
    let (x, y) = (tie_key(a), tie_key(b));
    x.encode_utf16().cmp(y.encode_utf16()) != std::cmp::Ordering::Less
}

/// Two copies of one card, reconciled per field — the same rule the interface's
/// `mergeCard` runs, because the Mac merges what the phone sends before it
/// answers it.
///
/// The field is taken from whichever copy wrote it last, and a field both wrote
/// at the same millisecond is decided by the larger JSON text of the two values,
/// so the answer does not depend on which device asks. `updatedAt` of the result
/// is the newest thing on either copy.
pub fn merge_cards(a: &Value, b: &Value) -> Value {
    let newer = if stamp(b) > stamp(a) { b } else { a };
    let mut merged = newer.as_object().cloned().unwrap_or_default();
    let mut stamps = Map::new();
    let mut newest = stamp(a).max(stamp(b));

    for field in MERGE_FIELDS {
        let sa = field_stamp(a, field);
        let sb = field_stamp(b, field);
        let (value, chosen) = if sa > sb {
            (field_value(a, field), sa)
        } else if sb > sa {
            (field_value(b, field), sb)
        } else {
            let va = field_value(a, field);
            let vb = field_value(b, field);
            if tie_wins(&va, &vb) {
                (va, sa)
            } else {
                (vb, sb)
            }
        };
        // An absent field stays absent rather than becoming `null`: the card is
        // written back to the file and to the other device as it would have
        // been without it.
        if value.is_null() {
            merged.remove(field);
        } else {
            merged.insert(field.to_owned(), value);
        }
        stamps.insert(field.to_owned(), json!(chosen));
        newest = newest.max(chosen);
    }

    merged.insert("stamps".to_owned(), Value::Object(stamps));
    merged.insert("updatedAt".to_owned(), json!(newest));
    Value::Object(merged)
}

fn id_of(item: &Value) -> Option<&str> {
    item.get("id").and_then(Value::as_str)
}

fn text_of(item: &Value, key: &str) -> String {
    item.get(key).and_then(Value::as_str).unwrap_or("").to_owned()
}

/// Writes both lists, newest stamp wins per id — the same rule the interface's
/// merge uses, expressed once here so the app's own save and the phone's sync
/// cannot disagree. Returns how many rows changed.
pub fn upsert(conn: &mut Connection, cards: &[Value], tags: &[Value]) -> Result<usize, String> {
    let tx = conn.transaction().map_err(failed)?;
    let mut changed = 0;
    for card in cards {
        changed += upsert_card(&tx, card)?;
    }
    for tag in tags {
        changed += upsert_tag(&tx, tag)?;
    }
    tx.commit().map_err(failed)?;
    Ok(changed)
}

/// Writes one card, merging it into the row already stored under its id.
///
/// The row is not overwritten: the stored copy and the incoming one are put
/// together field by field by `merge_cards`, which is the same rule the
/// interface runs. That is what lets the Mac change a title while the phone
/// presses 完成 on the same card — both writes are in the file afterwards.
fn upsert_card(tx: &Transaction, card: &Value) -> Result<usize, String> {
    let id = id_of(card).ok_or_else(|| "a card without an id".to_owned())?.to_owned();
    let stored: Option<(String, i64, String)> = tx
        .query_row("SELECT body, ord, status FROM cards WHERE id = ?1", [&id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()
        .map_err(failed)?;
    // A row that does not parse is corruption: the incoming copy stands on its
    // own rather than losing the write.
    let card = match &stored {
        Some((body, _, _)) => match serde_json::from_str::<Value>(body) {
            Ok(was) => merge_cards(&was, card),
            Err(_) => card.clone(),
        },
        None => card.clone(),
    };
    let status = text_of(&card, "status");
    let status = if status.is_empty() { "todo".to_owned() } else { status };
    let deleted = card.get("deleted").and_then(Value::as_bool).unwrap_or(false) as i64;
    // A card that changed column joins the end of its new column; one that only
    // changed its text keeps the place the user put it in. (`ord` is a cache now
    // that a column's order is its cards' ranks — a load sorts by rank.)
    let ord = match stored {
        Some((_, ord, was)) if was == status => ord,
        _ => next_ord(tx, "cards", Some(&status))?,
    };
    tx.execute(
        "INSERT INTO cards (id, body, updated_at, status, deleted, ord)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at,
             status = excluded.status, deleted = excluded.deleted, ord = excluded.ord
         WHERE excluded.updated_at >= cards.updated_at",
        params![id, card.to_string(), stamp(&card), status, deleted, ord],
    )
    .map_err(failed)
}

fn upsert_tag(tx: &Transaction, tag: &Value) -> Result<usize, String> {
    let id = id_of(tag).ok_or_else(|| "a tag without an id".to_owned())?;
    let deleted = tag.get("deleted").and_then(Value::as_bool).unwrap_or(false) as i64;
    let ord: Option<i64> = tx
        .query_row("SELECT ord FROM tags WHERE id = ?1", [id], |r| r.get(0))
        .optional()
        .map_err(failed)?;
    let ord = match ord {
        Some(ord) => ord,
        None => next_ord(tx, "tags", None)?,
    };
    tx.execute(
        "INSERT INTO tags (id, body, updated_at, deleted, ord) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at,
             deleted = excluded.deleted
         WHERE excluded.updated_at >= tags.updated_at",
        params![id, tag.to_string(), stamp(tag), deleted, ord],
    )
    .map_err(failed)
}

fn next_ord(tx: &Transaction, table: &str, status: Option<&str>) -> Result<i64, String> {
    let sql = match status {
        Some(_) => format!("SELECT COALESCE(MAX(ord) + 1, 0) FROM {table} WHERE status = ?1"),
        None => format!("SELECT COALESCE(MAX(ord) + 1, 0) FROM {table}"),
    };
    let mut stmt = tx.prepare(&sql).map_err(failed)?;
    let ord = match status {
        Some(status) => stmt.query_row([status], |r| r.get(0)),
        None => stmt.query_row([], |r| r.get(0)),
    };
    ord.map_err(failed)
}

/// Writes a column's card order: `{ "todo": ["c3", "c1"], … }`. Only the
/// columns whose order changed are sent, and each is sent whole, because one
/// card moving shifts every index after it.
pub fn apply_order(conn: &mut Connection, order: &Map<String, Value>) -> Result<usize, String> {
    if order.is_empty() {
        return Ok(0);
    }
    let tx = conn.transaction().map_err(failed)?;
    let mut changed = 0;
    for (status, ids) in order {
        let Some(ids) = ids.as_array() else { continue };
        for (index, id) in ids.iter().enumerate() {
            let Some(id) = id.as_str() else { continue };
            changed += tx
                .execute(
                    "UPDATE cards SET ord = ?1 WHERE id = ?2 AND status = ?3",
                    params![index as i64, id, status],
                )
                .map_err(failed)?;
        }
    }
    tx.commit().map_err(failed)?;
    Ok(changed)
}

/// Marks that a board has been written once, so an empty one is a board the
/// user emptied rather than a first run.
pub fn mark_seeded(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('seeded', '1')
         ON CONFLICT(key) DO UPDATE SET value = '1'",
        [],
    )
    .map(|_| ())
    .map_err(failed)
}

fn seeded(conn: &Connection) -> Result<bool, String> {
    conn.query_row("SELECT value FROM meta WHERE key = 'seeded'", [], |r| r.get::<_, String>(0))
        .optional()
        .map(|value| value.is_some())
        .map_err(failed)
}

fn bodies(conn: &Connection, sql: &str, since: Option<i64>) -> Result<Vec<Value>, String> {
    let mut stmt = conn.prepare(sql).map_err(failed)?;
    let mut texts: Vec<String> = Vec::new();
    match since {
        Some(since) => {
            let rows = stmt.query_map([since], |r| r.get::<_, String>(0)).map_err(failed)?;
            for row in rows {
                texts.push(row.map_err(failed)?);
            }
        }
        None => {
            let rows = stmt.query_map([], |r| r.get::<_, String>(0)).map_err(failed)?;
            for row in rows {
                texts.push(row.map_err(failed)?);
            }
        }
    }
    // `body` was written from a JSON value by this module; a row that does not
    // parse is corruption, and dropping one card beats failing the load.
    Ok(texts
        .into_iter()
        .filter_map(|text| serde_json::from_str::<Value>(&text).ok())
        .collect())
}

/// A card's column, counted the way the SQL's own `RANK` expression counts it.
fn column_of(card: &Value) -> u8 {
    match card.get("status").and_then(Value::as_str).unwrap_or("todo") {
        "todo" => 0,
        "doing" => 1,
        "done" => 2,
        "archive" => 3,
        _ => 4,
    }
}

/// A card's place in its column, `None` for a card written before a column had
/// a rank.
fn rank_of(card: &Value) -> Option<f64> {
    card.get("rank").and_then(Value::as_f64)
}

/// Puts cards in the order a column shows them: by column, then by rank.
///
/// A card with no rank keeps the place the store gave it — the sort is stable,
/// and the query already comes back in column and `ord` order. `ord` is only
/// that fallback now: the order itself is the ranks, which both devices carry,
/// so a column read back here is the column the user arranged anywhere.
fn sort_by_rank(cards: &mut [Value]) {
    cards.sort_by(|a, b| {
        let (ca, cb) = (column_of(a), column_of(b));
        if ca != cb {
            return ca.cmp(&cb);
        }
        let ra = rank_of(a).unwrap_or(f64::INFINITY);
        let rb = rank_of(b).unwrap_or(f64::INFINITY);
        ra.partial_cmp(&rb).unwrap_or(std::cmp::Ordering::Equal)
    });
}

/// The whole document, in board order.
pub fn all(conn: &Connection) -> Result<String, String> {
    let mut cards = bodies(
        conn,
        &format!("SELECT body FROM cards ORDER BY {RANK}, ord, id"),
        None,
    )?;
    sort_by_rank(&mut cards);
    let tags = bodies(conn, "SELECT body FROM tags ORDER BY ord, id", None)?;
    Ok(json!({ "cards": cards, "tags": tags, "seeded": seeded(conn)? }).to_string())
}

/// Everything stamped at or after `since`, plus the newest stamp the board
/// holds. A tie is re-sent rather than risked, so the comparison is inclusive.
pub fn rows_since(conn: &Connection, since: i64) -> Result<String, String> {
    let mut cards = bodies(
        conn,
        &format!("SELECT body FROM cards WHERE updated_at >= ?1 ORDER BY {RANK}, ord, id"),
        Some(since),
    )?;
    sort_by_rank(&mut cards);
    let tags = bodies(
        conn,
        "SELECT body FROM tags WHERE updated_at >= ?1 ORDER BY ord, id",
        Some(since),
    )?;
    let at: i64 = conn
        .query_row(
            "SELECT MAX(m) FROM (SELECT MAX(updated_at) AS m FROM cards
                                 UNION ALL SELECT MAX(updated_at) FROM tags)",
            [],
            |r| r.get::<_, Option<i64>>(0),
        )
        .map_err(failed)?
        .unwrap_or(0);
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM cards WHERE deleted = 0", [], |r| r.get(0))
        .map_err(failed)?;
    Ok(json!({ "cards": cards, "tags": tags, "at": at, "total": total }).to_string())
}

/// Empties the board, for a test that needs a first run.
pub fn clear(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("DELETE FROM cards; DELETE FROM tags; DELETE FROM meta;")
        .map_err(failed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    /// A store of its own, in memory: tests never touch the app's file.
    fn store() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn
    }

    fn card(id: &str, stamp: i64, patch: Value) -> Value {
        let mut base = json!({"id": id, "title": id, "status": "todo", "updatedAt": stamp});
        if let (Some(base), Some(patch)) = (base.as_object_mut(), patch.as_object()) {
            for (k, v) in patch {
                base.insert(k.clone(), v.clone());
            }
        }
        base
    }

    fn loaded(conn: &Connection) -> Value {
        serde_json::from_str(&all(conn).unwrap()).unwrap()
    }

    fn titles(value: &Value) -> Vec<String> {
        value["cards"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["title"].as_str().unwrap_or("").to_owned())
            .collect()
    }

    #[test]
    fn newer_wins_per_card() {
        let mut conn = store();
        upsert(&mut conn, &[card("a", 10, json!({"title": "old"}))], &[]).unwrap();
        upsert(&mut conn, &[card("a", 20, json!({"title": "new"}))], &[]).unwrap();
        assert_eq!(titles(&loaded(&conn)), ["new"]);
    }

    #[test]
    fn older_loses() {
        let mut conn = store();
        upsert(&mut conn, &[card("a", 20, json!({"title": "new"}))], &[]).unwrap();
        upsert(&mut conn, &[card("a", 10, json!({"title": "old"}))], &[]).unwrap();
        assert_eq!(titles(&loaded(&conn)), ["new"]);
    }

    #[test]
    fn tombstones_do_not_resurrect() {
        let mut conn = store();
        upsert(&mut conn, &[card("a", 30, json!({"deleted": true}))], &[]).unwrap();
        upsert(&mut conn, &[card("a", 20, json!({"title": "back?"}))], &[]).unwrap();
        let board = loaded(&conn);
        assert_eq!(board["cards"][0]["deleted"], true);
    }

    /// A cycle is a field like any other, and it has to survive the trip: the
    /// phone marks a card 每天, the Mac has not heard of the field yet, and the
    /// card that comes out still repeats.
    #[test]
    fn a_cycle_written_on_one_device_reaches_the_other() {
        let mut conn = store();
        upsert(
            &mut conn,
            &[card(
                "a",
                20,
                json!({
                    "due": "2026-11-12T08:00",
                    "repeat": "daily",
                    "stamps": {"title": 1, "due": 20, "repeat": 20},
                }),
            )],
            &[],
        )
        .unwrap();
        // The Mac's copy predates the cycle and knows nothing of the field.
        upsert(&mut conn, &[card("a", 10, json!({"title": "from the Mac", "stamps": {"title": 10}}))], &[]).unwrap();
        let board = loaded(&conn);
        assert_eq!(board["cards"][0]["repeat"], "daily");
        assert_eq!(board["cards"][0]["title"], "from the Mac");
        assert_eq!(board["cards"][0]["stamps"]["repeat"], 20);
    }

    /// The cases the interface's merge is run against, run here too.
    ///
    /// The Mac merges what the phone sends before it answers it, so the two
    /// implementations are the same rule twice. They share this file rather than
    /// each keeping its own idea of it: a case added for one is a case the other
    /// has to pass. Both argument orders are checked, because the device that
    /// asks must not change the answer.
    #[test]
    fn the_shared_cases_merge_the_same_in_both_implementations() {
        let raw = include_str!("../merge-cases.json");
        let cases: Value = serde_json::from_str(raw).unwrap();
        let cases = cases["cases"].as_array().unwrap();
        assert!(!cases.is_empty());
        for case in cases {
            let (a, b) = (&case["a"], &case["b"]);
            assert_eq!(merge_cards(a, b), case["merged"], "case: {}", case["name"]);
            assert_eq!(merge_cards(b, a), case["merged"], "case (swapped): {}", case["name"]);
        }
    }

    /// The write the whole change is for: a title written on one device and a
    /// status written on the other, arriving at the store one after the other,
    /// both land on the card.
    #[test]
    fn a_title_and_a_status_from_two_devices_both_survive() {
        let mut conn = store();
        // The phone presses 完成 at 20; the Mac types a title at 30.
        upsert(
            &mut conn,
            &[card(
                "a",
                20,
                json!({"status": "done", "stamps": {"title": 1, "status": 20, "notes": 1}}),
            )],
            &[],
        )
        .unwrap();
        upsert(
            &mut conn,
            &[card("a", 30, json!({"title": "Mac typed this", "stamps": {"title": 30, "status": 1}}))],
            &[],
        )
        .unwrap();
        let board = loaded(&conn);
        assert_eq!(board["cards"][0]["title"], "Mac typed this");
        assert_eq!(board["cards"][0]["status"], "done");
        assert_eq!(board["cards"][0]["updatedAt"], 30);
    }

    /// A field written on the other device and a field written here are two
    /// writes, so the row's own stamp has to move to the newest of them — it is
    /// what `rows_since` gives the phone.
    #[test]
    fn a_field_merge_moves_the_row_stamp() {
        let mut conn = store();
        upsert(&mut conn, &[card("a", 10, json!({"title": "old", "stamps": {"title": 10}}))], &[]).unwrap();
        upsert(
            &mut conn,
            &[card("a", 40, json!({"title": "old", "notes": "new", "stamps": {"title": 10, "notes": 40}}))],
            &[],
        )
        .unwrap();
        let board = loaded(&conn);
        assert_eq!(board["cards"][0]["title"], "old");
        assert_eq!(board["cards"][0]["notes"], "new");
        assert_eq!(board["cards"][0]["updatedAt"], 40);
        let fresh: Value = serde_json::from_str(&rows_since(&conn, 30).unwrap()).unwrap();
        assert_eq!(fresh["cards"].as_array().unwrap().len(), 1);
        assert_eq!(fresh["cards"][0]["id"], "a");
    }

    /// A tombstone is a field too: a note written on the other device after the
    /// delete is kept inside it, and the card stays removed.
    #[test]
    fn a_delete_keeps_the_note_written_after_it() {
        let mut conn = store();
        upsert(&mut conn, &[card("a", 10, json!({"deleted": true, "stamps": {"deleted": 10}}))], &[]).unwrap();
        // The phone did not know about the delete: its copy still says the card
        // is live, on the stamp it was made with, and writes a note after it.
        upsert(
            &mut conn,
            &[card("a", 20, json!({"title": "a", "notes": "写下的备注", "stamps": {"deleted": 1, "notes": 20}}))],
            &[],
        )
        .unwrap();
        let board = loaded(&conn);
        assert_eq!(board["cards"][0]["deleted"], true);
        assert_eq!(board["cards"][0]["notes"], "写下的备注");
    }

    /// A column read back is in rank order, not in the order rows happen to sit
    /// in the table: the order is the cards' own, and it came from the other
    /// device with them.
    #[test]
    fn a_load_comes_back_in_rank_order() {
        let mut conn = store();
        upsert(
            &mut conn,
            &[
                card("a", 1, json!({"rank": 3000})),
                card("b", 2, json!({"rank": 1000})),
                card("c", 3, json!({"rank": 2000})),
            ],
            &[],
        )
        .unwrap();
        assert_eq!(titles(&loaded(&conn)), ["b", "c", "a"]);
        // A card with no rank keeps the place the store gave it, after the ones
        // that have one.
        upsert(&mut conn, &[card("d", 4, json!({}))], &[]).unwrap();
        assert_eq!(titles(&loaded(&conn)), ["b", "c", "a", "d"]);
    }

    #[test]
    fn a_load_comes_back_in_column_order() {
        let mut conn = store();
        upsert(&mut conn, &[card("c1", 1, json!({"status": "done"}))], &[]).unwrap();
        upsert(&mut conn, &[card("c2", 2, json!({"status": "todo"}))], &[]).unwrap();
        upsert(&mut conn, &[card("c3", 3, json!({"status": "archive"}))], &[]).unwrap();
        upsert(&mut conn, &[card("c4", 4, json!({"status": "doing"}))], &[]).unwrap();
        assert_eq!(titles(&loaded(&conn)), ["c2", "c4", "c1", "c3"]);
    }

    #[test]
    fn an_order_write_places_every_card() {
        let mut conn = store();
        upsert(&mut conn, &[card("a", 1, json!({})), card("b", 2, json!({}))], &[]).unwrap();
        apply_order(&mut conn, json!({"todo": ["b", "a"]}).as_object().unwrap()).unwrap();
        assert_eq!(titles(&loaded(&conn)), ["b", "a"]);
    }

    #[test]
    fn a_card_that_changes_column_joins_its_end() {
        let mut conn = store();
        upsert(&mut conn, &[card("a", 1, json!({})), card("b", 2, json!({}))], &[]).unwrap();
        // `b` moves to doing without an order write: it lands after `a`, which
        // is what the board showed before the move was ever saved.
        upsert(&mut conn, &[card("b", 3, json!({"status": "doing"}))], &[]).unwrap();
        let moved = loaded(&conn);
        assert_eq!(moved["cards"][1]["id"], "b");
        assert_eq!(moved["cards"][1]["status"], "doing");
    }

    #[test]
    fn since_returns_only_what_moved() {
        let mut conn = store();
        upsert(&mut conn, &[card("a", 10, json!({})), card("b", 20, json!({}))], &[]).unwrap();
        let fresh: Value = serde_json::from_str(&rows_since(&conn, 15).unwrap()).unwrap();
        assert_eq!(fresh["cards"].as_array().unwrap().len(), 1);
        assert_eq!(fresh["cards"][0]["id"], "b");
        assert_eq!(fresh["at"], 20);
        // A tie is re-sent, never dropped.
        let tie: Value = serde_json::from_str(&rows_since(&conn, 20).unwrap()).unwrap();
        assert_eq!(tie["cards"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn tags_merge_like_cards_and_keep_their_order() {
        let mut conn = store();
        upsert(&mut conn, &[], &[json!({"id": "work", "label": "工作", "updatedAt": 10})]).unwrap();
        upsert(
            &mut conn,
            &[],
            &[
                json!({"id": "work", "label": "工作", "hue": "blue", "updatedAt": 20}),
                json!({"id": "t1", "label": "家", "hue": "green", "updatedAt": 5}),
            ],
        )
        .unwrap();
        let board = loaded(&conn);
        let tags = board["tags"].as_array().unwrap();
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0]["hue"], "blue");
        assert_eq!(tags[1]["label"], "家");
    }

    #[test]
    fn a_first_run_is_not_an_emptied_board() {
        let mut conn = store();
        assert_eq!(loaded(&conn)["seeded"], false);
        upsert(&mut conn, &[card("a", 1, json!({}))], &[]).unwrap();
        mark_seeded(&conn).unwrap();
        assert_eq!(loaded(&conn)["seeded"], true);
        // The user removes the last card: the board is empty, not unseeded.
        upsert(&mut conn, &[card("a", 2, json!({"deleted": true}))], &[]).unwrap();
        assert_eq!(loaded(&conn)["seeded"], true);
        let live: Value = serde_json::from_str(&rows_since(&conn, 0).unwrap()).unwrap();
        assert_eq!(live["total"], 0);
    }

    /// The one test that opens a real store, because it is about the file: a
    /// directory becomes a database, and its rows survive being read back.
    /// (`open` keeps one store per process, so no other test may call it.)
    #[test]
    fn a_directory_becomes_a_file_that_keeps_its_board() {
        let dir = std::env::temp_dir().join(format!("navigator-board-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = open(dir.to_str().unwrap()).unwrap();
        assert!(path.ends_with("board.sqlite3"), "{path}");
        assert!(Path::new(&path).exists(), "{path}");

        with(|db| {
            assert_eq!(all(&db.conn)?.contains("\"seeded\":false"), true);
            upsert(&mut db.conn, &[json!({"id": "a", "title": "存下来", "updatedAt": 5})], &[])?;
            mark_seeded(&db.conn)
        })
        .unwrap();

        // Reading it back is what the next launch does.
        let again: Value = serde_json::from_str(&with(|db| all(&db.conn)).unwrap()).unwrap();
        assert_eq!(again["cards"][0]["title"], "存下来");
        assert_eq!(again["seeded"], true);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A real board at a size the app should stay honest at: a thousand cards,
    /// most of them archived, in a real file.
    ///
    /// This is the number the store was chosen for. It asserts bounds loose
    /// enough never to fail on a busy machine, and prints the readings so a
    /// change that makes them ten times worse is visible in `cargo test --nocapture`.
    #[test]
    fn a_thousand_cards_load_and_save_in_a_moment() {
        let dir = std::env::temp_dir().join(format!("navigator-bench-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let conn = Connection::open(dir.join("bench.sqlite3")).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;").unwrap();
        conn.execute_batch(SCHEMA).unwrap();

        let notes = "让考试号规则和回测一起跑，这样能直接看出这条规则能不能通过考试号。开关放在回测设置那一块。";
        let board: Vec<Value> = (0..1000)
            .map(|i| {
                json!({
                    "id": format!("c{i}"),
                    "title": format!("回测里加一个「按考试号规则」的开关 {i}"),
                    "notes": notes,
                    "tags": ["work"],
                    "due": "2026-11-12T14:00:00",
                    // Most of a real board is finished or archived work.
                    "status": if i % 10 < 6 { "archive" } else if i % 10 < 8 { "done" } else { "todo" },
                    "updatedAt": 1_762_500_000_000i64 + i,
                })
            })
            .collect();

        let started = Instant::now();
        let mut conn = conn;
        upsert(&mut conn, &board, &[]).unwrap();
        let write_all = started.elapsed();

        let started = Instant::now();
        let loaded = all(&conn).unwrap();
        let load = started.elapsed();
        let bytes = loaded.len();

        // One card edited, as every keystroke does.
        let started = Instant::now();
        for _ in 0..20 {
            upsert(&mut conn, &[json!({"id": "c5", "title": "改过", "status": "todo", "updatedAt": 1_762_999_999_999i64})], &[]).unwrap();
        }
        let one_card = started.elapsed() / 20;

        let started = Instant::now();
        let delta = rows_since(&conn, 1_762_500_000_990).unwrap();
        let since = started.elapsed();

        println!(
            "1000 cards: {:?} to write the board, {:?} to load it ({bytes} B of JSON), \
             {:?} to write one card, {:?} to read what changed since a stamp ({} B)",
            write_all,
            load,
            one_card,
            since,
            delta.len()
        );

        assert_eq!(serde_json::from_str::<Value>(&loaded).unwrap()["cards"].as_array().unwrap().len(), 1000);
        // Well past what the app should ever take; a regression makes these fail.
        assert!(load < Duration::from_millis(500), "load took {load:?}");
        assert!(one_card < Duration::from_millis(50), "one card took {one_card:?}");
        assert!(write_all < Duration::from_secs(5), "the whole board took {write_all:?}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
