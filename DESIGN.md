---
name: Navigator
description: A four-column kanban that feels like a first-party Mac app, and a phone that catches a thought in seconds.
colors:
  ivory-ground: "#EFF1F2"
  ivory-tint: "#F6F7F8"
  ivory-deep: "#E4E7EA"
  paper: "#FFFFFF"
  pressed-paper: "#E9EDF0"
  ink: "#1A1C1E"
  ink-secondary: "#5A6067"
  ink-tertiary: "#666C73"
  steel-blue: "#2E6DA4"
  steel-blue-deep: "#245F94"
  steel-blue-wash: "#E4EDF5"
  rule: "#DDE2E5"
  alarm-red: "#B23A32"
  alarm-red-wash: "rgba(178, 58, 50, 0.11)"
  amber-due: "#8A5A12"
  amber-due-wash: "rgba(138, 90, 18, 0.14)"
  settled-green: "#1F7A55"
  tag-work: "#2E6DA4"
  tag-personal: "#1F7A55"
  tag-study: "#5F53A8"
  tag-life: "#96622A"
  tag-urgent: "#B23A32"
  dark-ground: "#17191B"
  dark-paper: "#24282B"
  dark-ink: "#F0F2F4"
  dark-ink-secondary: "#AEB4BA"
  dark-ink-tertiary: "#949BA2"
  dark-steel-blue: "#6FA9DC"
typography:
  columnLabel:
    fontSize: "12.5px"
    fontWeight: 600
    letterSpacing: "0.3px"
  cardTitle:
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20.5px"
    letterSpacing: "0.05px"
  phoneTitle:
    fontSize: "16.5px"
    fontWeight: 400
    lineHeight: "23.5px"
  inspectorTitle:
    fontSize: "19.5px"
    fontWeight: 600
    lineHeight: "27px"
  body:
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20.5px"
  meta:
    fontSize: "12px"
    fontWeight: 500
    letterSpacing: "0.1px"
  metaPhone:
    fontSize: "12.5px"
    fontWeight: 500
    letterSpacing: "0.1px"
rounded:
  card: "10px"
  panel-sheet: "20px"
  control: "9px"
  pill: "999px"
  due-pill: "5px"
spacing:
  page-edge: "16px"
  column-gutter: "30px"
  card-padding: "12px"
  card-gap: "7px"
  row-padding-y: "13px"
  header-height: "54px"
  column-header-height: "38px"
components:
  card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.card}"
    padding: "{spacing.card-padding}"
  card-selected:
    backgroundColor: "{colors.pressed-paper}"
    rounded: "{rounded.card}"
  new-button:
    backgroundColor: "{colors.steel-blue-wash}"
    textColor: "{colors.steel-blue}"
    rounded: "7px"
    height: "27px"
    padding: "0 10px"
  phone-primary:
    backgroundColor: "{colors.steel-blue}"
    textColor: "#FFFFFF"
    rounded: "12px"
    height: "48px"
  phone-primary-idle:
    backgroundColor: "{colors.steel-blue-wash}"
    textColor: "{colors.steel-blue-deep}"
    rounded: "12px"
    height: "48px"
  tag-dot:
    size: "6px"
  due-pill-today:
    backgroundColor: "{colors.amber-due-wash}"
    textColor: "{colors.amber-due}"
    rounded: "{rounded.due-pill}"
---

# Design System: Navigator

## Overview

**Creative North Star: "Paper on the Desk"**

The board is one sheet of paper on a desk, lit from the top-left. Columns are not
trays and cards are not panels: the only raised objects on the surface are the
cards themselves, white paper with one tight shadow and no border. Everything
that separates one thing from another is air or a hairline, never a container.
That single decision is what makes the app read as a native Mac application
instead of a web dashboard wearing a window.

The palette is cool ivory under a steel-blue accent, chosen over a warm paper
because the Mac is used for long stretches and the cool ground tires the eye
less. Colour is a strict budget of three jobs: a tag dot says what the work
belongs to, a due time turns amber today and red when it is late, and a finished
card drops to tertiary ink behind a green check. Nothing else in the interface is
allowed to be colourful — not the selection, not a header, not a count.

The phone is the same material at a different size. A column becomes a single
sheet of paper with rows divided by inset hairlines; a card's circle moves to the
leading edge because a thumb completes work faster than it opens it. Nothing on
the phone is a shrunken desktop control.

