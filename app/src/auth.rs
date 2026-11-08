//! The pairing code, the challenge it answers, and the door it holds shut.
//!
//! The board is served on the LAN with no account behind it, and a coffee shop's
//! Wi-Fi is the same LAN as far as the crate can tell. So the Mac keeps six
//! digits, shows them in its own title bar, and the phone proves it knows them:
//! it asks for a one-time challenge, and answers with an HMAC of that challenge
//! keyed by the code.
//!
//! **The code never crosses the network.** A challenge and its answer are both
//! useless to anyone listening: the challenge is spent the moment it is used,
//! and the answer is a hash, not the digits.
//!
//! **Six digits are only safe because guessing is slow.** A million codes, five
//! guesses before the door locks for a minute, is 300 guesses an hour: four
//! months of uninterrupted probing to cover the space, two on average, from a
//! laptop on the same network. Without the lock the same code falls in an hour,
//! so the lock is not a nicety — it is the whole of the strength.

use std::collections::HashMap;
use std::io::Read;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;
use subtle::ConstantTimeEq;

/// How long a challenge is worth answering. Long enough to make a request over
/// a slow Wi-Fi, short enough that a challenge left behind is worthless.
const NONCE_TTL: Duration = Duration::from_secs(30);
/// The most unanswered challenges held at once. Past this the oldest goes: a
/// phone that asks a thousand times before answering must not grow the Mac's
/// memory, and 64 of them last anyone 32 minutes of asking.
const NONCE_MAX: usize = 64;
/// Failed proofs in a row before the door locks.
const FAIL_MAX: u32 = 5;
/// How long it stays shut.
pub const LOCK: Duration = Duration::from_secs(60);

/// A hex string, from the system's randomness, of `bytes` bytes.
fn hex_of(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// Fills `out` from the system's randomness (`/dev/urandom`).
///
/// Not `Math.random`, and not the clock: a nonce and a code that can be guessed
/// from the time they were made are the same as no nonce and no code. Both
/// macOS and Android have this path, and its absence is a real failure rather
/// than something to paper over with a weaker source.
fn fill(out: &mut [u8]) -> Result<(), String> {
    std::fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(out))
        .map_err(|e| format!("/dev/urandom: {e}"))
}

/// `bytes` bytes of the system's randomness as hex.
pub fn random_hex(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    fill(&mut buf)?;
    Ok(hex_of(&buf))
}

/// A new six-digit code, leading zeros kept: `"004281"` is a code, not 4281.
pub fn new_code() -> Result<String, String> {
    // Rejection sampling rather than a plain remainder: over a 64-bit draw,
    // `% 1_000_000` would leave the first codes of the range very slightly more
    // likely than the rest. The rejection costs one draw in 10^13.
    const LIMIT: u64 = (u64::MAX / 1_000_000) * 1_000_000;
    loop {
        let mut bytes = [0u8; 8];
        fill(&mut bytes)?;
        let value = u64::from_le_bytes(bytes);
        if value < LIMIT {
            return Ok(format!("{:06}", value % 1_000_000));
        }
    }
}

/// Whether `code` is exactly the six digits a pairing code is.
pub fn is_code(code: &str) -> bool {
    code.len() == 6 && code.bytes().all(|b| b.is_ascii_digit())
}

/// HMAC-SHA256 of `message` under `key`, as hex.
pub fn hmac_hex(key: &[u8], message: &[u8]) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC takes a key of any length");
    mac.update(message);
    hex_of(&mac.finalize().into_bytes())
}

/// What a phone sends to prove it knows `code`: the code as the key, the
/// challenge as the message. The code itself is never in the answer.
pub fn proof(code: &str, nonce: &str) -> String {
    hmac_hex(code.as_bytes(), nonce.as_bytes())
}

