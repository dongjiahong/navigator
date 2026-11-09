#!/bin/sh
# Build the Android APK at the size the project ships. Run from anywhere;
# paths are resolved from this script.
#
#   scripts/build-android.sh [extra nsh package arguments]
#
# Two things the default build does not do, and the measured reasons:
#
# - arm64 only. `nsh package` ships arm64-v8a and armeabi-v7a unless told
#   otherwise, and the 32-bit library is a third of the APK. This app's minSdk
#   is 28 (Android 9), and every device it runs on is arm64.
# - A release profile with LTO. The generated workspace (.nsh/rust) is rewritten
#   on every run and carries no [profile.release], so the build is 16 codegen
#   units with no LTO: every generic instantiation is copied per crate, which is
#   30.6 MB of .text against 12.9 MB in one LTO'd module.
#
# Same source, arm64, default profile: 46.2 MiB. With this script: 26.0 MiB
# (`opt-level="s"` instead of `"z"` is 30.9 MiB, if `z` ever feels slow on a
# device). `panic=abort` would reach 22.7 MiB and is not used: nsh catches a
# component's panic to show it (nsh-core's element/component.rs `caught`), and
# an aborting binary loses that.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT/app"

command -v nsh >/dev/null 2>&1 || {
  echo "nsh is not on PATH" >&2
  exit 1
}

exec env \
  CARGO_PROFILE_RELEASE_LTO=fat \
  CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1 \
  CARGO_PROFILE_RELEASE_OPT_LEVEL=z \
  nsh package --target android --abi arm64-v8a "$@"
