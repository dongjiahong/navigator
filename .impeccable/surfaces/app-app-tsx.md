---
version: 1
slug: "app-app-tsx"
primary_target: "app/App.tsx"
related_targets: []
---

# Surface brief — 看板 board (Mac + phone)

## Scope

The whole app: the Mac four-column board with its inspector, and the phone's
one-column list with capture and detail sheets. Mode: **Operate**. The visitor
came to get planning done, so the world lends type, palette, density and one
signature move — never the layout or the controls.

The visual world was **pinned by the brief**, not rolled: the user supplied a
reference for the texture ("如图我需要这样的质感") and explicitly left logic and
layout to us. A pinned direction beats the roll, so no concept-seed round ran.

## Audience, job, action

One person planning work and personal life in one place. On the Mac, they sit
down to triage and reorganize; on the phone, they glance and capture in
seconds. The task is always the same: decide what is todo, what is in flight,
what is done, and what to put away. Success is that moving a card *means*
something, and that a thought captured on the phone is never lost.

## Constraints

Four fixed columns (待办/进行中/已完成/归档). Card fields: title, tags, notes,
due time. Content is authored sample material, labeled as such. Native AppKit
and Android views through nsh — no web surfaces, no HTML/CSS in the artifact.

## Direction contract

**THESIS.** A board is one sheet of paper, not a grid of boxes. The
category default — a grey ground with a white bordered card per task and a
tray per column, boxes inside boxes — is refused: columns are separated by
air and a hairline rule under each label, and cards are the only raised
objects on the surface.

**OWN-WORLD.** Ivory ground, raked with a single diagonal light from the
top-left (`158deg`, `#FCFCFA → #F6F7F8 → #EFF1F2 → #E4E7EA`). Cards are white
paper at radius 10 with one tight two-layer shadow and no border; the
inspector is a slightly cooler sheet (`#FAFBFC`) divided by a hairline, not a
panel that floats. Type is the platform scale at regular weight, so hierarchy comes from size and colour, not
boldness. Colour does three jobs and only three: a tag dot names what the work
belongs to (工作 blue, 个人 green, 学习 purple, 生活 amber, 紧急 red); a due
time is tinted only when it is today (amber) or overdue (red); a finished card
turns a green check and drops to tertiary text. Dark is its own scheme, not a
filter: `#17191B` ground, `#24282B` cards, `#1E2123` panel, accent lifted to
`#6FA9DC`, and the same three colour jobs at lighter tints (`#79B4E8`,
`#63C99B`, `#A99BEA`, `#D9A566`, `#FF8A80`).

Two surfaces the accent meets take different content, and the difference is
measured rather than eyeballed: a label *on an accent wash* uses the muted
accent (the plain one is 4.30–4.37:1 in light and 3.83:1 on the dark chip), and
content *on a filled accent* is white in light (5.47:1) and `#0D1418` in dark
(7.42:1), because the dark accent is a pale blue where white is 2.50:1.

**STORY.** The visitor reads the board in one pass: what is left, what is
moving, what is finished. Each card says what it is and when it is due
without opening anything. Opening a card (or a phone row) turns the same
object into a form and back, with no mode change and no lost keystroke.

**FIRST VIEWPORT.** The window's title bar *is* the app's own header: the system
chrome is hidden, the app fills the window to its top edge, and the traffic
lights sit on the app's paper. That band carries 看板 at 15px, the sync state as
one quiet line, and a single tinted 新建 button — with the controls pushed below
the platform's reserved drag strip, because a press in that strip never reaches
the app. Below it four columns of 246–336px on a 1280 window, each led by its
label, a tabular count, and a hairline rule that spans the column. Cards begin
directly under that rule with no tray behind them. The primary action is a
card: pressing one docks the 300px inspector as a second column of the window —
its own strip of the same height, closed by the same rule — and the board
scrolls rather than squeezing a column below a readable measure. The phone
finds the Mac by broadcasting on its own subnet and reading the reply's source
address, so no IP is ever typed.

**FORM.** Composition: header band, then a four-column reading plane that
scrolls horizontally, then a docked inspector. Ordered list position: the
continuous-sheet structure was chosen over a per-column tray (rejected as
boxes-inside-boxes) and over a table (rejected: status is a place, not a
column of text). Signature move, named concretely: **dragging lifts a card
off the paper — tilted 1.4°, scaled 1.03, shadowed — and opens a 2px seam at
the exact index it will land in; on release the card settles into that seam
with an ease.** That seam is the one place the accent colour appears as a
line, and it is what makes "status is a place" visible. On the phone the
signature move is its native form: a 44pt check circle that completes a row
in one tap, and a paged swipe across the four columns.
`seed: none (unavailable)` — the direction was pinned by the brief.

**FINISH.** unreviewed and undocumented is unfinished; this build ends with the
finish review, the verdict, DESIGN.md, and every shipping raster carrying its
provenance.

Two limits of that evidence, recorded rather than papered over: the app
screenshot path does not render unmasked outer shadows, so no desktop raster
shows the elevation that exists at runtime; and it captures the content view
only, so the traffic lights that sit in the app's header on the real window
cannot be verified from any file. The phone closes both gaps from the other
side: three device screencaps show the board with the FAB's shadow, the capture
sheet with a live Chinese IME and its keyboard inset holding, and the detail
sheet — and the contrast numbers quoted above are measured on those pixels. The
drag state is still unreviewed, because `dragAndHold` only runs headless and a
headless engine paints nothing.