/// Whether two strings are equal, in time that says nothing about where they
/// first differ. A comparison that returns early on the first wrong byte tells
/// an attacker how much of a guess was right, one byte at a time.
pub fn same(a: &str, b: &str) -> bool {
    // Length is not a secret: a proof is always 64 hex characters.
    if a.len() != b.len() {
        return false;
    }
    a.as_bytes().ct_eq(b.as_bytes()).into()
}

/// What a proof earns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// The proof matched a live challenge, which is now spent.
    Ok,
    /// No challenge, a spent or expired one, or a proof that does not match.
    Unauthorized,
    /// Too many failures: nothing is admitted until `left` has passed.
    Locked(Duration),
}

/// Failures in a row, and how long the door has left to stay shut.
#[derive(Default)]
struct Attempts {
    failures: u32,
    locked_until: Option<Instant>,
}

impl Attempts {
    fn blocked(&self, now: Instant) -> Option<Duration> {
        self.locked_until
            .filter(|until| *until > now)
            .map(|until| until - now)
    }

    /// One more failure; whether it was the one that shut the door.
    fn failed(&mut self, now: Instant) -> bool {
        self.failures += 1;
        if self.failures >= FAIL_MAX {
            // The count starts again with the lock: five more only after the
            // minute has passed, so the lock is a lock and not a countdown to
            // the next five attempts.
            self.failures = 0;
            self.locked_until = Some(now + LOCK);
            true
        } else {
            false
        }
    }

    fn cleared(&mut self) {
        self.failures = 0;
        self.locked_until = None;
    }
}

/// The Mac's side: the code to hold against, the challenges handed out, and
/// what has been tried.
pub struct Pairing {
    code: Mutex<String>,
    /// Challenge → when it stops being worth anything.
    nonces: Mutex<HashMap<String, Instant>>,
    attempts: Mutex<Attempts>,
}

impl Pairing {
    pub fn new() -> Self {
        Self {
            code: Mutex::new(String::new()),
            nonces: Mutex::new(HashMap::new()),
            attempts: Mutex::new(Attempts {
                failures: 0,
                locked_until: None,
            }),
        }
    }

    /// Adopts `code` as the one this Mac answers to.
    ///
    /// Every challenge handed out for the old code goes with it: a code the
    /// user has replaced must not open the door for another thirty seconds. The
    /// lockout goes too, because whoever changed the code is the owner.
    pub fn set_code(&self, code: &str) {
        *self.code.lock().unwrap() = code.to_owned();
        self.nonces.lock().unwrap().clear();
        self.attempts.lock().unwrap().cleared();
    }

    /// A fresh challenge, spending the oldest one if the table is full.
    pub fn issue(&self) -> Result<String, String> {
        self.issue_at(Instant::now())
    }

    pub fn issue_at(&self, now: Instant) -> Result<String, String> {
        let nonce = random_hex(16)?;
        let mut nonces = self.nonces.lock().unwrap();
        // Expired challenges are no use to anyone, and the table is bounded so
        // a caller that asks and never answers cannot grow it.
        nonces.retain(|_, until| *until > now);
        if nonces.len() >= NONCE_MAX {
            if let Some(oldest) = nonces
                .iter()
                .min_by_key(|(_, until)| **until)
                .map(|(nonce, _)| nonce.clone())
            {
                nonces.remove(&oldest);
            }
        }
        nonces.insert(nonce.clone(), now + NONCE_TTL);
        Ok(nonce)
    }

    /// Takes `nonce` out of the table, reporting whether it was still live.
    /// A challenge answers one request: spent exactly once, whatever comes back.
    pub fn spend_at(&self, nonce: &str, now: Instant) -> bool {
        match self.nonces.lock().unwrap().remove(nonce) {
            Some(until) => until > now,
            None => false,
        }
    }

    /// The whole check: is this request allowed to read or write the board?
    pub fn verify(&self, nonce: Option<&str>, proof: Option<&str>) -> Verdict {
        self.verify_at(Instant::now(), nonce, proof)
    }

