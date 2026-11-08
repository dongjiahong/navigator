import { open } from "nsh/test";

/**
 * Sync is off in every test, and so is the board's file.
 *
 * The app syncs and saves for real, and a test runs on the same machine as the
 * developer's own copy: without this a test board merges with whatever Mac app
 * happens to be open, the counts grow between tests, and a test that expects
 * one card finds two — or finds the developer's actual board instead of the
 * sample cards it asserts on. Tests are about the interface; the merge and the
 * file have their own unit tests, and sync was verified against a running app
 * on the LAN.
 */
const ISOLATED = { storage: { "navigator.syncEnabled": "0", "navigator.persist": "0" } };

/**
 * Opens the app on the surface the device actually has.
 *
 * `nsh test` refuses a size on a phone (the app fills the screen there, at the
 * size the device has), and `platform` inside the test runtime does not describe
 * the host: a macOS run and an Android run both report `os: "ios"`. The only
 * reliable signal is whether asking for a window works, so ask — and then fall
 * back rather than fail on an argument the device cannot take.
 */
export async function openApp() {
  try {
    return {
      app: await open("./App.tsx", { ...ISOLATED, width: 1280, height: 860 }),
      desktop: true,
    };
  } catch {
    return { app: await open("./App.tsx", ISOLATED), desktop: false };
  }
}

/**
 * Opens the app in a window of exactly `width` × `height`, or `null` where the
 * platform will not size one.
 *
 * A test that needs a particular viewport — a screenshot, a gesture reaching a
 * known point — cannot run on a phone: the app fills the screen there and `open`
 * rejects `width`. Returning `null` lets such a test return early instead of
 * failing on an argument the device cannot honour. The rejection must be
 * awaited: `open` returns a promise, so a synchronous `try` never catches it and
 * the failure surfaces later as an unhandled rejection.
 */
export async function openSized(
  width: number,
  height: number,
  extra: Record<string, unknown> = {},
) {
  try {
    return await open("./App.tsx", { ...ISOLATED, ...extra, width, height });
  } catch {
    return null;
  }
}

/**
 * Whether the app can be drawn at all — the headless engine paints nothing, so
 * `screenshot` rejects there and every host that draws accepts it.
 *
 * Screenshot tests are the only way to produce `.impeccable/review`'s evidence,
 * and running them without a platform cannot produce anything: they return
 * early rather than failing on a capability the run does not have. The real
 * captures come from `nsh test --target macos`.
 */
export async function canDraw(app: { screenshot(path?: string | null): Promise<Uint8Array> }) {
  try {
    await app.screenshot();
    return true;
  } catch {
    return false;
  }
}
