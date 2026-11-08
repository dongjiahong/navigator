import { LayoutAnimation, List, Overlay, PanResponder, Text, View, signal } from "nsh";
import { cards, COLUMNS, moveCard, setStatus, type Card, type Status } from "./data";
import { filteredBoard, isFiltering } from "./filters";
import { lists } from "./focus";
import { DueBadge, Icon, IconButton, TagRow } from "./ui";
import { theme, TYPE } from "./theme";
import { COL_GAP, COL_MAX, HDR_H, PAD_X, PAD_Y, ROW_GAP, ROW_TOP, boardGeom } from "./geom";

/**
 * The drag, in one signal read only by the drag layer. Keeping it out of the
 * board's tree matters: a board update mid-drag re-mounts list cells and the
 * native gesture loses its moves.
 */
const dragging = signal<{
  id: string;
  title: string;
  tagIds: string[];
  due?: string;
  to: Status;
  x: number;
  y: number;
  lineX: number;
  lineY: number;
} | null>(null);

/** Responders are made once per card and per grip: one rebuilt on each render drops the gesture. */
const pans = new Map<string, ReturnType<typeof PanResponder.create>>();

/**
 * Where each column's list sits in the window comes from `onLayout` on the
 * board, the column and the list (see `geom.ts`), so the drop seam, the drop
 * index and the edge band all work off the same numbers the layout engine
 * produced — on every platform, refs or not.
 */
function computeDrop(pageX: number, pageY: number) {
  const local = pageX - boardGeom.left - PAD_X;
  const statusIdx = Math.max(0, Math.min(3, Math.floor(local / (boardGeom.colW + COL_GAP))));
  const status = COLUMNS[statusIdx].id;
  const rows = boardGeom.rows().filter((r) => r.status === status).sort((a, b) => a.y - b.y);
  // The pointer against the column's content: what it is over, once the column's
  // own scroll is added back.
  const localY = pageY - boardGeom.bandTop(status) + boardGeom.scrollY[statusIdx];
  let index = 0;
  for (const r of rows) if (localY > r.y + r.h / 2) index++;
  const last = rows.length ? rows[rows.length - 1] : undefined;
  const anchor = index < rows.length ? rows[index].y - 5 : last ? last.y + last.h + 3 : 3;
  return {
    status,
    index,
    lineX: boardGeom.left + PAD_X + statusIdx * (boardGeom.colW + COL_GAP) + 2,
    lineY: boardGeom.bandTop(status) + anchor - boardGeom.scrollY[statusIdx],
  };
}

/**
 * Scrolling a column while a drag rests against its edge.
 *
 * A column is taller than the window once it holds a dozen cards, and a drop
 * below the fold used to be unreachable: the card had to be dropped, the column
 * scrolled, and the card picked up again. The band is 48 points and the speed
 * grows with how far into it the pointer is, so a drop just past the edge creeps
 * and one against the edge runs.
 */
const EDGE = 48;
const TICK = 16;

let auto: { status: Status; dir: 1 | -1; speed: number } | null = null;
/** The timer, the offset it is moving to, and what the column last reported:
 *  a list clamps at its ends, and the drift past the clamp has to be given back
 *  rather than unwound when the pointer turns round. */
let autoTimer: ReturnType<typeof setInterval> | null = null;
let autoOffset = 0;
let autoReported = 0;
let autoStill = 0;

function stopAutoScroll(): void {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = null;
  auto = null;
  autoStill = 0;
}

function tickAutoScroll(): void {
  const a = auto;
  if (!a) return;
  const idx = COLUMNS.findIndex((c) => c.id === a.status);
  const list = lists.get(a.status);
  if (!list) return stopAutoScroll();
  const reported = boardGeom.scrollY[idx];
  if (reported !== autoReported) {
    // The column moved to where it says it is (it clamps at its ends, and the
    // user may scroll it under the drag): its own number is the true one.
    autoReported = reported;
    autoOffset = reported;
    autoStill = 0;
  } else if (autoStill++ > 4) {
    // Asked to move five times and the column has not: it is at its end.
    return stopAutoScroll();
  }
  autoOffset = Math.max(0, autoOffset + a.dir * a.speed);
  list.scrollToOffset({ offset: autoOffset });
  const d = dragging();
  if (!d) return stopAutoScroll();
  // The seam follows the content: the pointer has not moved, the cards under it
  // have, and a drop has to land where the seam says it will.
  const at = computeDrop(d.x, d.y);
  dragging.set({ ...d, to: at.status, lineX: at.lineX, lineY: at.lineY });
}

