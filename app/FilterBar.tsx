import { Text, View, signal, windowSize } from "nsh";
import { Dialog } from "nsh/base";
import { board, boardTags } from "./data";
import {
  DUE_LABEL,
  clearTagFilters,
  dueCounts,
  dueFilter,
  isFiltering,
  selectedTags,
  setDueFilter,
  toggleTagFilter,
  type DueCondition,
} from "./filters";
import { BAR_GAP, BAR_PAD, SEARCH_W, dateGroupWidth, fitChips, tagBudget, type ChipSpec } from "./strip";
import { hueColor, onAccentWash, theme } from "./theme";
import { ClearFilterButton, SearchField, TagManagerButton, alpha } from "./ui";

/**
 * The board's filter, as one row on the Mac.
 *
 * Three date conditions, a hairline, the user's tags, the way into the tag list,
 * 清除, and the search field — in that order, because the row reads from "when"
 * to "what" to "which words". The tags are the only part that gives: as many fit
 * as fit and the rest go behind 更多, so the search field is never the thing
 * pushed off the window and nothing ever scrolls sideways.
 */

/** The three conditions, in the order the row draws them. */
const DUE_ORDER: DueCondition[] = ["today", "overdue", "none"];

/**
 * One filter control. A tag keeps its dot as its identity; being on is the
 * accent's wash with its own muted ink, which is the one thing the accent is
 * spent on in this row and reads as pressed without shouting.
 */
function FilterChip(props: {
  label: string;
  on: boolean;
  color?: string;
  count?: number;
  testID?: string;
  onPress: () => void;
}) {
  const dim = props.count === 0 && !props.on;
  return (
    <View
      testID={props.testID}
      onPress={props.onPress}
      role="button"
      accessibilityLabel={props.label}
      accessibilityState={{ selected: props.on }}
      activeStyle={{ opacity: 0.65 }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 24,
        paddingHorizontal: 9,
        borderRadius: 7,
        backgroundColor: props.on ? theme().accentSoft : theme().chip,
      }}
    >
      {props.color ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: props.color }} /> : null}
      <Text
        style={{
          fontSize: 11.5,
          fontWeight: props.on ? "600" : "500",
          color: props.on ? onAccentWash() : theme().textSecondary,
        }}
      >
        {props.label}
      </Text>
      {props.count === undefined ? null : (
        <Text
          style={{
            fontSize: 11.5,
            fontWeight: "500",
            fontVariant: ["tabular-nums"],
            // A condition with nothing in it still says so, one step quieter: a
            // chip that vanished would move every chip after it, and a disabled
            // one would look like a state the user cannot reach.
            color: props.on ? onAccentWash() : dim ? alpha(theme().textTertiary, 0.55) : theme().textTertiary,
          }}
        >
          {props.count}
        </Text>
      )}
    </View>
  );
}

/** 今天 / 已逾期 / 无日期: one at a time, and pressing the chosen one clears it. */
function DateFilterRow() {
  const counts = () => dueCounts(board(), Date.now());
  return (
    <View testID="date-filters" style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
      {DUE_ORDER.map((id) => (
        <FilterChip
          testID={`date-${id}`}
          label={DUE_LABEL[id]}
          count={counts()[id]}
          on={dueFilter() === id}
          onPress={() => setDueFilter(dueFilter() === id ? null : id)}
        />
      ))}
    </View>
  );
}

/** Whether the tags that did not fit are on show. */
const moreOpen = signal(false);

/** 全部 first, then one chip per tag, in the order the user made them. */
function tagChips(): ChipSpec[] {
  return [{ id: "all", label: "全部" }, ...boardTags().map((tag) => ({ id: tag.id, label: tag.label, dot: true }))];
}

/** The tags a strip `width` points wide has no room for. */
function hiddenTags(width: number) {
  const shown = fitChips(tagChips(), width).shown.map((chip) => chip.id);
  return boardTags().filter((tag) => !shown.includes(tag.id));
}

/**
 * The tag strip's room in a `width`-point window.
 *
 * Read rather than passed where the 更多 dialog needs it too: a dialog's content
 * is built where it is written, and a plain number handed to it is the number the
 * window had when it was written.
 */
function stripBudget(width: number): number {
  return tagBudget(width, {
    clear: isFiltering(),
    dateGroup: dateGroupWidth(
      DUE_ORDER.map((id) => ({ label: DUE_LABEL[id], count: dueCounts(board(), Date.now())[id] })),
    ),
  });
}

