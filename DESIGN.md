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
  header-height: "titleBar().height + 38px"
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
sheet of paper with rows divided by inset hairlines; a card's circle leads the row
at 44 points, because a thumb completes work faster than it opens it. Nothing on
the phone is a shrunken desktop control.

**Key Characteristics:**

- One raised object per surface: the card. No column trays, no nested panels.
- Warm-free, cool ivory ground with a single diagonal light (`158deg`), never a flat fill.
- Regular-weight card titles; hierarchy from size and colour, not boldness.
- Hairlines at `0.055`–`0.09` alpha; the heavier rule belongs to the header only.
- One accent colour, used at roughly 2% of the screen.
- Dark mode is its own scheme with its own tag colours, not a filter over light.
- A destructive press is answered *after* the fact, in one line that can put it
  back; only a batch asks first.

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
- **Panel** (`#FAFBFC` light, `#1E2123` dark): everything that floats *above* the
  desk — the open card, the command palette, the pairing dialog, the 更多 sheet,
  the restore list. One step off paper, not a colour.
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

**The No Filled Surface Rule.** Colour never becomes a surface: green, red and
amber are words about work, never a background for a row, a button or a band. The
phone's primary button and FAB are the accent's one filled moment; everything
else that carries colour is a dot, a label, a check or a wash.

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

**The One Window Rule.** The app owns the top of its window. Hide the system title
bar, keep the platform's window controls, let the app's ground run under them with
no seam, and make that whole band drag the window. But give the platform the strip
it still reserves: the app's own controls sit in a row below it, never inside it,
because a press in that strip never reaches the app — a button drawn there is
visible and dead. A native application never sits below a band of system chrome it
did not draw.

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
- **Chip label** (500–600, 11.5): the filter strip's chips, and the palette's
  hint line under a verb. Below the card's scale on purpose — a control's word is
  smaller than the content it narrows, or the row reads as a card.

### Named Rules

**The Regular Title Rule.** A card title is never bold on the board. If a title
needs emphasis, the card is in the wrong column.

**The Tabular Rule.** Every number that can change without the layout changing
(counts, times) is set with `fontVariant: ["tabular-nums"]`.

## Layout

A header band carrying 领航, the sync state, the 配对码 link and one 新建 button,
closed by a hairline. **It is the window's title bar**, not an app header inside a
titled window: the system chrome is hidden (`currentWindow().set({ titleBar: {
style: "hidden", height } })`), the app fills the window to its top edge, and the
traffic lights sit on the app's own ground. The band is draggable as a title bar.

It is drawn in two parts, because AppKit keeps a strip at the top for dragging and
**a press in that strip never reaches the app** — a button drawn there is visible
and dead. So the ground runs under the lights with no seam, `titleSpacer()` gives
the platform its strip, and the app's own 38pt row of controls sits immediately
below it; `headerHeight()` adds the two and is also what the title bar setting is given.
A band of system chrome above the board is what makes a native app look like a web
page in a browser.

Below it, on the Mac, one row of filters and then four equal columns on one
continuous sheet: a label row with its count and a hairline rule, then cards
beginning immediately with no tray.

**An opened card floats at the middle of the window, and the board does not
move.** It used to dock as a second column, which narrowed all four columns the
moment a card was read: the board the user was aiming at rearranged itself under
the pointer that had just opened a card. A panel over the board leaves every
column exactly where it was, and closing it puts the pointer back on the same
card. The panel is `min(560, window − 80)` wide and `min(720, window − 96)` tall,
floored at 300 × 320 (a `panel` fill at 16px radius on `shadowLift`): it is the
one thing genuinely above the desk, and it grew because the note is its body —
440 × 600 was a note with the meta strip in its way.

**Nothing on the board scrolls sideways, and nothing shows a scrollbar.** The
columns grow with the window to `COL_MAX` and then stop, and the row centers
itself once there is room to spare. **The drop is measured from that row, not from
the board's edge**: on a 2560-point window the centring leaves nearly 550 points
before 待办, and counting them as part of the first column made a card dragged
into 进行中 land in 归档 two columns over. The window is held above the width at which
four columns reach `COL_MIN` — nsh has no minimum-size API, so an `effect` puts
the window back to that floor as soon as it goes under. With no horizontal
scroll view there is no horizontal scrollbar to leave one; the vertical ones are
switched off (`scrollbar={false}`) on the columns, the phone's pages and the
floating card, because a bar down the side of a page of paper is chrome the app did
not draw.

Column width is fluid, floored at 246px and capped at 336px, with a 30px gutter
against a 16px page margin — the gutter must exceed the margin or four columns
read as a tiled grid instead of columns standing in a page. Reading a card never
changes those widths: the card floats over the board, so the columns keep the
measure they had.

