import {
  Canvas,
  Clipboard,
  Path2D,
  Scroll,
  Text,
  View,
  computed,
  createMotion,
  effect,
  openUrl,
  signal,
  windowSize,
  type CanvasRenderingContext2D,
  type InputRef,
} from "nsh";
import { AlertDialog, Calendar, Dialog, Input, TextView, type CalendarEntry } from "nsh/base";
import { HUES, hueColor, onAccentWash, theme, TYPE } from "./theme";
import {
  addTag,
  dueLabel,
  dismissUndo,
  patchTag,
  removeCard,
  removeSamples,
  removeTag,
  sampleCardsLeft,
  takeUndo,
  undoable,
  tagOf,
  withDueDay,
  withDueTime,
  boardTags,
  type Repeat,
  type Tag,
} from "./data";
import { appendItem, noteSegments, parseChecklist, previewLines, toggleItem, type ChecklistItem } from "./checklist";
import { clock } from "./clock";
import { clearFilters, filteredBoard, searchQuery } from "./filters";
import { nextRepeat, repeatLabel } from "./repeat";
import { linksIn } from "./text";
import {
  dismissUpdate,
  takeUpdateAction,
  updateActionLabel,
  updateCurrent,
  updateDetail,
  updateLine,
  updateState,
  updateVisible,
} from "./updates";

/** `#rrggbb` → `rgba(r, g, b, a)`. */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

type IconName =
  | "plus"
  | "check"
  | "calendar"
  | "tag"
  | "close"
  | "chevron"
  | "archive"
  | "more"
  | "trash"
  | "inbox"
  | "link"
  | "search"
  | "filter"
  | "repeat"
  | "clock";

const PATHS: Record<IconName, string[]> = {
  plus: ["M12 5.5v13", "M5.5 12h13"],
  check: ["M4.5 12.5l5 5 10-11"],
  calendar: ["M4.5 6.5h15v13h-15z", "M8 3.5v5", "M16 3.5v5", "M4.5 11h15"],
  tag: ["M3.5 12.2l8.7-8.7h6.6a1.5 1.5 0 011.5 1.5v6.6l-8.7 8.7-8.1-8.1z"],
  close: ["M6.5 6.5l11 11", "M17.5 6.5l-11 11"],
  chevron: ["M9.5 5.5l6.5 6.5-6.5 6.5"],
  archive: ["M3.5 7.5h17v4h-17z", "M5.5 11.5v8h13v-8", "M9.5 15h5"],
  more: ["M6 12h.01", "M12 12h.01", "M18 12h.01"],
  // A bin: a lid, the handle over it, a body that narrows, and two ribs. The
  // destructive press of the panel's own strip, so it is drawn at the same
  // weight as the arrow and the cross beside it rather than filled.
  trash: ["M4.5 7.5h15", "M9.5 7.5V4.8h5v2.7", "M7 7.5l.9 12h8.2l.9-12", "M10.5 11v5.6", "M13.5 11v5.6"],
  inbox: ["M3.5 13.5h4l1.5 3h6l1.5-3h4", "M3.5 13.5l2.5-8h12l2.5 8v5h-17z"],
  link: ["M10 13.5a4.5 4.5 0 006.4.4l2.6-2.6a4.5 4.5 0 00-6.4-6.4l-1.4 1.4", "M14 10.5a4.5 4.5 0 00-6.4-.4l-2.6 2.6a4.5 4.5 0 006.4 6.4l1.4-1.4"],
  // A lens and its handle, drawn on the same 24-unit grid as the rest.
  search: ["M11 4.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13z", "M15.9 15.9l4.1 4.1"],
  // Three rules narrowing downwards: the board is being narrowed, not sorted.
  filter: ["M4 6.5h16", "M7 12h10", "M10.5 17.5h3"],
  // Two arrows chasing each other round a rounded rectangle: the card comes
  // back. Drawn at the meta row's weight, because it is a fact about the card
  // and not a control.
  repeat: ["M17 4.5l3 3-3 3", "M3.5 11V9.5a2 2 0 012-2h14.5", "M7 19.5l-3-3 3-3", "M20.5 13v1.5a2 2 0 01-2 2H4"],
  // A face and its hands: the due time's own button, so the row says what
  // pressing it changes without a 时间 caption.
  clock: ["M12 3.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17z", "M12 7.5v4.8l3.3 2"],
};

/**
 * Icons drawn on the 24-unit grid and stroked, so stroke weight and joins stay
 * consistent: no glyphs or emoji standing in for an icon set. A `h.01` path is
 * a dot, drawn as a filled circle the way the icon set draws one.
 */
export function Icon(props: { name: IconName; size?: number; tint: string; width?: number; dot?: number }) {
  const size = props.size ?? 16;
  const weight = props.width ?? 1.7;
  const dot = props.dot ?? 1.5;
  return (
    <Canvas
      style={{ width: size, height: size }}
      draw={(cx: CanvasRenderingContext2D) => {
        cx.strokeStyle = props.tint;
        cx.fillStyle = props.tint;
        cx.lineWidth = weight;
        cx.lineCap = "round";
        cx.lineJoin = "round";
        cx.scale(size / 24, size / 24);
        for (const d of PATHS[props.name]) {
          if (d.endsWith("h.01")) {
            const x = Number(d.slice(1, d.indexOf(" ")));
            const y = Number(d.slice(d.indexOf(" ") + 1, -4));
            cx.beginPath();
            cx.arc(x, y, dot, 0, Math.PI * 2);
            cx.fill();
          } else {
            cx.beginPath();
            cx.stroke(new Path2D(d));
          }
        }
      }}
    />
  );
}

/**
 * One tag: a coloured dot and its name, no chip. A pill behind every tag would
 * turn a quiet list row into a row of buttons; the dot carries the colour and
 * the word carries the meaning.
 */
export function TagChip(props: { id: string; size?: "mac" | "phone" }) {
  const tree = computed(() => {
    const tag = tagOf(props.id);
    const color = hueColor(tag.hue);
    const phone = props.size === "phone";
    const dot = phone ? 6.5 : 6;
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color }} />
        <Text
          style={{
            fontSize: phone ? TYPE.metaPhone.fontSize : TYPE.meta.fontSize,
            fontWeight: "500",
            color,
            letterSpacing: 0.05,
          }}
        >
          {tag.label}
        </Text>
      </View>
    );
  });
  return <>{tree()}</>;
}

export function TagRow(props: { ids: string[]; size?: "mac" | "phone" }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {props.ids.map((id) => (
        <TagChip id={id} size={props.size} />
      ))}
    </View>
  );
}

/**
 * A due time. Today and overdue get a tinted pill because those are the two
 * states that ask something of you; everything else is plain secondary text.
 */
export function DueBadge(props: { iso: string; size?: "mac" | "phone"; settled?: boolean }) {
  const tree = computed(() => {
    // The clock is read here so the day word and the tone follow it: a deadline
    // that read 明天 when it was written reads 今天 at midnight, and the amber
    // pill turns red at its hour, with nobody typing on the board.
    clock();
    const t = theme();
    const label = dueLabel(props.iso);
    // A finished card is not late: its time is history, so it reads as one.
    const text = props.settled ? label.text.replace("已逾期 · ", "") : label.text;
    const tone = props.settled ? "normal" : label.tone;
    const color = tone === "late" ? t.danger : tone === "soon" ? t.warn : t.textTertiary;
    const fill = tone === "late" ? t.dangerSoft : tone === "soon" ? t.warnSoft : "transparent";
    const phone = props.size === "phone";
    const padded = tone !== "normal";
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 4.5,
          paddingHorizontal: padded ? (phone ? 7 : 6) : 0,
          paddingVertical: padded ? (phone ? 2.5 : 2) : 0,
          borderRadius: 5,
          backgroundColor: fill,
        }}
      >
        <Icon name="calendar" size={phone ? 12.5 : 11.5} tint={color} width={1.8} />
        <Text
          style={{
            fontSize: phone ? TYPE.metaPhone.fontSize : TYPE.meta.fontSize,
            fontWeight: "500",
            color,
            letterSpacing: 0.05,
            fontVariant: ["tabular-nums"],
          }}
        >
          {text}
        </Text>
      </View>
    );
  });
  return <>{tree()}</>;
}

