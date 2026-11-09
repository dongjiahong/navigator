import {
  List,
  Scroll,
  Storage,
  Text,
  View,
  signal,
  windowSize,
  type InputRef,
  type ScrollRef,
} from "nsh";
import { Input, Sheet, Switch } from "nsh/base";
import {
  COLUMNS,
  addCard,
  board,
  boardTags,
  cards,
  isBlank,
  patchCard,
  removeCard,
  removeWithUndo,
  removeSamples,
  sampleCardsLeft,
  setStatus,
  type Card,
  type Status,
} from "./data";
import {
  DUE_LABEL,
  clearFilters,
  clearTagFilters,
  dueCounts,
  dueFilter,
  filterSummary,
  filteredBoard,
  isFiltering,
  searchQuery,
  selectedTags,
  setDueFilter,
  toggleTagFilter,
  type DueCondition,
} from "./filters";
import { parseChecklist, previewLines } from "./checklist";
import { clock } from "./clock";
import {
  ChecklistProgress,
  ChecklistRows,
  DueBadge,
  DueEditor,
  Icon,
  IconButton,
  NoteLinks,
  NotePreview,
  SearchField,
  TagManagerButton,
  TagPicker,
  TagRow,
  alpha,
  clearArchive,
  clearSamples,
} from "./ui";
import { fieldHeight } from "./text";
import { hueColor, theme, onAccentFill, onAccentWash, TYPE } from "./theme";
import { dismissDue, dueNow, notificationLine, testNotification } from "./reminders";
import { takeUpdateAction, updateActionLabel, updateLine, updateState } from "./updates";
import { connectTo, detail, endpoint, pairLine, pairWith, peers, phase, start, statusLine, syncNow } from "./sync";
import { canPair, digits, pairCode, peerLine } from "./pairing";

const active = signal<Status>("todo");
const openId = signal<string | null>(null);
/**
 * The card the detail sheet is showing. Set when the sheet opens and left
 * alone while it closes: the sheet is presented natively, so its content has to
 * exist before the presentation starts, and must survive the tear-down.
 */
const shownId = signal<string | null>(null);

/** The paged column scroller, for the segment taps. */
let pages: ScrollRef | undefined;

/** Opens `id` in the detail sheet. */
export function openCard(id: string) {
  shownId.set(id);
  openId.set(id);
}

/**
 * Closes the detail sheet, and takes a card that ended up with nothing in it
 * with it: the same rule as the Mac's panel, so a phone that clears a title does
 * not leave an empty row behind. A card with any content stays.
 */
function closeDetail() {
  const id = shownId();
  const card = id ? cards().find((c) => c.id === id) : undefined;
  if (card && isBlank(card)) removeCard(card.id);
  openId.set(null);
}

const capturing = signal(false);
const draftTitle = signal("");
const draftTags = signal<string[]>([]);
const draftDue = signal<string | undefined>(undefined);
/** The sheet where the phone is told which Mac to follow. */
const linking = signal(false);
const draftAddress = signal("");
/** The six digits being typed into that sheet, digits only. */
const draftCode = signal("");
/**
 * Whether 添加 keeps the capture sheet open for the next card.
 *
 * A batch of cards thought of in one go — five things for work, or the shopping
 * list — is a sequence of one-line captures, and closing the sheet between each
 * of them costs a tap, a wait and a lost train of thought. It is a preference,
 * so it is kept on the device rather than asked for every time.
 */
const keepAdding = signal(false);
/** The 添加 button's moment of having fired, for the 连续添加 case. */
const addedFlash = signal(false);
const KEEP_KEY = "navigator.captureKeepGoing";
let keepRead = false;

/** Reads the preference once per launch. */
function readKeepAdding(): void {
  if (keepRead) return;
  keepRead = true;
  void Storage.getItem(KEEP_KEY).then((value) => keepAdding.set(value === "1"));
}

function setKeepAdding(on: boolean): void {
  keepAdding.set(on);
  void Storage.setItem(KEEP_KEY, on ? "1" : "0");
}

/** The capture sheet's title field, so a kept-open sheet can go back to it. */
let captureField: InputRef | null = null;