**Key Characteristics:**

- One raised object per surface: the card. No column trays, no nested panels.
- Warm-free, cool ivory ground with a single diagonal light (`158deg`), never a flat fill.
- Regular-weight card titles; hierarchy from size and colour, not boldness.
- Hairlines at `0.055`–`0.09` alpha; the heavier rule belongs to the header only.
- One accent colour, used at roughly 2% of the screen.
- Dark mode is its own scheme with its own tag colours, not a filter over light.

## Colors

A cool ivory ground carrying ink text, one steel-blue accent, and five tag hues
that are the only saturated colour the board permits.

### Primary

- **Steel Blue** (`#2E6DA4`): the accent. The 新建 button's label and tint, the
  selected status chip, the phone's primary button, the 工作 tag. Never a fill
  larger than a button.
- **Steel Blue Deep** (`#245F94`): the accent when it sits as a label on its own
  wash, where the lighter accent would fall under 4.5:1.
- **Steel Blue Wash** (`#E4EDF5`): the tinted fill behind the accent, and the
  idle state of the phone's primary action.

### Secondary

- **Alarm Red** (`#B23A32`): an overdue due time, and the destructive label
  (删除卡片 / 删除). Paired with its wash behind an overdue pill.
- **Amber Due** (`#8A5A12`): a due time that is today. Paired with its wash.
- **Settled Green** (`#1F7A55`): the check on a finished card, and the 个人 tag.

### Neutral

- **Ivory Ground** (`#EFF1F2`) with **Ivory Tint** (`#F6F7F8`) and **Ivory Deep**
  (`#E4E7EA`): the desk. Always a gradient through all three, never one flat value.
- **Paper** (`#FFFFFF`): a card. Every card, at rest.
- **Pressed Paper** (`#E9EDF0`): the open card. Paper pushed into the desk, not a
  fourth colour — a blue fill would outshout every tag on the board.
- **Ink** (`#1A1C1E`): card titles, body.
- **Ink Secondary** (`#5A6067`): notes, column labels.
- **Ink Tertiary** (`#666C73`): counts, timestamps, settled titles, empty copy.
- **Rule** (`#DDE2E5`): the header's bottom edge, and column label rules at
  `hairlineSoft`.

### Tag hues

Five hues: blue `#2E6DA4` · green `#1F7A55` · purple `#5F53A8` · amber `#96622A`
· red `#B23A32`. Each is defined twice — a light value that clears 4.5:1 on paper,
and a dark value for the dark card. The same hue in both appearances fails one of
them. Which label carries which hue is the user's choice; the palette is the
app's, and the five are the only ones a tag can be.

### Dark scheme

Ground `#17191B`, paper `#24282B`, panel `#1E2123`, ink `#F0F2F4`, accent
`#6FA9DC`, accent muted `#A9CBEA`. Not a filter: the tag hues lighten to
`#79B4E8`, `#63C99B`, `#A99BEA`, `#D9A566`, `#FF8A80` so they stay legible on
dark paper (6.06–7.33:1, all measured).

### Named Rules

**The Three Jobs Rule.** Colour does exactly three things: it names which part of
life a card belongs to (a 6px tag dot), it says whether a due time needs attention
now (amber today, red late), and it marks work as finished (a green check). Any
other colour anywhere on the board is a bug.

**The One Accent Rule.** The accent appears on a button, a selected chip, the drop
seam, and the phone's FAB — together under 2% of the pixels. Its rarity is what
makes it read as the thing to press.

**The Two Accent Surfaces Rule.** The accent meets text two ways, and they take
different content. A label *on an accent wash* uses the muted accent: the plain
one measures 4.30–4.37:1 in light and 3.83:1 on the dark selected chip, both
under the floor, while the muted twin clears every wash strength used here
(5.00–5.56:1 light, 5.67–8.28:1 dark). Content *on a filled accent surface* is
white in light (5.47:1) and near-black `#0D1418` in dark (7.42:1), because the
dark accent is a pale blue and white on it is 2.50:1. Both are one function each
(`onAccentWash()`, `onAccentFill()`), never a colour chosen at the call site.

**The Two Hairlines Rule.** The header's rule is `divider`, the app's heaviest
line; a column's rule is `hairlineSoft`, one step quieter. Two lines of equal
weight bracketing the label strip turn the board into a table.