    pub fn verify_at(&self, now: Instant, nonce: Option<&str>, answer: Option<&str>) -> Verdict {
        if let Some(left) = self.attempts.lock().unwrap().blocked(now) {
            return Verdict::Locked(left);
        }
        let code = self.code.lock().unwrap().clone();
        let ok = match (nonce, answer) {
            // A Mac with no code yet admits nobody: a proof over an empty key is
            // one anybody can compute.
            (Some(nonce), Some(answer)) if !code.is_empty() && self.spend_at(nonce, now) => {
                same(&proof(&code, nonce), answer)
            }
            _ => false,
        };
        let mut attempts = self.attempts.lock().unwrap();
        if ok {
            attempts.cleared();
            Verdict::Ok
        } else if attempts.failed(now) {
            Verdict::Locked(LOCK)
        } else {
            Verdict::Unauthorized
        }
    }
}

/// The Mac's pairing state, one per process.
static SERVING: std::sync::OnceLock<Pairing> = std::sync::OnceLock::new();

pub fn serving() -> &'static Pairing {
    SERVING.get_or_init(Pairing::new)
}

/// The code this *phone* proves with. Separate from the Mac's on purpose: the
/// two roles are never the same device, and a process that serves and proves
/// (a test with both ends inside it) must not have the two answers collide.
static PROVER: Mutex<String> = Mutex::new(String::new());

pub fn set_prover(code: &str) {
    *PROVER.lock().unwrap() = code.to_owned();
}

pub fn has_prover() -> bool {
    !PROVER.lock().unwrap().is_empty()
}

/// This phone's answer to `nonce`, or `None` when it has no code to answer with.
pub fn signed(nonce: &str) -> Option<String> {
    let code = PROVER.lock().unwrap().clone();
    (!code.is_empty()).then(|| proof(&code, nonce))
}

/// The headers a signed request carries.
pub const NONCE_HEADER: &str = "x-nav-nonce";
pub const PROOF_HEADER: &str = "x-nav-proof";

/// One header out of a request head, case-insensitively.
pub fn header<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    head.lines().skip(1).find_map(|line| {
        let (key, value) = line.split_once(':')?;
        key.trim().eq_ignore_ascii_case(name).then(|| value.trim())
    })
}

/// Whether a request head may touch the board.
pub fn admit(head: &str) -> Verdict {
    serving().verify(
        header(head, NONCE_HEADER),
        header(head, PROOF_HEADER),
    )
}

