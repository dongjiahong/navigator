import { Clipboard, Text, View, signal, windowSize } from "nsh";
import { AlertDialog, Dialog } from "nsh/base";
import {
  boardToJson,
  boardToMarkdown,
  exportName,
  parseBoard,
  planImport,
  planRestore,
  type BackupEntry,
} from "./backup";
import { backupEntries, backupText, writeExport } from "./backupStore";
import { cards, now, tags } from "./data";
import { mergeBoards, mergeTags } from "./merge";
import { theme } from "./theme";
import { IconButton } from "./ui";

/**
 * 导出、导入与从备份恢复：the board leaving the app, and coming back.
 *
 * Three verbs, all of them from the palette, all of them one press from the
 * board rather than a settings screen: a Mac user does this exactly when
 * something has gone wrong, and finding a menu for it is the last thing they
 * want to do.
 *
 * **Where the file goes.** nsh has no save panel and no file picker (checked
 * against `.nsh/types`: `nsh/desktop` is the window, the menu and the title bar
 * and nothing else), and `openUrl` refuses a `file:` URL, so there is no way to
 * reveal a folder in Finder either. An export therefore lands in 下载, named
 * with the day and the hour, and the app says so in one line at the foot of the
 * window. An import reads what the user copied — the clipboard is the one
 * channel this platform gives an app without a picker.
 *
 * **What it looks like.** One line at the foot of the board, the same paper on
 * `shadowLift` as the undo offer, with no action and no colour: this is a
 * report, not a decision. The restore sheet is one floating panel with rows of
 * pressed paper for the selection, never the accent.
 */

/** What the app has to say about the last export, import or restore. */
const notice = signal<string | null>(null);

/** How long the line stays: long enough to read a date and a count. */
const NOTICE_MS = 6000;

let noticeTimer: ReturnType<typeof setTimeout> | null = null;

/** Says one thing, and takes back whatever it said before. */
function say(text: string): void {
  if (noticeTimer) clearTimeout(noticeTimer);
  notice.set(text);
  noticeTimer = setTimeout(() => {
    noticeTimer = null;
    notice.set(null);
  }, NOTICE_MS);
}

function hush(): void {
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = null;
  notice.set(null);
}

/** The restore sheet, and the backups it lists. */
const restoreOpen = signal(false);
const backups = signal<BackupEntry[]>([]);
const picked = signal<string | null>(null);

/** The day a snapshot is named for, `navigator-2026-11-08.json` → `2026-11-08`. */
function dayOf(name: string): string {
  return name.startsWith("navigator-") ? name.slice("navigator-".length, -".json".length) : name;
}

/** Asks in the platform's alert, with the action as an ordinary one. */
async function ask(title: string, description: string, action: string): Promise<boolean> {
  const result = await AlertDialog.show({
    title,
    description,
    actions: [
      { id: "cancel", label: "取消", role: "cancel" },
      { id: "confirm", label: action, role: "default" },
    ],
  });
  return result.action === "confirm";
}

/**
 * Writes the board to 下载 as JSON or Markdown.
 *
 * The JSON is the file an import reads back; the Markdown is the one a person
 * reads. Both are the live board only — a removed card is not work, and an
 * export is a document.
 */
export async function exportBoard(kind: "json" | "markdown"): Promise<void> {
  const at = new Date();
  const name = exportName(kind, at);
  const text =
    kind === "json"
      ? boardToJson(cards(), tags(), at.getTime())
      : boardToMarkdown(cards(), tags(), at);
  try {
    writeExport(name, text);
  } catch (error) {
    console.log(`[navigator] export failed: ${error}`);
    say("导出失败，下载文件夹写不进去");
    return;
  }
  say(`已导出到下载：${name}`);
}

/**
 * Imports what is on the clipboard, merging by stamp.
 *
 * The counts are asked over before anything is written: an import is the one
 * press here that can change cards the user is not looking at, and 「导入 3 张
 * 新卡、更新 1 张？」 is a question that can be answered. A text that is not a
 * board changes nothing and says why.
 */
export async function importFromClipboard(): Promise<void> {
  let text = "";
  try {
    text = await Clipboard.readText();
  } catch (error) {
    console.log(`[navigator] clipboard unreadable: ${error}`);
    say("读不到剪贴板");
    return;
  }
  if (!text.trim()) {
    say("剪贴板是空的");
    return;
  }
  const parsed = parseBoard(text);
  if ("error" in parsed) {
    say(`剪贴板里不是看板 JSON：${parsed.error}`);
    return;
  }
  const plan = planImport(cards(), parsed.board.cards);
  if (!plan.add.length && !plan.update.length) {
    say("剪贴板里的卡片都在看板上");
    return;
  }
  const yes = await ask(
    "导入看板？",
    `导入 ${plan.add.length} 张新卡、更新 ${plan.update.length} 张？本机更新的同 id 卡片不会被覆盖。`,
    "导入",
  );
  if (!yes) return;
  cards.set(mergeBoards(cards(), [...plan.add, ...plan.update]));
  if (parsed.board.tags.length) tags.set(mergeTags(tags(), parsed.board.tags));
  say(`已导入 ${plan.add.length} 张新卡，更新 ${plan.update.length} 张`);
}

/** Opens the restore sheet, on the snapshots the launch can see. */
export function openRestore(): void {
  backups.set(backupEntries());
  picked.set(null);
  restoreOpen.set(true);
}

/**
 * Puts one snapshot back.
 *
 * The plan is computed before the question is asked, so the question can name
 * what it is about to write, and applied after it is answered. `now()` is read
 * once, before the plan: every restored row carries that one stamp, minted above
 * every stamp on the board, so the restore wins the merge on the other device
 * without the rows disagreeing about when they were written.
 */
