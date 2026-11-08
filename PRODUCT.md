# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Stack

Native Shell (`nsh` 0.4.0, https://nsh.dev): TSX screens on a Rust/QuickJS engine, native AppKit on macOS 14+ and
native Android views on Android 9+. Chosen and validated in this repo's `kanban-spike/` (see `~/.agents/AGENTS.md`).
The domain layer is a Rust crate beside the TSX app (`nsh init --template mixed`).

## Users

One person who plans work and personal life in the same place. They sit at a Mac all day for real work and carry an
Android phone. On the Mac they triage, write, and reorganize a whole board; on the phone they glance at it and capture
something in seconds, usually one-handed, often standing up.

## Product Purpose

A four-column kanban — 待办 / 进行中 / 已完成 / 归档 — that replaces the mental load of a flat reminder list. A card
holds a title, tags, free-form notes, and a due/reminder time. Success: the Mac board is where plans get shaped, and the
phone is where nothing gets forgotten.

## Positioning

It is a kanban with the *feel* of a first-party Mac app, not a web dashboard in a window. Status is spatial (a column
you drag into), not a field you edit. The same card is a board chip on the Mac and a native, keyboard-friendly to-do row
on the phone.

## Operating Context

- Mac: wide window, mouse and trackpad, keyboard-heavy editing, several columns visible at once, docked beside other
  work. Light and dark both matter; the Mac is often used in a dim room.
- Phone: portrait, one hand, short sessions, glanceable. Capture must work in a few seconds; the keyboard is a
  phone keyboard.
- Cards move between columns as work progresses; finished work is archived rather than deleted.

## Capabilities and Constraints

- Columns are fixed at four: 待办, 进行中, 已完成, 归档.
- Card fields: title, tags, notes, due date and time of day, and a repeat cycle
  (每天 / 每周 / 每月 / 每年) that brings the work back: finishing a repeating card puts
  the next occurrence at the foot of 待办, at the deadline advanced by one cycle. The
  cycle goes with the deadline — a card with no date cannot repeat, and clearing the
  date clears the cycle in the same write — and a month or a year that lands on a
  shorter month clamps to that month's end.
- A checklist is not a field: `- [ ] ` and `- [x] ` lines in the notes are the list, so
  a list typed on the phone and edited on the Mac merges, exports and syncs as the note
  it already is. A card shows only a check glyph and how much of it is ticked (`2/5`), and ticking is an
  edit of the note, not a change of status.
- A deadline reached while its card is still open notifies: a system notification
  with sound on the Mac, delivered even after the app quits; a banner inside the
  app on the phone, where Android would drop a notification the manifest cannot
  request. A finished, archived or deleted card drops its reminder, and a date
  that has already passed is shown as overdue rather than notified. On the Mac a
  card may also carry a lead reminder ahead of its deadline, and a reminder offers
  完成 and 推迟 1 小时 without opening the app.
- A single destructive press is reversible, not interrogated: deleting, finishing
  and archiving a card leave one line offering 撤销 for a few seconds. Only a batch
  — 清空归档, 清除示例数据 — asks first, naming how many cards it will remove, and
  removing a tag asks because it changes cards the user is not looking at.
- Tags are the user's: created, renamed, recoloured (one of five hues) and removed in one manager on either device. A
  tag outlives a card and syncs like one, with a tombstone so a removal does not come back from the other device.
- A card can be found by typing its title, its notes, or a tag's name; the board can also be narrowed to any of
  several tags at once (either of them), to one date condition (今天 / 已逾期 / 无日期), or to both, and those stack
  with the search. The filter is a view of this device, not part of the board: it does not sync.
- Cross-device sync between the Mac and the Android phone is required; it is not a local-only tool. Reading or writing
  the board over the LAN needs a six-digit pairing code from the Mac, so a shared Wi-Fi is not a shared board.
- No accounts, teams, assignees, comments, or permissions in scope.
- Both devices edit: the Mac is the fuller surface, the phone edits a card's title, notes, tags, status and deadline,
  and captures new cards in a few taps.
- The board is kept on each device in a SQLite file in the app's own data directory: quitting the app does not lose
  work, and the phone's board is real whether or not it can reach the Mac. Sync carries the fields that changed, not the
  whole board, so a thousand archived cards cost nothing to keep.
- The board is never trapped in the app: the Mac exports it as JSON or Markdown, imports one back from the clipboard,
  keeps a daily snapshot for a week, and can restore from those snapshots. The phone does not export.

## Evidence on Hand

No real card content exists yet. Board content in builds is authored sample material and must be labeled synthetic where
it could be mistaken for a user's real data. No customers, benchmarks, or pricing claims exist or may be invented.

## Product Principles

1. Status is a place, not a property: moving work means moving a card.
2. The Mac rewards precision; the phone rewards speed.
3. Quiet by default — the board is a surface for attention, not a scoreboard.
4. Native on each OS, one product: never a web page wearing a window.
5. Never lose a thought: capture on the phone must survive interruption.

## Accessibility & Inclusion

Standard platform accessibility: VoiceOver / TalkBack labels on every card and control, full keyboard operation on the
Mac (arrow keys walk the board, Enter opens the card under them, Space finishes it, Cmd+N / Cmd+K / Cmd+F / Cmd+] /
Cmd+[ cover creating, finding and moving, and no action is mouse-only), system text scaling respected, reduced motion
honored for transitions and drag.
