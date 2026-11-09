//! The board's file, and the sync service that lives inside every Mac app.
//!
//! The board is a SQLite file (`board.rs`). It is the only copy: the interface
//! loads it at launch, saves each change a moment later, and merges another
//! device's changes into the same rows, so there is nothing to reconcile between
//! a "stored" board and a "shown" one.
//!
//! The service only exists while the app is open: the listener is a thread this
//! crate starts, so quitting the app closes the port and a peer's next sync
//! fails instead of talking to a stale copy. Every Mac both serves and looks for
//! the others; the phone only looks, because its changes travel in the requests
//! it sends and the answer carries the Mac's.
//!
//! Two rules keep the merge honest:
//!
//! - **The newer write of each field wins.** A card is reconciled field by
//!   field (`board::merge_cards`), so a title typed on one device and a 完成
//!   pressed on another in the same minute both land on the card. `updatedAt`
//!   is the newest field stamp, which is what orders the exchange.
//! - **Deletes are tombstones.** A card removed on one device comes back as
//!   `deleted: true` with a newer stamp, so merging cannot resurrect it; an
//!   undo writes `deleted: false` with a newer stamp still, and that does.
//!
//! A device sends only what changed since it last told each peer, and gets back
//! only what it is missing: `POST /state` carries `{ cards, tags, since }` and
//! answers with the rows stamped at or after `since`. Each peer keeps its own
//! watermark and its own backlog, so one Mac that is shut or holds a different
//! code cannot stop the others from being in step.
//!
//! Devices find one another the way LocalSend finds its peers: each broadcasts a
//! probe on its own network, every serving device answers with a unicast
//! datagram, and the address is read off that answer. A Mac that moved to a new
//! DHCP lease is found again on the next probe without anyone typing an IP.
//!
//! The requests go over a plain socket rather than through the platform's HTTP
//! client, because Android blocks cleartext HTTP to a LAN address by policy, and
//! this traffic never leaves the LAN.
//!
//! The crate also owns the deadline reminders. nsh has no notification API, so
//! the Mac's go through `UNUserNotificationCenter` here, where a due date
//! becomes a real system notification that plays the system's sound and that
//! macOS delivers even after the app quits.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::{
    Mutex, OnceLock,
    atomic::{AtomicU64, Ordering},
};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use nsh_core::prelude::*;
use serde_json::{Value, json};

mod auth;
mod backup;
mod board;
/// The handshake over a real loopback socket, as the two devices do it.
#[cfg(test)]
mod pairing_test;

const MAX_BODY: usize = 4 * 1024 * 1024;

/// The port this process listens on, once `start` has bound it.
static BOUND: OnceLock<u16> = OnceLock::new();

/// Where a device broadcasts its probe, beside the board's own port.
const DISCOVERY_PORT: u16 = 8788;
/// What a device says to the network, and what a serving one answers with its
/// port.
const PROBE: &[u8] = b"NAVIGATOR/1 DISCOVER";
const OFFER: &str = "NAVIGATOR/1 OFFER ";
/// How long one probe collects answers: every Mac on the LAN, not the first.
const PROBE_WAIT: Duration = Duration::from_millis(700);
/// How often a device with peers probes again, to meet a Mac that just opened.
const PROBE_EVERY: Duration = Duration::from_secs(15);
/// How long one exchange may take before a peer is presumed gone.
const EXCHANGE_WAIT: Duration = Duration::from_secs(4);
/// How often a peer is asked what it has even when this device changed nothing.
/// Without it a card made on one device would only reach the other the next time
/// either of them was edited.
const POLL_MS: u64 = 3000;
/// How far below the newest stamp it heard a device asks from, because two
/// devices' clocks are not the same clock.
const MARGIN: i64 = 5 * 60 * 1000;

/// One device's rows, as they go on the wire: the cards and tags that changed
/// here, and nothing else.
#[derive(Clone, Default)]
struct Body {
    cards: Vec<Value>,
    tags: Vec<Value>,
}

impl Body {
    /// A body out of a request's text. Bad JSON is an empty body: the next
    /// offer carries the rows again, and a peer that cannot parse has nothing
    /// this device can do about it.
    fn from_text(text: &str) -> Body {
        let Ok(value) = serde_json::from_str::<Value>(text) else {
            return Body::default();
        };
        if value.is_array() {
            return Body { cards: value.as_array().cloned().unwrap_or_default(), tags: Vec::new() };
        }
        Body {
            cards: list_of(&value, "cards").unwrap_or_default(),
            tags: list_of(&value, "tags").unwrap_or_default(),
        }
    }

    fn is_empty(&self) -> bool {
        self.cards.is_empty() && self.tags.is_empty()
    }

    /// Adds `other`, keeping the newer copy of a row: the backlog of a peer that
    /// was away must not overwrite a row changed since it was first offered.
    fn absorb(&mut self, other: &Body) {
        for row in &other.cards {
            put_newer(&mut self.cards, row);
        }
        for row in &other.tags {
            put_newer(&mut self.tags, row);
        }
    }

    fn text(&self, since: i64) -> String {
        json!({ "cards": self.cards, "tags": self.tags, "since": since }).to_string()
    }
}

/// Keeps `row` in `rows` unless a copy with the same id is already as new. A
/// row without an `id` is kept as it is: it is not this device's to drop.
fn put_newer(rows: &mut Vec<Value>, row: &Value) {
    let stamp = |value: &Value| value.get("updatedAt").and_then(Value::as_f64).unwrap_or(0.0);
    let Some(id) = row.get("id").and_then(Value::as_str) else {
        rows.push(row.clone());
        return;
    };
    match rows.iter_mut().find(|old| old.get("id").and_then(Value::as_str) == Some(id)) {
        Some(old) if stamp(row) >= stamp(old) => *old = row.clone(),
        Some(_) => {}
        None => rows.push(row.clone()),
    }
}

/// One other device this device stays in step with.
struct Peer {
    /// `host:port`, read off the discovery answer or typed by the user.
    addr: String,
    /// The newest stamp this peer has told us about: what it is missing starts
    /// above it, less `MARGIN`.
    heard: i64,
    /// The last exchange succeeded.
    ok: bool,
    /// When the last exchange succeeded, in millis since the epoch; 0 for never.
    at: u64,
    /// The peer would not take this device's pairing code. Asking again only
    /// spends the five attempts it allows, so it is left alone until the code
    /// changes.
    refused: bool,
    /// The peer answered 429: nothing is sent to it before this moment.
    locked_until: u64,
    /// Typed by the user rather than found by a probe: it is kept even while it
    /// does not answer, so a network that drops broadcasts still works.
    typed: bool,
    /// Rows this peer has not been given yet, after a failed exchange.
    backlog: Body,
}

/// Every other device this one knows about. A Mac serves and discovers; a phone
/// only discovers, but it keeps one entry per Mac it found, and syncs with each.
static PEERS: Mutex<Vec<Peer>> = Mutex::new(Vec::new());
/// The rows the app last handed the exchange thread, for every peer on this
/// cycle. Each peer's own backlog carries what it missed.
static CURRENT: Mutex<Option<Body>> = Mutex::new(None);
/// Everything the peers have answered since the app last read it.
static INBOX: Mutex<Option<Body>> = Mutex::new(None);
/// When the last exchange with any peer succeeded, in millis since the epoch.
static SYNCED_AT: AtomicU64 = AtomicU64::new(0);
/// Bumped when the app wants the exchange thread to look for peers again now.
static NUDGE: AtomicU64 = AtomicU64::new(0);

fn parse_cards(text: &str) -> Result<Vec<Value>, String> {
    let value: Value = serde_json::from_str(text).map_err(|e| format!("bad JSON: {e}"))?;
    match value {
        Value::Array(items) => Ok(items),
        Value::Null => Ok(Vec::new()),
        _ => Err("expected an array of cards".to_owned()),
    }
}

/// The list under `key` of a body, empty when it has none. A body that is a bare
/// array is the cards of a peer that predates tags.
fn list_of(value: &Value, key: &str) -> Result<Vec<Value>, String> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(items)) => Ok(items.clone()),
        Some(_) => Err(format!("expected `{key}` to be an array")),
    }
}

/// Both lists a device sends, and the stamp it last heard from the other side.
/// A body that is a bare array is the cards of a peer that predates tags.
fn parse_exchange(text: &str) -> Result<(Vec<Value>, Vec<Value>, i64), String> {
    let value: Value = serde_json::from_str(text).map_err(|e| format!("bad JSON: {e}"))?;
    if let Value::Array(_) = value {
        return Ok((parse_cards(text)?, Vec::new(), 0));
    }
    if !value.is_object() {
        return Err("expected an object with cards and tags".to_owned());
    }
    Ok((
        list_of(&value, "cards")?,
        list_of(&value, "tags")?,
        since_in(&value),
    ))
}

/// A body's `since` stamp: only what changed at or after it is answered.
fn since_in(value: &Value) -> i64 {
    value
        .get("since")
        .and_then(Value::as_f64)
        .map(|f| f as i64)
        .unwrap_or(0)
}

/// The LAN address the phone should be pointed at, e.g. `10.0.0.5`. Reads the
/// route to a public address without sending anything; falls back to localhost.
fn lan_ip() -> String {
    if let Ok(socket) = UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("1.1.1.1:80").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                let ip = addr.ip().to_string();
                if ip != "0.0.0.0" && !ip.starts_with("127.") {
                    return ip;
                }
            }
        }
    }
    "127.0.0.1".to_owned()
}

