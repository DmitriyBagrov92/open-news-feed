#!/bin/bash
# Visual checkpoint screenshots: runs the Meridian-Screenshots scheme on iPhone 17 and
# iPad Pro 13" (M5) and exports every attachment to ios/screenshots/<name>.png.
#
#   ios/scripts/screenshots.sh [--live] [--only iphone|ipad]
#   (--live: the real meridi.info feed, real photography)
set -euo pipefail
IOS="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$IOS/screenshots"
RESULTS="$IOS/build/screenshots.xcresult"
LIVE=0
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --live) LIVE=1 ;;
    --only) ONLY="$2"; shift ;;
  esac
  shift
done
DESTS=()
[ "$ONLY" != "ipad" ] && DESTS+=(-destination 'platform=iOS Simulator,name=iPhone 17,OS=26.4')
[ "$ONLY" != "iphone" ] && DESTS+=(-destination 'platform=iOS Simulator,name=iPad Pro 13-inch (M5),OS=26.4')

cd "$IOS"
xcodegen generate --quiet
rm -rf "$RESULTS" "$OUT/export"
mkdir -p "$OUT"
TEST_RUNNER_SCREENSHOT_LIVE=$LIVE xcodebuild test -project Meridian.xcodeproj -scheme Meridian-Screenshots \
  "${DESTS[@]}" \
  -derivedDataPath build/DerivedData -clonedSourcePackagesDirPath .spm-cache \
  -skipPackagePluginValidation -skipMacroValidation -resultBundlePath "$RESULTS" -quiet || true
xcrun xcresulttool export attachments --path "$RESULTS" --output-path "$OUT/export" >/dev/null
python3 - "$OUT" <<'PY'
import json, pathlib, shutil, sys
out = pathlib.Path(sys.argv[1]); export = out / "export"
manifest = json.loads((export / "manifest.json").read_text())
count = 0
for test in manifest:
    for attachment in test.get("attachments", []):
        name = attachment.get("suggestedHumanReadableName", attachment["exportedFileName"])
        stem = name.split("_")[0] if name.count("_") >= 2 else pathlib.Path(name).stem
        shutil.copy(export / attachment["exportedFileName"], out / f"{stem}.png")
        count += 1
shutil.rmtree(export)
print(f"{count} screenshots in {out}")
PY
