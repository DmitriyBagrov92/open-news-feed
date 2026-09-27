#!/bin/bash
# App Store screenshots: AppStoreScreenshotTests on the fictional newsroom (scripts/newsroom.mjs)
# — the 6.9" iPhone 17 Pro Max (1320×2868) and the 13" iPad Pro (M5) in landscape (2752×2064),
# status bar at 9:41 with full signal and battery. The PNGs land in
# ios/screenshots/appstore/<iphone|ipad>/NN-name.png, ready for App Store Connect.
#
# simctl overrides the status bar's time but not its date (the iPad shows it), so the newsroom is
# generated as of today's 9:41 into build/newsroom — the app's date and ages then agree with it.
#
#   ios/scripts/appstore-screenshots.sh [--only iphone|ipad]
set -euo pipefail
IOS="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$IOS/screenshots/appstore"
RESULTS="$IOS/build/appstore-screenshots.xcresult"
RUNTIME="26.4"
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="$2"; shift ;;
  esac
  shift
done

cd "$IOS"
# 9:41 today in the Mac's zone (the simulator's), as UTC with milliseconds — the only form simctl takes
NOW="$(date -j -u -f %s "$(date -j -f "%H:%M:%S" "09:41:00" +%s)" +"%Y-%m-%dT%H:%M:%S.000Z")"
node scripts/newsroom.mjs --images --captured-at "$NOW" --out build/newsroom # photographs download once

udid() { # the available simulator called "$1" on the pinned runtime
  xcrun simctl list devices available -j | python3 -c '
import json, sys
name, runtime = sys.argv[1], "iOS-" + sys.argv[2].replace(".", "-")
for key, devices in json.load(sys.stdin)["devices"].items():
    if key.endswith(runtime):
        for device in devices:
            if device["name"] == name:
                print(device["udid"]); sys.exit()
sys.exit(f"no {name} simulator on iOS {sys.argv[2]}")' "$1" "$RUNTIME"
}

NAMES=()
[ "$ONLY" != "ipad" ] && NAMES+=("iPhone 17 Pro Max")
[ "$ONLY" != "iphone" ] && NAMES+=("iPad Pro 13-inch (M5)")
DESTS=()
UDIDS=()
for name in "${NAMES[@]}"; do
  id="$(udid "$name")"
  UDIDS+=("$id")
  DESTS+=(-destination "platform=iOS Simulator,id=$id")
  xcrun simctl boot "$id" 2>/dev/null || true
  xcrun simctl bootstatus "$id" -b >/dev/null
  xcrun simctl status_bar "$id" override --time "$NOW" --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode active --cellularBars 4 --operatorName "" --batteryState discharging --batteryLevel 100
done
trap 'for id in "${UDIDS[@]}"; do xcrun simctl status_bar "$id" clear || true; done' EXIT

xcodegen generate --quiet
rm -rf "$RESULTS" "$OUT/export"
mkdir -p "$OUT"
TEST_RUNNER_NEWSROOM=1 TEST_RUNNER_NEWSROOM_DIR="$IOS/build/newsroom" xcodebuild test -project Meridian.xcodeproj -scheme Meridian-Screenshots \
  -only-testing:MeridianScreenshotTests/AppStoreScreenshotTests "${DESTS[@]}" \
  -derivedDataPath build/DerivedData -clonedSourcePackagesDirPath .spm-cache \
  -skipPackagePluginValidation -skipMacroValidation -resultBundlePath "$RESULTS" -quiet || true
xcrun xcresulttool export attachments --path "$RESULTS" --output-path "$OUT/export" >/dev/null
python3 - "$OUT" <<'PY'
import json, pathlib, shutil, subprocess, sys
out = pathlib.Path(sys.argv[1]); export = out / "export"
manifest = json.loads((export / "manifest.json").read_text())
shots = []
for test in manifest:
    for attachment in test.get("attachments", []):
        name = attachment.get("suggestedHumanReadableName", attachment["exportedFileName"])
        stem = name.split("_")[0] if name.count("_") >= 2 else pathlib.Path(name).stem
        device, _, title = stem.partition("-")
        target = out / device / f"{title}.png"
        target.parent.mkdir(exist_ok=True)
        shutil.copy(export / attachment["exportedFileName"], target)
        shots.append(target)
shutil.rmtree(export)
for shot in sorted(shots):
    size = subprocess.run(["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(shot)], capture_output=True, text=True).stdout.split()
    print(f"{shot.relative_to(out)}  {size[-3]}×{size[-1]}")
print(f"{len(shots)} screenshots in {out}")
PY