/** Starts, retunes or stops the auto-scroll for a pointer at `y`. */
function steerAutoScroll(status: Status, y: number): void {
  const top = boardGeom.bandTop(status);
  const height = boardGeom.bandHeight(status);
  if (height <= 0) return stopAutoScroll();
  const fromTop = y - top;
  const fromBottom = top + height - y;
  const dir = fromTop < EDGE ? -1 : fromBottom < EDGE ? 1 : 0;
  if (dir === 0) return stopAutoScroll();
  const depth = dir === -1 ? fromTop : fromBottom;
  const speed = 2 + 10 * (1 - Math.max(0, Math.min(1, depth / EDGE)));
  if (auto && auto.status === status && auto.dir === dir) {
    auto.speed = speed;
    return;
  }
  stopAutoScroll();
  auto = { status, dir, speed };
  const idx = COLUMNS.findIndex((c) => c.id === status);
  autoReported = boardGeom.scrollY[idx];
  autoOffset = autoReported;
  autoTimer = setInterval(tickAutoScroll, TICK);
}

function beginDrag(id: string, pageX: number, pageY: number): void {
  const card = cards().find((c) => c.id === id);
  if (!card || card.deleted) return;
  const at = computeDrop(pageX, pageY);
  dragging.set({
    id: card.id,
    title: card.title,
    tagIds: card.tags,
    due: card.due,
    to: at.status,
    x: pageX,
    y: pageY,
    lineX: at.lineX,
    lineY: at.lineY,
  });
  steerAutoScroll(at.status, pageY);
}

function moveDrag(pageX: number, pageY: number): void {
  const d = dragging();
  if (!d) return;
  const at = computeDrop(pageX, pageY);
  dragging.set({ ...d, x: pageX, y: pageY, to: at.status, lineX: at.lineX, lineY: at.lineY });
  steerAutoScroll(at.status, pageY);
}

function endDrag(): void {
  stopAutoScroll();
  const d = dragging();
  dragging.set(null);
  if (!d) return;
  const at = computeDrop(d.x, d.y);
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  moveCard(d.id, at.status, at.index);
}

function cancelDrag(): void {
  stopAutoScroll();
  dragging.set(null);
}

/**
 * A pan on the whole card, and one on the grip.
 *
 * The grip is the visible affordance and always was; it claims the touch at
 * once, because a press on a handle means nothing else. The card claims it only
 * once the pointer has moved: a click that does not move has to stay a click
 * that opens the card, which is what the board is for.
 */
function panFor(fromCard: boolean, cardId: string) {
  const key = `${fromCard ? "card" : "grip"}:${cardId}`;
  const cached = pans.get(key);
  if (cached) return cached;
  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => !fromCard,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => beginDrag(cardId, e.pageX, e.pageY),
    onPanResponderMove: (_e, g) => moveDrag(g.moveX, g.moveY),
    onPanResponderRelease: endDrag,
    onPanResponderTerminate: cancelDrag,
  });
  pans.set(key, pan);
  return pan;
}

/** The lifted card and the seam it opens at the drop point. */
function DragLayer() {
  return (
    <>
      {dragging() ? (
        <Overlay style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
          <View
            style={{
              position: "absolute",
              left: dragging()!.lineX,
              top: dragging()!.lineY,
              width: boardGeom.colW - 8,
              height: 2,
              borderRadius: 1,
              backgroundColor: theme().accent,
            }}
          />
          <View
            style={{
              position: "absolute",
              left: dragging()!.x - 128,
              top: dragging()!.y - 26,
              width: 256,
              borderRadius: 12,
              backgroundColor: theme().card,
              boxShadow: theme().shadowLift,
              padding: 11,
              gap: 6,
              rotate: "-1.4deg",
              scale: 1.03,
            }}
          >
            <Text style={{ ...TYPE.cardTitle, color: theme().text, numberOfLines: 2 }}>
              {dragging()!.title || "未命名卡片"}
            </Text>
            {dragging()!.tagIds.length > 0 ? <TagRow ids={dragging()!.tagIds} /> : null}
            {dragging()!.due ? <DueBadge iso={dragging()!.due!} /> : null}
          </View>
        </Overlay>
      ) : null}
    </>
  );
}