/**
 * The links in a note, as rows under it.
 *
 * The note itself stays the text the user typed — a link drawn inside a field
 * could not be pressed, and a link the app marked up would be the app editing
 * prose. So the field keeps the words and these rows carry the way out: one
 * line each, truncated, opening in the system's browser. A row is paper pressed
 * into the sheet on hover, and carries no colour of its own: the board's three
 * colour jobs do not include "this is a link", and a board of blue links is a
 * web page.
 */
export function NoteLinks(props: { text: string; size?: "mac" | "phone" }) {
  // The rows are built where they are drawn, from the note's own text, rather
  // than in a `computed` of their own: a subtree computed for a panel that is
  // closed is one nothing ever mounted, and this engine frees such a tree twice
  // when the app goes away.
  return (
    <If when={linksIn(props.text).length > 0}>
      <View style={{ gap: 1, marginTop: -2 }}>
        <Each of={linksIn(props.text)} key={(url) => url}>
          {(url) => <NoteLink url={url} size={props.size} />}
        </Each>
      </View>
    </If>
  );
}

/** One link of a note: a glyph, the URL on one line, and a press that opens it. */
function NoteLink(props: { url: () => string; size?: "mac" | "phone" }) {
  const phone = props.size === "phone";
  return (
    <View
      testID="note-link"
      onPress={() => openLink(props.url())}
      role="link"
      accessibilityLabel={`打开链接 ${props.url()}`}
      hoverStyle={{ backgroundColor: theme().chip }}
      activeStyle={{ opacity: 0.6 }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: phone ? 34 : 24,
        paddingHorizontal: phone ? 2 : 4,
        borderRadius: 6,
      }}
    >
      <Icon name="link" size={phone ? 12.5 : 11.5} tint={theme().textTertiary} width={1.8} />
      <Text
        style={{
          flexShrink: 1,
          fontSize: phone ? 13 : 12,
          fontWeight: "500",
          color: theme().textSecondary,
          numberOfLines: 1,
        }}
      >
        {props.url()}
      </Text>
    </View>
  );
}

/**
 * Opens a note's link where the platform opens links.
 *
 * A browser is outside the app, so the URL goes through `openUrl` rather than
 * an in-app view: the point of a link on a card is to carry the reader out of
 * the board. The clipboard is the fallback when nothing handles it — a press
 * that silently does nothing is worse than a press that leaves the address
 * where the user can paste it.
 */
function openLink(url: string): void {
  void openUrl(url).catch(() => Clipboard.writeText(url).catch(() => {}));
}

/** An icon-only button: 28 on the Mac, 44 where a finger is the input. */
export function IconButton(props: {
  name: IconName;
  tint: string;
  size?: number;
  onPress: () => void;
  label: string;
  background?: string;
  testID?: string;
}) {
  const tree = computed(() => {
    const size = props.size ?? 28;
    return (
      <View
        testID={props.testID}
        onPress={props.onPress}
        role="button"
        accessibilityLabel={props.label}
        hitSlop={size < 40 ? 8 : 0}
        activeStyle={{ opacity: 0.55 }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: props.background ?? "transparent",
        }}
      >
        <Icon name={props.name} size={Math.round(size * 0.55)} tint={props.tint} />
      </View>
    );
  });
  return <>{tree()}</>;
}

export function TagPicker(props: {
  selected: string[];
  onChange: (ids: string[]) => void;
  size?: "mac" | "phone";
}) {
  const tree = computed(() => {
    const t = theme();
    const selected = props.selected;
    const phone = props.size === "phone";
    // The picker lists the user's tags, so a tag made a moment ago is on the
    // card without anything having to be re-mounted.
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: phone ? 8 : 6 }}>
        {boardTags().map((tag) => {
          const on = selected.includes(tag.id);
          const color = hueColor(tag.hue);
          return (
            <View
              testID={`tag-option-${tag.id}`}
              onPress={() =>
                props.onChange(on ? selected.filter((x) => x !== tag.id) : [...selected, tag.id])
              }
              role="button"
              accessibilityLabel={`标签 ${tag.label}`}
              accessibilityState={{ selected: on }}
              activeStyle={{ opacity: 0.6 }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                paddingHorizontal: phone ? 12 : 9,
                paddingVertical: phone ? 8 : 5,
                borderRadius: 999,
                minHeight: phone ? 36 : 0,
                backgroundColor: on ? alpha(color, t.dark ? 0.26 : 0.12) : t.chip,
                borderWidth: 1,
                borderColor: on ? alpha(color, 0.42) : "transparent",
              }}
            >
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
              <Text
                style={{
                  fontSize: phone ? 13 : 11.5,
                  fontWeight: "600",
                  color: on ? color : t.textSecondary,
                }}
              >
                {tag.label}
              </Text>
            </View>
          );
        })}
        <TagManagerButton size={props.size} />
      </View>
    );
  });
  return <>{tree()}</>;
}

/**
 * The board's search field. The placeholder takes the theme's tertiary ink:
 * an input's placeholder has no colour of its own, so without this it falls
 * back to black and disappears on the dark sheet.
 */
export function SearchField(props: { size?: "mac" | "phone"; width: number; autoFocus?: boolean }) {
  const phone = props.size === "phone";
  return (
    <Input
      testID={phone ? "phone-search" : "board-search"}
      // Only when asked: the field is on the board from the start on the Mac,
      // and a field that takes the keyboard as the window opens would put every
      // keystroke meant for the card in the search box.
      autoFocus={props.autoFocus ?? false}
      ref={(r) => {
        searchInput = r;
      }}
      // Escape and Cmd+F act differently while the field is being typed in, and
      // only the field knows: the caret is the platform's, not a signal's.
      onFocus={() => searchFocused.set(true)}
      onBlur={() => searchFocused.set(false)}
      value={searchQuery()}
      placeholder={phone ? "搜索标题、备注或标签" : "搜索"}
      accessibilityLabel="搜索卡片"
      onChange={({ value }) => searchQuery.set(value)}
      style={{
        width: props.width,
        height: phone ? 38 : 27,
        borderRadius: phone ? 9 : 7,
        paddingHorizontal: phone ? 12 : 9,
        backgroundColor: theme().chip,
        fontSize: phone ? 14 : 12.5,
        color: theme().text,
        placeholderColor: theme().textTertiary,
      }}
    />
  );
}

/** The search field's native view, once it exists: `Cmd+F` focuses it. */
let searchInput: InputRef | null = null;

/** Whether the search field holds the keyboard, which Escape and Cmd+F read. */
export const searchFocused = signal(false);

export function focusSearch(): void {
  searchInput?.focus();
}

export function blurSearch(): void {
  searchInput?.blur();
  searchFocused.set(false);
}

/**
 * The way out of every filter at once: the tags, the date condition and the
 * search, so the board is one press from whole.
 */
export function ClearFilterButton(props: { size?: "mac" | "phone" }) {
  const phone = props.size === "phone";
  return (
    <View
      testID="clear-filters"
      onPress={clearFilters}
      role="button"
      accessibilityLabel="清除筛选"
      activeStyle={{ opacity: 0.6 }}
      style={{
        height: phone ? 30 : 24,
        paddingHorizontal: phone ? 10 : 8,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontSize: phone ? 12.5 : 11.5,
          fontWeight: "500",
          color: theme().textTertiary,
        }}
      >
        清除
      </Text>
    </View>
  );
}

