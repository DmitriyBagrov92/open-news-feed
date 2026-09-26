#!/bin/bash
# Design iteration helper: build the app, run it in a simulator on the fixture newsroom
# (-UITestMode) or live (--live), and save a screenshot to ios/screenshots/<name>.png.
#
#   ios/scripts/shot.sh <name> [--device "iPhone 17"] [--dark] [--live] [--wait 4] [--no-build] [--env KEY=VALUE]...
set -euo pipefail
IOS="$(cd "$(dirname "$0")/.." && pwd)"
NAME="${1:?usage: shot.sh <name> [--device NAME] [--dark] [--live] [--wait S] [--no-build]}"
shift
DEVICE="iPhone 17"
APPEARANCE=light
LIVE=0
WAIT=4
BUILD=1
EXTRA=()
while [ $# -gt 0 ]; do
  case "$1" in
    --device) DEVICE="$2"; shift ;;
    --dark) APPEARANCE=dark ;;
    --live) LIVE=1 ;;
    --wait) WAIT="$2"; shift ;;
    --no-build) BUILD=0 ;;
    --env) EXTRA+=("SIMCTL_CHILD_$2"); shift ;;
  esac
  shift
done

UDID="$(xcrun simctl list devices available -j | python3 -c "
import json, sys
devices = json.load(sys.stdin)['devices']
for runtime, items in devices.items():
    if 'iOS-26-4' in runtime:
        for d in items:
            if d['name'] == '$DEVICE':
                print(d['udid']); sys.exit()
")"
[ -n "$UDID" ] || { echo "no iOS 26.4 simulator named $DEVICE" >&2; exit 1; }

cd "$IOS"
if [ "$BUILD" = 1 ]; then
  xcodegen generate --quiet
  xcodebuild build -project Meridian.xcodeproj -scheme Meridian -destination "id=$UDID" \
    -derivedDataPath build/DerivedData -clonedSourcePackagesDirPath .spm-cache \
    -skipPackagePluginValidation -skipMacroValidation -quiet
fi
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl ui "$UDID" appearance "$APPEARANCE" >/dev/null 2>&1 || true
xcrun simctl status_bar "$UDID" override --time "9:41" --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3 >/dev/null 2>&1 || true
xcrun simctl install "$UDID" build/DerivedData/Build/Products/Debug-iphonesimulator/Meridian.app
if [ "$LIVE" = 1 ]; then
  xcrun simctl launch --terminate-running-process "$UDID" info.meridi.app >/dev/null
else
  env SIMCTL_CHILD_FIXTURES_DIR="$IOS/Tests/Fixtures" SIMCTL_CHILD_APPEARANCE="$APPEARANCE" "${EXTRA[@]}" \
    xcrun simctl launch --terminate-running-process "$UDID" info.meridi.app -UITestMode >/dev/null
fi
sleep "$WAIT"
mkdir -p "$IOS/screenshots"
xcrun simctl io "$UDID" screenshot "$IOS/screenshots/$NAME.png" >/dev/null 2>&1
echo "$IOS/screenshots/$NAME.png"