function CardView(props: {
  card: () => Card;
  selected: boolean;
  focused: boolean;
  onSelect: () => void;
}) {
  // The card comes in as the list cell's own accessor, not as an id read once:
  // a recycled cell shows another card later, and a value captured at mount
  // would keep drawing the first one.
  const card = () => props.card();
  const settled = () => card().status === "done" || card().status === "archive";
  // Where the keyboard is. It takes the same pressed-paper fill as the open
  // card, and is told apart by what the open card trades away for its hairline:
  // the focused card keeps its shadow, so it reads as a card under the cursor
  // rather than a card laid into the desk. The open card wins where both apply.
  const lifted = () => props.selected || props.focused;
  return (
    <View
      testID={`card-${card().id}`}
      {...panFor(true, card().id).panHandlers}
      // The card is a handle as well as a button: a press that does not move is
      // a press that opens it, and the same press that moves 5 points lifts it.
      // The grip keeps its own pan and activates at 4, because it has nothing
      // else to do and a handle should answer the smallest movement.
      panActivation={{ activeOffsetX: 5, activeOffsetY: 5 }}
      onPress={props.onSelect}
      // A hover fill would repaint the card white and erase the selection, so
      // the open card keeps its own fill on hover — and its own hairline: the
      // pointer rests over the card that was just clicked, so an accent ring
      // here would be the loudest object on the board and would spend the one
      // accent on something the user already pressed.
      hoverStyle={lifted() ? { backgroundColor: theme().select } : { backgroundColor: theme().cardHover }}
      activeStyle={
        lifted() ? { backgroundColor: theme().select } : { backgroundColor: theme().cardPressed }
      }
      style={{
        // The open card takes the platform's selection fill. A ring drawn as a
        // zero-blur box shadow renders as nothing, so selection has to be a
        // fill plus a hairline: it is the only way to tell which card the
        // inspector owns.
        backgroundColor: lifted() ? theme().select : theme().card,
        borderRadius: 10,
        // A selected card trades the shadow for its hairline: a surface carries
        // one or the other, never both. The keyboard's card keeps the shadow —
        // that is the whole difference between the two fills.
        borderWidth: props.selected ? 1 : 0,
        borderColor: theme().selectEdge,
        boxShadow: props.selected ? "none" : theme().shadow,
        padding: 12,
        paddingTop: 11,
        gap: 7,
      }}
    >
      <View style={{ flexDirection: "row", gap: 7 }}>
        {/* The circle every card carries, finished or not: the phone completes a
            row with one tap and the Mac had no way to do it without opening the
            card and pressing a chip. An open card is a hollow ring in tertiary
            ink — nothing coloured, because colour here means a tag, a due time
            or a finished card — and a finished one keeps the check it always
            had. The box is the same size either way, so titles line up across
            the column instead of stepping in where a check appears. */}
        <View
          testID={`check-${card().id}`}
          onPress={() => setStatus(card().id, settled() ? "todo" : "done")}
          role="checkbox"
          accessibilityLabel={settled() ? "标记为未完成" : "标记为已完成"}
          accessibilityState={{ checked: settled() }}
          hitSlop={6}
          activeStyle={{ opacity: 0.45 }}
          style={{
            width: 22,
            height: 22,
            marginLeft: -6,
            marginTop: -1,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {settled() ? (
            <Icon
              name="check"
              size={12}
              tint={card().status === "done" ? theme().ok : theme().textTertiary}
              width={2.2}
            />
          ) : (
            <View
              style={{
                width: 13,
                height: 13,
                borderRadius: 6.5,
                borderWidth: 1.4,
                // Tertiary ink at full strength: a 1.4-pixel stroke over a
                // translucent colour blends back toward the paper and lands
                // near 3:1, under what a control's own edge is allowed. Solid
                // tertiary is 5.9:1 on the light card and 5.7:1 on the dark one.
                borderColor: theme().textTertiary,
              }}
            />
          )}
        </View>
        <Text
          style={{
            ...TYPE.cardTitle,
            flex: 1,
            numberOfLines: 4,
            color: settled() ? theme().textTertiary : theme().text,
          }}
        >
          {card().title || "未命名卡片"}
        </Text>
        <View
          {...panFor(false, card().id).panHandlers}
          testID={`grip-${card().id}`}
          accessibilityLabel="拖动卡片"
          panActivation={{ activeOffsetX: 4, activeOffsetY: 4 }}
          activeStyle={{ opacity: 0.45 }}
          style={{
            width: 18,
            height: 20,
            marginRight: -5,
            marginTop: -1,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="grip" size={14} tint={theme().textTertiary} width={2} dot={1.25} />
        </View>
      </View>
      {card().notes ? (
        <Text style={{ ...TYPE.body, fontSize: 12.5, lineHeight: 18.5, color: theme().textSecondary, numberOfLines: 2 }}>
          {card().notes}
        </Text>
      ) : null}
      {card().tags.length > 0 || card().due ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 11,
            flexWrap: "wrap",
            marginTop: card().notes ? 0 : 1,
          }}
        >
          {card().tags.length > 0 ? <TagRow ids={card().tags} /> : null}
          {card().due ? <DueBadge iso={card().due!} settled={settled()} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function Column(props: {
  width: number;
  status: Status;
  index: number;
  selectedId: string | null;
  focusId: string | null;
  onSelect: (id: string) => void;
  onAdd: (status: Status) => void;
}) {
  const items = () => filteredBoard().filter((x) => x.status === props.status);
  const col = COLUMNS.find((c) => c.id === props.status)!;
  return (
    <View
      style={{ width: props.width }}
      onLayout={(e) => boardGeom.setColumn(props.status, e.bounds.origin.y)}
    >
      <View
        testID={`head-${props.status}`}
        style={{
          height: HDR_H,
          flexDirection: "row",
          alignItems: "center",
          gap: 7,
          paddingLeft: 2,
          paddingRight: 4,
          // A quiet rule under the label, and no tray behind the column: the
          // board stays one continuous sheet, divided by air and hairlines.
          // Lighter than the header's rule, so the label strip is not a cell.
          borderBottomWidth: 1,
          borderBottomColor: theme().hairlineSoft,
          marginBottom: 9,
        }}
      >
        <Text style={{ ...TYPE.columnLabel, color: theme().textSecondary }}>{col.label}</Text>
        <Text style={{ ...TYPE.meta, color: theme().textTertiary, fontVariant: ["tabular-nums"] }}>
          {items().length}
        </Text>
        <View style={{ flex: 1 }} />
        <IconButton
          name="plus"
          tint={theme().textTertiary}
          size={22}
          label={`在${col.label}里新建卡片`}
          onPress={() => props.onAdd(props.status)}
        />
      </View>
      <List
        testID={`col-${props.status}`}
        each={items()}
        estimatedItemSize={92}
        onLayout={(e) =>
          boardGeom.setBand(props.status, { top: e.bounds.origin.y, height: e.bounds.size.height })
        }
        contentStyle={{ paddingBottom: 40, rowGap: ROW_GAP, paddingTop: ROW_TOP }}
        style={{ flex: 1 }}
        scrollbar={false}
        // A native scroll command needs the list's own view. Only a real window
        // hands one over; the keys and the drag's edge band fall back to the
        // layout numbers when it is missing, so neither depends on this.
        ref={(r) => {
          lists.set(props.status, r);
        }}
        onScroll={({ offset }) => {
          boardGeom.scrollY[props.index] = offset.y;
        }}
        empty={
          <View style={{ paddingTop: 6, paddingHorizontal: 2 }}>
            <Text style={{ fontSize: 12.5, lineHeight: 18, color: theme().textTertiary }}>
              {isFiltering()
                ? "没有匹配的卡片"
                : props.status === "archive"
                  ? "归档的卡片不会再打扰你"
                  : "把卡片拖到这里"}
            </Text>
          </View>
        }
      >
        {(item) => (
          // The row's own frame, not the card's: a card's frame is inside this
          // wrapper and its origin is always 0, while this one's is where the
          // row sits in the column's content — the number a drop and a scroll
          // need.
          <View
            onLayout={(e) =>
              boardGeom.setRow(item().id, {
                status: item().status,
                y: e.bounds.origin.y,
                h: e.bounds.size.height,
              })
            }
          >
            <CardView
              card={item}
              selected={props.selectedId === item().id}
              focused={props.focusId === item().id}
              onSelect={() => props.onSelect(item().id)}
            />
          </View>
        )}
      </List>
    </View>
  );
}

/**
 * The board never scrolls sideways. Four columns share the window, growing to
 * `COL_MAX` and then stopping, with the row centered when there is room to
 * spare. The window itself is held above the width at which four columns reach
 * `COL_MIN`; an opened card floats over the board rather than narrowing it, so
 * the columns keep their width while a card is read.
 */
function colWidth(total: number) {
  const inner = total - PAD_X * 2 - COL_GAP * 3;
  const w = Math.max(0, Math.min(COL_MAX, Math.floor(inner / 4)));
  boardGeom.colW = w;
  return w;
}

function boardWidth(total: number) {
  return colWidth(total) * 4 + COL_GAP * 3 + PAD_X * 2;
}

export function MacBoard(props: {
  width: number;
  selectedId: string | null;
  focusId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: (status: Status) => void;
}) {
  return (
    <>
      <View
        testID="board"
        style={{ flex: 1, alignItems: "center" }}
        // The board's own place in the window, which every column's and list's
        // frame is summed onto. `ref` never arrives on this engine, so this is
        // where the drag's page coordinates come from.
        onLayout={(e) => boardGeom.setOrigin(e.bounds.origin.x, e.bounds.origin.y)}
      >
        <View
          style={{
            width: boardWidth(props.width),
            flex: 1,
            flexDirection: "row",
            gap: COL_GAP,
            paddingHorizontal: PAD_X,
            paddingBottom: PAD_Y,
          }}
        >
          {COLUMNS.map((c, i) => (
            <Column
              width={colWidth(props.width)}
              status={c.id}
              index={i}
              selectedId={props.selectedId}
              focusId={props.focusId}
              onSelect={props.onSelect}
              onAdd={props.onAdd}
            />
          ))}
        </View>
      </View>
      <DragLayer />
    </>
  );
}
