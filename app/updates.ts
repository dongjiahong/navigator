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
 */
export type UpdateState = "idle" | "checking" | "downloading" | "ready" | "current" | "unsupported" | "failed";

export const updateState = signal<UpdateState>("idle");
/** One line for the phone's sheet and the Mac's palette. */
export const updateLine = signal("检查更新");
/** The package waiting for the next start, if one was found. */
export const updateReady = signal<PackageUpdate | null>(null);
/** 0–1 while a package downloads; 0 otherwise. */
export const updateProgress = signal(0);

let started = false;
let busy = false;
let autoChecked = false;

/** Whether this shell can run a downloaded package at all. */
function canUpdate(): boolean {
  try {
    return shellInfo().packages;
  } catch {
    return false;
  }
}

/** The build this run's code is, for the status line. */
function runningLabel(): string {
  try {
    const running = runningPackage();
    if (running) return `build ${running.build}`;
    const shell = shellInfo();
    return shell.build ? `build ${shell.build}` : "";
  } catch {
    return "";
  }
}

/** Whether the desktop can restart into a downloaded package now. */
function canRestart(): boolean {
  return platform.os === "macos" || platform.os === "windows" || platform.os === "linux";
}

/**
 * Looks for a newer package and downloads it.
 *
 * It is safe to call from a launch, a button and the palette: the second call
 * while one runs is a no-op. A failure is a line, not a dialog — an update the
 * network did not offer is not a reason to interrupt the board.
 */
export async function checkUpdates(): Promise<void> {
  if (busy) return;
  if (!canUpdate()) {
    updateState.set("unsupported");
    updateLine.set("此安装包不支持 OTA，需要安装新的 APK");
    return;
  }
  busy = true;
  updateState.set("checking");
  updateLine.set("正在检查更新…");
  try {
    const found = await checkForPackage();
    if (!found) {
      updateState.set("current");
      const build = runningLabel();
      updateLine.set(build ? `已是最新版本（${build}）` : "已是最新版本");
      return;
    }
    updateReady.set(found);
    updateState.set("downloading");
    updateProgress.set(0);
    updateLine.set(`发现 ${found.version}（build ${found.build}），正在下载…`);
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
  } catch (error) {
    updateState.set("failed");
    updateLine.set("检查更新失败，稍后再试");
    console.warn(`[navigator] updates: ${error}`);
  } finally {
    busy = false;
  }
}

/**
 * The row's one press: restart into a ready package on the desktop, otherwise
 * check again. On Android there is nothing to restart — the package waits for
 * the next cold start — so the press is a check, and the line says why.
 */
export async function takeUpdateAction(): Promise<void> {
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
  if (updateState() === "ready") return canRestart() ? "重启" : "";
  if (updateState() === "checking" || updateState() === "downloading") return "检查中…";
  return "检查更新";
}

/**
 * Checks once on launch, after the board is up.
 *
 * The delay keeps a network call out of the first frame; a package found here is
 * downloaded quietly, and the phone's 连到 Mac sheet says it will run next time.
 * Development runs and apps without package roots report unsupported, so this
 * is a no-op in a test.
 */
export function startUpdates(): void {
  if (started) return;
  started = true;
  if (!canUpdate()) {
    updateState.set("unsupported");
    updateLine.set("此安装包不支持 OTA，需要安装新的 APK");
    return;
  }
  if (autoChecked) return;
  autoChecked = true;
  setTimeout(() => void checkUpdates(), 5000);
}