/// Every IPv4 address and netmask this device holds, one pair per interface.
fn ipv4_interfaces() -> Vec<(Ipv4Addr, Ipv4Addr)> {
    let mut out = Vec::new();
    // SAFETY: `getifaddrs` fills a list we walk, then hand back to free.
    unsafe {
        let mut head: *mut libc::ifaddrs = std::ptr::null_mut();
        if libc::getifaddrs(&mut head) != 0 {
            return out;
        }
        let mut current = head;
        while !current.is_null() {
            let entry = &*current;
            if let (Some(addr), Some(mask)) = (ipv4_of(entry.ifa_addr), ipv4_of(entry.ifa_netmask)) {
                if !addr.is_loopback() && !addr.is_unspecified() {
                    out.push((addr, mask));
                }
            }
            current = entry.ifa_next;
        }
        libc::freeifaddrs(head);
    }
    out
}

/// Every directed broadcast address this device can reach, one per interface,
/// from the interface's own address and netmask.
///
/// A single `255.255.255.255` leaves by the default route, which on a phone
/// with mobile data is the carrier's, not the Wi-Fi's. Asking each interface's
/// subnet instead is what makes the probe reach the Mac beside it.
fn broadcast_addresses() -> Vec<Ipv4Addr> {
    let mut out = Vec::new();
    for (addr, mask) in ipv4_interfaces() {
        let broadcast = Ipv4Addr::from(u32::from(addr) | !u32::from(mask));
        if !out.contains(&broadcast) {
            out.push(broadcast);
        }
    }
    out
}

/// Whether an answer came from this very process: its own probe is delivered to
/// its own discovery port, and a device that treated that as a peer would talk
/// to itself forever.
fn is_self(ip: Ipv4Addr, port: u16) -> bool {
    BOUND.get().is_some_and(|bound| *bound == port)
        && ipv4_interfaces().iter().any(|(addr, _)| *addr == ip)
}

/// The IPv4 address a `sockaddr` holds, if it holds one. Null is no address.
fn ipv4_of(address: *const libc::sockaddr) -> Option<Ipv4Addr> {
    if address.is_null() {
        return None;
    }
    // SAFETY: the caller takes these pointers from `getifaddrs`, which fills
    // each entry's family and address together.
    unsafe {
        if i32::from((*address).sa_family) != libc::AF_INET {
            return None;
        }
        let inet = address.cast::<libc::sockaddr_in>();
        Some(Ipv4Addr::from(u32::from_be((*inet).sin_addr.s_addr)))
    }
}

/// Asks the network for every device serving a board, and returns each one's
/// `host:port`.
///
/// It collects for a moment instead of taking the first answer: two Macs on one
/// LAN both answer, and a board that only met the quicker one would be a board
/// half of the devices share. The answering datagram's own source is the
/// device's address right now, whatever the lease was when it was last synced.
fn discover() -> Vec<String> {
    let Ok(socket) = UdpSocket::bind(("0.0.0.0", 0)) else {
        return Vec::new();
    };
    socket.set_broadcast(true).ok();
    for target in broadcast_addresses() {
        let _ = socket.send_to(PROBE, (target, DISCOVERY_PORT));
    }
    let _ = socket.send_to(PROBE, (Ipv4Addr::BROADCAST, DISCOVERY_PORT));

    let deadline = Instant::now() + PROBE_WAIT;
    let mut out: Vec<String> = Vec::new();
    let mut buf = [0u8; 512];
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return out;
        }
        socket.set_read_timeout(Some(left)).ok();
        let Ok((read, from)) = socket.recv_from(&mut buf) else {
            return out;
        };
        let text = String::from_utf8_lossy(&buf[..read]);
        let Some(port) = offer_port(&text) else {
            continue;
        };
        let ip = match from.ip() {
            std::net::IpAddr::V4(ip) => ip,
            std::net::IpAddr::V6(_) => continue,
        };
        if is_self(ip, port) {
            continue;
        }
        let addr = SocketAddr::from((ip, port)).to_string();
        if !out.contains(&addr) {
            out.push(addr);
        }
    }
}

/// The port an answer datagram names, if it is one of this protocol's answers.
fn offer_port(text: &str) -> Option<u16> {
    text.strip_prefix(OFFER)?.trim().parse::<u16>().ok()
}

/// Adds the devices a probe found to the ones already known, keeping what each
/// known peer has already told us.
fn found_peers(found: Vec<String>) {
    let mut peers = PEERS.lock().unwrap();
    for addr in found {
        if peers.iter().any(|peer| peer.addr == addr) {
            continue;
        }
        peers.push(Peer {
            addr,
            heard: 0,
            ok: false,
            at: 0,
            refused: false,
            locked_until: 0,
            typed: false,
            backlog: Body::default(),
        });
    }
}

/// Points this device at `addr` by hand, for a network that drops broadcasts.
///
/// A typed address is a peer like any other, kept even while it does not
/// answer; the probe keeps running beside it, so typing one Mac's address does
/// not hide another Mac on the same network.
fn add_typed(addr: String) {
    let mut peers = PEERS.lock().unwrap();
    if let Some(peer) = peers.iter_mut().find(|peer| peer.addr == addr) {
        peer.typed = true;
        return;
    }
    // One typed address at a time: the app stores one, and a second would be a
    // Mac the user can no longer edit away.
    peers.retain(|peer| !peer.typed);
    peers.push(Peer {
        addr,
        heard: 0,
        ok: false,
        at: 0,
        refused: false,
        locked_until: 0,
        typed: true,
        backlog: Body::default(),
    });
}

/// What one cycle sends a peer: its own backlog plus what the app changed since
/// the last cycle.
fn body_for(addr: &str, current: Option<&Body>) -> Body {
    let peers = PEERS.lock().unwrap();
    let mut body = peers
        .iter()
        .find(|peer| peer.addr == addr)
        .map(|peer| peer.backlog.clone())
        .unwrap_or_default();
    drop(peers);
    if let Some(current) = current {
        body.absorb(current);
    }
    body
}

/// The peers to try this cycle, with the state each needs: whether it is locked
/// out, when it was last heard from, and the watermark it is asked from.
fn targets() -> Vec<(String, i64, bool, u64, u64)> {
    PEERS
        .lock()
        .unwrap()
        .iter()
        .map(|peer| (peer.addr.clone(), peer.heard, peer.refused, peer.locked_until, peer.at))
        .collect()
}

/// A peer answered and merged: remember what it has, keep nothing of the body
/// for it, and put its answer where the app will read it.
fn delivered(addr: &str, answer: &str) {
    let value = serde_json::from_str::<Value>(answer).unwrap_or(Value::Null);
    let at = value.get("at").and_then(Value::as_f64).unwrap_or(0.0) as i64;
    let body = Body::from_text(answer);
    {
        let mut inbox = INBOX.lock().unwrap();
        inbox.get_or_insert_with(Body::default).absorb(&body);
    }
    let mut peers = PEERS.lock().unwrap();
    if let Some(peer) = peers.iter_mut().find(|peer| peer.addr == addr) {
        peer.heard = peer.heard.max(at);
        peer.ok = true;
        peer.at = now_millis();
        peer.refused = false;
        peer.locked_until = 0;
        peer.backlog = Body::default();
    }
    SYNCED_AT.store(now_millis(), Ordering::Relaxed);
}

/// A peer would not take this device's code, or asked it to wait. The body goes
/// back into the peer's own backlog: none of it was merged.
fn refused_by(addr: &str, locked: bool, retry: u64, sent: Body) {
    let until = if locked { now_millis() + retry.max(1) * 1000 } else { 0 };
    let mut peers = PEERS.lock().unwrap();
    if let Some(peer) = peers.iter_mut().find(|peer| peer.addr == addr) {
        peer.ok = false;
        peer.backlog = sent;
        if locked {
            peer.locked_until = until;
        } else {
            peer.refused = true;
        }
    }
}

/// A peer did not answer. A discovered one is forgotten so the next probe finds
/// it again (at whatever address it took); a typed one is kept, because that is
/// the one address the user gave.
fn lost(addr: &str, sent: Body) {
    let mut peers = PEERS.lock().unwrap();
    if let Some(index) = peers.iter().position(|peer| peer.addr == addr) {
        if peers[index].typed {
            peers[index].ok = false;
            peers[index].backlog = sent;
        } else {
            peers.remove(index);
        }
    }
}

/// Answers probes with the board's port, for as long as the app is open.
fn serve_discovery(port: u16) {
    let Ok(socket) = UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT)) else {
        // Some other build holds the port: the phone falls back to typing an
        // address, which still works.
        return;
    };
    socket.set_broadcast(true).ok();
    let mut buf = [0u8; 512];
    loop {
        let Ok((read, from)) = socket.recv_from(&mut buf) else {
            continue;
        };
        if &buf[..read] != PROBE {
            continue;
        }
        let _ = socket.send_to(format!("{OFFER}{port}").as_bytes(), from);
    }
}

/// `base` as a socket address: `http://10.0.0.5:8787` or `10.0.0.5:8787`.
fn socket_address(base: &str) -> String {
    let rest = base.trim().trim_start_matches("http://");
    if rest.contains(':') {
        rest.trim_end_matches('/').to_owned()
    } else {
        format!("{rest}:8787")
    }
}

/// One request to the Mac, over our own socket: Android refuses cleartext to a
/// LAN address through its HTTP client, and a request is four lines anyway.
/// Answers the status it came back with and the body under it.
fn request(
    address: &str,
    method: &str,
    path: &str,
    body: &str,
    headers: &[(&str, &str)],
) -> Result<(u16, String), String> {
    let stream = TcpStream::connect_timeout(
        &address.parse::<SocketAddr>().map_err(|e| format!("{address}: {e}"))?,
        EXCHANGE_WAIT,
    )
    .map_err(|e| format!("{address}: {e}"))?;
    stream.set_read_timeout(Some(EXCHANGE_WAIT)).ok();
    stream.set_write_timeout(Some(EXCHANGE_WAIT)).ok();
    let mut stream = stream;
    let mut extra = String::new();
    for (name, value) in headers {
        extra.push_str(&format!("{name}: {value}\r\n"));
    }
    let head = format!(
        "{method} {path} HTTP/1.1\r\nHost: {address}\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n{extra}Connection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes()).map_err(|e| e.to_string())?;
    stream.write_all(body.as_bytes()).map_err(|e| e.to_string())?;
    stream.flush().map_err(|e| e.to_string())?;

    let mut response = Vec::new();
    stream.read_to_end(&mut response).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&response);
    let (head, body) = text
        .split_once("\r\n\r\n")
        .ok_or_else(|| "the Mac answered no body".to_owned())?;
    let status = head
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| head.lines().next().unwrap_or("bad answer").to_owned())?;
    Ok((status, body.to_owned()))
}

