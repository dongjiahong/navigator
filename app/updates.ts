import { platform, signal } from "nsh";
import {
  checkForPackage,
  downloadPackage,
  restartToPackage,
  runningPackage,
  shellInfo,
  type PackageUpdate,
} from "nsh/updater";

/**
 * OTA updates: the app's own code, delivered as a signed package.
 *
 * A package carries the TSX, its images and its fonts, not a new runtime. The
 * installed APK has to exist once; every change after that can arrive here,
 * including the phone's notification and picker work. The source is the GitHub
 * release named in `nsh.json`, and the package is verified against the root
 * public key baked into this build before it is allowed to run.
 *
 * A package runs from the next cold start on Android and iOS; the desktop can
 * restart into it now. The phone therefore says 下次打开生效, not 重启.
 *
 * Finding a package is not installing it: the check stops at 发现 and waits
 * for the press, because a download the user did not ask for is a download
 * that has to finish before the next start.
 */
export type UpdateState = "idle" | "checking" | "found" | "downloading" | "ready" | "current" | "unsupported" | "failed";

export const updateState = signal<UpdateState>("idle");
/** One line for the Mac's toast, the phone's sheet and the palette. */
export const updateLine = signal("检查更新");
/** The version and build of the code that is running now, under the line. */
export const updateCurrent = signal("");
/** Why a check failed, in the words the updater refused it with. */
export const updateDetail = signal("");
/** Whether the Mac's toast is on screen: only a check puts it there. */
export const updateVisible = signal(false);
/** The package waiting for the press (and then for the next start). */
export const updateReady = signal<PackageUpdate | null>(null);
/** 0–1 while a package downloads; 0 otherwise. */
export const updateProgress = signal(0);

let started = false;
let busy = false;
let autoChecked = false;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

/** Whether this shell can run a downloaded package at all. */
function canUpdate(): boolean {
  try {
    return shellInfo().packages;
  } catch {
    return false;
  }
}

/**
 * A version and a build as one label: 0.1.6 (build 7).
 *
 * The build alone said nothing a person can match against a release; the
 * version is the name the release carries. A shell that reports only one of
 * the two still says what it has.
 */
export function versionLabel(
  version: string | null | undefined,
  build: number | null | undefined,
): string {
  if (version && build) return `${version} (build ${build})`;
  if (version) return version;
  return build ? `build ${build}` : "";
}

/**
 * The version and build this run's code is, for the status line.
 *
 * The shell's own pair is the installed APK's; a downloaded package's is what
 * runs instead, and that is the code the user is looking at.
 */
function runningLabel(): string {
  try {
    const running = runningPackage();
    if (running) return versionLabel(running.version, running.build);
    const shell = shellInfo();
    return versionLabel(shell.version, shell.build);
  } catch {
    return "";
  }
}

/** The line under the status: 当前版本 0.1.6 (build 7). */
function currentLine(): string {
  const running = runningLabel();
  return running ? `当前版本 ${running}` : "";
}

/** Whether the desktop can restart into a downloaded package now. */
function canRestart(): boolean {
  return platform.os === "macos" || platform.os === "windows" || platform.os === "linux";
}