**The One Window Rule.** The app owns the top of its window. Hide the system
title bar, keep the platform's window controls, and put them on the same 54pt
band as the app's own title; inset the title by `titleBar().left` so it clears
them; make the band draggable. A native application never sits below a band of
system chrome it did not draw.

## Typography

**Font:** the platform's own (SF Pro on macOS, Roboto on Android). No face is
shipped: this is a tool that should look like the system it runs on.

**Character:** a working list, not a poster. Card titles are set at regular weight
because a bold title on every row of a long board becomes noise; hierarchy comes
from size and colour instead.

### Hierarchy

- **Inspector title** (600, 19.5/27): the card's title inside the Mac's panel. The
  one place weight is used for hierarchy.
- **Phone title** (400, 16.5/23.5): a phone row's title, a step larger than the Mac
  card for finger reach and glance distance.
- **Card title** (400, 14/20.5): a board card's title. Up to four lines, then
  clipped.
- **Body** (400, 13/20.5): notes on a card (two lines), a sheet's notes (unlimited).
- **Column label** (600, 12.5, `0.3px`): 待办 / 进行中 / 已完成 / 归档, beside a
  tabular count at Ink Tertiary.
- **Meta** (500, 12/12.5, `0.1px`, tabular figures): due times, tag names, counts.
  Tabular on every number that sits in a column, so digit changes never reflow.

### Named Rules

**The Regular Title Rule.** A card title is never bold on the board. If a title
needs emphasis, the card is in the wrong column.

**The Tabular Rule.** Every number that can change without the layout changing
(counts, times) is set with `fontVariant: ["tabular-nums"]`.

## Layout

A 54px header band carrying 领航, the sync state, and one 新建 button, closed by a
hairline. **It is the window's title bar**, not an app header inside a titled
window: the system chrome is hidden (`Window.setTitleBar({ style: "hidden" })`),
the app fills the window to its top edge, and the traffic lights sit in this
band. The band is draggable as a title bar, and its left padding adds
`titleBar().left` so 领航 never runs under the lights. A band of system chrome
above the board is what makes a native app look like a web page in a browser.

Below it, four equal columns on one continuous sheet: a label row with its count
and a hairline rule, then cards beginning immediately with no tray.

**An opened card floats at the middle of the window, and the board does not
move.** It used to dock as a second column, which narrowed all four columns the
moment a card was read: the board the user was aiming at rearranged itself under
the pointer that had just opened a card. A panel over the board leaves every
column exactly where it was, and closing it puts the pointer back on the same
card. The panel is 440px wide (the window minus 80, narrower on a small window),
a `panel` fill at 16px radius on `shadowLift`: it is the one thing genuinely
above the desk.

**Nothing on the board scrolls sideways, and nothing shows a scrollbar.** The
columns grow with the window to `COL_MAX` and then stop, and the row centers
itself once there is room to spare. The window is held above the width at which
four columns reach `COL_MIN` — nsh has no minimum-size API, so an `effect` puts
the window back to that floor as soon as it goes under. With no horizontal
scroll view there is no horizontal scrollbar to leave one; the vertical ones are
switched off (`scrollbar={false}`) on the columns, the phone's pages, the phone's
filter strip and the floating card, because a bar down the side of a page of
paper is chrome the app did not draw.

Column width is fluid, floored at 246px and capped at 336px, with a 30px gutter
against a 16px page margin — the gutter must exceed the margin or four columns
read as a tiled grid instead of columns standing in a page. Reading a card never
changes those widths: the card floats over the board, so the columns keep the
measure they had.

The phone is a single column filling the width, inside a 16px margin, under a
four-way segmented control with per-column counts. Tapping a segment scrolls the
pages to it, and the segmented control follows the pages when they are swiped:
the scroll is the one owner of which column shows, so a tap can never light a
segment whose list is not under it. Sheets rise from the bottom at a 20px radius
and reserve `env(keyboard-inset-height)`.

## Elevation & Depth

One shadow system, two values, and no borders under either. Elevation is never
combined with a border: a 1px edge over a wide soft shadow is the ghost card.

**Elevation is runtime-only in this platform's capture path.** `nsh`'s own
documentation is explicit that in-process renderings do not show unmasked outer
shadows, and the app screenshots come from that path: every `.impeccable/review`
desktop raster shows flat cards with no halo, while the same build on the real
Android device does cast the FAB's shadow. The shadow is declared once in
`theme()` and drawn at runtime; it is not visible in the PNG evidence, and a
reviewer reading only those files is right to say elevation is missing. A live
window capture is the only way to see it, which needs Screen Recording permission
this environment does not grant.

