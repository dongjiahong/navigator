import { List, Scroll, Text, View, signal, windowSize, type ScrollRef } from "nsh";
import { Input, Sheet } from "nsh/base";
import { COLUMNS, addCard, cards, patchCard, type Card, type Status } from "./data";
import { filteredBoard, isFiltering } from "./filters";
import {
  DueBadge,
  DueEditor,
  Icon,
  IconButton,
  ClearFilterButton,
  SearchField,
  TagFilterRow,
  TagManagerButton,
  TagPicker,
  TagRow,
  alpha,
  confirmRemoveCard,
} from "./ui";
import { theme, onAccentFill, onAccentWash, TYPE } from "./theme";
import { dismissDue, dueNow } from "./reminders";
import { connectTo, detail, endpoint, phase, start, statusLine } from "./sync";

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
function openCard(id: string) {
  shownId.set(id);
  openId.set(id);
}

/**
 * A fixed height for a multiline field, from how many lines its text takes.
 * `Input` has no height of its own, and a box tall enough for the longest card
 * would leave a hole under every short one. `perLine` is a rough count of the
 * characters that fit a line at the field's size.
 */
function fieldHeight(text: string, lineHeight: number, maxLines: number, perLine: number): number {
  const lines = Math.max(1, Math.min(maxLines, Math.ceil([...text].length / perLine)));
  return lines * lineHeight + 6;
}
const capturing = signal(false);
const draftTitle = signal("");
const draftTags = signal<string[]>([]);
const draftDue = signal<string | undefined>(undefined);
/** The sheet where the phone is told which Mac to follow. */
const linking = signal(false);
const draftAddress = signal("");