/**
 * The deadline's time, as a button.
 *
 * It used to be a `TimeField`: a row of segments that asks for a selection and
 * a keyboard, which is a hard target on a phone and a slow one on a Mac. A
 * press opens the app's own picker — two grids, hours and five-minute minutes
 * — and the time stays one word on the row.
 */
function TimeChip(props: { time: string; phone?: boolean; testID?: string; onPress: () => void }) {
  const phone = props.phone ?? false;
  return (
    <View
      testID={props.testID ?? "due-time"}
      onPress={props.onPress}
      role="button"
      accessibilityLabel={`截止时间 ${props.time}`}
      activeStyle={{ opacity: 0.65 }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        height: phone ? 34 : 26,
        paddingHorizontal: phone ? 10 : 8,
        borderRadius: phone ? 9 : 6,
        backgroundColor: theme().chip,
      }}
    >
      <Icon name="clock" size={phone ? 13 : 11.5} tint={theme().textTertiary} width={1.8} />
      <Text
        style={{
          fontSize: phone ? 14 : 12.5,
          fontWeight: "500",
          color: theme().text,
          fontVariant: ["tabular-nums"],
        }}
      >
        {props.time}
      </Text>
    </View>
  );
}

/**
 * The card's deadline. The three chips set a day and leave the time alone —
 * pressing 明天 on a 14:30 deadline means tomorrow at 14:30 — the field beside
 * them sets that time, and the calendar sets any day at all, with a time row of
 * its own when the day is not one of the three.
 */
export function DueEditor(props: {
  due: string | undefined;
  /** The cycle the card repeats on. Shown only where a deadline exists: a card
   *  with no deadline has nothing to repeat from. */
  repeat?: Repeat;
  size?: "mac" | "phone";
  settled?: boolean;
  /**
   * The panel's meta strip: one line, no caption, no pill standing above the
   * controls. The due *is* the button that opens the month — it carries the tone
   * (amber today, red late, plain ink for later) and the way to any other day —
   * and the three shortcuts, the hour and 清除 follow it on the same line. It
   * wraps only in a panel too narrow to hold the line, which is a 300-point
   * window and not a Mac.
   */
  compact?: boolean;
  onChange: (iso: string | undefined) => void;
  onRepeatChange?: (repeat: Repeat | undefined) => void;
}) {
  const tree = computed(() => {
    // The day word and the tone are read off the clock, so the deadline editor
    // says 今天 where it said 明天 last night — the same reading the card does.
    clock();
    const t = theme();
    const phone = props.size === "phone";
    const due = props.due;
    const time = due && due.length >= 16 ? due.slice(11, 16) : "18:00";
    if (props.compact) {
      // The due, read the way the board reads it: today is amber, late is red,
      // anything later is tertiary ink, and a finished card's time is history
      // and takes no tone at all.
      const label = due ? dueLabel(due) : null;
      const text = label ? (props.settled ? label.text.replace("已逾期 · ", "") : label.text) : "";
      const tone = props.settled ? "normal" : (label?.tone ?? "normal");
      const toneColor = tone === "late" ? t.danger : tone === "soon" ? t.warn : t.textTertiary;
      return (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <View
            testID="due-calendar"
            onPress={() => openDueCalendar(due, props.onChange)}
            role="button"
            accessibilityLabel={due ? `截止日期 ${dayLabel(due)}` : "选择截止日期"}
            activeStyle={{ opacity: 0.65 }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              height: 24,
              paddingHorizontal: 8,
              borderRadius: 5,
              backgroundColor: due
                ? tone === "late"
                  ? t.dangerSoft
                  : tone === "soon"
                    ? t.warnSoft
                    : t.chip
                : t.chip,
            }}
          >
            <Icon name="calendar" size={11.5} tint={due ? toneColor : t.textSecondary} width={1.8} />
            <Text
              style={{
                fontSize: 12,
                fontWeight: "500",
                color: due ? toneColor : t.textSecondary,
                fontVariant: ["tabular-nums"],
              }}
            >
              {due ? text : "选择日期"}
            </Text>
          </View>
          {[
            { label: "今天", offset: 0, hour: 18 },
            { label: "明天", offset: 1, hour: 9 },
            { label: "下周", offset: 7, hour: 9 },
          ].map((q) => {
            const on = !!due && due.slice(0, 10) === isoDay(q.offset) && !props.settled;
            return (
              <View
                testID={`due-${q.offset}`}
                onPress={() => props.onChange(withDueDay(due, q.offset, q.hour))}
                role="button"
                accessibilityLabel={`截止 ${q.label}`}
                accessibilityState={{ selected: on }}
                activeStyle={{ opacity: 0.6 }}
                style={{
                  height: 24,
                  paddingHorizontal: 8,
                  borderRadius: 6,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: on ? alpha(t.accent, t.dark ? 0.22 : 0.11) : t.chip,
                }}
              >
                <Text style={{ fontSize: 11.5, fontWeight: "500", color: on ? onAccentWash() : t.textSecondary }}>
                  {q.label}
                </Text>
              </View>
            );
          })}
          <TimeChip
            time={time}
            onPress={() => openDueTime(time, (value) => props.onChange(withDueTime(due, value)))}
          />
          {due ? (
            <View
              testID="due-clear"
              onPress={() => props.onChange(undefined)}
              role="button"
              accessibilityLabel="清除截止时间"
              activeStyle={{ opacity: 0.6 }}
              style={{ height: 24, paddingHorizontal: 5, justifyContent: "center" }}
            >
              <Text style={{ fontSize: 11.5, fontWeight: "500", color: t.danger }}>清除</Text>
            </View>
          ) : null}
          {/* The cycle, beside 清除, and only while there is a deadline to
              repeat: five states a press walks, the way a tag's hue does. */}
          {due ? <RepeatChip repeat={props.repeat} onChange={props.onRepeatChange} /> : null}
        </View>
      );
    }
    return (
      <View style={{ gap: 9, alignItems: "flex-start" }}>
        {due ? (
          <DueBadge iso={due} size={props.size} settled={props.settled} />
        ) : (
          <Text style={{ ...(phone ? TYPE.metaPhone : TYPE.meta), color: t.textTertiary }}>没有截止时间</Text>
        )}
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {[
            { label: "今天", offset: 0, hour: 18 },
            { label: "明天", offset: 1, hour: 9 },
            { label: "下周", offset: 7, hour: 9 },
          ].map((q) => {
            const on = !!due && due.slice(0, 10) === isoDay(q.offset) && !props.settled;
            return (
              <View
                testID={`due-${q.offset}`}
                onPress={() => props.onChange(withDueDay(due, q.offset, q.hour))}
                role="button"
                accessibilityLabel={`截止 ${q.label}`}
                accessibilityState={{ selected: on }}
                activeStyle={{ opacity: 0.6 }}
                style={{
                  paddingHorizontal: phone ? 14 : 9,
                  paddingVertical: phone ? 9 : 5,
                  borderRadius: phone ? 9 : 6,
                  backgroundColor: on ? alpha(t.accent, t.dark ? 0.22 : 0.11) : t.chip,
                }}
              >
                <Text
                  style={{
                    fontSize: phone ? 13 : 11.5,
                    fontWeight: "500",
                    color: on ? onAccentWash() : t.textSecondary,
                  }}
                >
                  {q.label}
                </Text>
              </View>
            );
          })}
          {due ? (
            <View
              testID="due-clear"
              onPress={() => props.onChange(undefined)}
              role="button"
              accessibilityLabel="清除截止时间"
              activeStyle={{ opacity: 0.6 }}
              style={{ paddingHorizontal: phone ? 12 : 8, paddingVertical: phone ? 9 : 5 }}
            >
              <Text style={{ fontSize: phone ? 13 : 11.5, fontWeight: "500", color: t.danger }}>清除</Text>
            </View>
          ) : null}
          {due ? <RepeatChip repeat={props.repeat} onChange={props.onRepeatChange} phone={phone} /> : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Text style={{ fontSize: phone ? 12.5 : 11.5, fontWeight: "500", color: t.textTertiary }}>时间</Text>
          <TimeChip
            time={time}
            phone={phone}
            onPress={() => openDueTime(time, (value) => props.onChange(withDueTime(due, value)))}
          />
          {/* Any day, not only the three above: this opens a month on a dialog
              the app owns. `DatePicker` would do the same thing, but its popup
              draws as a transparent layer here — the card underneath shows
              through the days — and a calendar one cannot read is worse than
              one more component. */}
          <View
            testID="due-calendar"
            onPress={() => openDueCalendar(due, props.onChange)}
            role="button"
            accessibilityLabel={due ? `截止日期 ${dayLabel(due)}` : "选择截止日期"}
            activeStyle={{ opacity: 0.6 }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              height: phone ? 34 : 26,
              paddingHorizontal: phone ? 11 : 8,
              borderRadius: phone ? 9 : 6,
              backgroundColor: t.chip,
            }}
          >
            <Icon name="calendar" size={phone ? 13 : 11.5} tint={t.textTertiary} width={1.8} />
            <Text style={{ fontSize: phone ? 13 : 11.5, fontWeight: "500", color: t.textSecondary }}>
              {due ? dayLabel(due) : "选择日期"}
            </Text>
          </View>
        </View>
      </View>
    );
  });
  return <>{tree()}</>;
}