/** The error as one short line: the updater's own words, not a code. */
function reason(error: unknown): string {
  const text = String(error instanceof Error ? error.message : error);
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

/**
 * Puts the toast up, and takes it down by itself unless it is asking for a
 * press. A check that ends in "nothing newer" or a failure is an answer the
 * user asked for and then knows; one that finds a package waits.
 */
function show(ms?: number): void {
  updateVisible.set(true);
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (ms !== undefined) {
    hideTimer = setTimeout(() => {
      hideTimer = null;
      updateVisible.set(false);
    }, ms);
  }
}

/** Takes the toast away now, keeping the state it last reported. */
export function dismissUpdate(): void {
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  updateVisible.set(false);
}

/**
 * Looks for a newer package.
 *
 * It is safe to call from a launch, a button and the palette: the second call
 * while one runs is a no-op. A failure is a line, not a dialog — an update the
 * network did not offer is not a reason to interrupt the board.
 *
 * `quiet` is the launch's check: it says nothing when there is nothing to say,
 * and only the discovery of a newer package puts the toast up.
 */
export async function checkUpdates(options?: { quiet?: boolean }): Promise<void> {
  const quiet = options?.quiet === true;
  if (busy) return;
  if (!canUpdate()) {
    updateState.set("unsupported");
    updateLine.set("此安装包不支持 OTA，需要安装新的 APK");
    updateDetail.set("");
    console.log("[navigator] updates: unsupported in this shell");
    if (!quiet) show(6000);
    return;
  }
  busy = true;
  updateState.set("checking");
  updateLine.set("正在检查更新…");
  updateDetail.set("");
  updateCurrent.set(currentLine());
  console.log(`[navigator] updates: checking, running ${currentLine() || "an unknown build"}`);
  if (!quiet) show();
  try {
    const found = await checkForPackage();
    if (!found) {
      updateState.set("current");
      const version = runningLabel();
      updateLine.set(version ? `已是最新版本，${version}` : "已是最新版本");
      console.log(`[navigator] updates: nothing newer than ${version || "this build"}`);
      if (!quiet) show(6000);
      return;
    }
    updateReady.set(found);
    updateState.set("found");
    updateLine.set(`发现 ${found.version}（build ${found.build}）`);
    console.log(`[navigator] updates: found ${found.version} (build ${found.build})`);
    show();
  } catch (error) {
    updateState.set("failed");
    updateLine.set("检查更新失败");
    updateDetail.set(reason(error));
    console.warn(`[navigator] updates: ${error}`);
    if (!quiet) show(12000);
  } finally {
    busy = false;
  }
}

/**
 * Downloads the package a check found. The press that asked for it is the
 * press that starts it; nothing downloads because a check happened.
 */
export async function applyUpdate(): Promise<void> {
  const found = updateReady();
  if (!found || busy) return;
  busy = true;
  updateState.set("downloading");
  updateProgress.set(0);
  updateDetail.set("");
  updateLine.set(`正在下载 ${found.version}（build ${found.build}）…`);
  show();
  try {
    await downloadPackage(({ received, total }) => {
      const share = total ? received / total : 0;
      updateProgress.set(share);
      updateLine.set(total ? `正在下载更新 ${Math.round(share * 100)}%` : "正在下载更新…");
    });
    updateState.set("ready");
    updateLine.set(
      canRestart()
        ? `更新 ${found.version} 已下载，重启后生效`
        : `更新 ${found.version} 已下载，下次打开生效`,
    );
    console.log(`[navigator] updates: downloaded ${found.version} (build ${found.build})`);
    show();
  } catch (error) {
    updateState.set("failed");
    updateLine.set("更新下载失败");
    updateDetail.set(reason(error));
    console.warn(`[navigator] updates: ${error}`);
    show(12000);
  } finally {
    busy = false;
  }
}

/**
 * The row's one press: download a package a check found, restart into one that
 * is ready, otherwise look again. On Android there is nothing to restart — the
 * package waits for the next cold start — so the last press is a check.
 */
export async function takeUpdateAction(): Promise<void> {
  if (busy) return;
  if (updateState() === "found") {
    await applyUpdate();
    return;
  }
  if (updateState() === "ready") {
    // Android and iOS have no in-process restart: the downloaded package is
    // already waiting for the next cold start, and pressing again must not
    // download it a second time.
    if (!canRestart()) return;
    try {
      await restartToPackage();
    } catch {
      updateLine.set("下次打开会运行新版本");
    }
    return;
  }
  await checkUpdates();
}

/** The action's label, which tells the user what the press will do. */
export function updateActionLabel(): string {
  switch (updateState()) {
    case "found":
      return "更新";
    case "downloading":
      return "下载中…";
    case "ready":
      return canRestart() ? "重启" : "";
    case "checking":
      return "检查中…";
    case "failed":
      return "重试";
    default:
      return "检查更新";
  }
}

/**
 * Checks once on launch, after the board is up.
 *
 * The delay keeps a network call out of the first frame. This one is quiet:
 * a launch that finds nothing newer says nothing, and only a package waiting
 * for a press puts the toast up. Development runs and apps without package
 * roots report unsupported, so this is a no-op in a test.
 */
export function startUpdates(): void {
  if (started) return;
  started = true;
  if (!canUpdate()) {
    updateState.set("unsupported");
    updateLine.set("此安装包不支持 OTA，需要安装新的 APK");
    console.log("[navigator] updates: unsupported in this shell");
    return;
  }
  if (autoChecked) return;
  autoChecked = true;
  setTimeout(() => void checkUpdates({ quiet: true }), 5000);
}
