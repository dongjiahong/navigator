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
//! + **`ord` is local.** A table has no order, so the order within a column is
//!   stored with the row. It is written when a card moves, never merged: the
//!   order each device sees is its own, which is what the interface already did
//!   with arrays.
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
    item.get("updatedAt")
        .and_then(Value::as_i64)
        .or_else(|| item.get("updatedAt").and_then(Value::as_f64).map(|f| f as i64))
        .unwrap_or(0)
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

fn upsert_card(tx: &Transaction, card: &Value) -> Result<usize, String> {
    let id = id_of(card).ok_or_else(|| "a card without an id".to_owned())?;
    let status = text_of(card, "status");
    let status = if status.is_empty() { "todo".to_owned() } else { status };
    let deleted = card.get("deleted").and_then(Value::as_bool).unwrap_or(false) as i64;
    // A card that changed column joins the end of its new column; one that only
    // changed its text keeps the place the user put it in.
    let existing: Option<(i64, String)> = tx
        .query_row("SELECT ord, status FROM cards WHERE id = ?1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()
        .map_err(failed)?;
    let ord = match existing {
        Some((ord, was)) if was == status => ord,
        _ => next_ord(tx, "cards", Some(&status))?,
    };
    tx.execute(
        "INSERT INTO cards (id, body, updated_at, status, deleted, ord)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at,
             status = excluded.status, deleted = excluded.deleted, ord = excluded.ord
         WHERE excluded.updated_at >= cards.updated_at",
        params![id, card.to_string(), stamp(card), status, deleted, ord],
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

/// The whole document, in board order.
pub fn all(conn: &Connection) -> Result<String, String> {
    let cards = bodies(
        conn,
        &format!("SELECT body FROM cards ORDER BY {RANK}, ord, id"),
        None,
    )?;
    let tags = bodies(conn, "SELECT body FROM tags ORDER BY ord, id", None)?;
    Ok(json!({ "cards": cards, "tags": tags, "seeded": seeded(conn)? }).to_string())
}

/// Everything stamped at or after `since`, plus the newest stamp the board
/// holds. A tie is re-sent rather than risked, so the comparison is inclusive.
pub fn rows_since(conn: &Connection, since: i64) -> Result<String, String> {
    let cards = bodies(
        conn,
        &format!("SELECT body FROM cards WHERE updated_at >= ?1 ORDER BY {RANK}, ord, id"),
        Some(since),
    )?;
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
