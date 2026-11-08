import { Text, View, windowSize } from "nsh";
import { Dialog } from "nsh/base";
import { closePairPanel, pairCode, pairCodeLabel, pairOpen } from "./pairing";
import { openPairCode, regenerateHostCode } from "./sync";
import { IconButton, confirm } from "./ui";
import { theme } from "./theme";

/**
 * The six digits, on the Mac.
 *
 * One small text button in the title band opens a panel with the code in it and
 * nothing else: a number to read off a screen and type into a phone. It is the
 * one place the digits appear — the status line belongs to sync, and a code
 * printed there would be a number nobody can find when they need it.
 *
 * Making a new one asks first, in the platform's own alert, because it is not
 * something the app can take back: every phone that was paired has to be handed
 * the new digits.
 */
export function PairDialog() {
  /** Asks, then replaces the code. A cancel leaves the old one working. */
  const regenerate = async () => {
    const yes = await confirm(
      "重新生成配对码？",
      "重新生成后，已配对的手机需要重新输入新的 6 位数字。",
      "重新生成",
    );
    if (yes) await regenerateHostCode();
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
        在手机的「连到 Mac」里输入这 6 位数字。只需要对一次。
      </Text>

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