async function restore(name: string): Promise<void> {
  picked.set(name);
  let text = "";
  try {
    text = backupText(name);
  } catch (error) {
    console.log(`[navigator] backup unreadable: ${error}`);
    say("备份文件读不出来");
    return;
  }
  const parsed = parseBoard(text);
  if ("error" in parsed) {
    say(`备份文件坏了：${parsed.error}`);
    return;
  }
  const stamp = now();
  const plan = planRestore({ cards: cards(), tags: tags() }, parsed.board, stamp);
  if (!plan.cards.length && !plan.tags.length) {
    restoreOpen.set(false);
    say(`${dayOf(name)} 的备份与看板一致`);
    return;
  }
  const yes = await ask(
    "从备份恢复？",
    `${dayOf(name)} 的备份将写回 ${plan.cards.length} 张卡片、${plan.tags.length} 个标签。备份之后新建或修改的卡片不会被删掉。`,
    "恢复",
  );
  if (!yes) return;
  if (plan.cards.length) cards.set(mergeBoards(cards(), plan.cards));
  if (plan.tags.length) tags.set(mergeTags(tags(), plan.tags));
  restoreOpen.set(false);
  say(`已恢复 ${plan.cards.length} 张卡`);
}

/**
 * The two pieces of furniture these verbs need: the line at the foot of the
 * window, and the sheet that lists the snapshots. Mounted once, by the app, so
 * both layouts share them the way they share the tag manager.
 */
export function BackupTool() {
  const wide = () => windowSize().width >= 900;
  return (
    <>
      {/* The restore sheet: one raised object over the board, its rows paper
          pressed into the panel for the one being restored. */}
      <Dialog
        testID="restore-sheet"
        open={restoreOpen()}
        animation="fade"
        closeOnEscape
        onCancel={() => restoreOpen.set(false)}
        onOpenChange={({ open }) => {
          if (!open) restoreOpen.set(false);
        }}
        backdropStyle={{ backgroundColor: theme().scrim }}
        style={{
          margin: "auto",
          width: windowSize().width < 520 ? windowSize().width - 40 : 400,
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
            paddingLeft: 16,
            paddingRight: 8,
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderBottomColor: theme().divider,
          }}
        >
          <Text style={{ fontSize: 15, fontWeight: "600", color: theme().text }}>从备份恢复</Text>
          <View style={{ flex: 1 }} />
          <IconButton
            name="close"
            tint={theme().textTertiary}
            size={26}
            label="关闭"
            onPress={() => restoreOpen.set(false)}
          />
        </View>
        <View style={{ paddingVertical: 6, paddingHorizontal: 6, gap: 1 }}>
          <If when={backups().length === 0}>
            <Text style={{ padding: 10, fontSize: 12.5, lineHeight: 18, color: theme().textTertiary }}>
              还没有备份。每天第一次打开时，看板会自己存一份，留最近 7 份。
            </Text>
          </If>
          <Each of={backups()} key={(entry) => entry.name}>
            {(item) => <BackupRow entry={item} onPick={restore} />}
          </Each>
          <If when={backups().length > 0}>
            <Text style={{ padding: 10, paddingTop: 8, fontSize: 11.5, lineHeight: 17, color: theme().textTertiary }}>
              恢复只写回缺失、被删掉或改动过的卡片，备份之后新建的卡片不会被删。
            </Text>
          </If>
        </View>
      </Dialog>

      {/* One line at the foot of whatever is showing, and no action: the
          export already happened, and a notice that needs dismissing is a
          second thing to do. */}
      <If when={notice() !== null}>
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            paddingBottom: "env(safe-area-inset-bottom)",
            alignItems: wide() ? "center" : "stretch",
            paddingHorizontal: wide() ? 0 : 16,
            pointerEvents: "box-none",
          }}
        >
          <View
            testID="backup-notice"
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              maxWidth: wide() ? 460 : 520,
              marginBottom: wide() ? 20 : 92,
              paddingLeft: 14,
              paddingRight: 6,
              paddingVertical: 6,
              borderRadius: 12,
              backgroundColor: theme().card,
              boxShadow: theme().shadowLift,
            }}
          >
            <Text style={{ flexShrink: 1, fontSize: 13, fontWeight: "500", color: theme().text, numberOfLines: 2 }}>
              {notice() ?? ""}
            </Text>
            <IconButton
              name="close"
              tint={theme().textTertiary}
              size={26}
              label="关闭提示"
              onPress={hush}
            />
          </View>
        </View>
      </If>
    </>
  );
}

/**
 * One snapshot: the day it was taken, what is in it, and nothing else. A press
 * asks before it writes.
 */
function BackupRow(props: { entry: () => BackupEntry; onPick: (name: string) => void }) {
  const entry = () => props.entry();
  const selected = () => picked() === entry().name;
  return (
    <View
      testID={`backup-${dayOf(entry().name)}`}
      onPress={() => props.onPick(entry().name)}
      role="button"
      accessibilityLabel={`恢复 ${dayOf(entry().name)} 的备份`}
      accessibilityState={{ selected: selected() }}
      hoverStyle={{ backgroundColor: theme().select }}
      activeStyle={{ opacity: 0.6 }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        height: 38,
        paddingHorizontal: 10,
        borderRadius: 7,
        backgroundColor: selected() ? theme().select : "transparent",
      }}
    >
      <Text style={{ flex: 1, fontSize: 13, color: theme().text, numberOfLines: 1 }}>{dayOf(entry().name)}</Text>
      <Text
        style={{
          fontSize: 11.5,
          fontWeight: "500",
          color: theme().textTertiary,
          fontVariant: ["tabular-nums"],
        }}
      >
        {entry().cards} 张
      </Text>
    </View>
  );
}