**Contrast is measured on device pixels as well as tokens.** The phone's own
screencaps settle what the token table can only predict: the FAB glyph reads
7.40:1 against its fill, and the idle 添加 label 6.96:1. Both numbers come from
`phone-real*.png`, not from a browser preview.

### Shadow Vocabulary

- **`shadow`** (`0 0.5px 1px rgba(22,30,38,0.09), 0 1.5px 3px rgba(22,30,38,0.055)`):
  a resting card. Tight, short, almost imperceptible — it says "paper on a desk",
  not "floating panel".
- **`shadowLift`** (`0 4px 10px rgba(22,30,38,0.13), 0 18px 44px rgba(22,30,38,0.17)`):
  the card being dragged, and the phone's FAB. Only for something genuinely off
  the surface.

### Named Rules

**The Declare-Once Rule.** A surface carries either a border or a shadow, never
both. A zero-blur shadow used as a ring (`0 0 0 2px`) renders as nothing on this
engine; selection is a fill plus a hairline instead.

## Shapes

Cards are 10px radius with no border. Buttons and chips are 7–9px. A due pill is
5px, deliberately squarer than a tag dot so the two meta types never blur. Sheets
are 20px at the top corners only. Nothing is a pill except the phone's check
circle and the FAB, where roundness is the affordance.

## Components

### Card

Paper at rest: white, 10px radius, `shadow`, 12px padding, 7px gap. Title, then
notes at Ink Secondary clipped to two lines, then one meta row of tag dots and a
due pill. The drag grip is always present at Ink Tertiary — not on hover: a handle
that appears only under the pointer is undiscoverable on a trackpad and
impossible on touch, and the grip is the only way to move a card on the phone's
shared board. Hover raises the shadow, never the colour. Selected (open in the
inspector) swaps the fill to Pressed Paper and adds a 1px `selectEdge` rule, and
keeps both on hover — the hover state must be written selection-aware, or it
repaints the card white *and* repaints its hairline in the accent, and the
selection turns into the loudest object on the board under the pointer that just
clicked it.

Selection is deliberately *not* the accent. A blue card on a board whose whole
thesis is quiet paper reads as an alert, and it would spend the accent on
something the user did not press. A selected card also carries **no shadow**: a
surface takes a border or a shadow, never both, and selection is the one state
that switches.

### Column

A label row (name at Ink Secondary, count at Ink Tertiary, a plus button) closed by
a `hairlineSoft` rule — one step quieter than the header's `Rule`, so the label
strip does not read as a table cell. No background of its own.

### Tag

On a card, a tag is a 6px dot and its name in the tag's colour at 12px/500 — no
chip, no background. A pill behind every tag on a card turns a quiet meta row into
a row of buttons.

In a **picker** — the inspector's 标签 field, the capture sheet, the phone's detail
sheet — tags are chips, because there they are controls: a 7px-radius chip carries
a press, and an unpressed one sits on `chip` with secondary ink while a pressed one
takes the tag's own hue in its wash. The distinction is label versus control, not a
licence to chip the board.

**Tags are the user's, so they are managed in one place.** A 标签 button sits at the
end of every picker and of the filter row, and opens one dialog: each tag is a hue
dot, an editable name and a remove button, with a field under them for a new tag.
The dot cycles through the five hues on a press, because five is a count a press
can walk and a colour picker is a second dialog for a decision this small. The
dialog states the two things a dot cannot: that it changes the colour, and that
removing a tag strips it from every card.

The tag list is data, not code. It syncs like the board, per tag by stamp, with a
tombstone for a tag removed on one device, and the hue is one of the same five
values the palette defines for both appearances — a tag made at noon is legible
at midnight.

### Due time

A calendar glyph and the time of day — always the time: a deadline set to 14:00
that renders as "11月12日" has thrown away the part the user chose. Plain Ink
Tertiary when it is later than today; amber on its wash when it is today; red on
its wash when it is late. A finished card drops the 已逾期 prefix: its time is
history, not a warning.

The deadline is edited in two parts. Three chips set the *day* (今天 / 明天 / 下周)
and keep the time already on the card, so 明天 on a 14:30 deadline means tomorrow
at 14:30 rather than tomorrow at 09:00. A `TimeField` beside them sets the hour and
minute, standing on the time in use before the first press. A 清除 next to the
chips takes the deadline away, and a day chip opens a month for any date at all.

