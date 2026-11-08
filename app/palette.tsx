import { Scroll, Text, View, effect, keymap, signal, windowSize } from "nsh";
import { Dialog, Input } from "nsh/base";
import { COLUMNS, boardTags, cards, type Card, type Status, type Tag } from "./data";
import { clearFilters, tagFilter } from "./filters";
import { LEAD_CHOICES, leadMinutes, setLeadMinutes } from "./deadline";
import { Icon, IconButton, clearArchive, managingTags } from "./ui";
import { hueColor, theme, type Hue } from "./theme";

/**
 * The command palette: one field that either names a card or runs one of the
 * board's few commands.
 *
 * A Mac is driven from the keyboard, and the board has grown enough verbs that
 * remembering a shortcut for each of them is worse than remembering one. Cmd+K
 * opens a field over the board, the field takes what is typed, and the list
 * under it answers with the cards that match and the commands that fit — the
 * same list the user could walk with the pointer.
 */

/** What a command does when it is chosen. */
export type CommandKind = "new" | "open" | "tag" | "unfilter" | "clear-archive" | "tags" | "lead";

export type Command = {
  /** Stable within one open palette, and the row's test id. */
  id: string;
  kind: CommandKind;
  label: string;
  /** What the row carries on its right: a column, a count. */
  hint?: string;
  /** The card an `open` command reads. */
  cardId?: string;
  /** The tag a `tag` command narrows to, and the dot its row draws. */
  tagId?: string;
  hue?: Hue;
  /** The lead time a `lead` command sets, in minutes; `0` is off. */
  lead?: number;
};

/** How many cards the palette will offer: more is a list to read, not a choice. */
const MAX_CARDS = 8;

/**
 * How well `needle` matches `haystack`: `-1` for not at all, higher for better.
 *
 * A query that starts the text wins, a query inside it comes next, and one whose
 * letters are merely in order is last — the same "typing narrows as you go"
 * order a search field has, so the first row is the row Enter takes.
 */
function score(needle: string, haystack: string): number {
  if (!needle) return 0;
  const at = haystack.indexOf(needle);
  if (at === 0) return 1000;
  if (at > 0) return 700 - Math.min(300, at);
  // Every character in order, with the gaps counting against it.
  let i = 0;
  let gaps = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i += 1;
    else if (i > 0) gaps += 1;
    if (i === needle.length) break;
  }
  if (i < needle.length) return -1;
  return Math.max(1, 400 - gaps);
}

/** A card's own score: its title first, then its tags, then its notes. */
function cardScore(query: string, card: Card, tagName: (id: string) => string): number {
  if (card.deleted) return -1;
  const title = score(query, card.title.toLowerCase());
  const tags = score(query, card.tags.map(tagName).join(" ").toLowerCase());
  const notes = score(query, card.notes.toLowerCase());
  // A title hit is what the user meant; a note hit is still a hit, but behind
  // every card whose title matched.
  if (title >= 0) return title + 200;
  if (tags >= 0) return tags + 100;
  return notes;
}

/**
 * The rows the palette shows for `query`: the board's commands, and the cards
 * whose title, notes or tag names match it.
 *
 * Pure, and the whole of the palette's judgement: the component draws what comes
 * back and runs what is chosen. It is written so that an empty query is a short,
 * stable list of verbs — opening a palette should not be a wall of every card on
 * the board — and any query puts the cards it matches above the verbs.
 */
