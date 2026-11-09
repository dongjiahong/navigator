//! The service and the phone on one loopback socket: the whole handshake, the
//! replay, and the lockout, driven through the same code the app runs.
//!
//! The Mac is a listener thread in this process and the phone is `post_state`,
//! so nothing here is a mock: the bytes on the wire are the bytes a phone sends
//! over Wi-Fi, and the answers are the ones the real server gives.
//!
//! The first test reads the board and never writes it: `board::open` keeps one
//! store per process, and the store's own test opens it. The second test does
//! write, so it is `#[ignore]`d and run on its own — see `sync_with_the_code` at
//! the foot of this file for the command.

use std::net::TcpListener;
use std::thread;

use serde_json::Value;

use crate::auth::{self, Verdict};
use crate::{Exchange, handle, post_state, request};

const CODE: &str = "482913";
/// An exchange that asks for the whole board and brings nothing that would
/// change it: what a phone sends the first time it meets a Mac.
const BOARD: &str = "{\"cards\":[],\"tags\":[],\"since\":0}";

/// A Mac on `127.0.0.1`, on a port the system picks: the port it listens on.
fn serve() -> u16 {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("a free loopback port");
    let port = listener.local_addr().unwrap().port();
    thread::spawn(move || {
        for stream in listener.incoming() {
            if let Ok(stream) = stream {
                thread::spawn(move || handle(stream));
            }
        }
    });
    port
}

/// Waits for the board the service reads, without opening one: `board::open`
/// keeps one store per process and it belongs to the store's own test, so a
/// second caller would race it for the same slot — and this test only reads the
/// board anyway, so it can wait for that one to appear.
fn board() {
    for _ in 0..500 {
        if crate::board::with(|_| Ok(())).is_ok() {
            return;
        }
        thread::sleep(std::time::Duration::from_millis(20));
    }
    panic!("the board was never opened: it is opened by the store's own test");
}

/// One signed `POST /state`, answering the status the Mac gave.
fn post(base: &str, nonce: &str, proof: &str) -> u16 {
    request(
        base,
        "POST",
        "/state",
        BOARD,
        &[(auth::NONCE_HEADER, nonce), (auth::PROOF_HEADER, proof)],
    )
    .expect("the Mac answers")
    .0
}

/// A `POST /state` signed with the wrong code, over a fresh challenge.
fn post_a_wrong_guess(base: &str) -> u16 {
    let nonce = auth::serving().issue().expect("a challenge");
    let wrong = auth::proof("000000", &nonce);
    post(base, &nonce, &wrong)
}

