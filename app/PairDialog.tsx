import { Text, View, signal, windowSize } from "nsh";
import { Dialog, Input } from "nsh/base";
import {
  canPair,
  closePairPanel,
  digits,
  pairCode,
  pairCodeLabel,
  pairLine,
  pairOpen,
  peerLine,
} from "./pairing";
import { openPairCode, pairWith, peers, regenerateHostCode } from "./sync";
import { IconButton, confirm } from "./ui";
import { onAccentWash, theme } from "./theme";

/** The digits typed to join another device's board, before they are taken. */
const adoptDraft = signal("");

/**
 * The six digits, on the Mac.
 *
 * One small text button in the title band opens a panel with the code in it and
 * nothing else: a number to read off a screen and type into a phone or a second
 * Mac. It is the one place the digits appear — the status line belongs to sync,
 * and a code printed there would be a number nobody can find when they need it.
 *
 * **One board, one code.** A second Mac does not make a board of its own: it
 * types the code shown here, and from then on it answers to the same digits and
 * the two are in step with each other. That is what the field under the digits
 * is for, and why the old copy about "the phone" had to go.
 *
 * Making a new one asks first, in the platform's own alert, because it is not
 * something the app can take back: every device that was paired has to be handed
 * the new digits.
 */
export function PairDialog() {
  /** Asks, then replaces the code. A cancel leaves the old one working. */
  const regenerate = async () => {
    const yes = await confirm(
      "重新生成配对码？",
      "重新生成后，已配对的手机和另一台 Mac 都需要重新输入新的 6 位数字。",
      "重新生成",
    );
    if (yes) await regenerateHostCode();
  };

  /** Joins another device's board: its code becomes this Mac's code too. */
  const adopt = async () => {
    if (!canPair(adoptDraft())) return;
    if (await pairWith(adoptDraft())) adoptDraft.set("");
  };

  return (
    <Dialog
      testID="pair-code"
      open={pairOpen()}
      animation="fade"
      closeOnEscape
      onCancel={closePairPanel}
      onOpenChange={({ open }) => pairOpen.set(open)}
      backdropStyle={{ backgroundColor: theme().scrim }}
      style={{
        margin: "auto",
        width: windowSize().width < 420 ? windowSize().width - 40 : 340,
        borderRadius: 16,
        backgroundColor: theme().panel,
        padding: 18,
        gap: 12,
        boxShadow: theme().shadowLift,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ fontSize: 16, fontWeight: "600", color: theme().text }}>配对码</Text>
        <View style={{ flex: 1 }} />
        <IconButton
          name="close"
          tint={theme().textSecondary}
          size={28}
          label="关闭"
          onPress={closePairPanel}
        />
      </View>

      {/* Digits, at a size read across a desk, in tabular figures so they do not
          shift as a new code replaces an old one. */}
      <Text
        testID="pair-code-digits"
        accessibilityLabel={pairCodeLabel(pairCode())}
        style={{
          fontSize: 36,
          lineHeight: 46,
          fontWeight: "500",
          letterSpacing: 3,
          color: theme().text,
          fontVariant: ["tabular-nums"],
          textAlign: "center",
        }}
      >
        {pairCodeLabel(pairCode())}
      </Text>

      <Text style={{ fontSize: 12.5, lineHeight: 19, color: theme().textSecondary }}>
        在手机或另一台 Mac 的配对里输入这 6 位数字。同一张看板只需要一个码。
      </Text>

      {/* Which devices this board is actually on. Quiet rows, one per peer: the
          status line can only say one thing, and the interesting question with
          two Macs is which of them is not in step. */}
      <If when={peers().length > 0}>
        <View style={{ height: 1, backgroundColor: theme().hairline }} />
        <Text style={{ fontSize: 11.5, fontWeight: "600", color: theme().textTertiary, letterSpacing: 0.3 }}>
          设备
        </Text>
        {peers().map((peer) => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text
              style={{
                flex: 1,
                fontSize: 12,
                color: theme().textSecondary,
                fontVariant: ["tabular-nums"],
              }}
            >
              {peer.addr}
            </Text>
            <Text
              testID={`pair-peer-${peer.addr}`}
              style={{
                fontSize: 12,
                color: peer.ok ? theme().textTertiary : theme().danger,
              }}
            >
              {peerLine(peer)}
            </Text>
          </View>
        ))}
      </If>

      {/* The way a second Mac joins: the digits from the first one, typed here.
          It is the same six digits the phone types, because it is the same
          board. */}
      <View style={{ height: 1, backgroundColor: theme().hairline }} />
      <Text style={{ fontSize: 12.5, lineHeight: 19, color: theme().textSecondary }}>
        第二台 Mac 输入另一台设备上的码，两边就接在同一张看板上。
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Input
            testID="pair-adopt"
            value={adoptDraft()}
            placeholder="另一台设备的码"
            keyboardType="number-pad"
            maxLength={6}
            onChange={({ value }) => adoptDraft.set(digits(value))}
            style={{
              fontSize: 16,
              letterSpacing: 2,
              color: theme().text,
              placeholderColor: theme().textTertiary,
              height: 40,
              padding: 0,
            }}
          />
        </View>
        <View
          testID="pair-adopt-save"
          onPress={() => void adopt()}
          role="button"
          accessibilityLabel="使用这个配对码"
          accessibilityState={{ disabled: !canPair(adoptDraft()) }}
          hoverStyle={{ opacity: 0.7 }}
          activeStyle={{ opacity: 0.5 }}
          style={{
            height: 40,
            paddingLeft: 14,
            paddingRight: 14,
            borderRadius: 9,
            backgroundColor: canPair(adoptDraft()) ? theme().accentSoft : theme().chip,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              fontSize: 13,
              fontWeight: "600",
              color: canPair(adoptDraft()) ? onAccentWash() : theme().textTertiary,
            }}
          >
            使用
          </Text>
        </View>
      </View>
      <If when={pairLine() !== "" && pairLine() !== "需要配对码"}>
        <Text testID="pair-code-note" style={{ fontSize: 12, color: theme().textSecondary }}>
          {pairLine()}
        </Text>
      </If>

      <View
        testID="pair-regenerate"
        onPress={() => void regenerate()}
        role="button"
        accessibilityLabel="重新生成配对码"
        hoverStyle={{ opacity: 0.7 }}
        activeStyle={{ opacity: 0.5 }}
        style={{ paddingVertical: 10, alignItems: "center" }}
      >
        {/* A quiet label, like every other thing that is only sometimes
            wanted: the accent belongs to the one press worth making. */}
        <Text style={{ fontSize: 12.5, fontWeight: "500", color: theme().textTertiary }}>
          重新生成
        </Text>
      </View>
    </Dialog>
  );
}

/**
 * The title band's way in. Small and quiet, a step to the right of the sync
 * line it belongs beside: where a user looks when a phone will not connect.
 *
 * The press area is padded well past the words — the label is 11.5pt, so the
 * words alone are a target a pointer misses.
 */
export function PairCodeLink() {
  return (
    <View
      testID="pair-code-open"
      onPress={() => void openPairCode()}
      role="button"
      accessibilityLabel="配对码"
      hoverStyle={{ opacity: 0.7 }}
      activeStyle={{ opacity: 0.5 }}
      style={{ paddingLeft: 9, paddingRight: 6, paddingVertical: 5 }}
    >
      <Text style={{ fontSize: 11.5, fontWeight: "500", color: theme().textTertiary }}>
        配对码
      </Text>
    </View>
  );
}
