#!/bin/sh
# Build a signed OTA package and its manifest, ready to upload to the latest
# GitHub release. Run from anywhere; paths are resolved from this script.
#
#   scripts/ota-release.sh [--build N] [--notes FILE]
#
# The keys live outside the repository (default ~/.navigator-ota) and are never
# committed. `nsh` must be the nightly build the installed app was made with.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
KEYS=${OTA_KEYS:-"$HOME/.navigator-ota"}
BUILD=""
NOTES=""

while [ $# -gt 0 ]; do
  case "$1" in
    --build) BUILD=$2; shift 2 ;;
    --notes) NOTES=$2; shift 2 ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

for file in release.secret release.cert update.secret; do
  if [ ! -f "$KEYS/$file" ]; then
    echo "missing $KEYS/$file — generate the OTA keys first" >&2
    exit 1
  fi
done

command -v nsh >/dev/null 2>&1 || {
  echo "nsh is not on PATH" >&2
  exit 1
}

cd "$ROOT"
mkdir -p dist
VERSION=$(python3 -c 'import json; print(json.load(open("app/nsh.json"))["version"])')
if [ -z "$BUILD" ]; then
  BUILD=$(python3 -c 'import json; print(json.load(open("app/nsh.json"))["build"])')
fi
ID=$(python3 -c 'import json; print(json.load(open("app/nsh.json"))["id"])')
PACKAGE="dist/$ID-$BUILD.nshpkg"

nsh publish app \
  --key "$KEYS/release.secret" \
  --cert "$KEYS/release.cert" \
  --build "$BUILD" \
  -o "$PACKAGE"

if [ -n "$NOTES" ]; then
  nsh update-manifest --entry app --package "$PACKAGE" --notes "$NOTES" \
    --key "$KEYS/update.secret" -o dist
else
  nsh update-manifest --entry app --package "$PACKAGE" \
    --key "$KEYS/update.secret" -o dist
fi

cat <<EOF

Built $PACKAGE and dist/latest.json (+ .sig).

Upload these three files together to the latest GitHub release:
  $PACKAGE
  dist/latest.json
  dist/latest.json.sig

Or, with GitHub CLI:
  gh release create "v$VERSION-$BUILD" "$PACKAGE" dist/latest.json dist/latest.json.sig

The app checks the latest release on launch; a package runs from the next cold
start on Android, or after 重启 on the desktop.
EOF