function todayLine() {
  const d = new Date();
  const wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 ${wd}`;
}

/** What one row write is: its word, its glyph, and the write. */
type RowAction = {
  label: string;
  icon: "check" | "archive" | "close";
  run: (id: string) => void;
};

/**
 * The two actions a row carries, by direction, for `status`.
 *
 * They are the meanings the app already has, not new ones: right is the check
 * circle's meaning (完成, or 恢复到待办 on a row that is already finished), left
 * is 归档, and in 归档 it is the 删除 that column exists for. Both write through
 * `setStatus` / `removeWithUndo`, so both offer a way back in the same line every
 * other write does.
 */
function rowActions(status: Status): { right: RowAction; left: RowAction } {
  const settled = status === "done" || status === "archive";
  return {
    right: settled
      ? { label: "恢复", icon: "check", run: (id) => setStatus(id, "todo") }
      : { label: "完成", icon: "check", run: (id) => setStatus(id, "done") },
    left:
      status === "archive"
        ? { label: "删除", icon: "close", run: (id) => removeWithUndo(id) }
        : { label: "归档", icon: "archive", run: (id) => setStatus(id, "archive") },
  };
}

/** The card whose row actions are on screen, or `null`. */
const rowSheetId = signal<string | null>(null);

/**
 * The three writes a row has: the sheet a held row opens.
 *
 * The hold is the row's one way in besides a tap. The rows sit inside the pager
 * that is the four columns, so a horizontal drag belongs to the page turn; the
 * check circle is the fast path for 完成, and this sheet is where 归档, 删除 and
 * 打开 live on every page.
 */
function RowSheet() {
  const card = () => cards().find((c) => c.id === rowSheetId());
  const actions = () => (card() ? rowActions(card()!.status) : null);
  return (
    <Sheet
      open={rowSheetId() !== null}
      onOpenChange={({ open }) => {
        if (!open) rowSheetId.set(null);
      }}
      closeOnSwipe
      popupStyle={{
        backgroundColor: theme().panel,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingBottom: "env(keyboard-inset-height)",
      }}
      backdropStyle={{ backgroundColor: theme().scrim }}
    >
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 20, gap: 2 }}>
        <View style={{ alignItems: "center", paddingBottom: 8 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: alpha(theme().textTertiary, 0.45) }} />
        </View>
        <Text
          style={{
            fontSize: 13,
            color: theme().textTertiary,
            paddingHorizontal: 8,
            paddingBottom: 8,
            numberOfLines: 1,
          }}
        >
          {card()?.title || "未命名卡片"}
        </Text>
        {actions() ? (
          <>
            <RowSheetAction
              testID="row-action-right"
              label={actions()!.right.label}
              icon={actions()!.right.icon}
              tint={theme().ok}
              onPress={() => {
                // Read the action before closing: closing clears the id, and
                // the actions are looked up from it.
                const action = actions()!.right;
                const id = rowSheetId();
                rowSheetId.set(null);
                if (id) action.run(id);
              }}
            />
            <RowSheetAction
              testID="row-action-left"
              label={actions()!.left.label}
              icon={actions()!.left.icon}
              tint={card()?.status === "archive" ? theme().danger : theme().textSecondary}
              onPress={() => {
                const action = actions()!.left;
                const id = rowSheetId();
                rowSheetId.set(null);
                if (id) action.run(id);
              }}
            />
            <RowSheetAction
              testID="row-action-open"
              label="打开"
              icon="chevron"
              tint={theme().textSecondary}
              onPress={() => {
                const id = rowSheetId();
                rowSheetId.set(null);
                if (id) openCard(id);
              }}
            />
          </>
        ) : null}
      </View>
    </Sheet>
  );
}

function RowSheetAction(props: {
  testID: string;
  label: string;
  icon: "check" | "archive" | "close" | "chevron";
  tint: string;
  onPress: () => void;
}) {
  return (
    <View
      testID={props.testID}
      onPress={props.onPress}
      role="button"
      accessibilityLabel={props.label}
      activeStyle={{ backgroundColor: theme().chip }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        minHeight: 50,
        paddingHorizontal: 8,
        borderRadius: 9,
      }}
    >
      <Icon name={props.icon} size={17} tint={props.tint} width={2} />
      <Text style={{ fontSize: 15.5, color: theme().text }}>{props.label}</Text>
    </View>
  );
}

/**
 * One tap, done. The circle is the phone's fastest action, so it gets 44 points.
 *
 * It takes the row's card accessor and reads the status where it draws it: a
 * list cell is recycled, so a status read in the body would keep the first
 * card's check on every row the cell shows later.
 */
function CheckCircle(props: { card: () => Card; onPress: () => void }) {
  const done = () => props.card().status === "done" || props.card().status === "archive";
  return (
    <View
      testID={`checkbox-${props.card().id}`}
      onPress={props.onPress}
      role="checkbox"
      accessibilityLabel={done() ? "标记为未完成" : "标记为已完成"}
      accessibilityState={{ checked: done() }}
      activeStyle={{ opacity: 0.5 }}
      style={{
        // 44 points of target around a 23-point circle, lifted onto the row's
        // first line: a check that floats in the middle of a three-line row
        // reads as belonging to the notes under the title.
        width: 44,
        height: 44,
        marginTop: -10,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: 23,
          height: 23,
          borderRadius: 11.5,
          borderWidth: done() ? 0 : 1.6,
          borderColor: alpha(theme().textTertiary, 0.8),
          backgroundColor: done() ? theme().ok : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {done() ? <Icon name="check" size={13} tint={theme().dark ? "#0D1A12" : "#FFFFFF"} width={2.6} /> : null}
      </View>
    </View>
  );
}

function PhoneRow(props: { card: () => Card }) {
  const c = () => props.card();
  const settled = () => c().status === "done" || c().status === "archive";
  // The accessor is kept as a value: a recycled cell's `props` outlives the row
  // it drew, and the action handlers read the card as it is at the moment of the
  // press rather than as it was when the row was made.
  const read = props.card;
  const right = () => rowActions(c().status).right;
  const left = () => rowActions(c().status).left;
  // One line of the note under the title, with a checklist's boxes drawn as
  // boxes: the row is a glance, not an editor.
  const preview = () => previewLines(c().notes, 1);
  const list = () => parseChecklist(c().notes);
  return (
    <View
      // The two writes as custom actions, for a screen reader that cannot hold
      // a row; the check circle and the detail sheet remain the ordinary paths.
      accessibilityActions={[
        { name: "complete", label: right().label },
        { name: "archive", label: left().label },
      ]}
      // Both read the card through the cell's own accessor, at the moment of
      // the press, never the value it had when the row was made.
      onAccessibilityAction={(e) => {
        const card = read();
        if (card.deleted) return;
        (e.actionName === "archive" ? left() : right()).run(card.id);
      }}
      style={{ backgroundColor: "transparent" }}
    >
      <View
        testID={`row-${c().id}`}
        onPress={() => openCard(c().id)}
        // Held down, a row offers its writes without asking the finger to travel:
        // 完成 / 恢复, 归档 / 删除 and 打开 in one sheet. A hold is the phone's
        // own mark for "more actions on this row", and it is the only path to
        // 归档 and 删除 besides the detail sheet.
        onLongPress={() => rowSheetId.set(c().id)}
        delayLongPress={420}
        activeStyle={{ backgroundColor: theme().cardPressed }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: 13,
          // Rows sit on the column's sheet; a card per row would put a box
          // inside a box on a phone screen.
          backgroundColor: theme().card,
        }}
      >
        <View style={{ width: 46, alignSelf: "stretch", alignItems: "center", justifyContent: "center" }}>
          <CheckCircle card={c} onPress={() => setStatus(c().id, settled() ? "todo" : "done")} />
        </View>
        <View style={{ flex: 1, gap: 5, paddingRight: 16 }}>
          <Text
            style={{
              ...TYPE.phoneTitle,
              color: settled() ? theme().textTertiary : theme().text,
              numberOfLines: 3,
            }}
          >
            {c().title || "未命名卡片"}
          </Text>
          {preview().length > 0 ? <NotePreview notes={c().notes} size="phone" lines={1} /> : null}
          {c().tags.length > 0 || c().due || list().total > 0 ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 11, flexWrap: "wrap", marginTop: 1 }}>
              {c().tags.length > 0 ? <TagRow ids={c().tags} size="phone" /> : null}
              {c().due ? <DueBadge iso={c().due ?? ""} size="phone" settled={settled()} /> : null}
              {c().due && c().repeat ? (
                <Icon name="repeat" size={12.5} tint={theme().textTertiary} width={1.9} />
              ) : null}
              <ChecklistProgress notes={c().notes} size="phone" />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function Segment() {

    return (
    <View
      style={{
        flexDirection: "row",
        gap: 2,
        padding: 3,
        marginHorizontal: 16,
        borderRadius: 9,
        backgroundColor: alpha(theme().text, 0.055),
      }}
    >
      {COLUMNS.map((c, i) => {
        const on = active() === c.id;
        return (
          <View
            testID={`segment-${c.id}`}
            // A tab tap has to move the pages, not just the tab: setting the
            // active column alone left the list on the column it was already
            // showing, so 待办 lit up over 进行中's rows. The paged scroll is
            // the one owner of which column shows — its `onScroll` sets the
            // active column — so a tap that never scrolls changes nothing.
            onPress={() => pages?.scrollTo({ x: i * windowSize().width, animated: true })}
            role="tab"
            accessibilityLabel={c.label}
            accessibilityState={{ selected: on }}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              paddingVertical: 6.5,
              borderRadius: 7,
              backgroundColor: on ? theme().card : "transparent",
              boxShadow: on ? theme().shadow : "none",
            }}
          >
            <Text style={{ fontSize: 12.5, fontWeight: on ? "600" : "500", color: on ? theme().text : theme().textSecondary }}>
              {c.label}
            </Text>
            <Text
              style={{
                fontSize: 11,
                fontWeight: "600",
                fontVariant: ["tabular-nums"],
                color: theme().textTertiary,
              }}
            >
              {filteredBoard().filter((x) => x.status === c.id).length}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function CaptureSheet() {
  readKeepAdding();
  return (
    <Sheet
      open={capturing()}
      onOpenChange={({ open }) => {
        capturing.set(open);
        if (!open) {
          draftTitle.set("");
          draftTags.set([]);
          draftDue.set(undefined);
        }
      }}
      closeOnSwipe
      popupStyle={{
        backgroundColor: theme().panel,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingBottom: "env(keyboard-inset-height)",
      }}
      backdropStyle={{ backgroundColor: theme().scrim }}
    >
      <View style={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 18, gap: 14 }}>
        <View style={{ alignItems: "center", paddingBottom: 4 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: alpha(theme().textTertiary, 0.45) }} />
        </View>
        <Input
          testID="capture-title"
          ref={(r) => {
            captureField = r;
          }}
          autoFocus
          multiline
          value={draftTitle()}
          placeholder="要做什么？"
          onChange={({ value }) => draftTitle.set(value)}
          style={{
            fontSize: 18,
            fontWeight: "500",
            lineHeight: 26,
            color: theme().text,
            // An input's placeholder has no colour of its own; without this it
            // falls back to black and the hint vanishes on the dark sheet.
            placeholderColor: theme().textTertiary,
            height: 54,
            padding: 0,
          }}
        />
        {/* The setters are wrapped, never passed as `draftTags.set`: a signal's
            `set` called off its own signal throws 「not a live signal」, so a chip
            pressed on the phone's capture sheet did nothing at all. */}
        <TagPicker selected={draftTags()} onChange={(ids) => draftTags.set(ids)} size="phone" />
        <DueEditor due={draftDue()} size="phone" onChange={(iso) => draftDue.set(iso)} />
        {/* The switch is `nsh/base`'s: presses, keyboard activation and the
            switch role and value come with it, and the two parts are the app's
            own. The thumb travels the track's inner width, and the colour and
            the travel change natively rather than by a style of a check-box
            drawn from scratch. */}
        <Switch
          testID="capture-keep"
          checked={keepAdding()}
          onChange={({ checked }) => setKeepAdding(checked)}
          accessibilityLabel="连续添加"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            alignSelf: "flex-start",
            paddingVertical: 9,
            paddingRight: 12,
            marginVertical: -4,
          }}
          trackStyle={{
            width: 34,
            height: 20,
            borderRadius: 10,
            padding: 2,
            backgroundColor: keepAdding() ? theme().accent : theme().chip,
            transitionProperty: "background-color",
            transitionDuration: 150,
          }}
          thumbStyle={{
            width: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: keepAdding() ? onAccentFill() : theme().card,
            transform: [{ translateX: keepAdding() ? 14 : 0 }],
            transitionProperty: "transform, background-color",
            transitionDuration: 150,
          }}
        >
          <Text style={{ fontSize: 13.5, color: theme().textSecondary }}>连续添加</Text>
        </Switch>
        <View
          testID="capture-save"
          onPress={() => {
            const text = draftTitle().trim();
            if (!text) return;
            addCard({ title: text, notes: "", tags: draftTags(), due: draftDue() });
            draftTitle.set("");
            if (keepAdding()) {
              // The sheet stays up for the next card. Tags and the deadline stay
              // as they were: a batch shares them, and re-picking them for every
              // line would make 连续添加 no faster than capturing one at a time.
              addedFlash.set(true);
              setTimeout(() => addedFlash.set(false), 800);
              // The press took the keyboard out of the field; the next card is
              // typed straight away, so it goes back.
              setTimeout(() => captureField?.focus(), 0);
              return;
            }
            draftTags.set([]);
            draftDue.set(undefined);
            capturing.set(false);
          }}
          role="button"
          accessibilityLabel="添加卡片"
          accessibilityState={{ disabled: !draftTitle().trim() }}
          style={{
            height: 48,
            borderRadius: 12,
            // Empty state: the same bar, unfilled, with a muted accent label.
            // It still reads as the primary action and not as another chip row,
            // while the filled accent marks the moment it can actually fire.
            backgroundColor: draftTitle().trim() ? theme().accent : theme().accentSoft,
            alignItems: "center",
            justifyContent: "center",
            marginTop: 2,
          }}
        >
          <Text
            style={{
              fontSize: 15,
              fontWeight: "600",
              color: draftTitle().trim() ? onAccentFill() : theme().accentMuted,
            }}
          >
            {addedFlash() ? "已添加" : "添加"}
          </Text>
        </View>
      </View>
    </Sheet>
  );
}

function DetailSheet() {
  // Read by id inside the tree, never once in the body: a body runs once, so a
  // card captured here would freeze the sheet at the state it opened in, and a
  // body-level `return null` would hide it for the life of the app.
  const c = () => cards().find((x) => x.id === shownId());
  return (
    <Sheet
      open={!!openId()}
      closeOnSwipe
      popupStyle={{
        backgroundColor: theme().panel,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        // The fields sit on the sheet itself, so it rises with the keyboard.
        paddingBottom: "env(keyboard-inset-height)",
      }}
      backdropStyle={{ backgroundColor: theme().scrim }}
      onOpenChange={({ open }) => {
        if (!open) closeDetail();
      }}
    >
      {c() ? <DetailBody id={c()!.id} /> : <View style={{ height: 1 }} />}
    </Sheet>
  );
}

function DetailBody(props: { id: string }) {
  // Captured at mount: this instance edits one card for its whole life, and a
  // closure that read `props` later would touch a torn-down props object when
  // the sheet closes.
  const id = props.id;
  // Tolerant of a card that has gone (removed here or on the Mac) while the
  // sheet is still on screen: a blank card renders for the moment it takes the
  // sheet to close, instead of throwing on `undefined`.
  const c = () =>
    cards().find((x) => x.id === id) ?? {
      id,
      title: "",
      notes: "",
      tags: [] as string[],
      status: "todo" as Status,
      updatedAt: 0,
    };
  const settled = () => c().status === "done" || c().status === "archive";
  return (
    <View style={{ paddingBottom: 10 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 10,
          paddingRight: 18,
          paddingTop: 4,
        }}
      >
        <IconButton name="close" tint={theme().textSecondary} size={44} label="关闭" onPress={closeDetail} />
        <View style={{ flex: 1 }} />
        <Text style={{ ...TYPE.metaPhone, color: theme().textTertiary }}>
          {COLUMNS.find((x) => x.id === c().status)!.label}
        </Text>
      </View>
      {/*
        The title and notes are editable here, on the phone too. They sit
        directly on the sheet, above its controls and outside any scroll view:
        an Input nested in a scroll view has no native field on Android, so a
        real tap could never focus it. On the sheet itself it is the same native
        EditText the capture sheet's title uses. Every keystroke patches the
        card, so there is nothing to save and nothing to lose.
      */}
      <View style={{ paddingHorizontal: 20, paddingTop: 2, gap: 12 }}>
        <Input
          testID="detail-title"
          multiline
          accessibilityLabel="卡片标题"
          value={c().title}
          placeholder="要做什么？"
          onChange={({ value }) => patchCard(id, { title: value })}
          style={{
            fontSize: 20,
            fontWeight: "600",
            lineHeight: 28,
            color: settled() ? theme().textSecondary : theme().text,
            // Grows with the title up to three lines instead of reserving the
            // height of the longest card under every short one.
            height: fieldHeight(c().title, 28, 3, 16),
            padding: 0,
            placeholderColor: theme().textTertiary,
          }}
        />
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 11.5, fontWeight: "600", color: theme().textTertiary }}>备注</Text>
          <Input
            testID="detail-notes"
            multiline
            accessibilityLabel="备注"
            value={c().notes}
            placeholder="补充细节、链接、下一步…"
            onChange={({ value }) => patchCard(id, { notes: value })}
            style={{
              fontSize: 15,
              lineHeight: 22,
              color: theme().text,
              height: fieldHeight(c().notes, 22, 8, 20),
              padding: 0,
              placeholderColor: theme().textTertiary,
            }}
          />
          {/* The links in the note, under the note: rows of the sheet, not part
              of the field, so a press opens the browser instead of moving the
              caret. */}
          <NoteLinks text={c().notes} size="phone" />
          {/* The note's checklist, on the sheet and outside any scroll view: a
              press rewrites one line of the note, so there is nothing to save. */}
          <ChecklistRows
            notes={c().notes}
            size="phone"
            onChange={(next) => patchCard(id, { notes: next })}
          />
        </View>
      </View>
      <View style={{ paddingHorizontal: 20, paddingTop: 10, gap: 14 }}>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {COLUMNS.map((s) => {
            const on = c().status === s.id;
            return (
              <View
                // Not `setStatus`: a sheet is a layer over the board, so an
                // offer made here would be drawn under it — an undo nobody can
                // see or press. These chips are the way back instead, and they
                // are under the finger that would want it. 移到归档 below closes
                // the sheet, so that one does offer.
                onPress={() => patchCard(c().id, { status: s.id })}
                role="button"
                accessibilityLabel={`移到${s.label}`}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  borderRadius: 9,
                  backgroundColor: on ? alpha(theme().accent, 0.15) : theme().chip,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "600", color: on ? onAccentWash() : theme().textSecondary }}>
                  {s.label}
                </Text>
              </View>
            );
          })}
        </View>
        <TagPicker selected={c().tags} onChange={(ids) => patchCard(c().id, { tags: ids })} size="phone" />
        <DueEditor
          due={c().due}
          repeat={c().repeat}
          size="phone"
          settled={settled()}
          // A deadline cleared takes the cycle with it: nothing to repeat from.
          onChange={(iso) => patchCard(c().id, iso ? { due: iso } : { due: undefined, repeat: undefined })}
          onRepeatChange={(next) => patchCard(c().id, { repeat: next })}
        />
        <View style={{ flexDirection: "row", gap: 18, paddingTop: 6 }}>
          <View
            onPress={() => {
              setStatus(c().id, "archive");
              closeDetail();
            }}
            role="button"
            accessibilityLabel="移到归档"
          >
            <Text style={{ fontSize: 14, fontWeight: "500", color: theme().textSecondary }}>移到归档</Text>
          </View>
          {/* The delete offers 撤销 above the capture button rather than asking
              in a dialog: the tombstone keeps the card whole, so one press can
              put it back. */}
          <View
            testID="detail-delete"
            onPress={() => {
              removeWithUndo(c().id);
              closeDetail();
            }}
            role="button"
            accessibilityLabel="删除"
          >
            <Text style={{ fontSize: 14, fontWeight: "500", color: theme().danger }}>删除</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

/**
 * Pairing with the Mac: the six digits from its title bar, and — only for a
 * network that drops broadcasts — its address.
 *
 * The code is the part that matters: without it the Mac will not answer, so the
 * address field is the fallback and sits under the code. A phone pairs once; the
 * digits are kept on the device, and this sheet is reached again only to pair
 * with another Mac or to replace a code that was regenerated.
 */
function LinkSheet() {
  /** Whether the code is whole yet: what makes 配对 worth pressing. */
  const ready = () => canPair(draftCode());

  /** Saves the digits (and the address, if one was typed) and goes. */
  const pair = async () => {
    if (!ready()) return;
    const address = draftAddress().trim();
    if (address) await connectTo(address);
    if (!(await pairWith(draftCode()))) return;
    draftCode.set("");
    linking.set(false);
  };

  return (
    <Sheet
      open={linking()}
      onOpenChange={({ open }) => linking.set(open)}
      closeOnSwipe
      popupStyle={{
        backgroundColor: theme().panel,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingBottom: "env(keyboard-inset-height)",
      }}
      backdropStyle={{ backgroundColor: theme().scrim }}
    >
      <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20, gap: 14 }}>
        <View style={{ alignItems: "center", paddingBottom: 2 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: alpha(theme().textTertiary, 0.45) }} />
        </View>
        <Text style={{ fontSize: 17, fontWeight: "600", color: theme().text }}>连到 Mac</Text>
        <Text style={{ fontSize: 13, lineHeight: 19, color: theme().textSecondary }}>
          在 Mac 标题栏的「配对码」里找到 6 位数字。同一个 Wi-Fi 下会自动找到每一台 Mac，只要对一次。
        </Text>
        <Input
          testID="link-code"
          value={draftCode()}
          placeholder="482 913"
          // The digits' own keyboard: a code is typed with a thumb, and a full
          // keyboard puts letters between the thumb and the six numbers.
          keyboardType="number-pad"
          maxLength={6}
          autoFocus
          onChange={({ value }) => draftCode.set(digits(value))}
          style={{
            fontSize: 22,
            letterSpacing: 3,
            color: theme().text,
            placeholderColor: theme().textTertiary,
            height: 52,
            padding: 0,
          }}
        />
        {/* What the code is doing, if the Mac has already said something: a
            refusal and a lockout are the two things worth knowing here. */}
        <If when={pairLine() !== "" && pairLine() !== "需要配对码"}>
          <Text testID="link-code-note" style={{ fontSize: 12.5, color: theme().textSecondary }}>
            {pairLine()}
          </Text>
        </If>
        <Text style={{ fontSize: 12.5, lineHeight: 18, color: theme().textTertiary }}>
          找不到 Mac 时，才把 Mac 标题栏里的地址填进来。
        </Text>
        <Input
          testID="link-address"
          value={draftAddress()}
          placeholder="192.168.1.5:8787"
          autoCapitalize="none"
          onChange={({ value }) => draftAddress.set(value)}
          style={{
            fontSize: 15,
            color: theme().text,
            placeholderColor: theme().textTertiary,
            height: 44,
            padding: 0,
          }}
        />
        {/* Every Mac this phone is in step with. With one Mac the header's line
            says everything; with two, this is the only place that can say which
            one is behind. */}
        <If when={peers().length > 0}>
          <View style={{ height: 1, backgroundColor: theme().hairline }} />
          <Text style={{ fontSize: 11.5, fontWeight: "600", color: theme().textTertiary, letterSpacing: 0.3 }}>
            设备
          </Text>
          {peers().map((peer) => (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text
                style={{
                  flex: 1,
                  fontSize: 12.5,
                  color: theme().textSecondary,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {peer.addr}
              </Text>
              <Text
                testID={`link-peer-${peer.addr}`}
                style={{
                  fontSize: 12.5,
                  color: peer.ok ? theme().textTertiary : theme().danger,
                }}
              >
                {peerLine(peer)}
              </Text>
            </View>
          ))}
        </If>
        {detail() ? (
          <Text style={{ fontSize: 12.5, color: phase() === "error" ? theme().danger : theme().textTertiary }}>
            {detail()}
          </Text>
        ) : null}
        {/* 48dp of accent when it can fire, the tinted wash when the code is not
            whole yet. `accessibilityState`, not `disabled`: a button that drops
            its whole affordance looks live and is not. */}
        <View
          testID="link-save"
          onPress={() => void pair()}
          role="button"
          accessibilityLabel="配对"
          accessibilityState={{ disabled: !ready() }}
          style={{
            height: 48,
            borderRadius: 12,
            backgroundColor: ready()
              ? theme().accent
              : alpha(theme().accent, theme().dark ? 0.14 : 0.09),
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: "600", color: ready() ? onAccentFill() : onAccentWash() }}>
            配对
          </Text>
        </View>
        {/* The notification permission, and a test that does not need a deadline.
            A greyed system switch is a fact this line can at least name. */}
        <View style={{ height: 1, backgroundColor: theme().hairline }} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 11.5, fontWeight: "600", color: theme().textTertiary, letterSpacing: 0.3 }}>
              通知
            </Text>
            <Text testID="notify-line" style={{ fontSize: 12.5, lineHeight: 18, color: theme().textSecondary }}>
              {notificationLine()}
            </Text>
          </View>
          <View
            testID="notify-test"
            onPress={() => void testNotification()}
            role="button"
            accessibilityLabel="测试通知"
            activeStyle={{ opacity: 0.6 }}
            style={{
              height: 34,
              paddingHorizontal: 12,
              borderRadius: 9,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: theme().chip,
            }}
          >
            <Text style={{ fontSize: 12.5, fontWeight: "600", color: theme().textSecondary }}>测试</Text>
          </View>
        </View>
        {/* OTA: the app's code as a signed package. On Android it runs from the
            next cold start, so the line says that and offers nothing to press;
            the desktop offers 重启. It sits under 配对 because the sheet is
            where a phone's own maintenance lives. */}
        <View style={{ height: 1, backgroundColor: theme().hairline }} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontSize: 11.5, fontWeight: "600", color: theme().textTertiary, letterSpacing: 0.3 }}>
              更新
            </Text>
            <Text
              testID="update-line"
              style={{
                fontSize: 12.5,
                lineHeight: 18,
                color: updateState() === "failed" ? theme().danger : theme().textSecondary,
              }}
            >
              {updateLine()}
            </Text>
          </View>
          <If when={updateActionLabel() !== ""}>
            <View
              testID="update-action"
              onPress={() => void takeUpdateAction()}
              role="button"
              accessibilityLabel={updateActionLabel()}
              accessibilityState={{ disabled: updateState() === "checking" || updateState() === "downloading" }}
              activeStyle={{ opacity: 0.6 }}
              style={{
                height: 34,
                paddingHorizontal: 12,
                borderRadius: 9,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: alpha(theme().accent, theme().dark ? 0.2 : 0.1),
              }}
            >
              <Text style={{ fontSize: 12.5, fontWeight: "600", color: onAccentWash() }}>
                {updateActionLabel()}
              </Text>
            </View>
          </If>
        </View>
        {/* A fresh install opens on fourteen written cards. Once the board is
            the user's own they are noise in every column, and this is where the
            phone can clear them — the same command is in the Mac's palette.
            Only while some are still there: a way to clear nothing is a
            question with no answer. */}
        <If when={sampleCardsLeft().length > 0}>
          <View
            testID="clear-samples"
            onPress={() => void clearSamples()}
            role="button"
            accessibilityLabel="清除示例数据"
            activeStyle={{ opacity: 0.6 }}
            style={{ paddingVertical: 12, alignItems: "center" }}
          >
            <Text style={{ fontSize: 13.5, color: theme().textSecondary }}>
              清除示例数据（{sampleCardsLeft().length} 张）
            </Text>
          </View>
        </If>
      </View>
    </Sheet>
  );
}

/** Whether the search field is out, and whether the tag sheet is up. */
const searchOpen = signal(false);
const filterOpen = signal(false);

/** Puts the field away, and the search with it: a hidden field must not filter. */
function collapseSearch(): void {
  searchOpen.set(false);
  searchQuery.set("");
}

/** What the line over the list names: the tags, the date condition, the words. */
function filterLabel(): string {
  return filterSummary();
}

/** The three date conditions, in the order the sheet lists them. */
const DUE_ORDER: DueCondition[] = ["today", "overdue", "none"];

/**
 * The funnel: every filter, in a sheet.
 *
 * The strip of chips stood over the list at all times, which is a row of the
 * phone's only screen spent on a filter most sessions do not set. The chip is
 * still the control it was, it is just one press away instead of always being
 * open — and the funnel says it is on whenever any of the filters is.
 */
function FilterButton() {
  const on = () => isFiltering();
  return (
    <View
      testID="phone-filter"
      onPress={() => filterOpen.set(true)}
      role="button"
      accessibilityLabel={on() ? `筛选：${filterLabel()}` : "筛选"}
      activeStyle={{ opacity: 0.55 }}
      style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}
    >
      <Icon
        name="filter"
        size={17}
        tint={on() ? onAccentWash() : theme().textSecondary}
        width={1.9}
      />
    </View>
  );
}

/** One line of the filter sheet: a tag, a date condition, with its check. */
function FilterOption(props: {
  testID: string;
  label: string;
  on: boolean;
  color?: string;
  count?: number;
  onPress: () => void;
}) {
  return (
    <View
      testID={props.testID}
      onPress={props.onPress}
      role="button"
      accessibilityLabel={props.label}
      accessibilityState={{ selected: props.on }}
      activeStyle={{ opacity: 0.6 }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        minHeight: 46,
        paddingHorizontal: 6,
        borderRadius: 9,
      }}
    >
      {props.color ? (
        <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: props.color }} />
      ) : (
        <View style={{ width: 7, height: 7 }} />
      )}
      <Text style={{ flex: 1, fontSize: 15, color: theme().text }}>{props.label}</Text>
      {props.count === undefined ? null : (
        <Text
          style={{
            fontSize: 13,
            fontWeight: "500",
            fontVariant: ["tabular-nums"],
            color: props.count === 0 ? alpha(theme().textTertiary, 0.55) : theme().textTertiary,
          }}
        >
          {props.count}
        </Text>
      )}
      {props.on ? <Icon name="check" size={15} tint={theme().accent} width={2.2} /> : null}
    </View>
  );
}

function FilterSheet() {
  // The counts follow the clock, as they do on the Mac: a deadline that is 今天
  // at midnight is counted as today when the sheet is open across it.
  const counts = () => dueCounts(board(), clock());
  return (
    <Sheet
      open={filterOpen()}
      onOpenChange={({ open }) => filterOpen.set(open)}
      closeOnSwipe
      popupStyle={{
        backgroundColor: theme().panel,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingBottom: "env(keyboard-inset-height)",
      }}
      backdropStyle={{ backgroundColor: theme().scrim }}
    >
      <View style={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 24, gap: 2 }}>
        <View style={{ alignItems: "center", paddingBottom: 6 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: alpha(theme().textTertiary, 0.45) }} />
        </View>
        <Text style={{ fontSize: 17, fontWeight: "600", color: theme().text, paddingBottom: 4 }}>筛选</Text>

        {/* Tags are several at once — a thumb picking 工作 and 学习 means either
            — so a press adds or takes away and the sheet stays up for the next. */}
        <FilterOption
          testID="filter-all"
          label="全部标签"
          on={selectedTags().length === 0}
          onPress={clearTagFilters}
        />
        {boardTags().map((tag) => (
          <FilterOption
            testID={`filter-tag-${tag.id}`}
            label={tag.label}
            color={hueColor(tag.hue)}
            on={selectedTags().includes(tag.id)}
            onPress={() => toggleTagFilter(tag.id)}
          />
        ))}

        <View style={{ height: 1, backgroundColor: theme().hairline, marginVertical: 10 }} />

        {/* When it is due: one at a time, and the counts are of the whole board
            — a number that moved as tags were picked would be counting the view. */}
        <FilterOption
          testID="filter-due-all"
          label="全部日期"
          on={dueFilter() === null}
          onPress={() => setDueFilter(null)}
        />
        {DUE_ORDER.map((id) => (
          <FilterOption
            testID={`filter-due-${id}`}
            label={DUE_LABEL[id]}
            count={counts()[id]}
            on={dueFilter() === id}
            onPress={() => setDueFilter(dueFilter() === id ? null : id)}
          />
        ))}

        <View style={{ height: 1, backgroundColor: theme().hairline, marginVertical: 10 }} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TagManagerButton size="phone" />
          <View style={{ flex: 1 }} />
          <View
            testID="filter-clear-all"
            onPress={() => clearFilters()}
            role="button"
            accessibilityLabel="清除全部"
            activeStyle={{ opacity: 0.6 }}
            style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9 }}
          >
            <Text style={{ fontSize: 14, fontWeight: "500", color: theme().textTertiary }}>清除全部</Text>
          </View>
          <View
            testID="filter-done"
            onPress={() => filterOpen.set(false)}
            role="button"
            accessibilityLabel="完成"
            activeStyle={{ opacity: 0.6 }}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 9,
              borderRadius: 9,
              backgroundColor: theme().accentSoft,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: "600", color: onAccentWash() }}>完成</Text>
          </View>
        </View>
      </View>
    </Sheet>
  );
}

/** The pull-to-refresh spinner, up for as long as a pull needs to feel answered. */
const refreshSpinner = signal(false);

/**
 * Pulling a column past its top syncs now.
 *
 * The spinner is the app's own timing, not the network's: the exchange thread
 * answers within a tick, and waiting for that answer would leave a spinner
 * turning because the Mac is asleep. The header's 已同步 line is where the
 * result shows, and it is a line, not a toast.
 */
function pullToSync(): void {
  syncNow();
  refreshSpinner.set(true);
  setTimeout(() => refreshSpinner.set(false), 700);
}

/** 清空归档, at the foot of the archive list — where the cards it clears are. */
function ArchiveClear() {
  return (
    <View
      testID="clear-archive"
      onPress={() => void clearArchive()}
      role="button"
      accessibilityLabel="清空归档"
      activeStyle={{ opacity: 0.6 }}
      style={{ alignItems: "center", paddingVertical: 18 }}
    >
      <Text style={{ fontSize: 13, fontWeight: "500", color: theme().textSecondary }}>清空归档</Text>
    </View>
  );
}

/**
 * The phone: a four-way segmented control over one column, because a portrait
 * screen cannot show four columns. Swiping across the columns beats a tab
 * bar here: the columns are the same board, one screen wide.
 *
 * The head of the screen is deliberately thin. A search field and a strip of tag
 * chips used to stand above the list at all times, which is a hundred points of
 * the only screen the phone has spent on two controls the session mostly does
 * not use: the list is what the phone is for. They are a lens and a funnel in
 * the title bar now, and a line over the list says what they left it showing.
 */
export function PhoneHome() {
  return (
    <View style={{ flex: 1 }} testID="phone-home">
      <View
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingHorizontal: 16,
          paddingBottom: 6,
          gap: 2,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", paddingTop: 8, gap: 2 }}>
          <Text style={{ fontSize: 29, fontWeight: "700", color: theme().text, letterSpacing: -0.4 }}>领航</Text>
          <View style={{ flex: 1 }} />
          <IconButton
            name="search"
            testID="phone-search-toggle"
            tint={searchOpen() ? theme().accent : theme().textSecondary}
            size={36}
            label="搜索"
            onPress={() => {
              if (searchOpen()) {
                collapseSearch();
                return;
              }
              searchOpen.set(true);
            }}
          />
          <FilterButton />
          {/* Date and sync state are one target: the status line alone is only
              a dozen pixels tall, which a fingertip cannot hit. The negative
              margins grow the hit area without moving the text. */}
          <View
            testID="phone-sync"
            onPress={() => {
              draftAddress.set(endpoint());
              draftCode.set(pairCode());
              linking.set(true);
            }}
            role="button"
            accessibilityLabel="同步设置"
            activeStyle={{ opacity: 0.55 }}
            style={{
              alignItems: "flex-end",
              gap: 2,
              paddingVertical: 9,
              paddingLeft: 8,
              paddingRight: 6,
              marginRight: -6,
            }}
          >
            <Text style={{ ...TYPE.metaPhone, color: theme().textTertiary }}>{todayLine()}</Text>
            <Text
              style={{
                fontSize: 11.5,
                fontWeight: "500",
                color: phase() === "error" ? theme().danger : theme().textTertiary,
              }}
            >
              {statusLine()}
            </Text>
          </View>
        </View>
        {/* The field, only while it is wanted. It sits above the pages rather
            than inside a column, so a search is one gesture from any column. */}
        <If when={searchOpen()}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingTop: 8 }}>
            <View style={{ flex: 1 }}>
              <SearchField
                size="phone"
                // The field exists only while it is wanted, so it takes the
                // keyboard as it appears: a lens that opened a field the user
                // then had to tap would be two gestures for one.
                autoFocus
                width={Math.max(120, windowSize().width - 32 - 46)}
              />
            </View>
            <IconButton
              name={searchQuery().trim() ? "close" : "chevron"}
              testID="phone-search-close"
              tint={theme().textSecondary}
              size={38}
              label={searchQuery().trim() ? "清空搜索" : "收起搜索"}
              onPress={() => {
                if (searchQuery().trim()) {
                  searchQuery.set("");
                  return;
                }
                collapseSearch();
              }}
            />
          </View>
        </If>
      </View>
      <View style={{ paddingBottom: 6 }}>
        <Segment />
      </View>

      {/* A deadline that came due while the app is open. With the notification
          permission the phone posts a real system notification instead; this
          line is what the list shows when the permission is denied or the
          platform cannot show one. */}
      <If when={dueNow() !== null}>
        <View
          testID="due-banner"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            marginHorizontal: 16,
            marginBottom: 8,
            paddingLeft: 12,
            paddingRight: 6,
            paddingVertical: 10,
            borderRadius: 11,
            backgroundColor: alpha(theme().warn, theme().dark ? 0.2 : 0.13),
          }}
        >
          <Icon name="calendar" size={15} tint={theme().warn} width={1.9} />
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={{ fontSize: 13.5, fontWeight: "600", color: theme().text }}>
              到时间了
            </Text>
            <Text style={{ fontSize: 12.5, color: theme().textSecondary, numberOfLines: 1 }}>
              {dueNow()!.title}
            </Text>
          </View>
          <View
            onPress={() => {
              const shown = dueNow();
              dismissDue();
              if (shown) openCard(shown.id);
            }}
            role="button"
            accessibilityLabel="打开这张卡"
            activeStyle={{ opacity: 0.6 }}
            style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8 }}
          >
            <Text style={{ fontSize: 12.5, fontWeight: "600", color: theme().warn }}>打开</Text>
          </View>
          <IconButton
            name="close"
            tint={theme().textTertiary}
            size={30}
            label="知道了"
            onPress={dismissDue}
          />
        </View>
      </If>

      {/* What the lens and the funnel left the list showing, and the one press
          that puts the whole board back. A line, not a banner: it is a fact
          about the list under it, in the same tertiary ink as a count. */}
      <If when={isFiltering()}>
        <View
          testID="filter-notice"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingLeft: 16,
            paddingRight: 8,
            paddingBottom: 6,
          }}
        >
          {/* One line, and the line gives rather than the list: several tags and
              a date condition are a long sentence, and 「…」 at the end of it is
              honest where a second row is a banner. */}
          <Text style={{ flexShrink: 1, fontSize: 12.5, color: theme().textTertiary, numberOfLines: 1 }}>
            正在筛选：{filterLabel()}
          </Text>
          <View
            testID="clear-filters"
            onPress={clearFilters}
            role="button"
            accessibilityLabel="清除筛选"
            activeStyle={{ opacity: 0.6 }}
            style={{ width: 30, height: 30, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name="close" size={12} tint={theme().textTertiary} width={2} />
          </View>
        </View>
      </If>

      <Scroll
        ref={(r) => {
          pages = r;
        }}
        horizontal
        pagingEnabled
        scrollbar={false}
        testID="phone-pages"
        style={{ flex: 1 }}
        onScroll={({ offset }) => {
          const page = Math.round(offset.x / Math.max(1, windowSize().width));
          const next = COLUMNS[Math.max(0, Math.min(3, page))];
          if (next && next.id !== active()) active.set(next.id);
        }}
      >
        {COLUMNS.map((c) => (
          <View style={{ width: windowSize().width, height: "100%" }}>
            <View
              style={{
                flex: 1,
                marginHorizontal: 16,
                borderRadius: 14,
                backgroundColor: theme().card,
                boxShadow: theme().shadow,
                overflow: "hidden",
              }}
            >
              <List
                testID={`phone-col-${c.id}`}
                each={filteredBoard().filter((x) => x.status === c.id)}
                estimatedItemSize={96}
                contentStyle={{ paddingBottom: 130 }}
                style={{ flex: 1 }}
                scrollbar={false}
                // Pulling the list past its top is the phone's gesture for "now,
                // not on your next tick": the exchange runs once and the header
                // says when it landed.
                refreshing={refreshSpinner()}
                onRefresh={pullToSync}
                empty={
                  <View style={{ paddingTop: 40, alignItems: "center" }}>
                    <Icon name="inbox" size={26} tint={alpha(theme().textTertiary, 0.65)} />
                    <Text style={{ marginTop: 10, fontSize: 13.5, color: theme().textTertiary }}>
                      {isFiltering() ? "没有匹配的卡片" : "这里还是空的"}
                    </Text>
                    {isFiltering() ? null : (
                      <Text style={{ marginTop: 4, fontSize: 13, color: alpha(theme().textTertiary, 0.85) }}>
                        点右下角的 ＋ 记一笔
                      </Text>
                    )}
                  </View>
                }
                separator={
                  <View style={{ height: 1, backgroundColor: theme().hairline, marginLeft: 47 }} />
                }
                // 归档's way out is at the foot of its own list: emptying the
                // column is a decision made while looking at what is in it.
                footer={
                  c.id === "archive" && filteredBoard().some((x) => x.status === "archive") ? (
                    <ArchiveClear />
                  ) : null
                }
              >
                {(item) => <PhoneRow card={item} />}
              </List>
            </View>
          </View>
        ))}
      </Scroll>

      <View
        style={{
          position: "absolute",
          right: 20,
          bottom: 0,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <View
          testID="fab"
          onPress={() => capturing.set(true)}
          role="button"
          accessibilityLabel="新建卡片"
          activeStyle={{ scale: 0.94, opacity: 0.9 }}
          style={{
            marginBottom: 22,
            width: 56,
            height: 56,
            borderRadius: 28,
            backgroundColor: theme().accent,
            alignItems: "center",
            justifyContent: "center",
            boxShadow: theme().shadowLift,
          }}
        >
          <Icon name="plus" size={26} tint={onAccentFill()} width={2.2} />
        </View>
      </View>

      <CaptureSheet />
      <DetailSheet />
      <LinkSheet />
      <FilterSheet />
      <RowSheet />
    </View>
  );
}
