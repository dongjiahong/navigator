import { Scroll, Text, View, windowSize, type JSX } from "nsh";
import { Dialog, Input } from "nsh/base";
import { COLUMNS, cards, patchCard, removeWithUndo, type Card, type Status } from "./data";
import { DueEditor, IconButton, TagPicker, alpha } from "./ui";
import { theme, onAccentWash, TYPE } from "./theme";

const BLANK = (id: string): Card => ({
  id,
  title: "",
  notes: "",
  tags: [],
  status: "todo",
  updatedAt: 0,
});

/** Styles read the theme where they are used, so a change of appearance repaints
 *  them without re-creating the tree. */
function Field(props: { label: string; children: JSX.Element }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 11, fontWeight: "600", letterSpacing: 0.2, color: theme().textTertiary }}>
        {props.label}
      </Text>
      {props.children}
    </View>
  );
}

function QuickAction(props: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <View
      onPress={props.onPress}
      role="button"
      accessibilityLabel={props.label}
      hoverStyle={{ backgroundColor: theme().chip }}
      activeStyle={{ opacity: 0.6 }}
      style={{
        paddingHorizontal: 9,
        paddingVertical: 5,
        borderRadius: 6,
        backgroundColor: theme().chip,
      }}
    >
      <Text style={{ fontSize: 11.5, fontWeight: "500", color: props.danger ? theme().danger : theme().textSecondary }}>
        {props.label}
      </Text>
    </View>
  );
}

/**
 * The card, opened — a card of its own, floating at the middle of the window.
 *
 * It used to dock as a second column, which pushed the board narrower every
 * time a card was opened: reading one card moved the four columns the user was
 * aiming at. A panel over the board leaves the board exactly where it was, and
 * closing it puts the pointer back on the card it came from.
 *
 * It reads the card by id rather than taking it as a value, so editing text
 * updates only what shows it: passing the card itself would re-create this
 * subtree on every keystroke and the field would lose focus.
 */
export function Inspector(props: {
  id: string | null;
  onClose: () => void;
  onSelectStatus: (s: Status) => void;
}) {
  const id = () => props.id ?? "";
  const card = () => cards().find((c) => c.id === id()) ?? BLANK(id());
  const open = () => props.id !== null;
  // A height, not a ceiling: the scroll inside needs one it can take the rest
  // of, and a popup sized by its content gives it nothing to fill.
  const height = () => Math.max(320, Math.min(600, windowSize().height - 140));
  return (
    <Dialog
      testID="inspector"
      open={open()}
      animation="fade"
      onOpenChange={({ open: next }) => {
        if (!next) props.onClose();
      }}
      backdropStyle={{ backgroundColor: theme().scrim }}
      style={{
        margin: "auto",
        width: Math.min(440, Math.max(300, windowSize().width - 80)),
        height: height(),
        borderRadius: 16,
        backgroundColor: theme().panel,
        boxShadow: theme().shadowLift,
        overflow: "hidden",
      }}
    >
      {/* The platform's title bar is above this panel, so its own strip is a
          plain header: 卡片 at tertiary ink, the close button on the same line. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingLeft: 18,
          paddingRight: 12,
          paddingTop: 10,
          paddingBottom: 8,
          borderBottomWidth: 1,
          borderBottomColor: theme().divider,
        }}
      >
        <Text style={{ fontSize: 12, fontWeight: "500", color: theme().textTertiary }}>卡片</Text>
        <View style={{ flex: 1 }} />
        <IconButton name="close" tint={theme().textSecondary} size={26} label="关闭" onPress={props.onClose} />
      </View>

      <Scroll
        scrollbar={false}
        style={{ flex: 1 }}
        contentStyle={{ padding: 18, paddingTop: 16, paddingBottom: 24, gap: 20 }}
      >
        <Input
          testID="inspector-title"
          multiline
          value={card().title}
          placeholder="要做什么？"
          onChange={({ value }) => patchCard(card().id, { title: value })}
          style={{
            ...TYPE.inspectorTitle,
            color: theme().text,
            placeholderColor: theme().textTertiary,
            height: 58,
            padding: 0,
          }}
        />

        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          {COLUMNS.map((s) => (
            <View
              onPress={() => props.onSelectStatus(s.id)}
              role="button"
              accessibilityLabel={`移到${s.label}`}
              activeStyle={{ opacity: 0.7 }}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 7,
                backgroundColor:
                  card().status === s.id
                    ? alpha(theme().accent, theme().dark ? 0.24 : 0.11)
                    : theme().chip,
              }}
            >
              <Text
                style={{
                  fontSize: 11.5,
                  fontWeight: "600",
                  // On the accent wash the plain accent is 4.55:1 in light and
                  // 3.83:1 in dark; `onAccentWash` clears both.
                  color: card().status === s.id ? onAccentWash() : theme().textSecondary,
                }}
              >
                {s.label}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ height: 1, backgroundColor: theme().hairlineSoft }} />

        <Field label="备注">
          <Input
            testID="inspector-notes"
            multiline
            value={card().notes}
            placeholder="补充细节、链接、下一步…"
            onChange={({ value }) => patchCard(card().id, { notes: value })}
            style={{
              ...TYPE.body,
              color: theme().text,
              placeholderColor: theme().textTertiary,
              height: 96,
              padding: 0,
            }}
          />
        </Field>

        <Field label="标签">
          <TagPicker
            selected={card().tags}
            onChange={(ids) => patchCard(card().id, { tags: ids })}
          />
        </Field>

        <Field label="截止">
          <DueEditor
            due={card().due}
            settled={card().status === "done" || card().status === "archive"}
            onChange={(iso) => patchCard(card().id, { due: iso })}
          />
        </Field>

        <View style={{ height: 1, backgroundColor: theme().hairlineSoft }} />

        <View style={{ flexDirection: "row", gap: 8 }}>
          <QuickAction label="移到归档" onPress={() => props.onSelectStatus("archive")} />
          {/* No alert in front of a delete: the card is kept as a tombstone, so
              the same press offers 撤销 at the foot of the window instead. */}
          <QuickAction
            label="删除卡片"
            danger
            onPress={() => {
              removeWithUndo(card().id);
              props.onClose();
            }}
          />
        </View>
      </Scroll>
    </Dialog>
  );
}