**One row narrows the board, and the row never scrolls.** Under the title band:
今天 / 已逾期 / 无日期 with their whole-board counts, a hairline, the tag strip
(全部 first and pinned, then the user's tags), 标签 to manage them, 清除 when
anything is on, then the search field. The search field has a fixed width and is
the part that must never be pushed off the window, so the tag chips are what
gives: as many as fit are drawn and the rest go behind 更多, which lights up when
one of the tags it hides is selected. A count of zero is set one step quieter
rather than disabled — a chip that vanished would move every chip after it, and a
dead control is a state the user cannot reach. The date chips take the accent's
wash when on and are never red or amber: those two colours belong to the due time
itself, and a filter row that borrowed them would spend the board's alarm on a
view.

The phone is a single column filling the width, inside a 16px margin, under a
four-way segmented control with per-column counts. Tapping a segment scrolls the
pages to it, and the segmented control follows the pages when they are swiped:
the scroll is the one owner of which column shows, so a tap can never light a
segment whose list is not under it. Sheets rise from the bottom at a 20px radius
and reserve `env(keyboard-inset-height)`.

**The phone's head is the title row and nothing else.** 领航, a lens, a funnel, and
the date with the sync state as one target. The search field and the filters used
to stand above the list at all times, which is about a hundred points of the only
screen the phone has spent on two controls most sessions never touch; they are one
press away now, and a single line over the list — 正在筛选：…, with the press that
puts the whole board back — says what they left showing.

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
  the card being dragged, the open card's panel, the command palette, the pairing
  dialog, the undo line, and the phone's FAB. Only for something genuinely off
  the surface.

### Named Rules

**The Declare-Once Rule.** A surface carries either a border or a shadow, never
both. A zero-blur shadow used as a ring (`0 0 0 2px`) renders as nothing on this
engine; selection is a fill plus a hairline instead.

## Shapes

Cards are 10px radius with no border. Buttons and chips are 7–9px. A due pill is
5px, deliberately squarer than a tag dot so the two meta types never blur. A panel
that floats — the open card, the command palette, the pairing dialog — is 16px;
the undo line is 12px, because it is a message and not a surface to press into.
Sheets are 20px at the top corners only. Nothing is a pill except the phone's check
circle and the FAB, where roundness is the affordance.

## Components

### Card

Paper at rest: white, 10px radius, `shadow`, 12px padding, 7px gap. A 22pt circle
leads the title — a hollow ring in tertiary ink while the card is open work, the
green check once it is done, grey once it is filed — because the phone finishes a
row with one tap and the Mac had no way to finish a card without opening it. The
circle's box is the same size in every state, so titles line up down a column
instead of stepping in where a check appears. Then the title, notes at Ink
Secondary clipped to two lines, then one meta row of tag dots, a due pill, a loop
mark when the card repeats and a check glyph with `2/5` when its note is a
checklist.

**A checklist is a note, written a certain way.** `- [ ] ` and `- [x] ` at the
start of a note's lines *are* the list: there is no field, so the list merges,
syncs and exports as the note it already was, and the card's two-line preview
draws the boxes — an item is a row with a square, so two items read as two things
to tick rather than two sentences that happen to start with a dash. The meta row
carries only a check glyph and the count, `2/5`, in tabular
figures, and
**the count is always Ink Tertiary**: green on this board means a finished card,
so a checklist that is fully ticked must not dress itself as one.

**A card can carry a picture.** Up to three, stored as `data:` URLs on the card
itself — so a picture rides the same row its title does through sync, export and
backup, and can never be a file the other device does not have. The system picker
scales a photo down to a glance (1280 px on the long side, quality 0.72) before it
enters the board; a screenshot pasted into a title or a note keeps the size the
platform handed over, because the paste is the fast path and a field cannot
resize what it is given. The panel, the phone's detail sheet and the capture sheet
show the same strip: tiles pressed to see one whole, a corner on each to take it
away, and a 贴图 tile that opens the picker. A screenshot also arrives by Cmd+V:
on the open card, or in a title or a note, the clipboard's picture becomes an
attachment, and a paste that holds text still types. Pasted files are taken out
of the paste as pictures; its text still goes into the field. The board itself
carries only the glyph and, past one, the count — a thumbnail under every title
would turn a column into a gallery, and the picture is looked at in the card.

**The card is its own handle.** There is no grip glyph on the Mac: a press that
moves 5 points lifts the card, and a press that does not is the press that opens
it. A grip was a target that had to be found inside a 12px padding, it was
undiscoverable on a trackpad, and the phone's board carries the same cards anyway.
A card dragged within 48 points of a column's top or bottom scrolls that column,
faster the closer it gets, and the drop is recomputed on every tick.

Hover raises the shadow, never the colour. Selected (open in the
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

**The keyboard's cursor is the second, softer state.** The arrow keys leave the
same pressed-paper fill on the card Enter would open, and that card **keeps its
shadow**, where the open card trades its shadow for the hairline: that difference
is the whole way to tell "the panel is showing this card" from "the keys are
pointing at it". A pointer press anywhere clears the cursor, because the user is
pointing now; Enter sets the panel's card without clearing it, so Escape leaves
the cursor where it was. After a write the cursor keeps its *row*, not the card: the
next row takes it, so a second Space finishes the card that moved up rather than
following the finished one into 已完成 and undoing the work.

### Column

A label row (name at Ink Secondary, count at Ink Tertiary, a plus button) closed by
a `hairlineSoft` rule — one step quieter than the header's `Rule`, so the label
strip does not read as a table cell. No background of its own.

**A column answers what needs doing next, so it is ordered by deadline.** The
nearest deadline is the top of the column and an overdue card sits above every
card still ahead; cards with no deadline keep the order the user gave them, after
all the dated ones. Two cards on one deadline fall back to `rank`. A drag still
writes a rank — the undated part of a column is the user's to arrange — but a
card with a deadline shows where its due time says it does, so dragging it among
other dated cards changes nothing visible.

The archive's label row carries one more thing: 清空 at Ink Tertiary, drawn only
while there is something to clear, and it asks first in the platform's own alert
naming the number of cards. The phone puts the same verb at the foot of the archive
list instead, where the cards it clears are.

**Finished work files itself after a week.** 已完成 is a place to look at what was
just done, not a second archive; a card that has sat there for seven days moves to
归档 on the next launch and once an hour after that, offering no undo because it is
putting work away rather than throwing it out. The age is the card's `updatedAt`,
since there is no `doneAt` field: the seven days count from the write that put it
there, and a column that is renumbered along the way restarts that count.

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

Which is why removing a tag, alone among the board's presses, still asks first:
the cards it changes are cards the user is not looking at, and one line of 撤销 at
the foot of the window can only offer one card back.

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

**The day word is read off the clock, not off the last edit.** 明天 21:00 written
on Monday evening reads 今天 21:00 on Tuesday, and turns amber and then red at
its own hour, with nobody typing on the board. The label is computed where it is
drawn from a wall-clock signal the deadline-shaped views read — the two pills,
the inspector's editor, both filter counts — so the board looks at the date
because the date moved, not because something else did.

The deadline is edited in two parts. Three chips set the *day* (今天 / 明天 / 下周)
and keep the time already on the card, so 明天 on a 14:30 deadline means tomorrow
at 14:30 rather than tomorrow at 09:00. A time chip beside them opens the app's
own picker: two grids, the 24 hours and the five-minute steps, with 现在 for the
clock's exact minute. The chip shows the time in use before the first press. A
清除 next to the chips takes the deadline away, and a day chip opens a month for
any date at all.

The month is a `Calendar` on a panel the app owns, not a `DatePicker` popup: a
picker's popup draws as a transparent layer on this engine and the card shows
through the days. The calendar carries the same time chip on a strip under it, so
a date and a time are two visible decisions rather than a date followed by a hunt
for a text field, and a picked day keeps the time the card already had.

**A repeat is one press, not a menu.** The deadline row ends with one chip whose
label walks 不重复 → 每天 → 每周 → 每月 → 每年 on each press, the way a tag's hue
walks its five values: five is a count a press can finish, and a menu would be a
second surface for a decision this small. The chip exists only where a deadline
does — a card with nothing to repeat from has no cycle — and clearing the deadline
clears the cycle in the same write. Off 不重复 it sits on `chip` in secondary ink;
on any cycle it takes the accent's wash and `onAccentWash()`, and it tells a
screen reader its own state as `重复：每周`. A card that repeats wears a loop mark
beside the due pill, at Ink Tertiary with no colour of its own, on the Mac's card
and on the phone's row alike.

**Finishing a repeating card makes the next one.** The occurrence lands at the
foot of 待办 with the same title, notes, tags and cycle, and a deadline advanced
to the first occurrence strictly after the moment the card was finished — counted
from the card's own deadline, so a card completed three weeks late still makes
exactly one card, at the hour the deadline always had. A month and a year clamp
to the end of a shorter month and then continue from the clamped day, so a
monthly card set on the 31st drifts to the 28th: an approximation the deadline
itself can correct, cheaper than a field the merge would have to carry. The next
card's id is derived from the card the chain started from and the next deadline,
so two devices that both finish the same card derive one id and the merge keeps
one card; a next card the user deleted is a tombstone, and the board does not put
it back.

**A deadline notifies.** On the Mac the crate gives the date to
`UNUserNotificationCenter`, which owns the schedule from then on: it delivers
with the app closed, plays the sound chosen in System Settings, and lists beside
every other app's. Every open card with a deadline is scheduled — a finished or
removed card drops its reminder — and a card that goes past its deadline is not
dropped but repeated: the deadline's own notification fires at its hour, and a
second request under `<id>.hourly` repeats every hour, in the same category and
with the same 完成 / 推迟 1 小时 buttons, until the card is done, filed or
removed. An overdue card is work nobody has done, and the board saying 已逾期 to
itself is not a reminder. The repeating request is the one kind of notification
the system keeps speaking with the app shut; a new launch hands it a fresh hour,
and the pass that finds the card finished takes it back. On the phone nsh's
`Notifications` posts a real system notification while the app is running: a card
that comes due within the app's five-minute window is handed to the system under
`navigator.card.<id>`, pressing it opens the card on the phone's sheet, and an
overdue card that has passed another hour is handed over again under the same id.
Where the permission is denied, or the platform cannot show one, the same loop
puts one line above the list instead: amber glyph, 到时间了, the card's title,
打开 and a dismiss; dismissing counts as that card having spoken, so it is quiet
for its own hour. The phone still cannot wake itself: nsh has no scheduled
notification or alarm, so an hour that passes while Navigator is closed is seen
on the next launch, not announced at its moment.

**One banner at a time is all the system shows.** Cards due at the same minute are
each handed over, and the system replaces the banner in front of the eye with the
next one within a couple of hundred milliseconds: three deadlines at 09:00 read
as one notification, and the other two sit in Notification Centre where nobody
looked. So the app spaces them itself — the first keeps the deadline's own
minute, the ones beside it follow a banner (2.5 s) apart, in id order so every
launch hands out the same times. A deadline a couple of seconds late is still the
deadline; a deadline nobody was told about is the bug.

**Ahead of time, and answerable.** A card may carry a second notification, one lead
time before the deadline, and that lead is a setting of *this Mac* rather than of
the card: `navigator.leadMinutes` in Storage, off by default, one palette row per
value (5 / 15 / 30 / 60 minutes), never synced. A reminder carries two buttons —
完成 and 推迟 1 小时 — registered in the app's own category, and pressing the
notification itself opens the card. **None of those three interactions has been
pressed by a human** (this machine grants no notification-click interaction); the
tests drive the same queue the system feeds the app.

**The schedule is reconciled with the system, not remembered.** Quitting the app and
opening it straight again makes `UNUserNotificationCenter` drop some of the requests
it was holding, silently. So launch reads back what the system actually holds
(`Reminder.pending()`) and re-schedules what is missing and withdraws what is no
longer the board's — the app's own bookkeeping is not evidence.

### Inspector

A floating card `min(560, window − 80)` wide at panel fill, 16px radius, on
`shadowLift`, centred over the board. Its strip carries 卡片 at tertiary ink and,
at the other end, 归档 / 删除 / 关闭 as three icons, closed by the same rule that
closes the board's header. The destructive pair used to sit under a rule at the
panel's foot, where two presses cost the note a line of its height.

**The note is the body of the panel.** Title at 19.5px/600, up to three lines and
then it stops; status chips, tags with their manager, the deadline editor, then the
note, which takes whatever height the panel has left. The field scrolls its own
text and the panel itself does not scroll: a card is a note with a few decisions
over it, and a scroll region inside a panel that has nothing to scroll is a
trapdoor. `Input` has no height of its own, so the note's box is measured and its
height handed to the field; the first frame falls back to a share of the panel so
there is no flicker.

**The note is read, and a press puts the source back.** The panel opens on the
note drawn: prose as Markdown — a heading is a heading, a link is a link — and
each checklist line a row with its box, ticked with one press. Pressing the prose,
or the blank space under it, reveals the field, which is the note's one editor
and holds the text exactly as it was typed; leaving the field puts the reading
back. The field stays mounted under the reading, so the two never reflow the box:
the note has the same height either way, and the reading is a layer on the
panel's own fill, not a second surface. Nothing is shown twice — the editor's
`- [ ]` no longer stands over a row that says the same thing — and the reading
shows the whole note, in a scroll of its own, instead of six rows and a count.

The note still has one floor (`NOTE_MIN` = 80) under its box, and the panel
itself still does not scroll: a card is a note with a few decisions over it.
Ticking a box is an edit of the note and not a change of status, so it moves no
card and offers no 撤销; the box's stroke is solid tertiary ink, not a translucent
one, because the blended version tests at 3.8:1, under what a control's edge is
allowed.

**A field cannot press what it draws, so links come in two forms.** In the
reading, an http(s) link is a span of the prose — secondary ink with an
underline, never the accent — and a press opens the browser where it is drawn.
In the field, where the text is plain and nothing in it is pressable, the note's
links are listed under it as rows with a link glyph, each a press that opens the
same address. A link the user can see and cannot press is a worse lie than no
link.

Deleting a card does not ask. The tombstone keeps every field, so the same press
offers 撤销 at the foot of the window: the question moved after the act, where it
is cheaper than a dialog and reversible. A batch is the other way round, and so is
removing a tag.

**A card nobody filled in is not a card.** Closing the panel — or pressing 新建 a
second time — drops a card whose title, notes, tags and deadline are all empty. It
leaves a tombstone like any other delete, says nothing, and offers no undo: the
board is left exactly as it was found, instead of a 「未命名卡片」 in 待办 that
nobody decided to make.

### Phone row

One sheet per column, rows divided by a hairline inset 47px on the left so it
starts where the text does. A 44pt check circle leads the row, then title, then one
line of notes, then tag dots and a due pill.

**The Held Row Rule.** A hold is the row's way in. A held row opens a sheet with
完成 / 恢复, 归档 / 删除 and 打开; the check circle stays the fast path for 完成,
and the detail sheet carries the same writes for a card opened by a tap.

**A row has no swipe.** The rows sit inside the pager that is the four columns, so
a horizontal drag is the page turn; a pan on the row would take that touch away
from every scroll view around it for good. The hold works on every page, which is
what makes 归档 and 删除 reachable without a gesture the pager has to lose.

### Phone sheets

Capture: the title field auto-focuses, tags and the deadline editor are taps, and
添加 is 48dp of accent when it can fire and the tinted wash with a muted accent
label when the title is empty — `accessibilityState`, not `disabled`, which drops
the whole affordance and leaves a button that looks live and is not. A 连续添加
switch beside it keeps the sheet open after a capture and flashes 已添加 on the
button for 800ms, which is the difference between adding three cards and fighting
the same sheet three times; it is off by default, because a sheet that will not
close is worse than one that will.

Detail: the title and notes are **editable on the phone too**, in native fields on
the sheet itself — above its controls, outside any scroll view, because an input
nested in a scroll view has no native field on Android and no tap could ever focus
it. Every keystroke patches the card, so there is no save button and nothing to
lose. The Mac's reading has no counterpart on the phone yet: a field and the
note's rows on the sheet are what a thumb reaches, and the field cannot move into
a scroll view to make room for a reading. The sheet keeps every tap as well:
status chips, tags, the deadline editor,
the note's checklist rows (on the sheet, outside any scroll view, like the fields
they belong to), archive, and a delete that offers 撤销 rather than asking.

The status chips on that sheet do **not** offer 撤销, and that is deliberate: the
sheet is a layer over the board, so the line would be drawn underneath it — an
offer nobody can see or press. The chips themselves are the way back, under the
finger that would want it; 移到归档 closes the sheet, so that one does offer.

**The One Sheet Rule.** Filters are one sheet too, behind the funnel in the head:
the tags (several at once), the three date conditions with the whole board's counts,
标签 to manage them, 清除全部, 完成. It says it is on by lighting the funnel and by
the one line over the list, not by a strip that is always there.

The header's date and sync state are one target, not two: a status line alone is
about 12pt tall and a fingertip cannot hit it, so the pressable area grows with
vertical padding and a negative margin at the right edge, and the text does not
move. It opens 连到 Mac, where the address and the six digits live.

### Empty state

A column says what to do, in one quiet line at Ink Tertiary: 把卡片拖到这里 in the
three live columns, 归档的卡片不会再打扰你 in the archive. No illustration, no
centred icon in a circle, no "get started" button.

### Undo line

One line at the foot of whatever surface is showing: centred under the Mac's board,
above the phone's capture button, which it must never cover. Paper on `shadowLift`
with no border — the same one-raised-object rule as a card — 12px radius, six
seconds, one line at a time: a second write replaces the first offer, because two
offers on screen at once is a queue nobody asked for.

Its fill is the surface it floats over, not a new colour: `card` on the Mac (over
the ivory desk) and `select` on the phone (over a column of paper). 撤销 itself sits
on a wash of the accent and takes `onAccentWash()` — 5.07:1 on the phone's light
line, 6.88:1 on the Mac's dark one — never the plain accent, which is under the
floor on its own tint. The message takes plain ink (11.7–17.1:1 across those four
fills).

With a dialog open the line is still drawn, but the first press lands on the
dialog's backdrop instead of the button, so in practice an offer made from the
inspector is one to take after the panel closes. Six seconds is short enough that
this has not been worth a second window.

**The Batch-Asks Rule.** One card is offered back in that line; a batch asks
first. 清空归档 and 清除示例数据 open the platform's own alert and name the number
of cards they are about to remove — 「将删除 12 张卡片。」 — because a tombstone
written for a whole column is not something one line can put back. Removing a tag
is under the same rule: it changes cards the user is not looking at. 清除示例数据
is offered only while the board still carries authored samples (the palette on the
Mac, 连到 Mac on the phone), and it tombstones them through the ordinary merge, so
the other device clears them too instead of pushing them back.

### Command palette

`Cmd+K` opens one field over the board holding every verb the board has: 新建卡片,
each tag as a filter toggle, the three date conditions and 全部日期, 清除筛选,
清空归档, 清除示例数据, 标签管理, the lead reminder's five values, 导出（JSON /
Markdown）, 从剪贴板导入, 从备份恢复, 显示配对码 — and one row per card, so typing a
title finds the card rather than a command. 480 wide (never under 300, never wider
than the window less 60), `panel` at 16px on `shadowLift`; the selected row is
`select`, and the only colour in the list is a tag's dot. The board's keys are off
while it is open (`boardKeys()`): a shortcut that moved a card behind the field
would be a card moved by a typo.

The palette is also the only place a setting lives. There is no settings window,
and a lead time is one number, so it is one row per value in the field that already
reaches every verb.

### Pairing code

One small text button in the title band — a step to the right of the sync line,
where a user looks when a phone will not connect — opens a 340pt `panel`: 配对码 at
16/600, the digits at 36pt/500 in tabular figures as `482 913` (six digits in a row
read as one number), one line saying to type them into 连到 Mac once, and 重新生成
at tertiary ink at the foot. Making a new code asks first in the platform's alert:
every paired phone has to be handed the new digits, and the app cannot take that
back. The digits never appear in the status line — a code printed beside 等待设备 is
a number nobody can find when they need it.

### Dock badge

A Mac-only decoration on a glance: the count of cards that are late or due today and
still open — `attentionCount`, the same judgement the amber and red pills make, so
the Dock and the board cannot disagree about what needs attention. Nothing at zero,
so the badge leaves with the work it counted, and `99+` past two digits. It is
written after the board changes and once a minute, because a deadline turns late
with nobody typing. A process with no Dock — the phone, a test runner — is a no-op
and says why in one line at launch.

## Sync

Sync is part of the surface, not plumbing behind it, because the phone is only
useful if it holds the same board. A handful of decisions shape what the user
sees.

**Every Mac serves, and only while it is running.** Its service is a thread in the
app's own process. Quitting the app closes the port, so the phone cannot sync
against a stale copy, and there is no daemon to install or manage. The window is
not the app: on macOS closing it hides the window and leaves the process serving,
with a compass in the menu bar that brings the window back, shows the sync line
and is where the user quits. Otherwise "leaving the Mac open" would mean leaving
a window on the desk. With two Macs both serve and both also look: they find each
other on the network and exchange boards directly, and the phone syncs with every
Mac it finds. A Mac that is
closed is a peer that is not answering this minute; the board on the others is
whole without it.

**The phone is the one device that does not serve.** It is not a daemon and must
not behave like one. The exchange is a round trip — the phone sends the rows it
changed and the answer carries the Mac's — so nothing a Mac has must be
initiated into the phone, and a listener there would be a port that has to
survive the background for no benefit. Its changes reach every Mac all the same.

**Every device finds the others; none remembers an address.** A typed IP is a
config file that rots the first time the router reissues a lease. Instead each
device broadcasts `NAVIGATOR/1 DISCOVER` on its own subnet and reads each
answering Mac's address off the unicast reply, the way LocalSend finds its peers.
Each interface's own broadcast address is used rather than `255.255.255.255`:
the global broadcast leaves by the default route, which on a phone with mobile
data is not the Wi-Fi. A probe collects **every** answer, not the first: two Macs
on one LAN both answer, and a board that only met the quicker one would be a board
half of the devices share. A device recognises its own answer by port and address
and ignores it. A peer that stops answering is dropped and probed for again, so a
sleep, a new lease and a network change all heal within seconds. Typing an address
stays as the fallback for a network that drops broadcasts, and it is one more
peer beside whatever a probe finds, not a decision to ignore the other Macs.

**The board is a file on each device, not a copy of the other's.** Each device
keeps its board in a SQLite file in its own data directory: quitting the app
does not lose work, and the phone's board is real whether or not it can reach the
Mac. A change is written as the row that changed, a third of a second after the
user makes it, and leaving the app flushes what the wait was still holding.

**Merging is per field, and deletes are tombstones.** Both devices hold a board and
each field of a card — title, notes, tags, due, repeat, images, status, deleted,
rank — carries its
own stamp, so the title typed on the Mac and the 完成 pressed on the phone in the
same minute both survive. Where the stamps are equal the larger serialized text of
the two values wins, in UTF-16 code-unit order on both sides, so two devices can
never flip a value back and forth. **A field a card cannot clear is never cleared
by absence**: a card with no `rank` has never been numbered, so the copy that has
none cannot win the place the other device gave it — otherwise introducing the
order against a board written before it erased every rank on the first merge, and
kept erasing the resurrected ones. A cleared deadline is the other case: the card
that cleared it carries the field's own stamp, so the absence is a write and it
wins. A deleted card is kept as `{...card, deleted:
true}` with a new stamp rather than dropped: a dropped id is pushed straight back
by the other device on the next merge, and an undo is the same row with a newer
`deleted` stamp. **A stamp is minted above every stamp already on the board**, not
just from the wall clock: a clock that was stepped back, or a phone whose clock
runs ahead, would otherwise let an edit look older than the card it edits and lose
it silently.

**What crosses the network is the difference, not the board.** Each side sends
`{cards, tags, since}` — the rows it changed, and the newest stamp it has heard
of — and gets back only the rows stamped at or after that. The watermark reaches
five minutes back (`MARGIN`) because two devices do not share a clock: a Mac two
minutes behind stamps a new card with a time the phone has already read past, and a
strict watermark would never ask for it. A board of a thousand archived cards costs
a few hundred bytes per keystroke, and a phone that has been alone for a day
catches up in one round trip.

**Each peer has its own watermark and its own backlog.** A Mac that is shut, or
that holds a different code, must not stop another one from being in step: the
refusal and the lockout belong to that peer, the rows it missed wait in its own
backlog, and the rest of the board keeps moving. Repeating an exchange is safe
because the merge is per field and a tombstone is a value, so the same row may
cross as often as it likes.

**Rows are pushed to the interface, not polled for.** The threads that exchange
boards cannot call into JS — a callback belongs to the engine thread — so they
hand each event to a channel, and one core task posts it on the engine thread:
`rows` when a peer's answer arrives, or when a phone's request has just been
written into this Mac's file, and `status` when what the sheet draws changes. The
status is compared at the resolution it is shown — a sync time is `HH:MM` — so an
exchange that only moved the seconds is not a repaint. The channel never drops a
row: the exchange advances the peer's watermark before the interface has merged
it, so a dropped row is a row no device would ever send again. The interface's
own edits still travel on its timer, because only the interface knows what the
user changed.

**The phone syncs while the app is in front of the user.** Android freezes a
backgrounded process and Doze cuts its network; nothing in this APK — no
foreground service, no alarm, no wake lock — overrides that, because the
exchange thread and the interface both live in the process. Locking the phone
stops syncing, and that is stated rather than papered over. Nothing is lost: the
file is flushed as the app leaves the foreground, and coming back nudges the
exchange thread and pushes what arrived meanwhile. A build that still polls
skips the poll while the app is not active, for the same reason: a board nobody
is looking at has nothing to repaint. The Mac is the exception by design — its
window can be hidden with the process still serving.

**One board, one code.** A LAN at a coffee shop is everybody's LAN, so the board
keeps six digits, shows them in a title band, and every device proves it read
them: `GET /challenge` hands out a 16-byte nonce good for thirty seconds and one
use, and `/state` wants `HMAC-SHA256(code, nonce)` in a header. The digits belong
to the board rather than to the machine that made them: a second Mac types them
once in its own 配对码 panel and answers to them from then on, and the phone types
the same six. The code itself never crosses the wire; the comparison is
constant-time; five failures lock that door for a minute, and a lockout is waited
out in full rather than shortened by coming back to the app. Guessing a million
codes five times a minute is about four months. What this buys is that a
neighbour cannot read or write the board; what it does not buy is secrecy,
because the cards themselves still travel as plain HTTP on the local network.
The status line is where a wrong code is reported — 需要配对码 / 配对码不对 /
尝试太多次，稍后再试 — in the same quiet tertiary ink as everything else sync has
to say, one line, never a banner. Regenerating makes new digits on that one
device only, so every other device has to be given them again, and the dialog
says so before it does it.

The header's status line is the only place any of this shows: `等待设备` on a Mac
with no peer, `已同步 HH:MM` with one and `已同步 2 台` with several,
`1 台未连上` / `1 台配对码不对` when one is behind, and `查找中` /
`连不上 Mac，正在重新查找` on the phone. It is one line of tertiary ink, tap-ready
on the phone to open 连到 Mac — the address and the six digits in one sheet, the
devices in step just under them — and it never becomes a banner, a toast or a
progress bar. Syncing is not an activity the user performs; it is a condition they
can check.

### Named Rules

**The Every-Mac-Serves Rule.** A device listens only when something must connect
to it. Every Mac serves and also watches, so two Macs are peers; the phone only
watches, because its changes travel in the request it sends and the answer carries
the other side's. A listener on a phone would be a port that has to survive the
background for no exchange it cannot already start itself.

**The One-Code Rule.** The code belongs to the board, not to the machine that
made it. A second device adopts it once and answers to it from then on, and
rotating it is a change every device has to be told — which is why the dialog
asks first and says who is affected.

**The Find-Don't-Remember Rule.** An address that only works until the next lease
is not a setting. Discover the peer on every session and keep a typed address
only as the fallback for a network that cannot broadcast.

**The Same-Board Rule.** Compare boards per card by id and stamp, never as JSON
text. A text comparison reports a change on every tick and the resulting
`cards.set` re-renders the board under the user's finger, which reads as the app
ignoring taps.

**The Foreground Probe Rule.** Probing backs off 3 / 6 / 12 / 24 / 30 seconds
while no peer answers, and three things bring it straight back to three — the app
returning to the foreground, a typed address, and finding a peer. A radio that
looks every three seconds for an afternoon is a radio that never sleeps. It holds
on a Mac too, now that a Mac has something to look for.

**The Older-Build Rule.** An OTA package carries TSX only and runs on the app that
installed it, so the interface can be newer than the crate under it. A new export
is therefore read off the module object it belongs to (`Sync.onEvent`) and gated
by a number the crate answers for (`Sync.api()`), never imported by name: a named
import of an export an older build does not have is a module that fails to load,
not an `undefined` the package could check. `api()` 1 is everything through build
9; 2 adds the pushed rows and status. An interface that cannot find the push
falls back to the mailbox, which the crate fills exactly when no listener exists.

**The Order-Is-Data Rule.** A column's order is a number on the card (`rank`), not
an index in an array that the other device cannot see. A move is the midpoint
between two neighbours, a column that runs out of room between them renumbers
itself in steps of 1000, and `ord` in the file is only a cache for cards written
before ranks existed. The visible order sorts by deadline first and then by
`rank`, so anything that reads order without that sort is one merge away from
showing a different board than the other device; the rank is what decides the
undated cards a column holds.

**The Six Digits Rule.** Six digits, generated from the system's randomness with
rejection sampling so no code is likelier than another, kept out of the board file,
shown only where the user asked for it, and proven by signing a one-use challenge
rather than by sending the code. A lockout is the answer to guessing, and it is
waited out in full.

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
- **Do** make a single destructive press reversible instead of questioning it:
  one card is answered with a line of 撤销, and only a batch asks first, naming
  the number it is about to remove.
- **Do** give one card one undo path that is visible on the surface the press was
  made on; where a sheet covers the board, the way back is a control on the sheet.
- **Do** let the card itself be the handle, and let a hold or a key do what a drag
  can do — a gesture that only exists as a drag is a feature half the input
  devices cannot reach.
- **Do** keep the keyboard's cursor and the open card distinguishable: the cursor
  keeps its shadow, the open card trades it for its hairline.
- **Do** let the note be the body of the inspector, and let the panel never scroll.
- **Do** show a note once on a surface: read it (Markdown drawn, checklist boxes
  tickable), and let a press put the source back. A field above a row that says
  the same thing is one note told twice.

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
- **Don't** put a dialog in front of a single delete. The tombstone makes it
  reversible, and a question asked before every press is a tax on every press.
- **Don't** fill a surface with colour: green, red and amber are words about
  work, not backgrounds for a button or a row.
- **Don't** let the search field be what gives when the filter row runs out of
  width — move a tag behind 更多, never the field.
- **Don't** offer 撤销 from a sheet that covers the line it would be drawn on; give
  the sheet its own way back.
- **Don't** leave the system title bar on a native app: a band of chrome the app
  did not draw above its own header reads as a browser window.
- **Don't** show a note's source and the same note rendered on one surface: pick
  the reading, and let a press put the source back.
- **Don't** ship an editable field *inside a scroll view* on the phone: on Android
  it has no native view and no tap can focus it. The detail sheet's fields sit on
  the sheet, above its controls, for exactly this reason.
- **Don't** show a scrollbar on a page of paper. The board and the phone's pages
  scroll, and a note scrolls inside its own field; the bar is chrome the app did
  not draw.
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