/// What one exchange with a peer came to.
enum Exchange {
    /// The peer merged the rows and answered with what this device was missing.
    Merged(String),
    /// The peer answered and would not let this device in; `locked` when it is
    /// rate-limited rather than merely unconvinced by the code, and `retry` the
    /// seconds it named.
    Refused { locked: bool, retry: u64 },
    /// The peer did not answer at all, or answered something that is not an
    /// exchange. Nothing in the app can do anything about it but try again.
    Missing,
}

/// Asks for a challenge, then POSTs `body` to `/state` signed with it.
///
/// One challenge per exchange: a challenge answers exactly one request, so it is
/// asked for immediately before the request it signs rather than being kept.
fn post_state(base: &str, body: &str) -> Exchange {
    let address = socket_address(base);
    let nonce = match request(&address, "GET", "/challenge", "", &[]) {
        Ok((200, text)) => match serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|value| value.get("nonce").and_then(Value::as_str).map(str::to_owned))
        {
            Some(nonce) => nonce,
            None => return Exchange::Missing,
        },
        Ok(_) => return Exchange::Missing,
        Err(_) => return Exchange::Missing,
    };
    let Some(proof) = auth::signed(&nonce) else {
        // No code on this device: nothing to prove, so there is nothing to ask
        // for. The peer would answer 401, and five of those shut its door.
        return Exchange::Refused { locked: false, retry: 0 };
    };
    let signed = [
        (auth::NONCE_HEADER, nonce.as_str()),
        (auth::PROOF_HEADER, proof.as_str()),
    ];
    match request(&address, "POST", "/state", body, &signed) {
        Ok((200, text)) => Exchange::Merged(text),
        Ok((401, _)) => Exchange::Refused { locked: false, retry: 0 },
        Ok((429, text)) => Exchange::Refused { locked: true, retry: retry_in(&text) },
        Ok(_) | Err(_) => Exchange::Missing,
    }
}

/// How many seconds a peer asked this device to wait, out of a 429 body. The
/// lock is the peer's own minute, so a missing or odd answer gets that.
fn retry_in(text: &str) -> u64 {
    serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|value| value.get("retry").and_then(Value::as_u64))
        .unwrap_or(auth::LOCK.as_secs())
}

/// How long to wait before probing again, after `missed` cycles in a row found
/// no peer that answered.
///
/// Three seconds while someone is probably in the room — a Mac may be starting
/// up, or the phone may have just joined the network — then doubling to half a
/// minute. Away from home the phone sits on a network with no Mac on it at all,
/// and a probe every three seconds for an afternoon is a radio that never sleeps.
fn probe_backoff(missed: u32) -> Duration {
    const SECONDS: [u64; 5] = [3, 6, 12, 24, 30];
    Duration::from_secs(SECONDS[(missed as usize).min(SECONDS.len() - 1)])
}

/// This device's side of the mesh: find every serving device, exchange boards
/// with each of them, and keep what they answer.
///
/// Each peer has its own watermark and its own backlog, so one Mac that is down
/// or holds a different code cannot stop the others from being in step. The
/// merge makes the exchange safe to repeat: it is per field, by stamp, and a
/// tombstone is a value, so the same rows may cross as often as they like.
fn exchange_loop() {
    // Which nudge was answered, and how many cycles in a row found nobody: a
    // nudge is the app saying "look now", and a quiet network is waited out
    // rather than hammered.
    let mut seen_nudge = NUDGE.load(Ordering::Relaxed);
    let mut missed = 0_u32;
    let mut probed_at: u64 = 0;
    loop {
        let nudge = NUDGE.load(Ordering::Relaxed);
        if nudge != seen_nudge {
            seen_nudge = nudge;
            missed = 0;
            probed_at = 0;
        }
        // An unpaired device stays quiet: it has nothing to prove, and every
        // attempt it made would count against a peer's five. Waiting here is
        // the app saying "pair me", and pairing nudges the thread awake.
        if !auth::has_prover() {
            wait_for_nudge(Duration::from_secs(2), &mut seen_nudge);
            continue;
        }
        // Probe when nothing is known, and now and then while something is, so
        // a Mac opened later is met without the radio looking constantly.
        let known = PEERS.lock().unwrap().len();
        let due = known == 0
            || probed_at == 0
            || now_millis().saturating_sub(probed_at) >= PROBE_EVERY.as_millis() as u64;
        if due {
            found_peers(discover());
            probed_at = now_millis();
        }
        let targets = targets();
        if targets.is_empty() {
            missed = missed.saturating_add(1);
            wait_for_nudge(probe_backoff(missed), &mut seen_nudge);
            continue;
        }
        // Taking the body, not copying it: a body a peer answered is done with,
        // and every peer that did not answer keeps it in its own backlog.
        let current = CURRENT.lock().unwrap().take();
        let mut any_ok = false;
        let mut attempted = 0_u32;
        for (addr, heard, refused, locked_until, at) in targets {
            // A refusal is the user's to fix, not the loop's, and a lockout is
            // waited out in full: asking again spends attempts that belong to
            // the device's owner.
            if refused || locked_until > now_millis() {
                continue;
            }
            let send = body_for(&addr, current.as_ref());
            // Nothing to say, and this peer was heard from a moment ago: asking
            // again would be a request every cycle for no news.
            if send.is_empty() && now_millis().saturating_sub(at) < POLL_MS {
                continue;
            }
            attempted += 1;
            let since = (heard - MARGIN).max(0);
            match post_state(&addr, &send.text(since)) {
                Exchange::Merged(answer) => {
                    any_ok = true;
                    delivered(&addr, &answer);
                }
                Exchange::Refused { locked, retry } => refused_by(&addr, locked, retry, send),
                Exchange::Missing => lost(&addr, send),
            }
        }
        if attempted == 0 {
            // Every peer is locked out or was just heard from and there was
            // nothing new to say: look again shortly, don't back off.
            wait_for_nudge(Duration::from_millis(700), &mut seen_nudge);
            continue;
        }
        if any_ok {
            missed = 0;
        } else {
            // Nothing answered: probe again before the next try, so a peer that
            // took a new lease is found rather than retried at an old address.
            missed = missed.saturating_add(1);
            probed_at = 0;
        }
        if any_ok {
            wait_for_nudge(Duration::from_millis(1500), &mut seen_nudge);
        } else {
            wait_for_nudge(probe_backoff(missed), &mut seen_nudge);
        }
    }
}

/// Sleeps for `wait`, unless the app nudges the exchange thread first.
///
/// In slices rather than one long sleep: a nudge means the app is back in front
/// of the user, and waiting out the rest of a thirty-second backoff would make
/// the wake-up late for nothing. Thirty slices is no cost at all.
fn wait_for_nudge(wait: Duration, seen: &mut u64) {
    const SLICE: Duration = Duration::from_millis(250);
    let mut left = wait;
    while !left.is_zero() {
        thread::sleep(SLICE.min(left));
        left = left.saturating_sub(SLICE);
        let nudge = NUDGE.load(Ordering::Relaxed);
        if nudge != *seen {
            *seen = nudge;
            return;
        }
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Handle one request: `GET /state`, `POST /state`, `GET /health`.
fn handle(mut stream: TcpStream) {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];

    // Read until the headers are complete, then the body the headers announce.
    let (head_end, content_length) = loop {
        match stream.read(&mut chunk) {
            Ok(0) => break (None, 0),
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&buf[..pos]).to_string();
                    let len = head
                        .lines()
                        .find_map(|l| {
                            let (k, v) = l.split_once(':')?;
                            k.eq_ignore_ascii_case("content-length")
                                .then(|| v.trim().parse::<usize>().ok())
                                .flatten()
                        })
                        .unwrap_or(0);
                    break (Some(pos + 4), len.min(MAX_BODY));
                }
                if buf.len() > MAX_BODY {
                    break (None, 0);
                }
            }
            Err(_) => break (None, 0),
        }
    };

    let Some(head_end) = head_end else {
        let _ = respond(&mut stream, 400, "{\"error\":\"bad request\"}");
        return;
    };

    while buf.len() < head_end + content_length {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    }

    let head = String::from_utf8_lossy(&buf[..head_end]).to_string();
    let mut parts = head.lines().next().unwrap_or("").split_whitespace();
    let method = parts.next().unwrap_or("");
    let target = parts.next().unwrap_or("");
    let (path, query) = match target.split_once('?') {
        Some((path, query)) => (path, query),
        None => (target, ""),
    };
    let body = String::from_utf8_lossy(&buf[head_end..]).to_string();

    // The board is served on the LAN, which at a coffee shop is everyone's LAN.
    // So the two endpoints that touch it want a proof that this phone knows the
    // six digits on the Mac's own title bar. `/health` and `/challenge` stay
    // open: one says a Mac is here, the other hands out the nonce a proof is
    // made over, and neither reads or writes a card.
    if path == "/state" {
        match auth::admit(&head) {
            auth::Verdict::Ok => {}
            auth::Verdict::Unauthorized => {
                let _ = respond(&mut stream, 401, "{\"error\":\"unauthorized\"}");
                return;
            }
            auth::Verdict::Locked(left) => {
                // The wait is named so a client knows not to try again sooner:
                // a phone that hammered at a locked Mac would keep it locked.
                let _ = respond(
                    &mut stream,
                    429,
                    &json!({ "error": "too many attempts", "retry": left.as_secs() }).to_string(),
                );
                return;
            }
        }
    }

    match (method, path) {
        // Only that it is there: how many cards the board holds is the user's
        // business, and this endpoint answers anyone on the network.
        ("GET", "/health") => {
            let _ = respond(&mut stream, 200, "{\"ok\":true}");
        }
        ("GET", "/challenge") => match auth::challenge() {
            Ok(answer) => {
                let _ = respond(&mut stream, 200, &answer);
            }
            Err(e) => {
                let _ = respond(&mut stream, 500, &json!({"error": e}).to_string());
            }
        },
        ("GET", "/state") => match board::with(|db| board::rows_since(&db.conn, since_of(query))) {
            Ok(answer) => {
                let _ = respond(&mut stream, 200, &answer);
            }
            Err(e) => {
                let _ = respond(&mut stream, 500, &json!({"error": e}).to_string());
            }
        },
        ("POST", "/state") => match parse_exchange(&body) {
            Ok((incoming, incoming_tags, since)) => {
                // The phone's changes land first, then it is told what its
                // `since` missed: one round trip keeps both boards equal, and
                // nothing but the difference crosses the network.
                let merged = board::with(|db| {
                    board::upsert(&mut db.conn, &incoming, &incoming_tags)?;
                    board::mark_seeded(&db.conn)?;
                    board::rows_since(&db.conn, since)
                });
                match merged {
                    Ok(answer) => {
                        let _ = respond(&mut stream, 200, &answer);
                    }
                    Err(e) => {
                        let _ = respond(&mut stream, 500, &json!({"error": e}).to_string());
                    }
                }
            }
            Err(e) => {
                let _ = respond(&mut stream, 400, &json!({"error": e}).to_string());
            }
        },
        _ => {
            let _ = respond(&mut stream, 404, "{\"error\":\"not found\"}");
        }
    }
}