#[test]
fn the_board_answers_only_a_phone_that_knows_the_code() {
    board();
    let port = serve();
    let base = format!("127.0.0.1:{port}");

    auth::serving().set_code(CODE);
    auth::set_prover(CODE);

    // What a stranger on the same network can have without a code: the fact
    // that a Mac is here, and a challenge to answer.
    let (status, body) = request(&base, "GET", "/health", "", &[]).expect("the Mac answers");
    assert_eq!(status, 200);
    assert_eq!(body, "{\"ok\":true}", "health must say nothing about the board");
    let (status, body) = request(&base, "GET", "/challenge", "", &[]).expect("the Mac answers");
    assert_eq!(status, 200);
    let nonce = serde_json::from_str::<Value>(&body).unwrap()["nonce"]
        .as_str()
        .expect("a challenge is a nonce")
        .to_owned();
    assert_eq!(nonce.len(), 32, "16 bytes of randomness, in hex");

    // The board with no proof at all, and with a proof over a challenge the Mac
    // never made: both refused, and told so. Neither reaches the board.
    let (status, body) = request(&base, "POST", "/state", BOARD, &[]).unwrap();
    assert_eq!(status, 401);
    assert!(body.contains("unauthorized"));
    let invented = auth::proof(CODE, "0000000000000000000000000000000000000000");
    assert_eq!(post(&base, "not-a-nonce", &invented), 401);

    // The handshake, by hand: challenge, proof, board. A `GET /state` so this
    // test writes nothing — the merge itself is the store's own business.
    let nonce = auth::serving().issue().unwrap();
    let proof = auth::proof(CODE, &nonce);
    let signed = [(auth::NONCE_HEADER, nonce.as_str()), (auth::PROOF_HEADER, proof.as_str())];
    let (status, body) = request(&base, "GET", "/state", "", &signed).expect("the Mac answers");
    assert_eq!(status, 200, "the right code is let in");
    let merged: Value = serde_json::from_str(&body).expect("the merged board parses");
    assert!(merged.get("cards").is_some_and(Value::is_array));
    assert!(merged.get("tags").is_some_and(Value::is_array));
    assert!(merged.get("at").is_some(), "and says what it has");

    // The same challenge again: spent, whatever the proof says.
    let (status, _) = request(&base, "GET", "/state", "", &signed).expect("the Mac answers");
    assert_eq!(status, 401, "a nonce answers one request");

    // Four more wrong proofs, and the fifth failure in a row locks the door. A
    // success above cleared the count, and the replay is failure one.
    assert_eq!(post_a_wrong_guess(&base), 401);
    assert_eq!(post_a_wrong_guess(&base), 401);
    assert_eq!(post_a_wrong_guess(&base), 401);
    assert_eq!(post_a_wrong_guess(&base), 429, "five wrong proofs lock the door");

    // Locked means locked: the right code does not open it either, and saying
    // so is what stops a phone from guessing its way through the minute.
    assert!(matches!(auth::serving().verify(None, None), Verdict::Locked(_)));
    let nonce = auth::serving().issue().unwrap();
    let right = auth::proof(CODE, &nonce);
    assert_eq!(post(&base, &nonce, &right), 429);

    // And the phone hears which of the two it was: a lockout, not a wrong code.
    auth::set_prover("000001");
    assert!(matches!(post_state(&base, BOARD), Exchange::Refused { locked: true, .. }));

    // The owner's next move is a new code. It opens the door again, and the
    // digits the phone still holds are out — which is the whole point of it.
    auth::serving().set_code("730271");
    auth::set_prover(CODE);
    assert!(matches!(
        post_state(&base, BOARD),
        Exchange::Refused { locked: false, .. }
    ));
    auth::set_prover("730271");
    assert!(matches!(post_state(&base, BOARD), Exchange::Merged(_)));
}

/// The exchange thread with a peer it was pointed at: the whole path a second
/// Mac takes, from a typed address to a row in the inbox and a peer in `status`.
///
/// It starts the process-wide exchange thread and writes to the board, so it is
/// `#[ignore]`d and run on its own, like the exchange above:
///
/// ```text
/// cargo test --offline the_exchange_thread_syncs_with_a_typed_peer -- --ignored --test-threads=1
/// ```
#[test]
#[ignore = "starts the exchange thread and writes to the board; run it alone"]
fn the_exchange_thread_syncs_with_a_typed_peer() {
    use crate::{Sync, board};

    board::open("").expect("a board in memory");
    board::with(|db| board::clear(&db.conn)).expect("an empty board");
    let port = serve();
    let code = "735091";
    auth::serving().set_code(code);
    auth::set_prover(code);

    // A Mac met by hand: the fallback a network without broadcasts needs. It
    // is a peer like any other once it answers.
    Sync::use_address(format!("127.0.0.1:{port}"));
    Sync::set_code(code.to_owned()).expect("the code");
    Sync::watch();

    let card = serde_json::json!({
        "id": "typed-peer-1", "title": "从另一台 Mac 来", "notes": "", "tags": [],
        "status": "todo", "updatedAt": now_millis_for_test(),
    });
    Sync::offer(serde_json::json!({ "cards": [card], "tags": [] }).to_string());

    // The thread works on its own clock; wait for it rather than assume it.
    let mut inbox = String::new();
    for _ in 0..200 {
        inbox = Sync::inbox();
        if inbox.contains("typed-peer-1") {
            break;
        }
        thread::sleep(std::time::Duration::from_millis(50));
    }
    assert!(inbox.contains("typed-peer-1"), "the peer's answer reached the inbox: {inbox}");

    // The peer the user typed is now one the device is in step with, and the
    // board really has the card: the server merged it before it answered.
    let status: Value = serde_json::from_str(&Sync::status()).expect("a status body");
    let peers = status["peers"].as_array().expect("a peer list");
    assert_eq!(peers.len(), 1, "one typed peer: {status}");
    assert_eq!(peers[0]["addr"], format!("127.0.0.1:{port}"));
    assert_eq!(peers[0]["ok"], true, "the exchange succeeded: {status}");
    assert_eq!(peers[0]["typed"], true);
    assert_eq!(status["pair"], "ok");

    let board = board::with(|db| board::all(&db.conn)).expect("the board");
    assert!(board.contains("从另一台 Mac 来"), "the rows crossed: {board}");
}

