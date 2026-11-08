import { Text, View, effect, keymap, lifecycle, mount, signal, windowSize } from "nsh";
import { isAvailable as hasWindow, Window } from "nsh/desktop";
import { MacBoard } from "./MacBoard";
import { Inspector } from "./Inspector";
import { PhoneHome } from "./PhoneHome";
import { CommandPalette, closePalette, openPalette, paletteOpen } from "./palette";
import { adoptWindowChrome, headerHeight, titleSpacer } from "./chrome";
import {
  addCard,
  cards,
  isBlank,
  patchCard,
  removeCard,
  removeWithUndo,
  setStatus,
  startAutoArchive,
  type Status,
} from "./data";
import { startBadge } from "./badge";
import { searchQuery } from "./filters";
import { MacFilterBar } from "./FilterBar";
import { adopt, clearFocus, focusId, focusedCard, keepFocus, moveFocus, shiftFocus } from "./focus";
import { MIN_WINDOW } from "./geom";
import { hydrate, startPersist } from "./persist";
import { nudgeSync, phase, start, statusLine } from "./sync";
import { installReminders, openRequested, startReminders } from "./reminders";
import { theme, onAccentWash } from "./theme";
import {
  DueCalendar,
  Icon,
  TagManager,
  UndoToast,
  alpha,
  blurSearch,
  focusSearch,
  managingTags,
  pickingDue,
  searchFocused,
} from "./ui";

const selectedId = signal<string | null>(null);


function createIn(status: Status) {
  // 新建 twice in a row: the blank card the first press made is not a card, and
  // the panel has already moved on to the second, so nothing would ever close
  // the first one again. It goes now, and the new card takes its place.
  const shown = selectedId();
  const open = shown ? cards().find((c) => c.id === shown) : undefined;
  if (open && isBlank(open)) removeCard(open.id);
  const id = addCard({ title: "", notes: "", tags: [], due: undefined });
  patchCard(id, { status });
  selectedId.set(id);
}

/**
 * Closes the open card, and takes a card that was never filled in with it.
 *
 * 新建 makes a card first and opens it, because a card is what the panel edits;
 * closing the panel on a card with no title, note, tag or deadline should leave
 * the board as it was found rather than put a 「未命名卡片」 in 待办 that nobody
 * decided to make. Nothing is said about it: the card never became one.
 */
function closeCard() {
  const id = selectedId();
  const card = id ? cards().find((c) => c.id === id) : undefined;
  if (card && isBlank(card)) removeCard(card.id);
  selectedId.set(null);
}

/** The one place sync reports itself, on either device. */
function SyncNote(props: { align?: "left" | "right" }) {
  const tone = () => (phase() === "error" ? theme().danger : theme().textTertiary);
  return (
    <Text
      testID="sync-status"
      style={{
        fontSize: 11.5,
        fontWeight: "500",
        color: tone(),
        fontVariant: ["tabular-nums"],
      }}
    >
      {statusLine()}
    </Text>
  );
}

/** Below this width the board becomes the phone's list. */
const WIDE = 900;

/**
 * Whether a board shortcut may fire now.
 *
 * While a dialog owns the screen — the open card, the calendar, the tag manager
 * — the board under it is not what the keys would act on, and moving a card the
 * user cannot see is the kind of thing an app does once before it is trusted
 * with nothing. The phone shows one column and no cursor, so the keys are not
 * its own either.
 */
function boardKeys(): boolean {
  return (
    windowSize().width >= WIDE &&
    selectedId() === null &&
    pickingDue() === null &&
    !managingTags() &&
    // The palette is a field with the keyboard: its arrows walk its own list,
    // and the board behind it is not what they would act on.
    !paletteOpen()
  );
}

/** Space, and 空格 on the circle: open work is finished, finished work reopens. */
function toggleFocused() {
  const card = focusedCard();
  if (!card) return;
  setStatus(card.id, card.status === "done" || card.status === "archive" ? "todo" : "done");
}