export function rankCommands(
  query: string,
  all: Card[],
  tags: Tag[],
  lead: number = leadMinutes(),
): Command[] {
  const q = query.trim().toLowerCase();
  const tagName = (id: string) => tags.find((t) => t.id === id)?.label ?? id;
  const out: { command: Command; rank: number }[] = [];

  // `base` is where a verb sits when nothing is typed: the everyday ones first,
  // the housekeeping last.
  const offer = (command: Command, words: string, base: number) => {
    const rank = q ? score(q, words.toLowerCase()) : base;
    if (rank >= 0) out.push({ command, rank });
  };

  offer({ id: "new", kind: "new", label: "新建卡片", hint: "待办" }, "新建卡片 新建 卡片 new", 100);

  const archived = all.filter((c) => !c.deleted && c.status === "archive").length;
  if (archived > 0) {
    offer({ id: "clear-archive", kind: "clear-archive", label: "清空归档", hint: `${archived} 张` }, "清空归档 删除 清空 archive", 90);
  }

  offer({ id: "tags", kind: "tags", label: "标签管理" }, "标签管理 标签 tag", 80);

  for (const tag of tags) {
    offer(
      { id: `tag-${tag.id}`, kind: "tag", tagId: tag.id, hue: tag.hue, label: `按标签筛选：${tag.label}` },
      // The label as it is written, and the tag's name on its own: typing
      // 学习 narrows to 学习, typing the whole row narrows to that one row.
      `按标签筛选：${tag.label} ${tag.label}`,
      70,
    );
  }

  offer({ id: "unfilter", kind: "unfilter", label: "清除筛选", hint: "全部" }, "清除筛选 全部 显示所有", 60);

  // The Mac's only setting: there is no settings page, and a lead time is one
  // number, so it is one row per value in the field that already reaches every
  // verb. The lead in use says so on its own row rather than in a status line.
  for (const minutes of LEAD_CHOICES) {
    const label = minutes === 0 ? "提前提醒：关闭" : `提前提醒：${minutes} 分钟`;
    offer(
      { id: `lead-${minutes}`, kind: "lead", lead: minutes, label, hint: minutes === lead ? "当前" : undefined },
      `提前提醒 提醒 提前 ${minutes === 0 ? "关闭 不提醒" : `${minutes} 分钟`}`,
      50,
    );
  }

  if (q) {
    const matched = all
      .map((card) => ({ card, rank: cardScore(q, card, tagName) }))
      .filter((hit) => hit.rank >= 0)
      // Newest first among equals: the card the user touched last is the one
      // they are most likely to be looking for.
      .sort((a, b) => b.rank - a.rank || (b.card.updatedAt ?? 0) - (a.card.updatedAt ?? 0))
      .slice(0, MAX_CARDS);
    for (const { card, rank } of matched) {
      out.push({
        command: {
          id: `card-${card.id}`,
          kind: "open",
          cardId: card.id,
          label: card.title.trim() || "未命名卡片",
          hint: columnLabel(card.status),
        },
        rank,
      });
    }
  }

  // `sort` is stable, so two rows of equal rank keep the order they were
  // offered in — the verbs do not shuffle between keystrokes.
  out.sort((a, b) => b.rank - a.rank);
  return out.map((hit) => hit.command);
}

function columnLabel(status: Status): string {
  return COLUMNS.find((c) => c.id === status)?.label ?? status;
}

/** Whether the palette owns the keyboard. The board's keys read this. */
export const paletteOpen = signal(false);

/** The query, and which row Enter would take. Reset each time it opens. */
const query = signal("");
const cursor = signal(0);

/** Opens the palette on an empty field, as Cmd+K does. */
export function openPalette(): void {
  query.set("");
  cursor.set(0);
  paletteOpen.set(true);
}

export function closePalette(): void {
  paletteOpen.set(false);
}

/** The rows for what is typed right now. */
function results(): Command[] {
  return rankCommands(query(), cards(), boardTags());
}

/**
 * One step of the keyboard's cursor through the list, wrapping at both ends so
 * the last row's down lands on the first.
 */
function step(by: number): void {
  if (!paletteOpen()) return;
  const count = results().length;
  if (count === 0) return;
  cursor.set((((cursor() + by) % count) + count) % count);
}

/**
 * The palette itself, over whatever the window is showing.
 *
 * It is a `Dialog` so it floats above the board and above an open card without
 * resizing either, and it is one raised object: panel fill, 16px radius, the
 * lifted shadow, no border. Its rows are text and — for a tag — that tag's dot,
 * which is the only colour the board allows a row.
 */