/// `since` out of a query string (`since=1762500000000`), 0 when absent.
fn since_of(query: &str) -> i64 {
    query
        .split('&')
        .find_map(|pair| pair.strip_prefix("since="))
        .and_then(|value| value.parse::<f64>().ok())
        .map(|value| value as i64)
        .unwrap_or(0)
}

fn respond(stream: &mut TcpStream, status: u16, body: &str) -> std::io::Result<()> {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        // The door is locked rather than the request malformed.
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        _ => "Not Found",
    };
    let head = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: application/json; charset=utf-8\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Headers: content-type\r\n\
         Connection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body.as_bytes())?;
    stream.flush()
}

/// The crate's UI set: what `App.tsx` imports from `app/native`.
#[native_module("app/native")]
fn native(registry: &mut Registry) {
    registry.module::<Board>();
    registry.module::<Backup>();
    registry.module::<Sync>();
    registry.module::<Reminder>();
    registry.module::<Dock>();
}

/// The board's store, in SQLite.
///
/// The database *is* the board: the interface loads it once at launch, saves
/// each change a moment after the user makes it, and the LAN service merges
/// the phone's changes into the same file. There is no second copy to keep in
/// step, so a card written by the phone and a card written by this Mac are
/// ordered by the same `updatedAt` rule.
///
/// The path is the app's data directory, which the interface passes in: macOS
/// keeps it under `~/Library/Application Support/<bundle id>/`, Android in the
/// app's private files. `""` keeps the board in memory, which is what a test
/// gets so it can never reach the board the user is looking at.
#[module]
pub struct Board;

#[module]
impl Board {
    /// Opens the board's file (creating it, its schema, and its directory) and
    /// returns the path it used. Safe to call more than once.
    pub fn open(dir: String) -> Result<String, String> {
        board::open(&dir)
    }

    /// The whole board as `{ cards, tags, seeded }`, cards in board order.
    /// `seeded` says a board has been saved at least once: an empty board with
    /// `seeded` is one the user emptied, not a first run to fill with samples.
    pub fn load() -> Result<String, String> {
        board::with(|db| board::all(&db.conn))
    }

    /// Writes what changed: `{ cards, tags, order? }`, where `order` carries the
    /// columns whose card order moved (`{ "todo": ["c3", "c1"] }`). Returns how
    /// many rows were written.
    pub fn save(changes: String) -> Result<u32, String> {
        let value: Value = serde_json::from_str(&changes).map_err(|e| format!("bad JSON: {e}"))?;
        let cards = list_of(&value, "cards")?;
        let tags = list_of(&value, "tags")?;
        let order = value
            .get("order")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        board::with(|db| {
            let mut written = board::upsert(&mut db.conn, &cards, &tags)?;
            written += board::apply_order(&mut db.conn, &order)?;
            board::mark_seeded(&db.conn)?;
            Ok(written as u32)
        })
    }

    /// Everything stamped at or after `stamp`, plus the newest stamp the board
    /// holds (`at`) and how many live cards it has.
    pub fn since(stamp: f64) -> Result<String, String> {
        board::with(|db| board::rows_since(&db.conn, stamp as i64))
    }

    /// Empties the board. For a test that needs a first run; the app never
    /// clears the user's board.
    pub fn clear() -> Result<(), String> {
        board::with(|db| board::clear(&db.conn))
    }
}

/// The board's own backups: a JSON snapshot a day, kept for a week, and the two
/// ways a board leaves the app and comes back.
///
/// The snapshot is the *store's* document, tombstones and tags included, so a
/// restore can put a card back that was removed before the snapshot was taken.
/// Everything here takes the folder from the interface, the way `Board.open`
/// does: this crate has no idea where the app keeps its data, and the folder a
/// launch uses is the one thing a test must not be able to change.
#[module]
pub struct Backup;

#[module]
impl Backup {
    /// Writes today's snapshot, if there is not one already. Answers with the
    /// name it wrote, `exists` when today's is already there, and `""` when the
    /// board has no folder (a test, a board in memory).
    ///
    /// `day` is the device's own day, `YYYY-MM-DD`: a snapshot is named for the
    /// day the user is living in, not UTC's.
    pub fn snapshot(dir: String, day: String) -> Result<String, String> {
        backup::snapshot(&dir, &day)
    }

    /// The backups on disk, newest first, as JSON:
    /// `[{ name, at, cards, tags }]` — the day, when it was taken, and how much
    /// was in it.
    pub fn list(dir: String) -> String {
        backup::list(&dir)
    }

    /// One backup's text. `name` must be `navigator-YYYY-MM-DD.json`: a restore
    /// cannot be asked for a path.
    pub fn read(dir: String, name: String) -> Result<String, String> {
        backup::read(&dir, &name)
    }

    /// Writes an export into `dir` and answers with the path it wrote. The
    /// interface names it; this refuses a name that is a path.
    pub fn write(dir: String, name: String, text: String) -> Result<String, String> {
        backup::write(&dir, &name, &text)
    }
}

/// Sync between this Mac and the phone on the same Wi-Fi.
#[module]
pub struct Sync;