The month is a `Calendar` on a panel the app owns, not a `DatePicker` popup: a
picker's popup draws as a transparent layer on this engine and the card shows
through the days. The calendar carries the hour on a strip under it, so a date is
one decision rather than a date followed by a hunt for the field that sets when,
and a picked day keeps the time the card already had.

**A deadline notifies.** On the Mac the crate gives the date to
`UNUserNotificationCenter`, which owns the schedule from then on: it delivers
with the app closed, plays the sound chosen in System Settings, and lists beside
every other app's. Only open work with a deadline still ahead is scheduled — a
finished card, a removed card and a date in the past all drop their reminder, and
an overdue card says 已逾期 on the board instead of pushing a notification about
a moment that has already gone. On the phone no system notification can be
posted at all (the manifest `nsh package` writes has no `POST_NOTIFICATIONS`), so
a deadline that comes due while the app is open puts one line above the list:
amber glyph, 到时间了, the card's title, 打开 and a dismiss. It is a banner the app
draws, and it is honest about being one.

### Inspector

A floating card 440px wide at panel fill, 16px radius, on `shadowLift`, centred
over the board. Its strip carries 卡片 at tertiary ink and the close button,
closed by the same rule that closes the board's header. Title at 19.5px/600,
status chips, notes, tags with their manager, the deadline editor, then a quiet
rule and the destructive pair.

Deleting a card asks first, in the platform's own alert (`AlertDialog.show`), and
names the card: a destructive press is never one tap from an accident, and a
tombstone is not something the app can undo for the user.

### Phone row

One sheet per column, rows divided by a hairline inset 47px on the left so it
starts where the text does. A 44pt check circle leads the row, then title, then
one line of notes, then tag dots and a due pill.

### Phone sheets

Capture: the title field auto-focuses, tags and the deadline editor are taps, and
添加 is 48dp of accent when it can fire and the tinted wash with a muted accent
label when the title is empty — `accessibilityState`, not `disabled`, which drops
the whole affordance and leaves a button that looks live and is not.

Detail: the title and notes are **editable on the phone too**, in native fields on
the sheet itself — above its controls, outside any scroll view, because an input
nested in a scroll view has no native field on Android and no tap could ever focus
it. Every keystroke patches the card, so there is no save button and nothing to
lose. The sheet keeps every tap as well: status chips, tags, the deadline editor,
archive, and a delete that asks first.

The header's date and sync state are one target, not two: a status line alone is
about 12pt tall and a fingertip cannot hit it, so the pressable area grows to
159pt with negative margins and the text does not move.

### Empty state

A column says what to do, in one quiet line at Ink Tertiary: 把卡片拖到这里 in the
three live columns, 归档的卡片不会再打扰你 in the archive. No illustration, no
centred icon in a circle, no "get started" button.

## Sync

Sync is part of the surface, not plumbing behind it, because the phone is only
useful if it holds the same board. Three decisions shape what the user sees.

**The Mac is the server, and only while it is open.** Its service is a thread in
the app's own process. Quitting the app closes the port, so the phone cannot
sync against a stale copy, and there is no daemon to install or manage.

**The phone finds the Mac; it does not remember an address.** A typed IP is a
config file that rots the first time the router reissues a lease. Instead the
phone broadcasts `NAVIGATOR/1 DISCOVER` on its own subnet and reads the Mac's
address off the unicast reply it gets back, the way LocalSend finds its peers.
Each interface's own broadcast address is used rather than `255.255.255.255`:
the global broadcast leaves by the default route, which on a phone with mobile
data is not the Wi-Fi. A failed exchange drops the known Mac and probes again,
so a sleep, a new lease and a network change all heal within seconds. Typing an
address stays as the fallback for a network that drops broadcasts.

**The board is a file on each device, not a copy of the other's.** Each device
keeps its board in a SQLite file in its own data directory: quitting the app
does not lose work, and the phone's board is real whether or not it can reach the
Mac. A change is written as the row that changed, a third of a second after the
user makes it, and leaving the app flushes what the wait was still holding.