/**
 * The card's cycle, as one chip that walks 不重复 → 每天 → 每周 → 每月 → 每年.
 *
 * A press is the whole control. Five states is a count a press can walk through
 * — the same argument the tag hues are decided on — and a menu for it would be a
 * second surface for a decision one press answers. Only shown where there is a
 * deadline: a card with nothing to repeat from has no cycle.
 */
function RepeatChip(props: { repeat?: Repeat; onChange?: (repeat: Repeat | undefined) => void; phone?: boolean }) {
  const tree = computed(() => {
    const t = theme();
    const phone = props.phone;
    const on = !!props.repeat;
    return (
      <View
        testID="due-repeat"
        onPress={() => props.onChange?.(nextRepeat(props.repeat))}
        role="button"
        accessibilityLabel={`重复：${repeatLabel(props.repeat)}`}
        accessibilityState={{ selected: on }}
        activeStyle={{ opacity: 0.6 }}
        style={{
          height: phone ? 34 : 24,
          paddingHorizontal: phone ? 12 : 8,
          borderRadius: phone ? 9 : 6,
          alignItems: "center",
          justifyContent: "center",
          // The accent wash of a selected chip, never a new colour.
          backgroundColor: on ? alpha(t.accent, t.dark ? 0.22 : 0.11) : t.chip,
        }}
      >
        <Text
          style={{
            fontSize: phone ? 13 : 11.5,
            fontWeight: "500",
            color: on ? onAccentWash() : t.textSecondary,
          }}
        >
          {repeatLabel(props.repeat)}
        </Text>
      </View>
    );
  });
  return <>{tree()}</>;
}

/**
 * A note's checklist, as rows under the note.
 *
 * The items are the note's own lines — `- [ ] 事项` — so nothing here is a
 * field: a press rewrites one line of the same text the person typed, and the
 * note, the merge and the export carry it without knowing about checklists.
 *
 * Six rows are shown. A card with more than that says how many are left and
 * where to go: a note of thirty items is a note to read, not a list to tick from
 * the card's panel. The Mac's panel reads the whole note instead (`NoteView`):
 * there the rows are the note, not a strip under a field.
 */
export function ChecklistRows(props: {
  notes: string;
  size?: "mac" | "phone";
  onChange: (notes: string) => void;
}) {
  const phone = props.size === "phone";
  const list = () => parseChecklist(props.notes);
  return (
    <If when={list().total > 0}>
      <View testID="checklist" style={{ flexDirection: "row", alignItems: "flex-start", gap: 4 }}>
        <View style={{ flex: 1, gap: phone ? 2 : 1 }}>
          <Each of={list().items.slice(0, 6)} key={(item) => String(item.line)}>
            {(item) => (
              <ChecklistRow
                item={item}
                size={phone ? "phone" : "mac"}
                onPress={() => props.onChange(toggleItem(props.notes, item().line))}
              />
            )}
          </Each>
          <If when={list().total > 6}>
            <Text
              style={{
                fontSize: phone ? 12.5 : 11.5,
                fontWeight: "500",
                color: theme().textTertiary,
                marginTop: phone ? 4 : 3,
              }}
            >
              {`还有 ${list().total - 6} 项，在备注里编辑`}
            </Text>
          </If>
        </View>
        <IconButton
          testID="checklist-add"
          name="plus"
          tint={theme().textTertiary}
          size={phone ? 30 : 22}
          label="添加清单项"
          onPress={() => props.onChange(appendItem(props.notes))}
        />
      </View>
    </If>
  );
}

/** One line of a checklist: a box, the item's words, and the press that flips
 *  it. A ticked item drops to tertiary ink — no green, which the board keeps for
 *  a finished card.
 *
 *  `panel` is the note read in a card's panel: a step larger than the board's
 *  card, because there it is the note itself rather than a strip under it. */
export function ChecklistRow(props: {
  item: () => ChecklistItem;
  size?: "mac" | "phone" | "panel";
  onPress: () => void;
}) {
  const done = () => props.item().done;
  const phone = () => props.size === "phone";
  const panel = () => props.size === "panel";
  return (
    <View
      testID={`checklist-toggle-${props.item().line}`}
      onPress={props.onPress}
      role="checkbox"
      accessibilityLabel={props.item().text || "清单项"}
      accessibilityState={{ checked: done() }}
      activeStyle={{ opacity: 0.55 }}
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: panel() ? 9 : 8,
        minHeight: phone() ? 30 : 22,
        paddingRight: 2,
      }}
    >
      <View
        style={{
          width: phone() ? 17 : panel() ? 15 : 14,
          height: phone() ? 17 : panel() ? 15 : 14,
          marginTop: phone() ? 6 : panel() ? 2.5 : 3.5,
          borderRadius: 4,
          borderWidth: 1.4,
          // Solid tertiary ink, not a translucent one: a 1.4-point stroke of it
          // blended back into the panel lands at 3.8:1, under what a control's
          // edge is allowed, and solid is 5.1:1 on the light panel and 5.8:1 on
          // the dark one.
          borderColor: theme().textTertiary,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {done() ? <Icon name="check" size={phone() ? 11 : 9} tint={theme().textTertiary} width={2.4} /> : null}
      </View>
      <Text
        style={{
          flex: 1,
          fontSize: phone() ? 14 : panel() ? 13 : 12.5,
          lineHeight: phone() ? 21 : panel() ? 20.5 : 19,
          color: done() ? theme().textTertiary : theme().text,
          numberOfLines: panel() ? 0 : 2,
        }}
      >
        {props.item().text}
      </Text>
    </View>
  );
}

/**
 * How much of a note's checklist is ticked, as one quiet pair of numbers.
 *
 * It sits in a card's meta row beside the tags and the deadline, in tertiary ink
 * and tabular figures: the count changes without the row moving, and it says a
 * fact rather than asking for a press.
 */
export function ChecklistProgress(props: { notes: string; size?: "mac" | "phone" }) {
  const phone = props.size === "phone";
  const list = () => parseChecklist(props.notes);
  return (
    <If when={list().total > 0}>
      <View testID="checklist-progress" style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Icon name="check" size={phone ? 12 : 11} tint={theme().textTertiary} width={2} />
        <Text
          style={{
            fontSize: phone ? 12.5 : 12,
            fontWeight: "500",
            letterSpacing: 0.1,
            color: theme().textTertiary,
            fontVariant: ["tabular-nums"],
          }}
        >
          {`${list().done}/${list().total}`}
        </Text>
      </View>
    </If>
  );
}