#[module]
impl Sync {
    /// Starts the service on `port` (0 picks a free one); the port it bound.
    ///
    /// Runs for as long as the app does: the listener is a background thread
    /// that ends with the process, so there is no service to start or stop by
    /// hand.
    pub fn start(port: u16) -> Result<u16, String> {
        // A second call returns the port already bound instead of leaking a
        // second listener onto a socket the caller can never name again.
        if let Some(bound) = BOUND.get() {
            return Ok(*bound);
        }
        // A port taken by another copy of this app (a development host beside
        // the installed one) is not a failure: take a free port instead and let
        // discovery announce whichever one this process got.
        let listener = TcpListener::bind(("0.0.0.0", port))
            .or_else(|_| TcpListener::bind(("0.0.0.0", 0)))
            .map_err(|e| format!("cannot listen on port {port}: {e}"))?;
        let bound = listener.local_addr().map_err(|e| e.to_string())?.port();
        thread::spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        thread::spawn(move || handle(stream));
                    }
                    Err(_) => break,
                }
            }
        });
        thread::spawn(move || serve_discovery(bound));
        let _ = BOUND.set(bound);
        Ok(bound)
    }

    /// The URL to point the phone at, e.g. `http://10.0.0.5:8787`.
    pub fn address(port: u16) -> String {
        format!("http://{}:{}", lan_ip(), port)
    }

    /// Starts this device looking for the others, and keeps exchanging boards.
    ///
    /// Nothing here touches the network on the caller's thread: the work
    /// happens in a thread of its own, which is why the interface never stalls
    /// while a peer is asleep. A Mac both serves and watches; a phone only
    /// watches, because its changes reach a peer in the request it sends.
    pub fn watch() {
        static WATCHING: OnceLock<()> = OnceLock::new();
        if WATCHING.set(()).is_ok() {
            thread::spawn(exchange_loop);
        }
    }

    /// Hands the exchange thread the rows that changed here; it carries them to
    /// every peer this cycle, and a peer that does not answer keeps its own copy
    /// until it does.
    pub fn offer(cards_json: String) {
        let fresh = Body::from_text(&cards_json);
        if fresh.is_empty() {
            return;
        }
        let mut current = CURRENT.lock().unwrap();
        match current.as_mut() {
            Some(pending) => pending.absorb(&fresh),
            None => *current = Some(fresh),
        }
    }

    /// Everything the peers have answered since this was last read; empty when
    /// nothing is new.
    pub fn inbox() -> String {
        INBOX.lock().unwrap().take().map(|body| body.text(0)).unwrap_or_default()
    }

    /// Where sync stands, as JSON.
    ///
    /// `peers` is one entry per device this one is in step with: its address,
    /// whether the last exchange worked, when it last did, and what its code is
    /// doing. The top-level `pair` is the one thing worth saying about the code
    /// across all of them, and `unreachable` says no peer answered at all.
    pub fn status() -> String {
        let peers = PEERS.lock().unwrap();
        let now = now_millis();
        let any_ok = peers.iter().any(|peer| peer.ok);
        let refused = peers.iter().any(|peer| peer.refused);
        let retry = peers.iter().map(|peer| peer.locked_until).max().unwrap_or(0);
        let locked = retry > now;
        // Why an exchange is not happening, in one word the app can draw:
        // `need` — this device has no code yet; `wrong` — a peer did not take
        // the code; `locked` — a peer asked it to wait; `ok` — nothing in the
        // way. A refusal is said only when no peer is in step: a code that is
        // wrong for a second Mac must not hide a board that is syncing with the
        // first, and the sheet names the peer that needs it.
        let pair = if !auth::has_prover() {
            "need"
        } else if refused && !any_ok {
            "wrong"
        } else if locked && !any_ok {
            "locked"
        } else {
            "ok"
        };
        let list: Vec<Value> = peers
            .iter()
            .map(|peer| {
                let state = if peer.refused {
                    "wrong"
                } else if peer.locked_until > now {
                    "locked"
                } else {
                    "ok"
                };
                json!({
                    "addr": peer.addr,
                    "ok": peer.ok,
                    "at": peer.at,
                    "typed": peer.typed,
                    "pair": state,
                    // Seconds left of this peer's lockout, rounded up so a
                    // client never comes back a moment early.
                    "retry": if peer.locked_until > now {
                        (peer.locked_until - now).div_ceil(1000)
                    } else {
                        0
                    },
                })
            })
            .collect();
        json!({
            "peer": peers.first().map(|peer| peer.addr.clone()).unwrap_or_default(),
            "peers": list,
            "unreachable": !peers.is_empty() && !any_ok,
            "at": SYNCED_AT.load(Ordering::Relaxed),
            "pair": pair,
            "retry": if locked { (retry - now).div_ceil(1000) } else { 0 },
        })
        .to_string()
    }

    /// Adds a device to sync with by hand, for a network that drops broadcasts.
    ///
    /// The probe keeps running beside it: a typed address is the fallback for
    /// the network, not a decision to ignore the other Macs on it.
    pub fn use_address(address: String) {
        add_typed(socket_address(&address));
        // An address is as good as a sighting: try it now, and from the start
        // of the backoff rather than from wherever it had grown to.
        NUDGE.fetch_add(1, Ordering::Relaxed);
    }

    /// Looks for the other devices again now, and at the start of the backoff.
    ///
    /// The app calls it when it comes back to the front: the phone has been in a
    /// pocket, walking out of one network and into another, while the thread
    /// waited longer and longer for a Mac that was not on the last one. Nothing
    /// runs where there is no exchange thread, so it is harmless everywhere else.
    pub fn nudge() {
        NUDGE.fetch_add(1, Ordering::Relaxed);
    }

    /// Adopts `code` as the six digits this device answers to.
    ///
    /// The app keeps the digits (one key in the device's own storage) and hands
    /// them back at launch: the board's file is the user's work, and its tables
    /// are not the place for this. The crate holds the code in memory, which is
    /// exactly as long as the port is open.
    pub fn host_code(code: String) -> Result<(), String> {
        if !auth::is_code(&code) {
            return Err("a pairing code is six digits".to_owned());
        }
        auth::serving().set_code(&code);
        Ok(())
    }

    /// Makes a new pairing code, adopts it, and returns it for the app to keep.
    ///
    /// Everything the old code opened closes with it: the challenges handed out
    /// for it are gone and its lockout is cleared, so a device that guessed
    /// wrong can try again — with the new digits, which it has to be given.
    pub fn new_code() -> Result<String, String> {
        let code = auth::new_code()?;
        auth::serving().set_code(&code);
        Ok(code)
    }

    /// Adopts `code` as the one this device proves it knows; `""` forgets the
    /// one it had, which is what a launch with nothing in storage hands over.
    pub fn set_code(code: String) -> Result<(), String> {
        if !code.is_empty() && !auth::is_code(&code) {
            return Err("a pairing code is six digits".to_owned());
        }
        auth::set_prover(&code);
        // A new code is a new attempt: every refusal and lockout belonged to
        // the old digits. The exchange thread is woken so it tries them now.
        for peer in PEERS.lock().unwrap().iter_mut() {
            peer.refused = false;
            peer.locked_until = 0;
        }
        NUDGE.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }
}

/// Deadline reminders.
///
/// nsh has no notification API, so this is the one place a due date leaves the
/// app: the Mac hands it to `UNUserNotificationCenter`, which owns the schedule
/// from then on. The system delivers it whether or not the app is still open,
/// plays the sound the user chose in Settings, and lists it in Notification
/// Centre beside every other app's.
///
/// Android cannot be served the same way: a notification needs
/// `POST_NOTIFICATIONS` in the manifest on API 33 and newer, and `nsh package`
/// writes that manifest with `INTERNET` alone and offers no way to add to it.
/// So `status` says `unsupported` there and the phone reminds from inside the
/// app instead, which is honest about what it can do rather than posting a
/// notification the system drops.
#[module]
pub struct Reminder;

/// What the user allowed, as last read: 0 unknown, 1 granted, 2 denied, and
/// 3 there is no notification centre to ask — a test binary or a development
/// host, whose process has no bundle to be identified by.
static AUTH: AtomicU64 = AtomicU64::new(0);

/// What every reminder's identifier starts with, so the system's own list can
/// be read back as card ids.
const ID_PREFIX: &str = "navigator.card.";
/// The category every reminder belongs to. A category is what gives a
/// notification its buttons, so the content names it and `install` declares it.
const CATEGORY: &str = "navigator.reminder";
/// The suffix of the early reminder, the one that fires ahead of a deadline.
const EARLY: &str = ".pre";

/// The identifier the system knows one reminder by: the deadline's own
/// notification is the bare card id, and the early one adds `.pre`, so the two
/// are separate requests that never replace each other.
fn identifier_text(id: &str) -> String {
    format!("{ID_PREFIX}{id}")
}

/// The card an identifier names, and whether it was the early reminder.
fn card_of(identifier: &str) -> Option<(String, bool)> {
    let rest = identifier.strip_prefix(ID_PREFIX)?;
    match rest.strip_suffix(EARLY) {
        Some(id) => Some((id.to_owned(), true)),
        None => Some((rest.to_owned(), false)),
    }
}

/// What an action identifier asks for. `open` is a plain click on the
/// notification, which the framework reports as an action of its own; the two
/// buttons carry their own identifiers.
fn action_of(action: &str) -> Option<&'static str> {
    match action {
        "done" => Some("done"),
        "snooze" => Some("snooze"),
        "open" => Some("open"),
        _ => None,
    }
}

/// What the user answered, waiting for the interface to collect it.
///
/// The notification centre calls its delegate on the main thread and the
/// interface runs on a thread of its own, so this queue is the only thing the
/// two share. It is also what keeps an answer that arrived before the interface
/// was ready — the click that launched the app — instead of dropping it.
static ANSWERS: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

fn enqueue_answer(id: String, action: &str) {
    if let Ok(mut queue) = ANSWERS.lock() {
        queue.push((id, action.to_owned()));
    }
}

/// Everything answered since the last call, as `[{ id, action }]`.
fn take_answers() -> String {
    let taken = match ANSWERS.lock() {
        Ok(mut queue) => std::mem::take(&mut *queue),
        Err(_) => Vec::new(),
    };
    let answers: Vec<Value> = taken
        .iter()
        .map(|(id, action)| json!({ "id": id, "action": action }))
        .collect();
    serde_json::to_string(&answers).unwrap_or_else(|_| "[]".to_owned())
}

#[module]
impl Reminder {
    /// Registers the reminder's category and takes the notification centre's
    /// delegate: `ok`, or `unsupported` where the process has no notification
    /// centre at all.
    ///
    /// This has to be the first thing the app does with reminders. A click on a
    /// notification can be what launches the app, and the system only hands
    /// that answer to a delegate that is already set; the category is what the
    /// 完成 and 推迟 1 小时 buttons come from, and a notification naming a
    /// category nobody registered arrives with no buttons.
    pub fn install() -> String {
        #[cfg(target_os = "macos")]
        {
            return macos::install();
        }
        #[allow(unreachable_code)]
        "unsupported".to_owned()
    }

    /// What the user answered, as `[{ id, action }]`, and forgets it: `[]` when
    /// nothing happened since the last ask. `action` is `done`, `snooze` or
    /// `open`, and `id` is the card's — the early reminder's suffix is dropped,
    /// because both buttons act on the same card.
    pub fn take_responses() -> String {
        take_answers()
    }

    /// Asks once for permission to show notifications, and reports what the
    /// user allowed. The answer arrives asynchronously; call `status` again
    /// after a moment to read it.
    pub fn request() -> String {
        #[cfg(target_os = "macos")]
        {
            return macos::request();
        }
        #[allow(unreachable_code)]
        "unsupported".to_owned()
    }

    /// What the app may do now: `granted`, `denied`, `unknown` (not asked yet)
    /// or `unsupported` where the platform cannot post one.
    pub fn status() -> String {
        #[cfg(target_os = "macos")]
        {
            return macos::status();
        }
        #[allow(unreachable_code)]
        "unsupported".to_owned()
    }

