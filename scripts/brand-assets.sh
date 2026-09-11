#!/bin/bash
# Regenerates public/og.png and public/icons/* from inline SVG sources.
# macOS only: rasterizes with QuickLook (qlmanage) and resizes/crops with
# sips — no npm dependencies. Square SVGs render 1:1; the Open Graph image
# is drawn in the middle band of a square canvas and center-cropped.
#
#   bash scripts/brand-assets.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT/icons"

# Solar mark: void tile, amber solar disc, the meridian line through it.
# $1 = disc radius (smaller for the maskable variant's 80% safe zone), $2 = corner radius
mark() {
cat <<EOF
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="$2" fill="#0A0B12"/>
  <circle cx="512" cy="512" r="$1" fill="#F5A83C"/>
  <circle cx="512" cy="512" r="$1" fill="none" stroke="#FFC46B" stroke-width="18" opacity="0.9"/>
  <line x1="512" y1="$(( 512 - $1 - 70 ))" x2="512" y2="$(( 512 + $1 + 70 ))" stroke="#F2EFE9" stroke-width="44" stroke-linecap="round"/>
</svg>
EOF
}
mark 300 180 > "$TMP/icon.svg"
mark 230 0   > "$TMP/icon-maskable.svg"

cat > "$TMP/og.svg" <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
  <rect width="1200" height="1200" fill="#0A0B12"/>
  <!-- 1200×630 band: y 285..915 -->
  <circle cx="600" cy="560" r="520" fill="#F5A83C" opacity="0.06"/>
  <circle cx="600" cy="560" r="150" fill="#F5A83C"/>
  <circle cx="600" cy="560" r="150" fill="none" stroke="#FFC46B" stroke-width="10" opacity="0.9"/>
  <text x="600" y="612" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="150" font-weight="700" fill="#F2EFE9" text-anchor="middle" letter-spacing="10">MERIDIAN</text>
  <text x="600" y="720" font-family="Georgia, Times New Roman, serif" font-size="46" font-style="italic" fill="#F2EFE9" text-anchor="middle">The world, as it happens</text>
  <text x="600" y="800" font-family="Menlo, SF Mono, monospace" font-size="27" fill="#A29DAD" text-anchor="middle" letter-spacing="3">83 SOURCES · 8 LANGUAGES · AI ON YOUR DEVICE · NO ADS</text>
  <text x="600" y="878" font-family="Menlo, SF Mono, monospace" font-size="24" fill="#F5A83C" text-anchor="middle" letter-spacing="3">meridi.info</text>
</svg>
EOF

for f in icon icon-maskable og; do
  qlmanage -t -s 1200 -o "$TMP" "$TMP/$f.svg" >/dev/null 2>&1
done

sips -z 512 512 "$TMP/icon.svg.png" --out "$OUT/icons/icon-512.png" >/dev/null
sips -z 192 192 "$TMP/icon.svg.png" --out "$OUT/icons/icon-192.png" >/dev/null
sips -z 180 180 "$TMP/icon.svg.png" --out "$OUT/icons/apple-touch-icon.png" >/dev/null
sips -z 512 512 "$TMP/icon-maskable.svg.png" --out "$OUT/icons/icon-maskable-512.png" >/dev/null
sips -c 630 1200 "$TMP/og.svg.png" --out "$OUT/og.png" >/dev/null

for f in "$OUT/icons/"*.png "$OUT/og.png"; do
  echo "${f#$ROOT/}: $(sips -g pixelWidth -g pixelHeight "$f" | awk '/pixel/{printf "%s ", $2}')"
done
