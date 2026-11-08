import {
  LayoutAnimation,
  List,
  Overlay,
  PanResponder,
  Scroll,
  Text,
  View,
  createAnimatedValue,
  mount,
  signal,
} from "nsh";
import { Input } from "nsh/base";

type Card = { id: number; title: string; notes: string };

const COL_TITLES = ["待办", "进行中", "已完成"];
const COL_W = 300;
const COL_GAP = 12;
const COL_HDR = 44;
const ROW_H = 74;

function initialColumns(): Card[][] {
  const cols: Card[][] = [[], [], []];
  for (let i = 0; i < 200; i++) {
    cols[i % 3].push({ id: i, title: `任务 #${i + 1}`, notes: "" });
  }
  return cols;
}

// One row mounted per cell: proves virtualization if this stays far below 200.
let rowMounts = 0;

// Gesture session state lives outside the component: a re-render recreates
// everything inside it, and a drag that spans renders would lose its target.
const gScroll = { x: 0, y: [0, 0, 0] };
const gBoard = {
  top: 0,
  left: 0,
  ref: undefined as { measure(): Promise<{ pagePosition: { x: number; y: number } } | null> } | undefined,
};
// One responder per card id, made once: a responder rebuilt on every render
// of a list cell loses the moves of a drag already under way.
const pans = new Map<number, unknown>();

function measureBoard() {
  gBoard.ref?.measure().then((m) => {
    if (!m) return;
    gBoard.top = m.pagePosition.y;
    gBoard.left = m.pagePosition.x;
  });
}