    /// Schedules one notification for card `id`, at `at` (millis since the
    /// epoch), replacing whatever was pending under the same id.
    ///
    /// A date in the past is not an error: the card is overdue, and a
    /// notification about a deadline that already passed is noise. It is
    /// dropped, and the app says so by showing the overdue pill instead.
    pub fn schedule(id: String, title: String, body: String, at: f64) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            return macos::schedule(&id, &title, &body, at);
        }
        #[allow(unreachable_code)]
        {
            let _ = (id, title, body, at);
            Err("this platform cannot post a notification".to_owned())
        }
    }

    /// Takes back a reminder that is still pending.
    pub fn cancel(id: String) {
        #[cfg(target_os = "macos")]
        macos::cancel(&id);
        #[cfg(not(target_os = "macos"))]
        {
            let _ = id;
        }
    }

    /// Takes back every pending reminder, for the app's own reset.
    pub fn cancel_all() {
        #[cfg(target_os = "macos")]
        macos::cancel_all();
    }

    /// The reminders the system still holds, as a JSON array of card ids:
    /// `[]` when there are none, `""` while the answer is still on its way.
    ///
    /// Asking the system, not the app, is the only way to know a reminder
    /// really was scheduled — which is what a test has to check.
    pub fn pending() -> String {
        #[cfg(target_os = "macos")]
        {
            return macos::pending();
        }
        #[allow(unreachable_code)]
        "[]".to_owned()
    }
}

/// The badge on the app's Dock icon.
///
/// A board that is behind another window is a board nobody is looking at, and
/// the icon is the one part of it still in sight. The number on it is the count
/// of work that wants attention *now* — late, or due today, and still open —
/// which the interface computes from the same pills the board draws, so the
/// badge and the cards cannot disagree about what attention means.
///
/// It is a Mac idea and only a Mac one: Android has no Dock, and its launcher
/// dots would need a permission the manifest cannot ask for, so this does
/// nothing there.
#[module]
pub struct Dock;

/// The badge's text for `count`: nothing at zero, so the badge goes away with
/// the work it was counting, and `99+` past two digits, where a number would no
/// longer fit on an icon.
fn badge_label(count: f64) -> Option<String> {
    let n = if count.is_finite() { count.max(0.0).floor() as u64 } else { 0 };
    if n == 0 {
        return None;
    }
    if n > 99 {
        return Some("99+".to_owned());
    }
    Some(n.to_string())
}

#[module]
impl Dock {
    /// Puts `count` on the Dock's icon, and takes the badge away at zero.
    ///
    /// A no-op where there is no Dock to put it on, which includes a process
    /// with no bundle: that is `nsh test`'s runner, and a badge is not a reason
    /// for a test run to die.
    pub fn set_badge(count: f64) {
        let label = badge_label(count);
        #[cfg(target_os = "macos")]
        macos::set_badge(label);
        #[cfg(not(target_os = "macos"))]
        {
            let _ = label;
        }
    }

    /// What the Dock's icon carries now: `""` for no badge, and also for a
    /// process that has no Dock to ask.
    ///
    /// On the main thread this reads the tile itself. Anywhere else it answers
    /// with what the last hand-over put on the tile — the interface's own thread
    /// cannot look at AppKit, and the number the icon carries is what that work
    /// wrote there.
    pub fn badge() -> String {
        #[cfg(target_os = "macos")]
        {
            return macos::badge();
        }
        #[allow(unreachable_code)]
        String::new()
    }

    /// Whether this process can badge a Dock icon, and what stops it when it
    /// cannot: `ok`, or `no-bundle` where there is no app to put a Dock on — a
    /// bare test executable. `unsupported` where the platform has no Dock.
    ///
    /// The badge is a decoration, so a process that cannot draw one works
    /// without it — but nothing else in the app can tell `""` from "it did not
    /// happen", and a silent no-op is exactly the kind of thing that ships
    /// broken.
    pub fn status() -> String {
        #[cfg(target_os = "macos")]
        {
            return macos::dock_status();
        }
        #[allow(unreachable_code)]
        "unsupported".to_owned()
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{AUTH, CATEGORY, Ordering, card_of, enqueue_answer, identifier_text};
    use block2::DynBlock;
    use objc2::rc::Retained;
    use objc2::runtime::{Bool, NSObject, NSObjectProtocol, ProtocolObject};
    use objc2::{AnyThread, define_class, msg_send};
    use objc2_app_kit::{NSApplication, NSDockTile};
    use objc2_foundation::{NSArray, NSBundle, NSError, NSSet, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
        UNNotification, UNNotificationAction, UNNotificationActionOptions, UNNotificationCategory,
        UNNotificationCategoryOptions, UNNotificationDefaultActionIdentifier,
        UNNotificationDismissActionIdentifier, UNNotificationPresentationOptions,
        UNNotificationRequest, UNNotificationResponse, UNNotificationSettings,
        UNNotificationSound, UNTimeIntervalNotificationTrigger, UNUserNotificationCenter,
        UNUserNotificationCenterDelegate,
    };

    /// The system's notification centre, or `None` when the process is not an
    /// app the system can address.
    ///
    /// `currentNotificationCenter` raises an Objective-C exception — which
    /// aborts the process, not the call — when the process has no bundle
    /// identifier: `nsh test`'s runner is a bare executable. Asking first, and
    /// catching anyway, is what keeps a headless run from dying here.
    fn center() -> Option<Retained<UNUserNotificationCenter>> {
        if NSBundle::mainBundle().bundleIdentifier().is_none() {
            AUTH.store(3, Ordering::Relaxed);
            return None;
        }
        match objc2::exception::catch(|| UNUserNotificationCenter::currentNotificationCenter()) {
            Ok(center) => Some(center),
            Err(_) => {
                AUTH.store(3, Ordering::Relaxed);
                None
            }
        }
    }

    /// Notification identifiers are the card's id, so a rescheduled card
    /// replaces its own reminder instead of stacking a second one.
    fn identifier(id: &str) -> Retained<NSString> {
        NSString::from_str(&identifier_text(id))
    }

    define_class!(
        // SAFETY: NSObject has no subclassing requirements, and this class holds
        // no instance variables — there is nothing to drop, lock or keep in
        // step with Objective-C.
        #[unsafe(super(NSObject))]
        #[name = "NavigatorNotificationDelegate"]
        #[ivars = ()]
        struct Delegate;

        unsafe impl NSObjectProtocol for Delegate {}

        unsafe impl UNUserNotificationCenterDelegate for Delegate {
            /// A deadline that comes due while the board is open is still a
            /// deadline. The system asks the delegate what to do with a
            /// notification arriving in front of the app, and without this
            /// answer it shows nothing at all.
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present(
                &self,
                _center: &UNUserNotificationCenter,
                _notification: &UNNotification,
                completion: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                completion.call((
                    UNNotificationPresentationOptions::Banner
                        | UNNotificationPresentationOptions::List
                        | UNNotificationPresentationOptions::Sound,
                ));
            }

            /// What the user did with a notification: a click on it, or one of
            /// the two buttons. The answer is only queued here — the board lives
            /// on the interface's own thread, and this callback runs on the
            /// main one.
            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn did_receive(
                &self,
                _center: &UNUserNotificationCenter,
                response: &UNNotificationResponse,
                completion: &DynBlock<dyn Fn()>,
            ) {
                let action = answer_of(&response.actionIdentifier().to_string());
                if let Some(action) = action {
                    let identifier = response.notification().request().identifier().to_string();
                    if let Some((id, _early)) = card_of(&identifier) {
                        enqueue_answer(id, action);
                    }
                }
                completion.call(());
            }
        }
    );

    impl Delegate {
        fn new() -> Retained<Self> {
            let this = Self::alloc().set_ivars(());
            unsafe { msg_send![super(this), init] }
        }
    }

    /// What an action identifier from the system means: a plain click on the
    /// notification is `open`, a dismissal is nothing (closing a notification is
    /// not an answer), and the two buttons name themselves.
    fn answer_of(action: &str) -> Option<&'static str> {
        // SAFETY: both are the framework's own constants, exported by
        // UserNotifications and valid for the life of the process.
        let (default, dismiss) = unsafe {
            (
                UNNotificationDefaultActionIdentifier.to_string(),
                UNNotificationDismissActionIdentifier.to_string(),
            )
        };
        if action == default {
            Some("open")
        } else if action == dismiss {
            None
        } else {
            super::action_of(action)
        }
    }