/**
 * The note as a surface shows it once there is nothing to type: prose drawn as
 * Markdown, and each checklist line a row with its box.
 *
 * The note is still one string, written the way it always was. What changes is
 * which of its two readings a surface shows: an editor showing `- [ ]` above a
 * row that says the same thing twice is the same note told twice. So a note is
 * *read* here — one box per line, links drawn as links — and pressing it is the
 * way into the field that keeps the source.
 *
 * `onEdit` is the press on the prose (a checklist row keeps its own press: that
 * one ticks the line); `onChange` is a tick or the ＋, both writes to the same
 * text, so nothing here is a second copy of the note.
 */
export function NoteView(props: {
  notes: string;
  size?: "mac" | "phone";
  onChange: (notes: string) => void;
  onEdit: () => void;
  /** A cap for a sheet that has other things under the note (the phone). */
  maxHeight?: number;
}) {
  const phone = () => props.size === "phone";
  const segments = () => noteSegments(props.notes);
  const hasItems = () => segments().some((segment) => segment.kind === "item");
  return (
    <Scroll
      testID="note-view"
      scrollbar={false}
      style={props.maxHeight ? { maxHeight: props.maxHeight } : { flex: 1 }}
      contentStyle={{ gap: phone() ? 7 : 6, paddingRight: 2, paddingBottom: 2 }}
    >
      {/* An empty note has nothing to read, so the placeholder is the thing to
          press: the panel keeps its one way in whatever the card holds. */}
      <If when={!props.notes.trim()}>
        <View
          testID="note-empty"
          onPress={props.onEdit}
          role="button"
          accessibilityLabel="写备注"
          style={{ minHeight: 24, justifyContent: "center" }}
        >
          <Text
            style={{
              fontSize: phone() ? 14 : 13,
              lineHeight: phone() ? 21 : 20.5,
              color: theme().textTertiary,
            }}
          >
            补充细节、链接、下一步…
          </Text>
        </View>
      </If>
      <Each of={segments()} key={(segment) => `${segment.kind}-${segment.at}`}>
        {(segment) => (
          <View>
            <If when={segment().kind === "prose"}>
              <View
                onPress={props.onEdit}
                role="button"
                accessibilityLabel="编辑备注"
                hoverStyle={{ opacity: 0.85 }}
                activeStyle={{ opacity: 0.7 }}
              >
                <MarkdownBlock text={segment().text} size={props.size} />
              </View>
            </If>
            <If when={segment().kind === "item"}>
              <ChecklistRow
                item={() => segment().item ?? { line: segment().at, text: segment().text, done: false }}
                size={phone() ? "phone" : "panel"}
                onPress={() => props.onChange(toggleItem(props.notes, segment().at))}
              />
            </If>
          </View>
        )}
      </Each>
      {/* One more item, appended and opened for typing: a ＋ whose item has no
          words yet would be a row nobody can see. */}
      <If when={hasItems()}>
        <View
          testID="checklist-add"
          onPress={() => {
            props.onChange(appendItem(props.notes));
            props.onEdit();
          }}
          role="button"
          accessibilityLabel="添加清单项"
          hitSlop={6}
          activeStyle={{ opacity: 0.55 }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            alignSelf: "flex-start",
            minHeight: phone() ? 30 : 24,
            paddingRight: 6,
          }}
        >
          <Icon name="plus" size={phone() ? 15 : 13} tint={theme().textTertiary} width={1.9} />
          <Text style={{ fontSize: phone() ? 13 : 12, fontWeight: "500", color: theme().textTertiary }}>
            再加一项
          </Text>
        </View>
      </If>
      {/* The blank space under the words is a way in, as it is in any notes app:
          on a short note it is the largest thing in the panel, and it should not
          be the one thing that does nothing. */}
      <View
        testID="note-edit"
        onPress={props.onEdit}
        role="button"
        accessibilityLabel="编辑备注"
        style={{ minHeight: phone() ? 36 : 30 }}
      />
    </Scroll>
  );
}

/**
 * A run of a note's prose, drawn as Markdown.
 *
 * `TextView` reads it in Rust and draws it with native texts, so bold, a
 * heading, a quote and a list are the ones the user typed rather than raw
 * syntax. A link takes the reader's ink and an underline instead of the accent:
 * the accent is spent on what the user presses, and a note full of blue would
 * be a web page in the middle of the board.
 */
function MarkdownBlock(props: { text: string; size?: "mac" | "phone" }) {
  const phone = () => props.size === "phone";
  return (
    <TextView
      markdown={props.text}
      // A link is pressed where it is drawn, as a link in a page is: the note
      // is read here, so nothing has to be listed under it to be pressable.
      onLinkPress={({ url }) => openLink(url)}
      style={{ gap: 6 }}
      styles={{
        root: {
          fontSize: phone() ? 14 : 13,
          lineHeight: phone() ? 21 : 20.5,
          color: theme().text,
        },
        link: { color: theme().textSecondary, textDecorationLine: "underline" },
      }}
    />
  );
}

/**
 * A note as a card or a phone row previews it: two lines on the Mac, one on the
 * phone, with a checklist's boxes drawn as boxes.
 *
 * The old preview took the markers off and kept the words, which read as a list
 * of sentences. A row with a box is the same two lines and says what the note
 * is: work to tick, not prose. It stays a glance — no row is taller than a line
 * of the body — so the card's measure does not change.
 */
export function NotePreview(props: { notes: string; size?: "mac" | "phone"; lines?: number }) {
  const phone = () => props.size === "phone";
  const lines = () => previewLines(props.notes, props.lines ?? 2);
  return (
    <If when={lines().length > 0}>
      <View style={{ gap: 1 }}>
        <Each of={lines()} key={(line) => String(line.at)}>
          {(line) => (
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: phone() ? 6 : 5 }}>
              <If when={line().done !== null}>
                <View
                  style={{
                    width: phone() ? 12 : 11,
                    height: phone() ? 12 : 11,
                    marginTop: phone() ? 3.5 : 3.6,
                    borderRadius: 3,
                    borderWidth: 1.2,
                    borderColor: theme().textTertiary,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <If when={line().done === true}>
                    <Icon name="check" size={phone() ? 8 : 7} tint={theme().textTertiary} width={2.2} />
                  </If>
                </View>
              </If>
              <Text
                style={{
                  flex: 1,
                  fontSize: phone() ? 13 : 12.5,
                  lineHeight: phone() ? 19 : 18.5,
                  color: line().done ? theme().textTertiary : theme().textSecondary,
                  numberOfLines: 1,
                }}
              >
                {line().text}
              </Text>
            </View>
          )}
        </Each>
      </View>
    </If>
  );
}

/** The day the calendar is choosing for, or `null` while it is closed. */
export const pickingDue = signal<string | null>(null);

/**
 * The month a deadline is picked from.
 *
 * The day and the time are chosen together: the calendar carries the hour on
 * its own strip, so a date is one decision and not a date followed by a hunt for
 * the field that sets when. A picked day keeps the time the card already had.
 */
