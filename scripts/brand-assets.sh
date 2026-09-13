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

# The mark: a meridian line through a ring — the wordmark pill's glyph.
# White tile, system blue. $1 = ring radius (smaller for the maskable
# variant's 80% safe zone), $2 = corner radius
mark() {
cat <<EOF
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#EEF0F4"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="$2" fill="url(#bg)"/>
  <circle cx="512" cy="512" r="$1" fill="none" stroke="#007AFF" stroke-width="72"/>
  <line x1="512" y1="$(( 512 - $1 - 96 ))" x2="512" y2="$(( 512 + $1 + 96 ))" stroke="#007AFF" stroke-width="72" stroke-linecap="round"/>
</svg>
EOF
}
mark 260 180 > "$TMP/icon.svg"
mark 200 0   > "$TMP/icon-maskable.svg"

cat > "$TMP/og.svg" <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#E9ECF2"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="1200" fill="url(#bg)"/>
  <!-- 1200×630 band: y 285..915 -->
  <circle cx="600" cy="520" r="130" fill="none" stroke="#007AFF" stroke-width="34"/>
  <line x1="600" y1="342" x2="600" y2="698" stroke="#007AFF" stroke-width="34" stroke-linecap="round"/>
  <text x="600" y="790" font-family="-apple-system, Helvetica Neue, Helvetica, Arial, sans-serif" font-size="96" font-weight="800" letter-spacing="-4" fill="#111114" text-anchor="middle">Meridian</text>
  <text x="600" y="850" font-family="-apple-system, Helvetica Neue, Helvetica, Arial, sans-serif" font-size="34" font-weight="600" fill="#6E6E73" text-anchor="middle">The world, as it happens</text>
  <text x="600" y="900" font-family="-apple-system, Helvetica Neue, Helvetica, Arial, sans-serif" font-size="22" font-weight="700" letter-spacing="3" fill="#007AFF" text-anchor="middle">83 SOURCES · 8 LANGUAGES · AI ON YOUR DEVICE · NO ADS · MERIDI.INFO</text>
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