/// A challenge for whoever asks, as the JSON `GET /challenge` answers with.
pub fn challenge() -> Result<String, String> {
    let nonce = serving().issue()?;
    Ok(serde_json::json!({ "nonce": nonce }).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    /// The digests a real SHA-256 makes, in hex. If these hold, the padding and
    /// the endianness are right, which is all the HMAC depends on.
    #[test]
    fn sha256_matches_the_published_vectors() {
        let hex = |message: &str| hex_of(&Sha256::digest(message.as_bytes()));
        assert_eq!(
            hex(""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
    }

    /// RFC 4231's own HMAC-SHA256 cases, including the long key that is hashed
    /// down first — the one a hand-rolled HMAC usually gets wrong.
    #[test]
    fn hmac_sha256_matches_rfc_4231() {
        assert_eq!(
            hmac_hex(&[0x0b; 20], b"Hi There"),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
        );
        assert_eq!(
            hmac_hex(b"Jefe", b"what do ya want for nothing?"),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
        assert_eq!(
            hmac_hex(
                &[0xaa; 131],
                b"Test Using Larger Than Block-Size Key - Hash Key First"
            ),
            "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
        );
    }

    /// A code is six digits, and a code that starts with zeros keeps them.
    #[test]
    fn a_code_is_exactly_six_digits_and_keeps_its_zeros() {
        for _ in 0..200 {
            let code = new_code().unwrap();
            assert_eq!(code.len(), 6, "{code} is not six digits");
            assert!(code.bytes().all(|b| b.is_ascii_digit()), "{code}");
            assert!(is_code(&code));
        }
        // The formatting is what keeps 42 a code of six digits, not of two.
        assert_eq!(format!("{:06}", 42), "000042");
        assert!(!is_code("0042"));
        assert!(!is_code("0000420"));
        assert!(!is_code("00a042"));
        assert!(!is_code(""));
    }

    #[test]
    fn two_codes_are_not_the_same_code() {
        // Not a proof of randomness, a proof it is not a constant.
        let first = new_code().unwrap();
        assert!((0..40).any(|_| new_code().unwrap() != first));
        assert_ne!(random_hex(16).unwrap(), random_hex(16).unwrap());
        assert_eq!(random_hex(16).unwrap().len(), 32);
    }

    #[test]
    fn a_proof_is_over_the_challenge_and_nothing_else() {
        let code = "482913";
        let answer = proof(code, "a1b2");
        assert_eq!(answer, hmac_hex(code.as_bytes(), b"a1b2"));
        // Another challenge, another proof: a stolen one answers one request.
        assert_ne!(answer, proof(code, "a1b3"));
        // And it does not contain the code, which is the point.
        assert!(!answer.contains(code));
        assert!(same(&answer, &proof(code, "a1b2")));
    }

    #[test]
    fn comparison_ignores_neither_a_wrong_byte_nor_a_different_length() {
        assert!(same("abc", "abc"));
        assert!(!same("abc", "abd"));
        // The first byte being wrong is as unequal as the last.
        assert!(!same("abc", "xbc"));
        assert!(!same("abc", "abcd"));
        assert!(!same("", "a"));
        assert!(same("", ""));
    }

    /// A challenge answers one request and expires on its own.
    #[test]
    fn a_challenge_is_spent_once_and_expires() {
        let pairing = Pairing::new();
        pairing.set_code("482913");
        let now = Instant::now();
        let nonce = pairing.issue_at(now).unwrap();

        // The first answer is admitted, the second of the same challenge is not.
        assert_eq!(
            pairing.verify_at(now, Some(&nonce), Some(&proof("482913", &nonce))),
            Verdict::Ok
        );
        assert_eq!(
            pairing.verify_at(now, Some(&nonce), Some(&proof("482913", &nonce))),
            Verdict::Unauthorized
        );

        // Thirty seconds later a fresh challenge is worth nothing either.
        let late = pairing.issue_at(now).unwrap();
        assert_eq!(
            pairing.verify_at(now + NONCE_TTL + Duration::from_millis(1), Some(&late), Some(&proof("482913", &late))),
            Verdict::Unauthorized
        );
    }

    /// A wrong proof spends the challenge too, so one challenge is one guess.
    #[test]
    fn a_wrong_proof_costs_the_challenge() {
        let pairing = Pairing::new();
        pairing.set_code("482913");
        let now = Instant::now();
        let nonce = pairing.issue_at(now).unwrap();
        assert_eq!(
            pairing.verify_at(now, Some(&nonce), Some(&proof("000000", &nonce))),
            Verdict::Unauthorized
        );
        // The right answer to that same challenge is too late now.
        assert_eq!(
            pairing.verify_at(now, Some(&nonce), Some(&proof("482913", &nonce))),
            Verdict::Unauthorized
        );
        assert!(!pairing.spend_at(&nonce, now));
    }

    #[test]
    fn challenges_are_capped_and_the_expired_ones_go() {
        let pairing = Pairing::new();
        pairing.set_code("482913");
        let now = Instant::now();
        let first = pairing.issue_at(now).unwrap();
        for millis in 0..NONCE_MAX * 3 {
            pairing
                .issue_at(now + Duration::from_millis(millis as u64))
                .unwrap();
        }
        assert_eq!(pairing.nonces.lock().unwrap().len(), NONCE_MAX);
        // The oldest went, not the newest.
        assert!(!pairing.spend_at(&first, now));

        // Once they expire the table empties rather than growing forever.
        pairing.issue_at(now + NONCE_TTL + Duration::from_secs(1)).unwrap();
        assert_eq!(pairing.nonces.lock().unwrap().len(), 1);
    }

    /// Five failures shut the door for a minute; the sixth attempt is refused
    /// without even being looked at, and one success opens it again.
    #[test]
    fn five_failures_lock_the_door_for_a_minute() {
        let pairing = Pairing::new();
        pairing.set_code("482913");
        let now = Instant::now();

        let guess = |at: Instant| {
            let nonce = pairing.issue_at(at).unwrap();
            pairing.verify_at(at, Some(&nonce), Some(&proof("000000", &nonce)))
        };
        for _ in 0..FAIL_MAX - 1 {
            assert_eq!(guess(now), Verdict::Unauthorized);
        }
        // The fifth failure is the one that locks it.
        assert_eq!(guess(now), Verdict::Locked(LOCK));
        // And nothing gets through while it is shut, not even the right code.
        let nonce = pairing.issue_at(now).unwrap();
        assert_eq!(
            pairing.verify_at(now, Some(&nonce), Some(&proof("482913", &nonce))),
            Verdict::Locked(LOCK)
        );

        // A minute later the door is open again, and one right answer clears
        // the count so the next failure starts from one.
        let later = now + LOCK + Duration::from_millis(1);
        let nonce = pairing.issue_at(later).unwrap();
        assert_eq!(
            pairing.verify_at(later, Some(&nonce), Some(&proof("482913", &nonce))),
            Verdict::Ok
        );
        for _ in 0..FAIL_MAX - 1 {
            assert_eq!(guess(later), Verdict::Unauthorized);
        }
        // The count really did restart: the next failure is a plain refusal.
        assert_eq!(guess(later), Verdict::Locked(LOCK));
    }

    #[test]
    fn a_request_with_no_code_admits_nobody() {
        let pairing = Pairing::new();
        let now = Instant::now();
        let nonce = pairing.issue_at(now).unwrap();
        // The empty key's proof is one anybody can compute, so it must not work.
        assert_eq!(
            pairing.verify_at(now, Some(&nonce), Some(&proof("", &nonce))),
            Verdict::Unauthorized
        );
        assert_eq!(pairing.verify_at(now, None, None), Verdict::Unauthorized);
        assert_eq!(pairing.verify_at(now, Some(&nonce), None), Verdict::Unauthorized);
    }

    #[test]
    fn a_new_code_closes_what_the_old_one_opened() {
        let pairing = Pairing::new();
        pairing.set_code("482913");
        let now = Instant::now();
        let nonce = pairing.issue_at(now).unwrap();
        pairing.set_code("111111");
        // The challenge handed out for the old code is gone, and the old code
        // does not answer the new one.
        assert_eq!(
            pairing.verify_at(now, Some(&nonce), Some(&proof("482913", &nonce))),
            Verdict::Unauthorized
        );
        let nonce = pairing.issue_at(now).unwrap();
        assert_eq!(
            pairing.verify_at(now, Some(&nonce), Some(&proof("111111", &nonce))),
            Verdict::Ok
        );
    }

    #[test]
    fn a_head_carries_its_headers_whatever_their_case() {
        let head = "POST /state HTTP/1.1\r\nHost: 10.0.0.5\r\nX-Nav-Nonce: ab12\r\nX-Nav-Proof: cd34\r\n\r\n";
        assert_eq!(header(head, NONCE_HEADER), Some("ab12"));
        assert_eq!(header(head, PROOF_HEADER), Some("cd34"));
        assert_eq!(header(head, "x-nav-other"), None);
        // The request line is not a header, however it looks.
        assert_eq!(header("GET x-nav-nonce: no\r\n\r\n", NONCE_HEADER), None);
    }
}