export function DueCalendar() {
  return (
    <Dialog
      testID="due-calendar-dialog"
      open={pickingDue() !== null}
      animation="fade"
      onOpenChange={({ open }) => {
        if (!open) pickingDue.set(null);
      }}
      backdropStyle={{ backgroundColor: theme().scrim }}
      style={{
        margin: "auto",
        width: 320,
        borderRadius: 16,
        backgroundColor: theme().panel,
        padding: 14,
        gap: 10,
        boxShadow: theme().shadowLift,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: theme().text }}>截止日期</Text>
        <View style={{ flex: 1 }} />
        <IconButton
          name="close"
          tint={theme().textSecondary}
          size={28}
          label="关闭"
          onPress={() => pickingDue.set(null)}
        />
      </View>
      {/* A Calendar is element-sized rather than laid out: it needs a width of
          its own, and its own fill, or it draws over whatever is behind it. */}
      <View style={{ backgroundColor: theme().card, borderRadius: 10 }}>
        <Calendar
          // The calendar picks a day; the hour lives on the strip below it, so
          // only the date part is handed over.
          value={pickingDue() ? pickingDue()!.slice(0, 10) : null}
          firstDayOfWeek={1}
          numberOfMonths={1}
          previousAccessibilityLabel="上个月"
          nextAccessibilityLabel="下个月"
          onChange={({ value }) => {
            const day = typeof value === "string" ? value : null;
            const shown = pickingDue();
            if (!day || !shown) return;
            // The day changes, the time does not: the card keeps the hour it
            // had, and a card with no deadline yet gets the field's default.
            const time = shown.length >= 16 ? shown.slice(11, 16) : "18:00";
            chooseDue(`${day.slice(0, 10)}T${time}`);
          }}
          style={{ padding: 6, width: 292 }}
          headerStyle={{ paddingVertical: 2, paddingHorizontal: 4 }}
          monthStyle={{ gap: 2 }}
          rowStyle={{ gap: 2, justifyContent: "space-between" }}
          itemClass="items-center justify-center min-w-8 h-8"
          itemStyle={{ fontSize: 13, color: theme().text }}
          // The calendar draws no words of its own: without this every item is
          // its raw number, and the weekday row reads 1 2 3 4 5 6 0. The
          // picked day is drawn here too: a `selected:` fill on the item takes
          // the number with it, and the month loses today.
          renderItem={(item) => <CalendarLabel item={item} />}
        />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ fontSize: 11.5, fontWeight: "500", color: theme().textTertiary }}>时间</Text>
        <TimeChip
          testID="calendar-time"
          time={pickingDue() && pickingDue()!.length >= 16 ? pickingDue()!.slice(11, 16) : "18:00"}
          onPress={() => {
            const shown = pickingDue();
            if (!shown) return;
            const time = shown.length >= 16 ? shown.slice(11, 16) : "18:00";
            openDueTime(time, (value) => {
              const current = pickingDue();
              if (!current) return;
              chooseDue(`${current.slice(0, 10)}T${value}`);
            });
          }}
        />
        <View style={{ flex: 1 }} />
        <View
          testID="calendar-done"
          onPress={() => pickingDue.set(null)}
          role="button"
          accessibilityLabel="完成"
          activeStyle={{ opacity: 0.6 }}
          style={{
            height: 30,
            paddingHorizontal: 14,
            borderRadius: 7,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: alpha(theme().accent, theme().dark ? 0.2 : 0.1),
          }}
        >
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: onAccentWash() }}>完成</Text>
        </View>
      </View>
    </Dialog>
  );
}

/** The hour and minute choices the picker draws. Minutes are five apart. */
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

/** The time the picker is choosing for, or `null` while it is closed. */
export const pickingTime = signal<string | null>(null);
/** What a picked time is written to; the card or the calendar, whichever opened it. */
let applyingTime: ((value: string) => void) | null = null;

/** Opens the picker on `time`, and writes every press to `apply`. */
export function openDueTime(time: string, apply: (value: string) => void) {
  pickingTime.set(time);
  applyingTime = apply;
}

function chooseTime(value: string) {
  pickingTime.set(value);
  applyingTime?.(value);
}

/** The clock's own time, to the minute, for the picker's 现在. */
function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The hour and the minute as two grids, not a text field.
 *
 * A deadline is picked with a thumb: 24 hours and twelve five-minute steps are
 * large targets that never open a keyboard, and the selected pair is readable
 * at a glance. 现在 keeps the exact minute when the user wants it; a card with
 * an odd minute keeps that minute until a grid cell is pressed.
 */
export function TimePicker() {
  const value = () => pickingTime() ?? "18:00";
  const hour = () => value().split(":")[0] ?? "18";
  const minute = () => value().split(":")[1] ?? "00";
  return (
    <Dialog
      testID="due-time-dialog"
      open={pickingTime() !== null}
      animation="fade"
      onOpenChange={({ open }) => {
        if (!open) pickingTime.set(null);
      }}
      backdropStyle={{ backgroundColor: theme().scrim }}
      style={{
        margin: "auto",
        width: 300,
        borderRadius: 16,
        backgroundColor: theme().panel,
        padding: 14,
        gap: 10,
        boxShadow: theme().shadowLift,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: theme().text }}>截止时间</Text>
        <View style={{ flex: 1 }} />
        <IconButton
          name="close"
          tint={theme().textSecondary}
          size={28}
          label="关闭"
          onPress={() => pickingTime.set(null)}
        />
      </View>
      <Text
        testID="due-time-value"
        style={{
          fontSize: 28,
          fontWeight: "500",
          color: theme().text,
          textAlign: "center",
          fontVariant: ["tabular-nums"],
        }}
      >
        {value()}
      </Text>
      <Text style={{ fontSize: 11.5, fontWeight: "600", color: theme().textTertiary, letterSpacing: 0.3 }}>小时</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
        {HOURS.map((h) => (
          <TimeCell
            label={h}
            accessibilityLabel={`${h} 时`}
            selected={h === hour()}
            onPress={() => chooseTime(`${h}:${minute()}`)}
          />
        ))}
      </View>
      <Text style={{ fontSize: 11.5, fontWeight: "600", color: theme().textTertiary, letterSpacing: 0.3 }}>分钟</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
        {MINUTES.map((m) => (
          <TimeCell
            label={m}
            accessibilityLabel={`${m} 分`}
            selected={m === minute()}
            onPress={() => chooseTime(`${hour()}:${m}`)}
          />
        ))}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View
          testID="due-time-now"
          onPress={() => chooseTime(nowTime())}
          role="button"
          accessibilityLabel="现在"
          activeStyle={{ opacity: 0.6 }}
          style={{ height: 30, paddingHorizontal: 10, borderRadius: 7, justifyContent: "center" }}
        >
          <Text style={{ fontSize: 12.5, fontWeight: "500", color: theme().textSecondary }}>现在</Text>
        </View>
        <View style={{ flex: 1 }} />
        <View
          testID="due-time-done"
          onPress={() => pickingTime.set(null)}
          role="button"
          accessibilityLabel="完成"
          activeStyle={{ opacity: 0.6 }}
          style={{
            height: 30,
            paddingHorizontal: 14,
            borderRadius: 7,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: alpha(theme().accent, theme().dark ? 0.2 : 0.1),
          }}
        >
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: onAccentWash() }}>完成</Text>
        </View>
      </View>
    </Dialog>
  );
}

