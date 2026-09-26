#!/bin/bash
# Meridian iOS quality gate: regenerate the project, check that the golden vectors and the
# String Catalog still match the web client, then run the test schemes.
#
#   ios/scripts/test.sh [unit|integration|contract|acceptance|all]    (default: all)
#
# Toolchain: the default Xcode (26.2 — Xcode 26.4.1 on this Mac lacks its iOS platform component;
# install it in Xcode › Settings › Components, then export DEVELOPER_DIR to switch).
# Destinations (iOS 26.4 runtime): IPHONE_DEST / IPAD_DEST.
set -euo pipefail
IOS="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$IOS/.." && pwd)"
IPHONE="${IPHONE_DEST:-platform=iOS Simulator,name=iPhone 17,OS=26.4}"
IPAD="${IPAD_DEST:-platform=iOS Simulator,name=iPad Pro 13-inch (M5),OS=26.4}"
DERIVED="$IOS/build/DerivedData"
SPM="$IOS/.spm-cache"
WHAT="${1:-all}"

cd "$IOS"
xcodegen generate --quiet
node "$IOS/scripts/export-golden.mjs" --check
node "$IOS/scripts/sync-strings.mjs" --check
node "$IOS/scripts/sync-flags.mjs" --check

run() { # scheme destination...
  local scheme="$1"
  shift
  local dests=()
  for d in "$@"; do dests+=(-destination "$d"); done
  xcodebuild test -project Meridian.xcodeproj -scheme "$scheme" "${dests[@]}" \
    -derivedDataPath "$DERIVED" -clonedSourcePackagesDirPath "$SPM" \
    -skipPackagePluginValidation -skipMacroValidation -quiet
}

# The live client against the real Node server in fixture mode (same env as playwright.config.js).
contract() {
  local port=4174
  (cd "$ROOT" && PORT=$port FEED_FIXTURE=test/fixtures/feed.json COMMENTS_DB=:memory: \
    USAGE_LOG_MINUTES=0 LOG_SILENT=1 RATE_LIMIT_DISABLED=1 \
    exec node --disable-warning=ExperimentalWarning server.js) &
  local pid=$!
  trap 'kill '"$pid"' 2>/dev/null || true' EXIT
  for _ in $(seq 1 100); do
    curl -sf "http://127.0.0.1:$port/api/health" >/dev/null 2>&1 && break
    sleep 0.2
  done
  TEST_RUNNER_MERIDIAN_CONTRACT_URL="http://127.0.0.1:$port" run Meridian-Contract "$IPHONE"
  kill "$pid" 2>/dev/null || true
  trap - EXIT
}

case "$WHAT" in
  unit) run Meridian-Unit "$IPHONE" ;;
  integration) run Meridian-Integration "$IPHONE" ;;
  contract) contract ;;
  acceptance) run Meridian-Acceptance "$IPHONE" "$IPAD" ;;
  all)
    run Meridian-Unit "$IPHONE"
    run Meridian-Integration "$IPHONE"
    contract
    run Meridian-Acceptance "$IPHONE" "$IPAD"
    ;;
  *)
    echo "usage: $0 [unit|integration|contract|acceptance|all]" >&2
    exit 2
    ;;
esac
echo "iOS gate ($WHAT): green"