function todayLine() {
  const d = new Date();
  const wd = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 ${wd}`;
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
        width: 44,
        height: 44,
        marginLeft: -11,
        marginTop: -10,
        marginBottom: -10,
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
  return (
    <View
      testID={`row-${c().id}`}
      onPress={() => openCard(c().id)}
      activeStyle={{ backgroundColor: theme().cardPressed }}
      style={{
        flexDirection: "row",
        gap: 10,
        paddingLeft: 14,
        paddingRight: 12,
        paddingVertical: 13,
        // Rows sit on the column's sheet; a card per row would put a box
        // inside a box on a phone screen.
        backgroundColor: theme().card,
      }}
    >
      <CheckCircle
        card={c}
        onPress={() => patchCard(c().id, { status: settled() ? "todo" : "done" })}
      />
      <View style={{ flex: 1, gap: 5 }}>
        <Text
          style={{
            ...TYPE.phoneTitle,
            color: settled() ? theme().textTertiary : theme().text,
            numberOfLines: 3,
          }}
        >
          {c().title || "未命名卡片"}
        </Text>
        {c().notes ? (
          <Text style={{ fontSize: 13, lineHeight: 19, color: theme().textSecondary, numberOfLines: 1 }}>
            {c().notes}
          </Text>
        ) : null}
        {c().tags.length > 0 || c().due ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 11, flexWrap: "wrap", marginTop: 1 }}>
            {c().tags.length > 0 ? <TagRow ids={c().tags} size="phone" /> : null}
            {c().due ? <DueBadge iso={c().due ?? ""} size="phone" settled={settled()} /> : null}
          </View>
        ) : null}
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
        <TagPicker selected={draftTags()} onChange={draftTags.set} size="phone" />
        <DueEditor due={draftDue()} size="phone" onChange={draftDue.set} />
        <View
          testID="capture-save"
          onPress={() => {
            const text = draftTitle().trim();
            if (!text) return;
            addCard({ title: text, notes: "", tags: draftTags(), due: draftDue() });
            draftTitle.set("");
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
            添加
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
      onOpenChange={({ open }) => {
        if (!open) openId.set(null);
      }}
      closeOnSwipe
      popupStyle={{
        backgroundColor: theme().panel,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        // The fields sit on the sheet itself, so it rises with the keyboard.
        paddingBottom: "env(keyboard-inset-height)",
      }}
      backdropStyle={{ backgroundColor: theme().scrim }}
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
        <IconButton name="close" tint={theme().textSecondary} size={44} label="关闭" onPress={() => openId.set(null)} />
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
        </View>
      </View>
      <View style={{ paddingHorizontal: 20, paddingTop: 10, gap: 14 }}>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {COLUMNS.map((s) => {
            const on = c().status === s.id;
            return (
              <View
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
          size="phone"
          settled={settled()}
          onChange={(iso) => patchCard(c().id, { due: iso })}
        />
        <View style={{ flexDirection: "row", gap: 18, paddingTop: 6 }}>
          <View
            onPress={() => {
              patchCard(c().id, { status: "archive" });
              openId.set(null);
            }}
            role="button"
            accessibilityLabel="移到归档"
          >
            <Text style={{ fontSize: 14, fontWeight: "500", color: theme().textSecondary }}>移到归档</Text>
          </View>
          <View
            testID="detail-delete"
            onPress={() => void confirmRemoveCard(c, () => openId.set(null))}
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
 * Which Mac this phone follows. The Mac shows its address in its own header;
 * typing it here is the whole pairing step, because the service has no accounts.
 */
function LinkSheet() {
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
          同一个 Wi-Fi 下会自动找到 Mac，不用填地址。找不到时，才把 Mac 标题栏里的地址填进来。
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
        {detail() ? (
          <Text style={{ fontSize: 12.5, color: phase() === "error" ? theme().danger : theme().textTertiary }}>
            {detail()}
          </Text>
        ) : null}
        <View
          testID="link-save"
          onPress={() => {
            const address = draftAddress().trim();
            if (!address) return;
            connectTo(address);
            linking.set(false);
          }}
          role="button"
          accessibilityLabel="开始同步"
          style={{
            height: 46,
            borderRadius: 12,
            backgroundColor: theme().accent,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: "600", color: onAccentFill() }}>开始同步</Text>
        </View>
      </View>
    </Sheet>
  );
}

/**
 * The phone: a four-way segmented control over one column, because a portrait
 * screen cannot show four columns. Swiping across the columns beats a tab
 * bar here: the columns are the same board, one screen wide.
 */
export function PhoneHome() {
  return (
    <View style={{ flex: 1 }} testID="phone-home">
      <View
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingHorizontal: 18,
          paddingBottom: 12,
          gap: 2,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "flex-end", paddingTop: 8 }}>
          <Text style={{ fontSize: 29, fontWeight: "700", color: theme().text, letterSpacing: -0.4 }}>领航</Text>
          <View style={{ flex: 1 }} />
          {/* Date and sync state are one target: the status line alone is only
              a dozen pixels tall, which a fingertip cannot hit. The negative
              margins grow the hit area without moving the text. */}
          <View
            testID="phone-sync"
            onPress={() => {
              draftAddress.set(endpoint());
              linking.set(true);
            }}
            role="button"
            accessibilityLabel="同步设置"
            activeStyle={{ opacity: 0.55 }}
            style={{
              alignItems: "flex-end",
              gap: 2,
              paddingVertical: 9,
              paddingLeft: 10,
              paddingRight: 8,
              marginRight: -8,
              marginBottom: -3,
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
      </View>
      <View style={{ paddingBottom: 10 }}>
        <Segment />
      </View>

      {/* A deadline that came due while the app is open. The phone cannot post
          a system notification (Android would drop it: the manifest has no
          POST_NOTIFICATIONS and nsh cannot add one), so this is where a
          reminder lands here. */}
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

      {/* Search and tags, one row above the sheet. The field sits here rather
          than inside a column so a search is one gesture from any page. */}
      <View
        testID="phone-filter"
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 16,
          paddingBottom: 6,
        }}
      >
        <View style={{ flex: 1 }}>
          <SearchField
            size="phone"
            width={Math.max(120, windowSize().width - 32 - (isFiltering() ? 54 : 0))}
          />
        </View>
        <If when={isFiltering()}>
          <ClearFilterButton size="phone" />
        </If>
      </View>
      <Scroll
        horizontal
        scrollbar={false}
        style={{ flexGrow: 0, height: 40 }}
        contentStyle={{ paddingHorizontal: 16, paddingTop: 3, alignItems: "center", gap: 6 }}
      >
        <TagFilterRow size="phone" />
        <TagManagerButton size="phone" />
      </Scroll>

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
    </View>
  );
}