**Merging is per card, and deletes are tombstones.** Both devices hold a board
and the newer `updatedAt` wins per card, so a phone that was offline cannot
revert a Mac edit. A deleted card is kept as `{...card, deleted: true}` with a
new stamp rather than dropped: a dropped id is pushed straight back by the other
device on the next merge. **A stamp is minted above every stamp already on the
board**, not just from the wall clock: a clock that was stepped back, or a phone
whose clock runs ahead, would otherwise let an edit look older than the card it
edits and lose it silently.

**What crosses the network is the difference, not the board.** Each side sends
`{cards, tags, since}` — the rows it changed, and the newest stamp it has heard
of — and gets back only the rows stamped at or after that. A board of a thousand
archived cards costs a few hundred bytes per keystroke, and a phone that has been
alone for a day catches up in one round trip.

The header's status line is the only place any of this shows: `等待手机` on the
Mac, and `已同步 HH:MM` / `查找中` / `连不上 Mac，正在重新查找` on the phone. It
is one line of tertiary ink, tap-ready on the phone to open the manual pairing
sheet, and it never becomes a banner, a toast or a progress bar. Syncing is not
an activity the user performs; it is a condition they can check.

### Named Rules

**The Find-Don't-Remember Rule.** An address that only works until the next lease
is not a setting. Discover the peer on every session and keep a typed address
only as the fallback for a network that cannot broadcast.

**The Same-Board Rule.** Compare boards per card by id and stamp, never as JSON
text. A text comparison reports a change on every tick and the resulting
`cards.set` re-renders the board under the user's finger, which reads as the app
ignoring taps.

## Do's and Don'ts

### Do:

- **Do** keep the card the only raised object on the board; columns get air and a
  hairline, never a tray.
- **Do** verify every text pair against its own background at 4.5:1, including
  ink-on-paper, tag-on-paper, both appearances, and both accent surfaces (a label
  on a wash, content on a fill). Every pair measured in this file passes; the
  accent family is tabulated under The Two Accent Surfaces Rule.
- **Do** define the "what colour sits on the accent" decision once, as
  `onAccentWash()` / `onAccentFill()`, rather than picking an accent shade per
  call site: the wrong one is a sub-4.5:1 label that is easy to miss by eye.
- **Do** keep the accent under about 2% of the screen.
- **Do** set numbers in tabular figures wherever they sit in a column.
- **Do** define tag hues per appearance; one hue cannot clear both grounds.
- **Do** let the reader open a card without moving the board: float the card,
  never dock it as a column that resizes what the user was aiming at.
- **Do** keep the window above the width four columns need, rather than putting a
  scrollbar under the board.
- **Do** ask before a delete. A tombstone is not something the app can undo.

### Don't:

- **Don't** put a card inside a panel inside a card. No nested containers: the build
  removed its column trays for exactly this reason.
- **Don't** declare both a border and a shadow on one surface.
- **Don't** use a zero-blur shadow as a ring; it renders as nothing.
- **Don't** read a signal in a component body — the body runs once and the value
  never updates. Read it inside the JSX expression.
- **Don't** add a dependency on `cards()` to a shell that holds a focused input:
  every keystroke rebuilds it and the field drops letters. Use `effect` for
  side effects that must watch the board.
- **Don't** compare boards as JSON text. The engine re-serializes objects with
  sorted keys, so text comparison reports a change on every tick and the
  resulting `cards.set` interrupts a press.
- **Don't** use bold for a card title on the board.
- **Don't** paint selection in the accent; select with paper pressed into the desk.
- **Don't** leave the system title bar on a native app: a band of chrome the app
  did not draw above its own header reads as a browser window.
- **Don't** ship an editable field *inside a scroll view* on the phone: on Android
  it has no native view and no tap can focus it. The detail sheet's fields sit on
  the sheet, above its controls, for exactly this reason.
- **Don't** show a scrollbar on a page of paper. The board and the sheets scroll;
  the bar is chrome the app did not draw.
- **Don't** hand a value from a `List` row's `item()` to a child component. Rows
  are recycled: pass the accessor and read it where it is drawn, or the third
  cell shows the first card's title.
- **Don't** ship an app icon with square corners on macOS. The system does not
  round it for you: the squircle has to be in the picture, with transparent
  margins around it, or the Dock shows a block among rounded neighbours.
- **Don't** trust a system API to be there. `currentNotificationCenter` raises an
  Objective-C exception in a process with no bundle — which aborts rather than
  throws — so the crate checks for a bundle and catches the call. A headless test
  run must not be able to kill the app through a notification.
