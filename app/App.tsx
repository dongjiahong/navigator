import { Text, View, effect, keymap, mount, signal, windowSize } from "nsh";
import { isAvailable as hasWindow, Window } from "nsh/desktop";
import { MacBoard } from "./MacBoard";
import { Inspector } from "./Inspector";
import { PhoneHome } from "./PhoneHome";
import { adoptWindowChrome, headerHeight, titleSpacer } from "./chrome";
import { addCard, cards, isBlank, patchCard, removeCard, removeWithUndo, setStatus, type Status } from "./data";
import { isFiltering, searchQuery, tagFilter } from "./filters";
import { adopt, focusId, focusedCard, keepFocus, moveFocus, shiftFocus } from "./focus";
import { MIN_WINDOW } from "./geom";
import { hydrate, startPersist } from "./persist";
import { phase, start, statusLine } from "./sync";
import { startReminders } from "./reminders";
import { theme, onAccentWash } from "./theme";
import {
  ClearFilterButton,
  DueCalendar,
  Icon,
  SearchField,
  TagFilterRow,
  TagManager,
  TagManagerButton,
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
    windowSize().width >= WIDE && selectedId() === null && pickingDue() === null && !managingTags()
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

        {/* Search and one tag, on the board's own sheet. It is a strip rather
            than another boxed row: the tag dots are the only colour, and nothing
            gets a tray. */}
        <View
          testID="filter-bar"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingLeft: 20,
            paddingRight: 20,
            paddingBottom: 10,
          }}
        >
          <TagFilterRow />
          <TagManagerButton />
          <If when={isFiltering()}>
            <ClearFilterButton />
          </If>
          <View style={{ flex: 1 }} />
          <SearchField width={190} />
        </View>

        <MacBoard
          width={windowSize().width}
          selectedId={selectedId()}
          focusId={focusId()}
          onSelect={(id) => {
            if (id) adopt(id);
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
  try {
    await hydrate();
  } catch (error) {
    // A board that cannot be read is not a reason to lose the run: the samples
    // are on screen, and `persist` keeps trying the file as it is edited.
    console.log(`[navigator] the board could not be read: ${error}`);
  }
  startPersist();
  start();
  startReminders();
}

export function App() {
  keymap.bind("mod+n", () => createIn("todo"));
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

  // The keyboard's cursor follows the board: a card completed into another
  // column takes the cursor with it, and a card deleted or filtered out hands
  // the cursor to the one that took its row. Also an effect, for the same
  // reason: the shell must not re-render on every keystroke for this.
  effect(() => keepFocus());


  return (
    <View
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
