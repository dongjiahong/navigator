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
 * Opens the app on the phone's surface, wherever the test is running.
 *
 * The phone layout is chosen by the window's width, not by the platform, so a
 * 390-point window is the phone on a desktop as well — and a real device, which
 * refuses a size, is the phone already. The phone tests used to be Android-only
 * for that reason, which meant the headless suite could not see them at all;
 * this opens the same screen everywhere it can be laid out.
 *
 * `titleBand` is true only on a host that draws a real window it sized: such a
 * window has the platform's own title bar band across the top even with the
 * chrome hidden, and presses in it belong to the window rather than to the
 * content. A phone has no such band, and neither does the headless engine, so a
 * test that presses a control in the phone's title row skips it there — the band
 * swallows the press, which says nothing about the app.
 */
export async function openPhone() {
  const sized = await openSized(390, 844);
  if (!sized) return { app: await open("./App.tsx", ISOLATED), titleBand: false };
  return { app: sized, titleBand: await canDraw(sized) };
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