/// The wall clock in millis, as a card's stamp.
fn now_millis_for_test() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(1)
}

/// The phone's whole side against the Mac's whole side, with a board that really
/// merges: a card the phone sends lands on the Mac, and the wrong code gets
/// nothing.
///
/// It writes, so it is `#[ignore]`d and run on its own — `cargo test` keeps one
/// store per process, and this one changes it. From `app/`:
///
/// ```text
/// cargo test --offline sync_with_the_code -- --ignored --test-threads=1
/// ```
#[test]
#[ignore = "writes to the board; run it alone"]
fn sync_with_the_code() {
    // Alone, so it may open the store itself and empty it.
    crate::board::open("").expect("a board in memory");
    let port = serve();
    let base = format!("127.0.0.1:{port}");
    auth::serving().set_code(CODE);

    // A card made on the phone, with the stamp the merge orders by.
    crate::board::with(|db| crate::board::clear(&db.conn)).expect("an empty board");
    let card = serde_json::json!({
        "id": "phone-1", "title": "手机上记的一笔", "notes": "", "tags": [],
        "status": "todo", "updatedAt": 1_800_000_000_000_i64,
    });
    let body = serde_json::json!({ "cards": [card], "tags": [], "since": 0 }).to_string();

    // The wrong code: refused, and the Mac's board is untouched.
    auth::set_prover("000000");
    assert!(matches!(post_state(&base, &body), Exchange::Refused { locked: false, .. }));
    let board = crate::board::with(|db| crate::board::all(&db.conn)).expect("the board");
    assert!(!board.contains("phone-1"), "a wrong code must move no card");

    // The right code: merged, and answered with what the phone was missing.
    auth::set_prover(CODE);
    let Exchange::Merged(answer) = post_state(&base, &body) else {
        panic!("the right code did not sync");
    };
    let merged: Value = serde_json::from_str(&answer).expect("a merged board");
    assert!(
        merged["cards"].as_array().is_some_and(|cards| cards.iter().any(|c| c["id"] == "phone-1")),
        "the card the phone sent is on the Mac: {answer}"
    );
    let board = crate::board::with(|db| crate::board::all(&db.conn)).expect("the board");
    assert!(board.contains("手机上记的一笔"), "and it is in the Mac's file");

    // A phone that has been away asks only for what it is missing.
    auth::set_prover(CODE);
    let Exchange::Merged(answer) = post_state(
        &base,
        &serde_json::json!({ "cards": [], "tags": [], "since": 1_800_000_000_001_i64 })
            .to_string(),
    ) else {
        panic!("the second exchange failed");
    };
    let later: Value = serde_json::from_str(&answer).unwrap();
    assert!(
        later["cards"].as_array().is_none_or(|cards| cards.is_empty()),
        "nothing was stamped after that: {answer}"
    );
}
