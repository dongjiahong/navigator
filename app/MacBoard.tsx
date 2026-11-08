import { LayoutAnimation, List, Overlay, PanResponder, Text, View, signal } from "nsh";
import { COLUMNS, moveCard, setStatus, type Card, type Status } from "./data";
import { filteredBoard, isFiltering } from "./filters";
import { DueBadge, Icon, IconButton, TagRow, alpha } from "./ui";
import { theme, TYPE } from "./theme";
import { COL_GAP, COL_MAX, HDR_H, PAD_X, PAD_Y, boardGeom, measureBoard } from "./geom";

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

/** Responders are made once per card: one rebuilt on each render drops the gesture. */
const pans = new Map<string, ReturnType<typeof PanResponder.create>>();

function computeDrop(pageX: number, pageY: number) {
  const local = pageX - boardGeom.left - PAD_X;
  const statusIdx = Math.max(0, Math.min(3, Math.floor(local / (boardGeom.colW + COL_GAP))));
  const status = COLUMNS[statusIdx].id;
  const rows = boardGeom.rows().filter((r) => r.status === status).sort((a, b) => a.y - b.y);
  const localY = pageY - (boardGeom.top + HDR_H) + boardGeom.scrollY[statusIdx];
  let index = 0;
  for (const r of rows) if (localY > r.y + r.h / 2) index++;
  const last = rows.length ? rows[rows.length - 1] : undefined;
  const anchor = index < rows.length ? rows[index].y - 5 : last ? last.y + last.h + 3 : 3;
  return {
    status,
    index,
    lineX: boardGeom.left + PAD_X + statusIdx * (boardGeom.colW + COL_GAP) + 2,
    lineY: boardGeom.top + HDR_H + anchor - boardGeom.scrollY[statusIdx],
  };
}

function panFor(cardId: string, every: () => Card) {
  const cached = pans.get(cardId);
  if (cached) return cached;
  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      const c = every();
      measureBoard();
      const at = computeDrop(e.pageX, e.pageY);
      dragging.set({
        id: c.id,
        title: c.title,
        tagIds: c.tags,
        due: c.due,
        to: at.status,
        x: e.pageX,
        y: e.pageY,
        lineX: at.lineX,
        lineY: at.lineY,
      });
    },
    onPanResponderMove: (_e, g) => {
      const d = dragging();
      if (!d) return;
      const at = computeDrop(g.moveX, g.moveY);
      dragging.set({ ...d, x: g.moveX, y: g.moveY, to: at.status, lineX: at.lineX, lineY: at.lineY });
    },
    onPanResponderRelease: () => {
      const d = dragging();
      dragging.set(null);
      if (!d) return;
      const at = computeDrop(d.x, d.y);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      moveCard(d.id, at.status, at.index);
    },
    onPanResponderTerminate: () => dragging.set(null),
  });
  pans.set(cardId, pan);
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

function CardView(props: { card: () => Card; selected: boolean; onSelect: () => void }) {
  // The card comes in as the list cell's own accessor, not as an id read once:
  // a recycled cell shows another card later, and a value captured at mount
  // would keep drawing the first one.
  const card = () => props.card();
  const settled = () => card().status === "done" || card().status === "archive";
  return (
    <View
      testID={`card-${card().id}`}
      onPress={props.onSelect}
      onLayout={(e) => {
        boardGeom.setRow(card().id, { status: card().status, y: e.bounds.origin.y, h: e.bounds.size.height });
      }}
      // A hover fill would repaint the card white and erase the selection, so
      // the open card keeps its own fill on hover — and its own hairline: the
      // pointer rests over the card that was just clicked, so an accent ring
      // here would be the loudest object on the board and would spend the one
      // accent on something the user already pressed.
      hoverStyle={
        props.selected ? { backgroundColor: theme().select } : { backgroundColor: theme().cardHover }
      }
      activeStyle={{ backgroundColor: props.selected ? theme().select : theme().cardPressed }}
      style={{
        // The open card takes the platform's selection fill. A ring drawn as a
        // zero-blur box shadow renders as nothing, so selection has to be a
        // fill plus a hairline: it is the only way to tell which card the
        // inspector owns.
        backgroundColor: props.selected ? theme().select : theme().card,
        borderRadius: 10,
        // A selected card trades the shadow for its hairline: a surface carries
        // one or the other, never both.
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
                borderColor: alpha(theme().textTertiary, 0.85),
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
          {...panFor(card().id, card).panHandlers}
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
  onSelect: (id: string) => void;
  onAdd: (status: Status) => void;
}) {
  const items = () => filteredBoard().filter((x) => x.status === props.status);
  const col = COLUMNS.find((c) => c.id === props.status)!;
  return (
    <View style={{ width: props.width }}>
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
        contentStyle={{ paddingBottom: 40, rowGap: 7, paddingTop: 2 }}
        style={{ flex: 1 }}
        scrollbar={false}
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
          <View>
            <CardView
              card={item}
              selected={props.selectedId === item().id}
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
  onSelect: (id: string | null) => void;
  onAdd: (status: Status) => void;
}) {
  return (
    <>
      <View testID="board" style={{ flex: 1, alignItems: "center" }}>
        <View
          ref={(r) => {
            boardGeom.ref = r;
            measureBoard();
          }}
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