/**
 * The tags, as many as the strip has room for.
 *
 * 全部 is first and never culled: it is the way out of the tag selection, and a
 * strip that hides its own way out turns a filter into a trap. The rest are
 * taken in the order the user made them, and 更多 says how many are behind it.
 */
function TagStrip(props: { width: number }) {
  const fit = () => fitChips(tagChips(), props.width);
  /** The ids that fit, and 全部 when it is one of them. */
  const shown = () => fit().shown.map((chip) => chip.id);
  return (
    <View
      testID="tag-filters"
      style={{
        width: props.width,
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        overflow: "hidden",
      }}
    >
      <If when={shown().includes("all")}>
        <FilterChip testID="tag-filter-all" label="全部" on={selectedTags().length === 0} onPress={clearTagFilters} />
      </If>
      <Each of={boardTags().filter((tag) => shown().includes(tag.id))} key={(tag) => tag.id}>
        {(tag) => (
          <FilterChip
            testID={`tag-filter-${tag().id}`}
            label={tag().label}
            color={hueColor(tag().hue)}
            on={selectedTags().includes(tag().id)}
            onPress={() => toggleTagFilter(tag().id)}
          />
        )}
      </Each>
      <If when={fit().hidden > 0}>
        {/* 更多 takes the chip's own on-state when a tag behind it is chosen:
            the strip may hide a tag, but never the fact that one is filtering. */}
        <FilterChip
          testID="tags-more"
          label="更多"
          count={fit().hidden}
          on={hiddenTags(props.width).some((tag) => selectedTags().includes(tag.id))}
          onPress={() => moreOpen.set(true)}
        />
      </If>
    </View>
  );
}

/**
 * The tags that did not fit, in one dialog.
 *
 * The strip is one line by design, so a board with a dozen tags cannot show them
 * all; this is where the rest stay reachable, drawn as the same chips the row
 * draws — pressing one is the same press, and the dialog stays up for the second.
 */
function TagMoreDialog() {
  return (
    <Dialog
      testID="tags-more-sheet"
      open={moreOpen()}
      animation="fade"
      onOpenChange={({ open }) => moreOpen.set(open)}
      backdropStyle={{ backgroundColor: theme().scrim }}
      style={{
        margin: "auto",
        width: 320,
        borderRadius: 16,
        backgroundColor: theme().panel,
        padding: 18,
        gap: 12,
        boxShadow: theme().shadowLift,
      }}
    >
      {/* Built only while the dialog is up: a tree computed for a closed dialog
          is one nothing ever mounted, and this engine frees such a tree twice
          when the app goes away. */}
      <If when={moreOpen()}>
        <Text style={{ fontSize: 15, fontWeight: "600", color: theme().text }}>标签</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
          <Each of={hiddenTags(stripBudget(windowSize().width))} key={(tag) => tag.id}>
            {(tag) => (
              <FilterChip
                testID={`more-tag-${tag().id}`}
                label={tag().label}
                color={hueColor(tag().hue)}
                on={selectedTags().includes(tag().id)}
                onPress={() => toggleTagFilter(tag().id)}
              />
            )}
          </Each>
        </View>
      </If>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ flex: 1 }} />
        <View
          onPress={() => moreOpen.set(false)}
          role="button"
          accessibilityLabel="完成"
          activeStyle={{ opacity: 0.6 }}
          style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7 }}
        >
          <Text style={{ fontSize: 12.5, fontWeight: "500", color: onAccentWash() }}>完成</Text>
        </View>
      </View>
    </Dialog>
  );
}

/**
 * The whole row, sized for the window it is in.
 *
 * `width` is the window's, because the tag strip's room is what is left after
 * everything else has taken its fixed share — and that calculation is the only
 * thing standing between a narrow window and a search field half off the edge.
 */
export function MacFilterBar(props: { width: number }) {
  const budget = () => stripBudget(props.width);
  return (
    <View>
      <View
        testID="filter-bar"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: BAR_GAP,
          paddingHorizontal: BAR_PAD,
          paddingBottom: 10,
        }}
      >
        <DateFilterRow />
        {/* The date conditions and the tags are two questions — when it is due,
            and whose work it is — so one hairline stands between them. */}
        <View style={{ width: 1, height: 14, backgroundColor: theme().hairline }} />
        <TagStrip width={budget()} />
        <View style={{ flex: 1 }} />
        <TagManagerButton />
        <If when={isFiltering()}>
          <ClearFilterButton />
        </If>
        <SearchField width={SEARCH_W} />
      </View>
      <TagMoreDialog />
    </View>
  );
}