function deleteFocused() {
  const card = focusedCard();
  if (card) removeWithUndo(card.id);
}

/**
 * Components read signals and theme where they are used, never into a local at
 * the top: a body runs once, and a value read there never updates.
 *
 * The window is one sheet with one horizontal rule under the title row, running
 * its full width. An opened card floats over the board at the middle of the
 * window rather than docking as a column: the board never changes size when a
 * card is read, and the column the card came from stays where the pointer left
 * it.
 *
 * The band is drawn from the window's very top, so the ground runs under the
 * traffic lights and there is no seam where the app's paper meets the platform's
 * chrome. Only the *controls* are pushed below the platform's title bar area,
 * because AppKit keeps that area for dragging and a press there never arrives.
 */
function MacShell() {
  return (
    <View style={{ flex: 1 }}>
        <View
          testID="title-band"
          // The band is the window's title bar: pressing it drags the window
          // (double-click maximizes), which is what hidden system chrome owes
          // the user. Without this only AppKit's own thin strip above the band
          // was draggable, so the window could barely be moved. Views with a
          // press handler inside stay clickable, so 新建 still works.
          desktop={{ windowDrag: true }}
          style={{
            height: headerHeight(),
            paddingTop: titleSpacer(),
            paddingLeft: 20,
            paddingRight: 20,
            // A hairline closes the header. Without it the app's title and the
            // column labels share one undivided band. It is the heavier of the
            // two rules on purpose: the column rules below are quieter so the
            // label strip does not read as a table grid.
            borderBottomWidth: 1,
            borderBottomColor: theme().divider,
          }}
        >
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: theme().text, letterSpacing: 0 }}>领航</Text>
            <View style={{ width: 12 }} />
            <SyncNote />
            <View style={{ flex: 1 }} />
            <View
              testID="new-card"
              onPress={() => createIn("todo")}
              role="button"
              accessibilityLabel="新建卡片"
              hoverStyle={{ backgroundColor: alpha(theme().accent, theme().dark ? 0.2 : 0.13) }}
              activeStyle={{ opacity: 0.7 }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                height: 27,
                paddingHorizontal: 10,
                borderRadius: 7,
                backgroundColor: alpha(theme().accent, theme().dark ? 0.14 : 0.09),
              }}
            >
              {/* The label sits on its own 9% wash, which lifts the ground under
                  it: the plain accent measures 4.30:1 there, so it uses
                  `onAccentWash` (5.26:1). */}
              <Icon name="plus" size={12.5} tint={onAccentWash()} width={2.2} />
              <Text style={{ fontSize: 12.5, fontWeight: "500", color: onAccentWash() }}>新建</Text>
            </View>
          </View>
        </View>

        {/* When it is due, whose work it is, and which words — one row on the
            board's own sheet. Not another boxed row: the tag dots are the only
            colour, and nothing here gets a tray. It is sized from the window
            because the tag strip is the part that gives when the window is
            narrow; the search field is the part that never does. */}
        <MacFilterBar width={windowSize().width} />

        <MacBoard
          width={windowSize().width}
          selectedId={selectedId()}
          focusId={focusId()}
          // A press on a card opens it and takes the keyboard's cursor away: the
          // card is what the pointer chose, and a cursor left behind on it kept
          // its pressed-paper fill after the panel closed, which read as a card
          // stuck selected. The keyboard's Enter sets the panel's card without
          // coming through here, so walking the board with the keys still leaves
          // the cursor where it was after Escape.
          onSelect={(id) => {
            clearFocus();
            selectedId.set(id);
          }}
          onAdd={(status) => createIn(status)}
        />
      {/* The open card floats at the middle of the window instead of docking
          as a second column: docking narrowed the board every time a card was
          opened, which moved the columns under the pointer mid-press. */}
      <Inspector
        id={selectedId()}
        onClose={closeCard}
        onSelectStatus={(s) => setStatus(selectedId()!, s)}
      />
    </View>
  );
}