export function CommandPalette(props: { onNew: () => void; onOpen: (id: string) => void }) {
  /** Runs the row `id` names, and closes. */
  const run = (id: string) => {
    // One press runs one row: the return key arrives from more than one place
    // (a field's key report, a binding), and the palette is already closed for
    // the second of them.
    if (!paletteOpen()) return;
    const chosen = results().find((command) => command.id === id);
    if (!chosen) return;
    closePalette();
    switch (chosen.kind) {
      case "new":
        props.onNew();
        break;
      case "open":
        if (chosen.cardId) props.onOpen(chosen.cardId);
        break;
      case "tag":
        tagFilter.set(chosen.tagId ?? null);
        break;
      case "unfilter":
        clearFilters();
        break;
      case "clear-archive":
        void clearArchive();
        break;
      case "tags":
        managingTags.set(true);
        break;
      case "lead":
        setLeadMinutes(chosen.lead ?? 0);
        break;
    }
  };

  /**
   * The keys belong to the palette only while it is up.
   *
   * They have to be `always`: its field has the keyboard, and in a field the
   * arrows are the caret's and the return key is the return key, so a binding
   * waiting for `notEditing` would never fire. Bound for the component's whole
   * life they would be newer than the board's own arrows and Enter, and a closed
   * palette would swallow the keys of an open board — so they are bound when it
   * opens and taken back when it closes.
   */
  effect(() => {
    if (!paletteOpen()) return;
    const arrows = keymap.bind({ down: () => step(1), up: () => step(-1) }, { when: "always", repeat: true });
    const keys = keymap.bind(
      { enter: () => run(selectedId() ?? ""), escape: closePalette },
      { when: "always" },
    );
    return () => {
      arrows();
      keys();
    };
  });

  return (
    <Dialog
      testID="palette"
      open={paletteOpen()}
      animation="fade"
      // Escape closes the palette natively as well; `onCancel` is the same
      // answer whichever of the two arrives first.
      closeOnEscape
      onCancel={closePalette}
      onOpenChange={({ open }) => {
        if (open) openPalette();
        else closePalette();
      }}
      backdropStyle={{ backgroundColor: theme().scrim }}
      style={{
        margin: "auto",
        width: Math.min(480, Math.max(300, windowSize().width - 60)),
        borderRadius: 16,
        backgroundColor: theme().panel,
        boxShadow: theme().shadowLift,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingLeft: 16,
          paddingRight: 8,
          paddingVertical: 4,
          borderBottomWidth: 1,
          borderBottomColor: theme().divider,
        }}
      >
        <Input
          testID="palette-input"
          autoFocus
          value={query()}
          placeholder="搜索卡片，或输入一条命令"
          accessibilityLabel="命令面板"
          // The return key runs the row the list is on. It is reported here
          // rather than through `onSubmit`: a return key pressed on an empty
          // field submits nothing, and 新建卡片 is exactly the row an empty
          // field is on.
          submitBehavior="submit"
          onKeyPress={({ key }) => {
            if (key === "Enter") run(selectedId() ?? "");
          }}
          onChange={({ value: next }) => {
            query.set(next);
            cursor.set(0);
          }}
          style={{
            flex: 1,
            height: 34,
            padding: 0,
            fontSize: 15,
            color: theme().text,
            placeholderColor: theme().textTertiary,
          }}
        />
        <IconButton name="close" tint={theme().textTertiary} size={26} label="关闭" onPress={closePalette} />
      </View>

      <Scroll scrollbar={false} style={{ maxHeight: 336 }} contentStyle={{ paddingVertical: 6, paddingHorizontal: 6 }}>
        {/* The rows are built from the board where they are drawn, not in a
            `computed` of their own: a value computed for a dialog that is closed
            is a tree nothing ever mounted, and this engine frees such a tree
            twice when the app goes away. */}
        <If when={results().length === 0}>
          <View style={{ paddingHorizontal: 10, paddingVertical: 12 }}>
            <Text style={{ fontSize: 12.5, color: theme().textTertiary }}>没有匹配的卡片或命令</Text>
          </View>
        </If>
        <Each of={results()} key={(command) => command.id}>
          {(item) => <CommandRow command={item} onRun={run} />}
        </Each>
      </Scroll>
    </Dialog>
  );
}

/**
 * One row of the list: a glyph or a tag's dot, the label, and what the row says
 * on its right. Selection is paper pressed into the panel, never the accent.
 */
function CommandRow(props: { command: () => Command; onRun: (id: string) => void }) {
  const command = () => props.command();
  /** Whether the keyboard is on this row, read where it is drawn. */
  const selected = () => {
    const list = results();
    const at = Math.min(cursor(), Math.max(0, list.length - 1));
    return list[at]?.id === command().id;
  };
  return (
    <View
      testID={`cmd-${command().id}`}
      onPress={() => props.onRun(command().id)}
      role="button"
      accessibilityLabel={command().label}
      accessibilityState={{ selected: selected() }}
      hoverStyle={{ backgroundColor: theme().chip }}
      activeStyle={{ opacity: 0.6 }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 34,
        paddingHorizontal: 10,
        borderRadius: 7,
        backgroundColor: selected() ? theme().select : "transparent",
      }}
    >
      {command().kind === "tag" ? (
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: hueColor(command().hue ?? "blue"),
          }}
        />
      ) : (
        <Icon
          name={command().kind === "open" ? "chevron" : commandGlyph(command().kind)}
          size={11}
          tint={theme().textTertiary}
          width={1.8}
        />
      )}
      <Text
        style={{
          flexShrink: 1,
          fontSize: 13,
          fontWeight: "400",
          color: command().kind === "open" ? theme().text : theme().textSecondary,
          numberOfLines: 1,
        }}
      >
        {command().label}
      </Text>
      <View style={{ flex: 1 }} />
      <Text style={{ fontSize: 11.5, fontWeight: "500", color: theme().textTertiary, numberOfLines: 1 }}>
        {command().hint ?? ""}
      </Text>
    </View>
  );
}

/** The id of the row the keyboard is on. */
function selectedId(): string | null {
  const list = results();
  if (list.length === 0) return null;
  return list[Math.min(cursor(), list.length - 1)].id;
}

/** The glyph a verb carries, from the board's own icon set. */
function commandGlyph(kind: CommandKind): "plus" | "archive" | "tag" | "inbox" | "chevron" | "calendar" {
  switch (kind) {
    case "new":
      return "plus";
    case "clear-archive":
      return "archive";
    case "tags":
    case "tag":
      return "tag";
    case "unfilter":
      return "inbox";
    case "lead":
      return "calendar";
    default:
      return "chevron";
  }
}