/** One hour or five-minute cell: a target a thumb can hit without aiming. */
function TimeCell(props: {
  label: string;
  accessibilityLabel: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <View
      onPress={props.onPress}
      role="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ selected: props.selected }}
      activeStyle={{ opacity: 0.6 }}
      style={{
        width: 42,
        height: 32,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: props.selected
          ? alpha(theme().accent, theme().dark ? 0.24 : 0.11)
          : theme().chip,
      }}
    >
      <Text
        style={{
          fontSize: 12.5,
          fontWeight: "500",
          color: props.selected ? onAccentWash() : theme().textSecondary,
          fontVariant: ["tabular-nums"],
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}

/**
 * What one item of the month says. A `Calendar` draws nothing by itself, so
 * every word here — the weekdays, the month toggle, the years — is the app's.
 */
function CalendarLabel(props: { item: CalendarEntry }) {
  const item = props.item;
  const text =
    item.kind === "weekday"
      ? "日一二三四五六"[item.value] ?? ""
      : item.kind === "previous"
        ? "‹"
        : item.kind === "next"
          ? "›"
          : item.kind === "monthToggle" || item.kind === "month"
            ? `${item.value}月`
            : `${item.value}`;
  // The picked day, drawn as a disc of pressed paper under the number. It is
  // read from the month's own value rather than from a `selected:` class: the
  // item's state is the class's, and a class that changes the fill also takes
  // the number's colour with it.
  const picked = item.kind === "day" && !!item.date && item.date === pickingDue()?.slice(0, 10);
  const size = item.kind === "day" || item.kind === "weekday";
  // The month and the year are words of their own width ("11月", "2026"), so
  // they are plain text; only a day gets a disc to be picked on.
  const style = {
    fontSize: item.kind === "day" ? 13 : 12,
    fontWeight: picked ? ("600" as const) : item.kind === "day" ? ("400" as const) : ("500" as const),
    color:
      item.kind === "weekday"
        ? theme().textTertiary
        : item.outside
          ? alpha(theme().textTertiary, 0.55)
          : theme().text,
    fontVariant: ["tabular-nums" as const],
  };
  if (!size) {
    return (
      <View style={{ height: 26, paddingHorizontal: 2, alignItems: "center", justifyContent: "center" }}>
        <Text style={style}>{text}</Text>
      </View>
    );
  }
  return (
    <View
      style={{
        width: 26,
        height: 26,
        borderRadius: 13,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: picked ? alpha(theme().accent, theme().dark ? 0.28 : 0.14) : "transparent",
        borderWidth: item.today && !picked ? 1 : 0,
        borderColor: theme().selectEdge,
      }}
    >
      <Text style={style}>{text}</Text>
    </View>
  );
}

/**
 * The due being edited, held while the calendar is open: the card is patched on
 * every change, and the calendar keeps reading its own value so a press on a day
 * does not close it before the time is set.
 */
let editingDue: ((iso: string) => void) | null = null;
/** The due the calendar opened with, so a day picked keeps the hour. */
let openedWith = "18:00";

export function openDueCalendar(iso: string | undefined, apply: (next: string) => void) {
  openedWith = iso && iso.length >= 16 ? iso : `${isoToday()}T18:00`;
  editingDue = apply;
  pickingDue.set(openedWith);
}

function isoToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function chooseDue(iso: string) {
  pickingDue.set(iso);
  editingDue?.(iso);
}

/** `11月20日` / `2027年1月9日`: the day a deadline falls on, with no weekday. */
function dayLabel(iso: string): string {
  const day = iso.slice(0, 10);
  const year = day.slice(0, 4);
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  return Number(year) === new Date().getFullYear() ? `${month}月${date}日` : `${year}年${month}月${date}日`;
}

/** The day `offset` days from today, as the `YYYY-MM-DD` a due starts with. */
function isoDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Opens the tag manager. One sheet serves the board, the phone and every card. */
export const managingTags = signal(false);

/** The way into tag management, beside the tags themselves. */
export function TagManagerButton(props: { size?: "mac" | "phone" }) {
  const phone = props.size === "phone";
  return (
    <View
      testID="manage-tags"
      onPress={() => managingTags.set(true)}
      role="button"
      accessibilityLabel="管理标签"
      activeStyle={{ opacity: 0.6 }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: phone ? 12 : 9,
        paddingVertical: phone ? 8 : 5,
        minHeight: phone ? 36 : 0,
        borderRadius: 999,
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: theme().selectEdge,
      }}
    >
      <Icon name="tag" size={phone ? 13 : 11} tint={theme().textTertiary} width={1.8} />
      <Text style={{ fontSize: phone ? 13 : 11.5, fontWeight: "500", color: theme().textTertiary }}>
        标签
      </Text>
    </View>
  );
}

/**
 * Tag management: rename a tag in place, give it another of the five hues, or
 * remove it. The fields sit in a dialog rather than in a scroll view, because an
 * input inside a scroll view has no native field on Android and could never be
 * focused.
 */
export function TagManager() {
  const draft = signal("");
  return (
    <Dialog
      testID="tag-manager"
      open={managingTags()}
      animation="fade"
      onOpenChange={({ open }) => managingTags.set(open)}
      backdropStyle={{ backgroundColor: theme().scrim }}
      style={{
        margin: "auto",
        width: windowSize().width < 520 ? windowSize().width - 40 : 380,
        borderRadius: 16,
        backgroundColor: theme().panel,
        padding: 18,
        gap: 14,
        boxShadow: theme().shadowLift,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: theme().text }}>标签</Text>
        <View style={{ flex: 1 }} />
        <IconButton
          name="close"
          tint={theme().textSecondary}
          size={28}
          label="关闭"
          onPress={() => managingTags.set(false)}
        />
      </View>

      <View style={{ gap: 8 }}>
        <Each of={boardTags()} key={(t) => t.id}>
          {(item) => <TagManagerRow tag={item} />}
        </Each>
        <If when={boardTags().length === 0}>
          <Text style={{ fontSize: 12.5, color: theme().textTertiary }}>还没有标签，先建一个。</Text>
        </If>
        {/* A dot that cycles its hue has no label of its own, so the sheet says
            what it does once rather than leaving it to be discovered. */}
        <Text style={{ fontSize: 11.5, lineHeight: 17, color: theme().textTertiary }}>
          点圆点换颜色，点名字直接改。删掉标签会从所有卡片上取下。
        </Text>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Input
          testID="new-tag"
          value={draft()}
          placeholder="新标签"
          onChange={({ value }) => draft.set(value)}
          style={{
            flex: 1,
            height: 32,
            borderRadius: 7,
            paddingHorizontal: 9,
            backgroundColor: theme().chip,
            fontSize: 13,
            color: theme().text,
            placeholderColor: theme().textTertiary,
          }}
        />
        <View
          testID="add-tag"
          onPress={() => {
            addTag(draft());
            draft.set("");
          }}
          role="button"
          accessibilityLabel="新建标签"
          activeStyle={{ opacity: 0.6 }}
          style={{
            height: 32,
            paddingHorizontal: 12,
            borderRadius: 7,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: alpha(theme().accent, theme().dark ? 0.2 : 0.1),
          }}
        >
          <Text style={{ fontSize: 12.5, fontWeight: "600", color: theme().accentMuted }}>添加</Text>
        </View>
      </View>
    </Dialog>
  );
}

/**
 * One tag in the manager. The hue advances on a press of the dot: five hues do
 * not need a picker of their own, and a press that cycles is one target instead
 * of five.
 */
function TagManagerRow(props: { tag: () => Tag }) {
  const tag = () => props.tag();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View
        testID={`tag-hue-${tag().id}`}
        onPress={() => {
          const at = HUES.findIndex((h) => h.id === tag().hue);
          patchTag(tag().id, { hue: HUES[(at + 1) % HUES.length].id });
        }}
        role="button"
        accessibilityLabel={`换颜色：${tag().label}`}
        activeStyle={{ opacity: 0.6 }}
        style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}
      >
        <View style={{ width: 13, height: 13, borderRadius: 7, backgroundColor: hueColor(tag().hue) }} />
      </View>
      <Input
        testID={`tag-name-${tag().id}`}
        value={tag().label}
        accessibilityLabel={`标签名 ${tag().label}`}
        onChange={({ value }) => patchTag(tag().id, { label: value })}
        style={{
          flex: 1,
          height: 32,
          borderRadius: 7,
          paddingHorizontal: 9,
          backgroundColor: theme().chip,
          fontSize: 13,
          color: theme().text,
        }}
      />
      <IconButton
        name="close"
        tint={theme().textTertiary}
        size={26}
        label={`删除标签 ${tag().label}`}
        onPress={() => {
          void confirm(
            "删除标签？",
            `「${tag().label}」会从所有卡片上取下。`,
            "删除",
          ).then((yes) => {
            if (yes) removeTag(tag().id);
          });
        }}
      />
    </View>
  );
}

/**
 * A confirmation in the platform's own voice, for the destructive press that
 * cannot be taken back in one line. Removing a *tag* is that press: it strips
 * the tag from every card the user is not looking at.
 */