    /// The delegate the notification centre holds. Its `delegate` property is
    /// weak, so this is what keeps the object alive: made once, kept for the
    /// life of the process, so an answer arriving at any point finds it.
    fn delegate() -> &'static Retained<Delegate> {
        static DELEGATE: std::sync::OnceLock<Retained<Delegate>> = std::sync::OnceLock::new();
        DELEGATE.get_or_init(Delegate::new)
    }

    /// Declares the category every reminder belongs to, with the two things a
    /// reminder can be answered with.
    ///
    /// The buttons carry no options on purpose: neither needs the app brought
    /// forward, and an action that pulls the window in front of what the user is
    /// reading is a worse answer than the answer itself.
    fn register_categories(center: &UNUserNotificationCenter) {
        let done = UNNotificationAction::actionWithIdentifier_title_options(
            &NSString::from_str("done"),
            &NSString::from_str("完成"),
            UNNotificationActionOptions::empty(),
        );
        let snooze = UNNotificationAction::actionWithIdentifier_title_options(
            &NSString::from_str("snooze"),
            &NSString::from_str("推迟 1 小时"),
            UNNotificationActionOptions::empty(),
        );
        let category = UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
            &NSString::from_str(CATEGORY),
            &NSArray::from_retained_slice(&[done, snooze]),
            &NSArray::new(),
            UNNotificationCategoryOptions::empty(),
        );
        center.setNotificationCategories(&NSSet::from_retained_slice(&[category]));
    }

    pub fn install() -> String {
        let Some(center) = center() else {
            return "unsupported".to_owned();
        };
        register_categories(&center);
        let delegate = delegate();
        center.setDelegate(Some(ProtocolObject::from_ref(&**delegate)));
        // The center's registration with the notification daemon is
        // asynchronous, so nothing here reads the delegate back: it answers
        // `true` only a moment later, and a status that said `false` for a
        // delegate that is set would be worse than no status at all.
        "ok".to_owned()
    }

    fn remember(status: UNAuthorizationStatus) {
        let code = if status == UNAuthorizationStatus::Authorized
            || status == UNAuthorizationStatus::Provisional
        {
            1
        } else if status == UNAuthorizationStatus::Denied {
            2
        } else {
            0
        };
        AUTH.store(code, Ordering::Relaxed);
    }

    pub fn request() -> String {
        let Some(center) = center() else {
            return "unsupported".to_owned();
        };
        // `Alert` is the banner a reminder deserves; `Sound` is the sound the
        // user picked for this app in System Settings, so the reminder sound is
        // the system's, not a file the app carries.
        let options = UNAuthorizationOptions::Alert
            | UNAuthorizationOptions::Sound
            | UNAuthorizationOptions::Badge;
        let block = block2::RcBlock::new(move |granted: Bool, _error: *mut NSError| {
            AUTH.store(if granted.as_bool() { 1 } else { 2 }, Ordering::Relaxed);
        });
        center.requestAuthorizationWithOptions_completionHandler(options, &block);
        "unknown".to_owned()
    }

    pub fn status() -> String {
        if AUTH.load(Ordering::Relaxed) == 0 {
            // Before the first ask, read the setting the user already made:
            // a permission granted in an earlier run is not asked for again.
            if let Some(center) = center() {
                let block = block2::RcBlock::new(move |settings: std::ptr::NonNull<UNNotificationSettings>| {
                    remember(unsafe { settings.as_ref() }.authorizationStatus());
                });
                center.getNotificationSettingsWithCompletionHandler(&block);
            }
        }
        match AUTH.load(Ordering::Relaxed) {
            1 => "granted".to_owned(),
            2 => "denied".to_owned(),
            3 => "unsupported".to_owned(),
            _ => "unknown".to_owned(),
        }
    }

    pub fn schedule(id: &str, title: &str, body: &str, at: f64) -> Result<(), String> {
        let Some(center) = center() else {
            return Err("this process cannot post a notification".to_owned());
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as f64)
            .unwrap_or(0.0);
        let seconds = (at - now) / 1000.0;
        // A trigger of zero or less is an exception in the framework, not a
        // missed deadline: a card due in the past simply has no reminder.
        if !(seconds.is_finite() && seconds > 0.5) {
            return Ok(());
        }

        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(if title.is_empty() { "截止时间到了" } else { title }));
        if !body.is_empty() {
            content.setBody(&NSString::from_str(body));
        }
        content.setSound(Some(&UNNotificationSound::defaultSound()));
        // The category is what the 完成 and 推迟 1 小时 buttons hang off, so the
        // early reminder names the same category as the deadline's.
        content.setCategoryIdentifier(&NSString::from_str(CATEGORY));

        let trigger =
            UNTimeIntervalNotificationTrigger::triggerWithTimeInterval_repeats(seconds, false);
        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &identifier(id),
            &content,
            Some(&trigger),
        );

        let block = block2::RcBlock::new(move |error: *mut NSError| {
            if let Some(error) = std::ptr::NonNull::new(error) {
                // `NSError` is not `Send`, so the message is read here, on the
                // thread the system calls back on, and only text is kept.
                let text = unsafe { error.as_ref().localizedDescription().to_string() };
                eprintln!("reminder: the system refused a notification: {text}");
            }
        });
        center.addNotificationRequest_withCompletionHandler(&request, Some(&block));

        Ok(())
    }

    pub fn cancel(id: &str) {
        let Some(center) = center() else { return };
        let ids = NSArray::from_retained_slice(&[identifier(id)]);
        center.removePendingNotificationRequestsWithIdentifiers(&ids);
        center.removeDeliveredNotificationsWithIdentifiers(&ids);
    }

    pub fn cancel_all() {
        if let Some(center) = center() {
            center.removeAllPendingNotificationRequests();
        }
    }

    /// The identifiers the system holds, as last asked. `None` until the first
    /// answer comes back.
    fn held() -> &'static std::sync::Mutex<Option<Vec<String>>> {
        static HELD: std::sync::OnceLock<std::sync::Mutex<Option<Vec<String>>>> =
            std::sync::OnceLock::new();
        HELD.get_or_init(|| std::sync::Mutex::new(None))
    }

    pub fn pending() -> String {
        let Some(center) = center() else {
            return "[]".to_owned();
        };
        let block = block2::RcBlock::new(
            move |requests: std::ptr::NonNull<NSArray<UNNotificationRequest>>| {
                let requests = unsafe { requests.as_ref() };
                let mut ids = Vec::new();
                for request in requests.iter() {
                    ids.push(request.identifier().to_string());
                }
                if let Ok(mut held) = held().lock() {
                    *held = Some(ids);
                }
            },
        );
        center.getPendingNotificationRequestsWithCompletionHandler(&block);
        let answer = held().lock().ok().and_then(|held| held.clone());
        match answer {
            Some(ids) => serde_json::to_string(&ids).unwrap_or_else(|_| "[]".to_owned()),
            None => String::new(),
        }
    }

    /// The app's Dock tile, or `None` where this process has none.
    ///
    /// Two things can be missing, and both are normal: a bare test executable
    /// has no bundle to be an app with; and `sharedApplication` builds the app
    /// object when it does not exist yet, which raises an Objective-C exception
    /// — an abort, not a return — in a process with no window server. Asking
    /// first and catching anyway is the same guard the notification centre gets.
    ///
    /// It must be called on the main thread: `MainThreadMarker::new()` is the
    /// check, and AppKit's tile is main-thread only. `apply_label` is the one
    /// caller, and it runs on the main queue.
    fn dock_tile() -> Option<Retained<NSDockTile>> {
        if NSBundle::mainBundle().bundleIdentifier().is_none() {
            return None;
        }
        let mtm = objc2::MainThreadMarker::new()?;
        match objc2::exception::catch(|| NSApplication::sharedApplication(mtm).dockTile()) {
            Ok(tile) => Some(tile),
            Err(_) => None,
        }
    }

    /// What the last hand-over put on the tile, so a thread that cannot look at
    /// AppKit can still answer what the icon carries.
    fn shown() -> &'static std::sync::Mutex<Option<String>> {
        static SHOWN: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);
        &SHOWN
    }

    /// AppKit is main-thread only and the interface runs its own thread — said
    /// here because it is the reason this crate hands the work over instead of
    /// doing it: `nsh`'s engine calls native modules off the main thread.
    fn on_main_thread() -> bool {
        objc2::MainThreadMarker::new().is_some()
    }

    /// Puts `label` on the tile. Runs on the main queue, so AppKit answers.
    extern "C" fn apply_label(context: *mut std::ffi::c_void) {
        // The label the caller boxed for this call, taken back and dropped with
        // the queue's work.
        let label = unsafe { Box::from_raw(context as *mut Option<String>) };
        let Some(tile) = dock_tile() else { return };
        let text = label.as_deref().map(NSString::from_str);
        tile.setBadgeLabel(text.as_deref());
        if let Ok(mut shown) = shown().lock() {
            *shown = label.as_ref().clone();
        }
    }

    pub fn set_badge(label: Option<String>) {
        if NSBundle::mainBundle().bundleIdentifier().is_none() {
            return;
        }
        let boxed = Box::into_raw(Box::new(label));
        if on_main_thread() {
            // Already where AppKit lives: no reason to make the run loop carry
            // it, and no window for the caller to see a stale icon.
            apply_label(boxed as *mut std::ffi::c_void);
            return;
        }
        // One hop, and the count is on the icon. A hand-over the run loop never
        // picks up (a process shutting down) leaves its box behind: the badge is
        // a decoration, and leaking a number is cheaper than a deadlock.
        unsafe {
            let queue = std::ptr::addr_of!(_dispatch_main_q) as *mut std::ffi::c_void;
            dispatch_async_f(queue, boxed as *mut std::ffi::c_void, apply_label)
        };
    }

    pub fn badge() -> String {
        if on_main_thread() {
            let Some(tile) = dock_tile() else {
                return String::new();
            };
            return tile.badgeLabel().map(|text| text.to_string()).unwrap_or_default();
        }
        shown().lock().ok().and_then(|shown| shown.clone()).unwrap_or_default()
    }

    pub fn dock_status() -> String {
        if NSBundle::mainBundle().bundleIdentifier().is_none() {
            return "no-bundle".to_owned();
        }
        // Off the main thread the number is handed to the main queue, which is
        // what makes the AppKit call legal — so a bundle is the whole answer.
        "ok".to_owned()
    }

    // The main queue, from libdispatch: linked with the system on macOS, so the
    // two are declared rather than found in a crate. `dispatch_get_main_queue`
    // is a macro over the global queue, which is the symbol that exists.
    unsafe extern "C" {
        static _dispatch_main_q: std::ffi::c_void;
        fn dispatch_async_f(
            queue: *mut std::ffi::c_void,
            context: *mut std::ffi::c_void,
            work: extern "C" fn(*mut std::ffi::c_void),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_arrays() {
        assert!(parse_cards("{\"cards\":[]}").is_err());
        assert_eq!(parse_cards("[]").unwrap().len(), 0);
    }

    #[test]
    fn a_body_carries_cards_tags_and_a_stamp() {
        let (cards, tags, since) =
            parse_exchange("{\"cards\":[{\"id\":\"c1\"}],\"tags\":[{\"id\":\"t1\"}],\"since\":42}")
                .unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(tags[0]["id"], "t1");
        assert_eq!(since, 42);
        // A body from a peer that predates tags is still a board, and one that
        // names no `since` asks for everything.
        let (cards, tags, since) = parse_exchange("[{\"id\":\"c1\"}]").unwrap();
        assert_eq!(cards.len(), 1);
        assert!(tags.is_empty());
        assert_eq!(since, 0);
        // And one that names neither is empty, not an error.
        let (cards, tags, since) = parse_exchange("{}").unwrap();
        assert!(cards.is_empty() && tags.is_empty());
        assert_eq!(since, 0);
    }

    #[test]
    fn a_query_string_carries_the_stamp() {
        assert_eq!(since_of("since=1762500000000"), 1762500000000);
        assert_eq!(since_of("other=1&since=7"), 7);
        assert_eq!(since_of(""), 0);
        assert_eq!(since_of("since=not-a-number"), 0);
    }

    #[test]
    fn an_address_arrives_with_or_without_a_scheme() {
        assert_eq!(socket_address("http://10.0.0.5:8787"), "10.0.0.5:8787");
        assert_eq!(socket_address("10.0.0.5:8787/"), "10.0.0.5:8787");
        assert_eq!(socket_address(" 10.0.0.5 "), "10.0.0.5:8787");
        assert_eq!(socket_address("http://10.0.0.5"), "10.0.0.5:8787");
    }

    #[test]
    fn the_badge_says_nothing_at_zero_and_fits_on_an_icon() {
        // No badge at zero: the number goes away with the work it counted.
        assert_eq!(badge_label(0.0), None);
        assert_eq!(badge_label(0.4), None);
        // Nor for a count that makes no sense, which is what a board mid-merge
        // can hand over for one tick.
        assert_eq!(badge_label(-3.0), None);
        assert_eq!(badge_label(f64::NAN), None);
        assert_eq!(badge_label(1.0), Some("1".to_owned()));
        assert_eq!(badge_label(12.0), Some("12".to_owned()));
        assert_eq!(badge_label(99.0), Some("99".to_owned()));
        // Two digits fit an icon's corner; the third does not.
        assert_eq!(badge_label(100.0), Some("99+".to_owned()));
    }

    #[test]
    fn a_probe_backs_off_but_never_past_half_a_minute() {
        let waits: Vec<u64> = (0..8).map(|missed| probe_backoff(missed).as_secs()).collect();
        assert_eq!(waits, vec![3, 6, 12, 24, 30, 30, 30, 30]);
        // A phone that has been away for days still probes, and never overflows
        // into a wait that outlasts the app.
        assert_eq!(probe_backoff(u32::MAX).as_secs(), 30);
    }

    #[test]
    fn a_nudge_cuts_the_wait_short() {
        let mut seen = NUDGE.load(Ordering::Relaxed);
        Sync::nudge();
        let at = Instant::now();
        wait_for_nudge(Duration::from_secs(5), &mut seen);
        assert!(
            at.elapsed() < Duration::from_secs(2),
            "a nudge must end the wait, not lengthen it"
        );
        // And with nobody nudging, the whole wait is waited.
        let at = Instant::now();
        wait_for_nudge(Duration::from_millis(400), &mut seen);
        assert!(at.elapsed() >= Duration::from_millis(400));
    }

    #[test]
    fn a_response_names_the_card_and_what_was_asked() {
        // The early reminder carries its own identifier, and both come back as
        // the card an answer acts on.
        assert_eq!(identifier_text("c1"), "navigator.card.c1");
        assert_eq!(identifier_text("c1.pre"), "navigator.card.c1.pre");
        assert_eq!(card_of("navigator.card.c1"), Some(("c1".to_owned(), false)));
        assert_eq!(card_of("navigator.card.c1.pre"), Some(("c1".to_owned(), true)));
        // Anything that is not one of this app's reminders is not a card.
        assert_eq!(card_of("someone.else.c1"), None);
        assert_eq!(card_of(""), None);
    }

    #[test]
    fn an_answer_is_one_of_the_three_verbs() {
        assert_eq!(action_of("done"), Some("done"));
        assert_eq!(action_of("snooze"), Some("snooze"));
        assert_eq!(action_of("open"), Some("open"));
        // The system's dismiss is reported as an action of its own and is not
        // one of ours: closing a notification is not an answer.
        assert_eq!(action_of("com.apple.UNNotificationDismissActionIdentifier"), None);
    }

    #[test]
    fn an_answer_waits_in_the_queue_until_it_is_collected() {
        // Nothing answered yet.
        assert_eq!(take_answers(), "[]");
        enqueue_answer("c1".to_owned(), "done");
        enqueue_answer("c2".to_owned(), "snooze");
        let taken: Value = serde_json::from_str(&take_answers()).unwrap();
        assert_eq!(
            taken,
            json!([
                { "id": "c1", "action": "done" },
                { "id": "c2", "action": "snooze" }
            ])
        );
        // Collecting empties it: the interface applies each answer once.
        assert_eq!(take_answers(), "[]");
    }

    #[test]
    fn a_process_without_a_dock_simply_does_nothing() {
        // `cargo test` is a bare executable on a worker thread: no bundle to be
        // an app with, no AppKit to talk to. Badging must not take the process
        // down, and where there *is* a Dock the number must really arrive.
        Dock::set_badge(3.0);
        if Dock::status() == "ok" {
            assert_eq!(Dock::badge(), "3");
            Dock::set_badge(0.0);
            assert_eq!(Dock::badge(), "");
        } else {
            assert_eq!(Dock::badge(), "");
        }
    }

    #[test]
    fn an_answer_is_read_as_the_port_it_names() {
        // What a serving device sends, and what is ignored: a stray datagram on
        // the discovery port, an older protocol, or a port that is not one.
        assert_eq!(offer_port("NAVIGATOR/1 OFFER 8787"), Some(8787));
        assert_eq!(offer_port("NAVIGATOR/1 OFFER 8787\n"), Some(8787));
        assert_eq!(offer_port("NAVIGATOR/1 DISCOVER"), None);
        assert_eq!(offer_port("NAVIGATOR/2 OFFER 8787"), None);
        assert_eq!(offer_port("NAVIGATOR/1 OFFER 99999"), None);
    }

    #[test]
    fn a_body_keeps_the_newer_copy_of_each_row() {
        let row = |id: &str, stamp: f64| json!({ "id": id, "title": stamp, "updatedAt": stamp });
        let mut body = Body::from_text(
            &json!({ "cards": [row("a", 10.0), row("b", 20.0)], "tags": [] }).to_string(),
        );
        // The backlog of a peer that was away meets a row changed since: the
        // newer copy wins, and the rows the second body does not name stay.
        body.absorb(&Body::from_text(
            &json!({ "cards": [row("a", 30.0), row("c", 5.0)], "tags": [] }).to_string(),
        ));
        let ids: Vec<&str> =
            body.cards.iter().filter_map(|card| card["id"].as_str()).collect();
        assert_eq!(ids, ["a", "b", "c"]);
        assert_eq!(body.cards[0]["title"], 30.0);
        assert_eq!(body.cards[1]["title"], 20.0);

        // An older copy does not overwrite a newer one.
        body.absorb(&Body::from_text(
            &json!({ "cards": [row("a", 1.0)], "tags": [] }).to_string(),
        ));
        assert_eq!(body.cards[0]["title"], 30.0);
    }

    #[test]
    fn a_wire_body_is_read_as_cards_and_tags() {
        let body = Body::from_text(
            &json!({ "cards": [{"id": "a"}], "tags": [{"id": "t"}], "since": 7 }).to_string(),
        );
        assert_eq!(body.cards.len(), 1);
        assert_eq!(body.tags.len(), 1);
        // A body that is a bare array is a peer that predates tags, and a body
        // that does not parse carries nothing rather than failing the cycle.
        let old = Body::from_text(&json!([{"id": "a"}]).to_string());
        assert_eq!(old.cards.len(), 1);
        assert!(old.tags.is_empty());
        assert!(Body::from_text("not json").cards.is_empty());
        // What goes back out drops `since`: each peer is asked from its own
        // watermark, which the loop puts in.
        let text: Value = serde_json::from_str(&body.text(42)).unwrap();
        assert_eq!(text["since"], 42);
        assert_eq!(text["cards"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn a_lockout_is_waited_out_in_full() {
        // The peer names its own wait; an answer without one gets the crate's
        // minute, which is the lock the service actually keeps.
        assert_eq!(retry_in("{\"error\":\"too many attempts\",\"retry\":37}"), 37);
        assert_eq!(retry_in("{}"), auth::LOCK.as_secs());
        assert_eq!(retry_in("not json"), auth::LOCK.as_secs());
    }

    #[test]
    fn the_peer_list_says_which_device_is_behind() {
        // The prover is process-wide, and this is the only test that looks at
        // the peer table; it leaves both as it found them.
        auth::set_prover("482913");
        let peer = |addr: &str, ok: bool, refused: bool, typed: bool| Peer {
            addr: addr.to_owned(),
            heard: 0,
            ok,
            at: 0,
            refused,
            locked_until: 0,
            typed,
            backlog: Body::default(),
        };
        {
            let mut peers = PEERS.lock().unwrap();
            peers.clear();
            peers.push(peer("10.0.0.5:8787", true, false, false));
            peers.push(peer("10.0.0.6:8787", false, true, true));
        }

        // One Mac in step and one that will not take the code: the board is
        // syncing, so the refusal must not hide it — the list names the Mac.
        let status: Value = serde_json::from_str(&Sync::status()).unwrap();
        assert_eq!(status["peers"].as_array().unwrap().len(), 2);
        assert_eq!(status["unreachable"], false);
        assert_eq!(status["pair"], "ok");
        assert_eq!(status["peers"][0]["addr"], "10.0.0.5:8787");
        assert_eq!(status["peers"][0]["pair"], "ok");
        assert_eq!(status["peers"][1]["pair"], "wrong");
        assert_eq!(status["peers"][1]["typed"], true);

        // With every known peer failing, "unreachable" is the truth, and the
        // code is the thing to say first.
        {
            let mut peers = PEERS.lock().unwrap();
            peers[0].ok = false;
        }
        let status: Value = serde_json::from_str(&Sync::status()).unwrap();
        assert_eq!(status["unreachable"], true);
        assert_eq!(status["pair"], "wrong");

        PEERS.lock().unwrap().clear();
    }
}