/**
 * Reads the board from its file, then starts everything that writes to it.
 *
 * The order is the point: the LAN service merges the phone's cards into the
 * same file, and the reminders hand deadlines to the system's notification
 * centre, so both have to see the user's board rather than the samples the app
 * starts with. `hydrate` resolves before the first frame, so no frame shows the
 * samples at all.
 */
async function boot() {
  // Before the board is even read: a click on a notification can be what
  // launched this process, and the system only hands that answer to a delegate
  // that is already set. Nothing here touches the board, so it costs the read
  // nothing.
  installReminders();
  try {
    await hydrate();
  } catch (error) {
    // A board that cannot be read is not a reason to lose the run: the samples
    // are on screen, and `persist` keeps trying the file as it is edited.
    console.log(`[navigator] the board could not be read: ${error}`);
  }
  startPersist();
  start();
  // Finished work is filed before the reminders read the board, so a card that
  // is about to leave 已完成 never gets a notification on its way out.
  startAutoArchive();
  startReminders();
  startBadge();
}

export function App() {
  keymap.bind("mod+n", () => createIn("todo"));
  // One key reaches every verb the board has: cards by their title, a tag to
  // narrow to, 新建, the archive, the tags themselves. It toggles, so the key
  // that opened the field also puts it away.
  keymap.bind("mod+k", () => {
    if (paletteOpen()) closePalette();
    else if (windowSize().width >= WIDE) openPalette();
  });
  // Escape empties the search field while it has the keyboard, which a field
  // otherwise swallows. Bound first, so the closing binding below is the newer
  // one and wins wherever both may fire — one keypress never does both, and
  // Escape inside a title field still belongs to the field.
  keymap.bind(
    "escape",
    () => {
      if (!searchFocused()) return;
      searchQuery.set("");
      blurSearch();
    },
    { when: "always" },
  );
  keymap.bind("escape", closeCard);
  // Search is a field on the board, so it is one key from the board: a Mac user
  // typing a title to find it should not have to find the field with the mouse.
  keymap.bind("mod+f", () => {
    if (boardKeys()) focusSearch();
  });

  // The arrow keys walk the board, Enter reads the card and Space finishes it.
  // All of them are `notEditing`: in a title, a note or the search field those
  // keys are the caret, the space bar and the return key. Only the arrows repeat
  // — holding Space would toggle a card as fast as the key repeats.
  keymap.bind(
    {
      up: () => boardKeys() && moveFocus("up"),
      down: () => boardKeys() && moveFocus("down"),
      left: () => boardKeys() && moveFocus("left"),
      right: () => boardKeys() && moveFocus("right"),
    },
    { when: "notEditing", repeat: true },
  );
  keymap.bind(
    {
      enter: () => {
        if (!boardKeys()) return;
        const id = focusId();
        if (id) selectedId.set(id);
      },
      space: () => boardKeys() && toggleFocused(),
      // The card is kept as a tombstone and offered back, so the keyboard's
      // delete is the same delete the panel's button makes.
      "mod+backspace": () => boardKeys() && deleteFocused(),
      "mod+delete": () => boardKeys() && deleteFocused(),
      // Moving work between columns is the board's signature gesture, and these
      // are the same move without a pointer.
      "mod+]": () => boardKeys() && shiftFocus(1),
      "mod+[": () => boardKeys() && shiftFocus(-1),
    },
    { when: "notEditing" },
  );
  // The window's title bar is the app's own header, and it can be drawn at once:
  // nothing about it waits for the board.
  adoptWindowChrome();
  // The board itself is read from its file first, and everything that writes to
  // it starts after it is open — the LAN service merges into the same file, and
  // a reminder scheduled for a sample card would be a notification about work
  // the user does not have. `hydrate` resolves before the first frame is drawn,
  // so the window opens on the user's board rather than the samples.
  void boot();

  // The board never scrolls sideways, so the window keeps enough room for four
  // readable columns. nsh has no minimum-size API; putting the window back to
  // the floor as soon as it goes under is the same guarantee. Windows below the
  // phone breakpoint are left alone — they are the phone layout (and screenshot
  // tests open exactly such a window).
  effect(() => {
    if (!hasWindow) return;
    const width = windowSize().width;
    // The two extra points cover a window decoration the frame includes but the
    // content size may not, so the floor is not applied over and over.
    if (width >= WIDE && width < MIN_WINDOW) Window.setFrame({ size: { width: MIN_WINDOW + 2 } });
  });

  // Close the inspector when the open card is removed on the other device.
  // This is an effect, not a render dependency: reading `cards` here would make
  // every keystroke rebuild the shell and the focused field would drop letters.
  effect(() => {
    const id = selectedId();
    if (!id) return;
    if (!cards().some((c) => c.id === id && !c.deleted)) selectedId.set(null);
  });

  // A notification's own click asks for its card to be read. Which card is open
  // is this shell's state, so the reminder module leaves the request in a
  // signal and it is taken here — cleared first, so the same card can be asked
  // for twice.
  effect(() => {
    const id = openRequested();
    if (!id) return;
    openRequested.set(null);
    if (!cards().some((c) => c.id === id && !c.deleted)) return;
    adopt(id);
    selectedId.set(id);
  });

  // The keyboard's cursor follows the board: a card completed into another
  // column takes the cursor with it, and a card deleted or filtered out hands
  // the cursor to the one that took its row. Also an effect, for the same
  // reason: the shell must not re-render on every keystroke for this.
  effect(() => keepFocus());

  // Coming back to the app is a moment worth a probe. A phone that spent the
  // afternoon away walked out of one network and into another, and the exchange
  // thread has been backing off the whole time; this is the app saying it is in
  // front of the user again.
  effect(() => {
    if (lifecycle() === "active") nudgeSync();
  });


  return (
    <View
      // A press anywhere the app is not a card — the air between two columns,
      // the band above the board — puts the keyboard's cursor away, because the
      // user is pointing rather than walking. It is on the sheet rather than on
      // the board so it also covers the header, and a press that lands on a card
      // or a button stops there and never reaches it.
      onPress={clearFocus}
      style={{
        flex: 1,
        backgroundColor: theme().ground,
        // Light rakes in from the top-left corner over a warm paper ground, so
        // the board sits on a lit material rather than a flat fill. The stops
        // are spaced to keep a visible falloff across the window: a single
        // gentle ramp reads as one flat grey.
        backgroundImage: `linear-gradient(158deg, ${theme().lightWarm} 0%, ${theme().groundTint} 26%, ${theme().ground} 56%, ${theme().groundDeep} 100%)`,
      }}
    >
      {windowSize().width >= WIDE ? <MacShell /> : <PhoneHome />}
      {/* One tag manager for both layouts: a Dialog floats over whatever the
          window is showing, so a tag made or renamed here is the same list the
          pickers and the filter row read. */}
      <TagManager />
      {/* The one field that reaches the board's verbs and its cards by name: it
          floats over whatever the window shows, and closing it puts the reader
          back on the board exactly where it was. */}
      <CommandPalette
        onNew={() => createIn("todo")}
        onOpen={(id) => {
          adopt(id);
          selectedId.set(id);
        }}
      />

      {/* One month for both layouts, for the same reason: the deadline editor on
          the Mac's card and on the phone's sheet opens the same calendar. */}
      <DueCalendar />
      {/* One undo line for both layouts, at the foot of the surface: a delete, a
          completion and an archive are all one press from being taken back, and
          the app says so in the same place whichever device did it. */}
      <UndoToast phone={windowSize().width < WIDE} />
    </View>
  );
}

mount(App);