export async function confirm(title: string, description: string, action: string): Promise<boolean> {
  const result = await AlertDialog.show({
    title,
    description,
    actions: [
      { id: "cancel", label: "取消", role: "cancel" },
      { id: "confirm", label: action, role: "destructive" },
    ],
  });
  return result.action === "confirm";
}

/**
 * Empties 归档, after asking in the platform's own alert.
 *
 * One card can be offered back in a line at the foot of the window; a batch is
 * not that, and a tombstone written for a whole column is not something the app
 * can put back for the user. So this is the one press that asks first, and the
 * question names the number of cards it is about to remove.
 *
 * It clears what 归档 shows, which is what its count says: with a tag or a
 * search narrowing the board, the cards that press would take are the ones on
 * screen, and the number in the question is that same number.
 */
export async function clearArchive(): Promise<void> {
  const ids = filteredBoard()
    .filter((c) => c.status === "archive")
    .map((c) => c.id);
  if (ids.length === 0) return;
  const yes = await confirm("清空归档？", `将删除 ${ids.length} 张卡片。`, "清空");
  if (!yes) return;
  for (const id of ids) removeCard(id);
}

/**
 * Clears what is left of the authored sample board, after asking.
 *
 * A fresh install starts with fourteen written cards, and a board the user is
 * making their own should not keep paying for them: this press tombstones the
 * ones still on the board, through the same merge every delete uses, so the
 * other device clears them too. The question names the count, because a whole
 * first board is more than the one card 撤销 can offer back.
 */
export async function clearSamples(): Promise<void> {
  const left = sampleCardsLeft();
  if (!left.length) return;
  const yes = await confirm("清除示例数据？", `将删除 ${left.length} 张示例卡片。`, "清除");
  if (!yes) return;
  removeSamples();
}

/**
 * What just happened, and the way back from it: one line at the foot of
 * whatever surface is showing — centred under the Mac's board, above the
 * phone's capture button, which it must never cover.
 *
 * Deleting a card used to ask first. A card is kept as a tombstone with every
 * field, so it can be written again, and an offer that expires is both faster
 * than a dialog and reversible — the question moved here, after the act.
 *
 * The bar is paper on lift, no border: the same one-raised-object rule as a
 * card. 撤销 sits on a wash of the accent, so its label takes `onAccentWash()`
 * rather than the plain accent, which measures under the floor on its own tint:
 * 5.07:1 on the phone's light bar, 6.88:1 on the Mac's dark one. The message
 * takes plain ink, 11.7–17.1:1 on the same four fills.
 */
export function UndoToast(props: { phone?: boolean }) {
  const phone = props.phone;
  // The line comes up from the foot of the surface rather than appearing: it
  // arrives while the eye is still on the card that went away, and a message
  // that slides into the place the press was made reads as the press's answer.
  const line = createMotion();
  effect(() => {
    if (undoable() !== null) void line.play("slideInUp", { duration: 220 });
  });
  return (
    <If when={undoable() !== null}>
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          // The safe area is part of the phone's foot, exactly as it is for the
          // capture button below: the line has to clear the button on a device
          // with a gesture bar, not only in a test window.
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingHorizontal: phone ? 16 : 0,
          alignItems: phone ? "stretch" : "center",
          // The wrapper is only a place to centre the bar: a press beside it
          // belongs to the board, not to an invisible full-width strip.
          pointerEvents: "box-none",
        }}
      >
        <View
          testID="undo-toast"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            maxWidth: phone ? 520 : 460,
            // Above the phone's 56-point capture button and its 22-point margin,
            // under the Mac's board.
            marginBottom: phone ? 92 : 20,
            paddingLeft: 14,
            paddingRight: 6,
            paddingVertical: 6,
            borderRadius: 12,
            // Chosen against the surface it floats over, which is not the same
            // one on the two devices: the Mac's bar is paper over the desk (the
            // ivory ground), the phone's is paper pressed into the sheet, since
            // there it hangs over a column of paper. Both are the palette's own
            // neutrals, and both take the same ink (14.5:1 and 13.3:1).
            backgroundColor: phone ? theme().select : theme().card,
            boxShadow: theme().shadowLift,
            ...line.style,
          }}
        >
          <Text
            style={{
              flexShrink: 1,
              fontSize: 13,
              fontWeight: "500",
              color: theme().text,
              numberOfLines: 1,
            }}
          >
            {undoable()?.label ?? ""}
          </Text>
          <View
            testID="undo-action"
            onPress={takeUndo}
            role="button"
            accessibilityLabel="撤销"
            activeStyle={{ opacity: 0.6 }}
            style={{
              height: phone ? 32 : 26,
              paddingHorizontal: phone ? 14 : 10,
              borderRadius: 7,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: alpha(theme().accent, theme().dark ? 0.14 : 0.09),
            }}
          >
            <Text style={{ fontSize: 12.5, fontWeight: "600", color: onAccentWash() }}>撤销</Text>
          </View>
          <IconButton
            name="close"
            tint={theme().textTertiary}
            size={phone ? 32 : 26}
            label="关闭提示"
            onPress={dismissUndo}
          />
        </View>
      </View>
    </If>
  );
}

/**
 * What a check for updates says on the Mac.
 *
 * The palette only has the verb; the answer — which version is running, what
 * the check found, why it failed — is a line at the foot of the board, where
 * the undo line lives, and it is there only while a check is being answered.
 * A package it finds waits for the press: 发现 is not yet a download.
 */
export function UpdateToast(props: { phone?: boolean }) {
  const phone = props.phone;
  // Above the undo line when one is up: the two messages are different answers
  // and neither may cover the other.
  const bottom = computed(() => (undoable() !== null ? 76 : 20));
  return (
    <If when={updateVisible() && !phone}>
      <View
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          alignItems: "center",
          pointerEvents: "box-none",
          paddingHorizontal: 16,
        }}
      >
        <View
          testID="update-toast"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            maxWidth: 460,
            marginBottom: bottom(),
            paddingLeft: 14,
            paddingRight: 6,
            paddingVertical: 8,
            borderRadius: 12,
            backgroundColor: theme().card,
            boxShadow: theme().shadowLift,
          }}
        >
          <View style={{ flexShrink: 1, gap: 2 }}>
            <Text
              testID="update-toast-line"
              style={{
                fontSize: 13,
                fontWeight: "500",
                color: updateState() === "failed" ? theme().danger : theme().text,
                numberOfLines: 2,
              }}
            >
              {updateLine()}
            </Text>
            <Text
              testID="update-toast-version"
              style={{
                fontSize: 11.5,
                color: theme().textTertiary,
                fontVariant: ["tabular-nums"],
                numberOfLines: 1,
              }}
            >
              {updateCurrent()}
            </Text>
            <If when={updateDetail() !== ""}>
              <Text
                testID="update-toast-detail"
                style={{
                  fontSize: 11.5,
                  color: theme().textTertiary,
                  numberOfLines: 2,
                }}
              >
                {updateDetail()}
              </Text>
            </If>
          </View>
          <If when={updateActionLabel() !== ""}>
            <View
              testID="update-toast-action"
              onPress={() => void takeUpdateAction()}
              role="button"
              accessibilityLabel={updateActionLabel()}
              accessibilityState={{ disabled: updateState() === "checking" || updateState() === "downloading" }}
              activeStyle={{ opacity: 0.6 }}
              style={{
                height: 26,
                paddingHorizontal: 10,
                borderRadius: 7,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: alpha(theme().accent, theme().dark ? 0.14 : 0.09),
              }}
            >
              <Text style={{ fontSize: 12.5, fontWeight: "600", color: onAccentWash() }}>
                {updateActionLabel()}
              </Text>
            </View>
          </If>
          <IconButton
            name="close"
            tint={theme().textTertiary}
            size={26}
            label="关闭更新提示"
            onPress={dismissUpdate}
          />
        </View>
      </View>
    </If>
  );
}

