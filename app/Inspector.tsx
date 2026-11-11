import { Text, View, createMotion, effect, signal, windowSize, type InputRef } from "nsh";
import { Dialog, Input } from "nsh/base";
import { COLUMNS, cards, patchCard, removeWithUndo, type Card, type Status } from "./data";
import { DueEditor, IconButton, ImageAttachments, NoteLinks, NoteView, TagPicker, alpha, withPastedImages } from "./ui";
import { charsPerLine, fieldHeight } from "./text";
import { noteHeight as heightOfNote, panelSize } from "./panel";
import { theme, onAccentWash, TYPE } from "./theme";

const BLANK = (id: string): Card => ({
  id,
  title: "",
  notes: "",
  tags: [],
  status: "todo",
  updatedAt: 0,
});

/**
 * The room the note has, measured outside the component.
 *
 * `Input` has no height of its own, and the note is the one field that should
 * take whatever the panel has left — so the box around it is `flex: 1` and the
 * height that box was given is read back with `onLayout`. The signal is read in
 * the field's *style*, the one place this engine tracks it: a value read in the
 * component body would never update. Until the first layout reports a number the
 * field falls back to a share of the panel, so it is never a zero-height stripe
 * that jumps once the window settles.
 */
const noteBox = signal(0);

/**
 * The card, opened — a card of its own, floating at the middle of the window.
 *
 * It used to dock as a second column, which pushed the board narrower every
 * time a card was opened: reading one card moved the four columns the user was
 * aiming at. A panel over the board leaves the board exactly where it was, and
 * closing it puts the pointer back on the card it came from.
 *
 * The note is the subject of the panel. Everything else — the status, the tags,
 * the deadline — is one line of controls above it, with no captions and no
 * rule between the groups: a card is written in prose, not filled in as a form,
 * and the old panel spent most of its height on labels for three rows of chips.
 * The panel no longer scrolls anywhere: the note's own field scrolls its text
 * (a native one does), so there is never a scroll inside a scroll.
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
  // A bigger panel than the first one: the note is what a card is read in, and
  // 440 × 600 minus a caption per field left it about a hundred points tall.
  // 560 × 720 at most, and always 80 points inside the window it floats in.
  const height = () => panelSize(windowSize()).height;
  const width = () => panelSize(windowSize()).width;
  const innerWidth = () => width() - 36;
  // The field is the measured box, or a share of the panel until the first
  // layout reports one, and never under `NOTE_MIN`: the reading and the rows sit
  // in the same box as the field, so a note narrowed to a stripe is not a note.
  const noteHeight = () => heightOfNote(noteBox(), height());
  // Which card's note is open for typing. It is the id, not a flag: the panel
  // can move to another card while it is open, and a flag would carry the typing
  // state onto a card nobody touched. Nothing is reset when the panel closes
  // either — a closed panel is showing no card's note, so there is nothing to
  // put back (and an effect that wrote a signal on the way out would re-render a
  // subtree whose card had gone).
  const editingId = signal<string | null>(null);
  const editingNote = () => props.id !== null && editingId() === props.id;
  // The note's field, for the press that opens it: `focus()` is what puts the
  // caret in it, and the field itself reports the focus it took.
  let noteField: InputRef | null = null;
  const editNote = () => {
    editingId.set(props.id);
    // The field is mounted all along (it is the note's one editor), so the
    // focus is asked for at once: a press that opens the note leaves the caret
    // in it, and a key that follows the press has somewhere to go.
    noteField?.focus();
  };
  // A screenshot pasted into the title or the note becomes the card's picture.
  // The text of the paste still goes in as the field's own: only the files are
  // taken out here, and a paste with no picture is left alone.
  const pasteImages = (files: readonly File[]) => {
    if (!files.length) return;
    const id = card().id;
    void withPastedImages(card().images ?? [], files).then((next) => {
      if (next) patchCard(id, { images: next });
    });
  };
  // A short rise as the panel arrives. It moves the panel by a few points and
  // does not touch its opacity — `Dialog` already fades it in, and two fades on
  // one surface read as a slow one.
  const rise = createMotion();
  effect(() => {
    if (open()) void rise.play({ duration: 180, keyframes: { translateY: [6, 0] } });
  });
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
        width: width(),
        height: height(),
        borderRadius: 16,
        backgroundColor: theme().panel,
        boxShadow: theme().shadowLift,
        overflow: "hidden",
        ...rise.style,
      }}
    >
      {/* The platform's title bar is above this panel, so its own strip is a
          plain header: 卡片 at tertiary ink, then the two things that end a
          card's life — filed, or deleted — and the close button, all on the same
          line. The destructive pair used to sit under a rule at the panel's
          foot, where it cost the note a line of height for two presses. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 2,
          paddingLeft: 18,
          paddingRight: 10,
          paddingTop: 9,
          paddingBottom: 8,
          borderBottomWidth: 1,
          borderBottomColor: theme().divider,
        }}
      >
        <Text style={{ fontSize: 12, fontWeight: "500", color: theme().textTertiary }}>卡片</Text>
        <View style={{ flex: 1 }} />
        <IconButton
          name="archive"
          tint={theme().textSecondary}
          size={26}
          label="归档卡片"
          onPress={() => props.onSelectStatus("archive")}
        />
        {/* No alert in front of a delete: the card is kept as a tombstone, so
            the same press offers 撤销 at the foot of the window instead. */}
        <IconButton
          name="trash"
          tint={theme().danger}
          size={26}
          label="删除卡片"
          onPress={() => {
            removeWithUndo(card().id);
            props.onClose();
          }}
        />
        <IconButton name="close" tint={theme().textSecondary} size={26} label="关闭" onPress={props.onClose} />
      </View>

      <View style={{ flex: 1, padding: 18, paddingTop: 14, gap: 12 }}>
        <Input
          testID="inspector-title"
          multiline
          value={card().title}
          placeholder="要做什么？"
          onChange={({ value }) => patchCard(card().id, { title: value })}
          onPaste={(e) => pasteImages(e.files)}
          style={{
            ...TYPE.inspectorTitle,
            color: theme().text,
            placeholderColor: theme().textTertiary,
            // Three lines of title, then it stops: a note is the prose of a
            // card, and a title that pushes the note off the panel has stopped
            // being a title.
            height: fieldHeight(
              card().title,
              TYPE.inspectorTitle.lineHeight,
              3,
              charsPerLine(innerWidth(), TYPE.inspectorTitle.fontSize),
            ),
            padding: 0,
          }}
        />

        {/* The meta strip: three lines, no captions. A caption above every group
            was three lines of the panel spent saying what the chips say. */}
        <View testID="inspector-meta" style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", gap: 6 }}>
            {COLUMNS.map((s) => (
              <View
                onPress={() => props.onSelectStatus(s.id)}
                role="button"
                accessibilityLabel={`移到${s.label}`}
                activeStyle={{ opacity: 0.7 }}
                style={{
                  height: 25,
                  paddingHorizontal: 10,
                  borderRadius: 7,
                  alignItems: "center",
                  justifyContent: "center",
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

          <TagPicker selected={card().tags} onChange={(ids) => patchCard(card().id, { tags: ids })} />

          <DueEditor
            compact
            due={card().due}
            repeat={card().repeat}
            settled={card().status === "done" || card().status === "archive"}
            // Clearing the deadline clears the cycle with it: a card with no
            // deadline has nothing to repeat from, so leaving the cycle behind
            // would be a setting no surface could show.
            onChange={(iso) => patchCard(card().id, iso ? { due: iso } : { due: undefined, repeat: undefined })}
            onRepeatChange={(next) => patchCard(card().id, { repeat: next })}
          />

          {/* A picture is a card's own material, like the note: the strip sits
              in the meta block, above the note whose height it narrows. */}
          <ImageAttachments
            images={card().images ?? []}
            onChange={(next) => patchCard(card().id, { images: next })}
          />
        </View>

        {/* The note, and the rest of the panel's height. The box around the
            field is what `flex: 1` sizes and `onLayout` reports; the field takes
            that height, and a note longer than it scrolls its own text.

            The field stays mounted while the note is read: it is the note's one
            editor, and showing it is what a press on the note does. The reading
            is a layer over the field, on the panel's own fill, so the two never
            reflow the panel — the box has the same measure in both states, and
            the caret lands where the note was. */}
        <View
          testID="inspector-note-area"
          style={{
            flex: 1,
            paddingTop: 10,
            borderTopWidth: 1,
            borderTopColor: theme().hairlineSoft,
          }}
        >
          <View style={{ flex: 1 }} onLayout={(e) => noteBox.set(Math.round(e.bounds.size.height))}>
            <Input
              testID="inspector-notes"
              multiline
              ref={(r) => {
                noteField = r;
              }}
              // The field scrolls its own text, and the bar is chrome the app did
              // not draw: the board and the phone's pages hide theirs for the
              // same reason. A page of paper has no scrollbar down its side.
              scrollbar={false}
              value={card().notes}
              placeholder="补充细节、链接、下一步…"
              onChange={({ value }) => patchCard(card().id, { notes: value })}
              onPaste={(e) => pasteImages(e.files)}
              // The press on the note reveals the field (`editNote`); leaving
              // the field puts the reading back. The field does not reveal
              // itself on focus: it is mounted under the reading all along, and
              // a focus that came without a press (a test typing into it) is
              // not the user asking for the source.
              onBlur={() => editingId.set(null)}
              // The field is under the reading, so it is also out of the screen
              // reader's tree until the reading is put away: a note read twice,
              // once as text and once as a field, is two notes to a listener.
              accessibilityElementsHidden={!editingNote()}
              importantForAccessibility={editingNote() ? "auto" : "no-hide-descendants"}
              style={{
                ...TYPE.body,
                color: theme().text,
                placeholderColor: theme().textTertiary,
                height: noteHeight(),
                padding: 0,
              }}
            />
            <If when={!editingNote()}>
              <View
                // Any press that is not a checklist box or a link is the note
                // asking to be written in: the reading is the whole box, and a
                // blank stretch under a short note should not be the one part
                // of the panel that does nothing.
                onPress={editNote}
                accessibilityLabel="编辑备注"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: theme().panel,
                }}
              >
                <NoteView
                  notes={card().notes}
                  onChange={(next) => patchCard(card().id, { notes: next })}
                  onEdit={editNote}
                />
              </View>
            </If>
          </View>
          {/* A field cannot press what it draws, so the links a note carries are
              rows of their own — and only while the field is what is showing:
              the reading draws them as links. */}
          <If when={editingNote()}>
            <View style={{ paddingTop: 6 }}>
              <NoteLinks text={card().notes} />
            </View>
          </If>
        </View>
      </View>
    </Dialog>
  );
}
