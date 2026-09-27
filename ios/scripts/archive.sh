#!/bin/bash
# Archive Meridian for the App Store and upload it to App Store Connect (then TestFlight).
#
#   ios/scripts/archive.sh [--no-upload]
#
# ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH: an App Store Connect team API key (Users and Access ›
# Integrations › App Store Connect API, role Admin — xcodebuild's cloud-managed distribution
# certificate is refused to a lower role); DEVELOPMENT_TEAM: the 10-character team id (default:
# project.yml's). Each comes from the environment or from ~/.appstoreconnect/meridian.env (KEY=VALUE
# lines, outside the repo). Signing is automatic — Xcode gets the certificates and profiles through
# the key. The build number is the commit count, so every upload is new. --no-upload stops at an
# .ipa in ios/build/export (to inspect or upload by hand).
set -euo pipefail
IOS="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$HOME/.appstoreconnect/meridian.env"
if [ -f "$ENV_FILE" ]; then # the environment wins over the file
  while IFS='=' read -r name value; do
    case "$name" in ASC_KEY_ID|ASC_ISSUER_ID|ASC_KEY_PATH|DEVELOPMENT_TEAM) ;; *) continue ;; esac
    value="${value%\"}"; value="${value#\"}"; value="${value/#\~/$HOME}"; value="${value//\$HOME/$HOME}"
    [ -z "${!name:-}" ] && export "$name=$value"
  done < "$ENV_FILE"
fi
: "${ASC_KEY_ID:?the App Store Connect API key id}"
: "${ASC_ISSUER_ID:?the API key issuer id}"
: "${ASC_KEY_PATH:?the path of the .p8 key}"
DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM:-$(awk '/DEVELOPMENT_TEAM:/ { print $2; exit }' "$IOS/project.yml")}"
: "${DEVELOPMENT_TEAM:?the 10-character team id}"
UPLOAD=1
[ "${1:-}" = "--no-upload" ] && UPLOAD=0

BUILD="$(git -C "$IOS" rev-list --count HEAD)"
ARCHIVE="$IOS/build/Meridian.xcarchive"
EXPORT="$IOS/build/export"
AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$ASC_KEY_PATH"
      -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")

cd "$IOS"
xcodegen generate --quiet
rm -rf "$ARCHIVE" "$EXPORT"
# Archived unsigned, signed by the export: an automatically signed archive needs a development
# profile, and that needs a registered device ("Your team has no devices…"); the App Store export
# signs with the cloud-managed distribution certificate and a store profile, which need none.
xcodebuild archive -project Meridian.xcodeproj -scheme Meridian -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -derivedDataPath build/ReleaseData -clonedSourcePackagesDirPath .spm-cache \
  -skipPackagePluginValidation -skipMacroValidation \
  DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" CURRENT_PROJECT_VERSION="$BUILD" CODE_SIGNING_ALLOWED=NO -quiet

DESTINATION=export
[ "$UPLOAD" = 1 ] && DESTINATION=upload
cat > "$IOS/build/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key><string>app-store-connect</string>
	<key>destination</key><string>$DESTINATION</string>
	<key>teamID</key><string>$DEVELOPMENT_TEAM</string>
	<key>signingStyle</key><string>automatic</string>
	<key>uploadSymbols</key><true/>
	<key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
PLIST
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$EXPORT" \
  -exportOptionsPlist "$IOS/build/ExportOptions.plist" "${AUTH[@]}"
if [ "$UPLOAD" = 1 ]; then
  echo "Uploaded build $BUILD — it appears in App Store Connect › TestFlight after processing."
else
  echo "Exported build $BUILD to $EXPORT"
fi