function App() {
  const cols = signal<Card[][]>(initialColumns());
  const visible = signal<number[]>([0, 0, 0]);
  const lastMove = signal("尚未拖拽");

  const drag = signal<{ id: number; from: number; title: string; to: number; index: number } | null>(null);
  const previewX = createAnimatedValue(0);
  const previewY = createAnimatedValue(0);

  const probe = signal("0,0");
  const probePan = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderMove: (_e, g) => probe.set(`${Math.round(g.dx)},${Math.round(g.dy)}`),
    onPanResponderRelease: (_e, g) => probe.set(`up ${Math.round(g.dx)},${Math.round(g.dy)}`),
  });

  const editId = signal<number | null>(null);
  const editTitle = signal("");
  const editNotes = signal("");
  const composing = signal("");


  const total = () => cols().reduce((n, c) => n + c.length, 0);

  function updateCard(id: number, title: string) {
    cols.update((all) =>
      all.map((cards) => cards.map((c) => (c.id === id ? { ...c, title } : c))),
    );
  }

  function openEdit(card: Card) {
    editId.set(card.id);
    editTitle.set(card.title);
    editNotes.set(card.notes);
  }

  function updateTarget(x: number, y: number) {
    const d = drag();
    if (!d) return;
    const localX = x - gBoard.left + gScroll.x;
    let to = Math.floor(localX / (COL_W + COL_GAP));
    to = Math.max(0, Math.min(2, to));
    const listTop = gBoard.top + COL_HDR + 8;
    const localY = y - listTop + gScroll.y[to];
    const len = cols()[to].length;
    const index = Math.max(0, Math.min(len, Math.round(localY / ROW_H)));
    if (to !== d.to || index !== d.index) drag.set({ ...d, to, index });
  }

  function moveCard(id: number, from: number, to: number, index: number) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.spring);
    cols.update((all) => {
      const copy = all.map((c) => [...c]);
      const at = copy[from].findIndex((c) => c.id === id);
      if (at < 0) return all;
      const [card] = copy[from].splice(at, 1);
      let into = index;
      if (from === to && into > at) into -= 1;
      into = Math.max(0, Math.min(into, copy[to].length));
      copy[to].splice(into, 0, card);
      return copy;
    });
  }

  function panFor(colIndex: number, item: () => Card) {
    const id = item().id;
    const cached = pans.get(id);
    if (cached) return cached as ReturnType<typeof PanResponder.create>;

    const pan = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const card = item();
        measureBoard();
        drag.set({ id: card.id, from: colIndex, title: card.title, to: colIndex, index: 0 });
        previewX.set(e.pageX - 24);
        previewY.set(e.pageY - 16);
      },
      onPanResponderMove: (_e, g) => {
        previewX.set(g.moveX - 24);
        previewY.set(g.moveY - 16);
        updateTarget(g.moveX, g.moveY);
      },
      onPanResponderRelease: () => {
        const d = drag();
        if (!d) return;
        moveCard(d.id, d.from, d.to, d.index);
        previewX.spring(gBoard.left + d.to * (COL_W + COL_GAP) + 8 - gScroll.x);
        previewY.spring(gBoard.top + COL_HDR + 8 + d.index * ROW_H - gScroll.y[d.to]);
        lastMove.set(`#${d.id + 1} → ${COL_TITLES[d.to]} @ ${d.index}`);
        setTimeout(() => drag.set(null), 240);
      },
      onPanResponderTerminate: () => drag.set(null),
    });
    pans.set(id, pan);
    return pan;
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#f4f4f5",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <View style={{ height: 34, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 12 }}>
        <Text style={{ fontSize: 15, fontWeight: "700" }}>KanbanSpike</Text>
        <Text style={{ fontSize: 11, color: "#71717a" }}>
          卡片 {total()} · 可见 {visible()[0] + visible()[1] + visible()[2]}
        </Text>
      </View>
      <View style={{ height: 22, paddingHorizontal: 12, flexDirection: "row", gap: 10 }}>
        <Text testID="last-move" style={{ fontSize: 11, color: "#3f3f46" }}>
          {lastMove()}
        </Text>
        <Text style={{ fontSize: 11, color: "#a1a1aa" }}>按住 ⠿ 拖到别的列</Text>
        <View
          testID="probe"
          {...probePan.panHandlers}
          style={{ width: 70, height: 20, backgroundColor: "#fde68a", borderRadius: 4 }}
        >
          <Text testID="probe-text" style={{ fontSize: 11 }}>
            {probe()}
          </Text>
        </View>
      </View>

      <Scroll
        horizontal
        style={{ flex: 1 }}
        onScroll={({ offset }) => {
          gScroll.x = offset.x;
        }}
      >
        <View
          ref={(r) => {
            gBoard.ref = r;
            measureBoard();
          }}
          style={{ flexDirection: "row", paddingHorizontal: 8, paddingVertical: 8 }}
        >
          {[0, 1, 2].map((i) => {
            return (
              <View
                   style={{
                  width: COL_W,
                  height: "100%",
                  marginRight: COL_GAP,
                  borderRadius: 12,
                  backgroundColor: "#e9e9ec",
                }}
              >
                <View
                  style={{
                    height: COL_HDR,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingHorizontal: 10,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: "600" }}>{COL_TITLES[i]}</Text>
                  <Text style={{ fontSize: 11, color: "#71717a" }}>{cols()[i].length}</Text>
                </View>
                <List
                  testID={`col-${i}`}
                  each={cols()[i]}
                  estimatedItemSize={ROW_H}
                  contentStyle={{ paddingHorizontal: 6, paddingBottom: 24 }}
                  style={{ flex: 1 }}
                  onScroll={({ offset }) => {
                    gScroll.y[i] = offset.y;
                  }}
                  onViewableItemsChange={({ viewableItems }) => {
                    const next = [...visible()];
                    next[i] = viewableItems.length;
                    visible.set(next);
                  }}
                >
                  {(item) => {
                    rowMounts++;
                    if (rowMounts % 10 === 1) console.log("[spike] row cells created:", rowMounts);
                    return (
                      <View
                        style={{
                          height: 64,
                          marginTop: 8,
                          borderRadius: 10,
                          backgroundColor: "#ffffff",
                          padding: 10,
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                      >
                        <View onPress={() => openEdit(item())} testID={`open-${item().id}`}>
                          <Text style={{ fontSize: 14, fontWeight: "600", numberOfLines: 1 }}>
                            {item().title}
                          </Text>
                        </View>
                        <View
                          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                        >
                          <Text style={{ fontSize: 10, color: "#a1a1aa" }}>#{item().id + 1}</Text>
                          <View
                            {...panFor(i, item).panHandlers}
                            panActivation={{ activeOffsetX: 8, failOffsetY: 20 }}
                            testID={`drag-${item().id}`}
                            style={{
                              paddingHorizontal: 10,
                              paddingVertical: 2,
                              borderRadius: 6,
                              backgroundColor: "#e4e4e7",
                            }}
                          >
                            <Text style={{ fontSize: 12, color: "#52525b" }}>⠿</Text>
                          </View>
                        </View>
                      </View>
                    );
                  }}
                </List>
              </View>
            );
          })}
        </View>
      </Scroll>

      <If when={drag() !== null}>
        <Overlay style={{ position: "absolute", left: 0, top: 0, width: COL_W - 12, pointerEvents: "none" }}>
          <View
            style={{
              height: 64,
              borderRadius: 10,
              backgroundColor: "#ffffff",
              padding: 10,
              translate: [previewX, previewY],
              opacity: 0.95,
              boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: "600", numberOfLines: 1 }}>
              {drag()?.title ?? ""}
            </Text>
            <Text style={{ fontSize: 10, color: "#71717a" }}>
              → {COL_TITLES[drag()?.to ?? 0]} @ {drag()?.index ?? 0}
            </Text>
          </View>
        </Overlay>
      </If>

      <If when={editId() !== null}>
        <Overlay
          style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.35)" }}
          onPressOutside={() => editId.set(null)}
        >
          <View
            style={{
              margin: 16,
              marginTop: 80,
              padding: 16,
              gap: 10,
              borderRadius: 14,
              backgroundColor: "#ffffff",
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: "700" }}>编辑卡片 #{((editId() ?? 0) + 1).toString()}</Text>
            <Input
              testID="card-title-input"
              value={editTitle()}
              placeholder="用中文输入标题（试试拼音候选）"
              onChange={({ value }) => {
                editTitle.set(value);
                const id = editId();
                if (id !== null) updateCard(id, value);
              }}
              onCompositionChange={({ text }) => composing.set(text)}
              style={{
                fontSize: 15,
                paddingHorizontal: 10,
                paddingVertical: 8,
                borderWidth: 1,
                borderColor: "#d4d4d8",
                borderRadius: 8,
              }}
            />
            <Input
              testID="card-notes-input"
              multiline
              value={editNotes()}
              placeholder="备注（多行，试试 Cmd+Z / 长按删除）"
              onChange={({ value }) => editNotes.set(value)}
              onCompositionChange={({ text }) => composing.set(text)}
              style={{
                height: 90,
                fontSize: 13,
                paddingHorizontal: 10,
                paddingVertical: 8,
                borderWidth: 1,
                borderColor: "#d4d4d8",
                borderRadius: 8,
              }}
            />
            <Text style={{ fontSize: 11, color: "#71717a" }}>正在输入（composition）：{composing() || "—"}</Text>
            <View
              onPress={() => editId.set(null)}
              style={{ alignSelf: "flex-end", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: "#2563eb" }}
            >
              <Text style={{ fontSize: 13, color: "#ffffff", fontWeight: "600" }}>完成</Text>
            </View>
          </View>
        </Overlay>
      </If>
    </View>
  );
}

mount(App);
