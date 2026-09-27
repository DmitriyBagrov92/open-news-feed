#!/bin/bash
# Archive Meridian for the App Store and upload it to App Store Connect (then TestFlight).
#
#   ASC_KEY_ID=… ASC_ISSUER_ID=… ASC_KEY_PATH=~/keys/AuthKey_….p8 [DEVELOPMENT_TEAM=…] \
#     ios/scripts/archive.sh [--no-upload]
#
# ASC_*: an App Store Connect API key (Users and Access › Integrations › App Store Connect API, role
# App Manager); DEVELOPMENT_TEAM: the 10-character team id (default: project.yml's). Signing is
# automatic — Xcode creates the distribution certificate and profile through the key. The build
# number is the commit count, so every upload is new. --no-upload stops at an .ipa in
# ios/build/export (to inspect or upload by hand).
set -euo pipefail
IOS="$(cd "$(dirname "$0")/.." && pwd)"
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
xcodebuild archive -project Meridian.xcodeproj -scheme Meridian -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -derivedDataPath build/ReleaseData -clonedSourcePackagesDirPath .spm-cache \
  -skipPackagePluginValidation -skipMacroValidation \
  DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" CODE_SIGN_STYLE=Automatic CURRENT_PROJECT_VERSION="$BUILD" \
  "${AUTH[@]}" -quiet

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
