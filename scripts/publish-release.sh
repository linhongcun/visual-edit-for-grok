#!/usr/bin/env bash
# Publish a GitHub Release with the arm64 DMG.
# Usage (from a terminal where `gh` can write the repo):
#   ./scripts/publish-release.sh
# Optional env: REPO, TAG, DMG, TITLE, VERSION
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPO="${REPO:-linhongcun/visual-edit-for-grok}"
VERSION="${VERSION:-$(node -p "require('./package.json').version")}"
TAG="${TAG:-v${VERSION}}"
DMG="${DMG:-release/Visual-Capture-for-Grok-${VERSION}-arm64.dmg}"
TITLE="${TITLE:-Visual Capture for Grok v${VERSION}}"

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI not found. Install: https://cli.github.com/" >&2
  exit 1
fi

if [[ ! -f "$DMG" ]]; then
  echo "DMG missing at $DMG — building with npm run dist ..."
  npm run dist
fi

if [[ ! -f "$DMG" ]]; then
  echo "error: still no DMG at $DMG" >&2
  exit 1
fi

echo "Publishing $TAG to $REPO with $(du -h "$DMG" | awk '{print $1}') asset..."
echo "  $DMG"

NOTES="$(cat <<EOF
## Visual Capture for Grok v${VERSION}

macOS **Apple Silicon** (arm64) installer.

### Install
1. Download **Visual-Capture-for-Grok-${VERSION}-arm64.dmg**
2. Open the DMG and drag **Visual Capture for Grok** to Applications
3. If Gatekeeper blocks the app:
   - Right-click → **Open** → **Open**, or
   - Run: \`xattr -cr "/Applications/Visual Capture for Grok.app"\`

### Requirements
- macOS on Apple Silicon (\`arm64\`)
- Grok Build CLI as \`grok\` (default: \`~/.grok/bin/grok\`, or set \`GROK_PATH\`)

### Notes
- Ad-hoc signed local build (not Apple notarized / Developer ID)
- Source: this repository (\`main\` / tag \`${TAG}\`)
- See CHANGELOG.md and docs/PACKAGING.md
EOF
)"

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "Release $TAG already exists — uploading asset (clobber if present)..."
  gh release upload "$TAG" "$DMG" --repo "$REPO" --clobber
else
  gh release create "$TAG" "$DMG" \
    --repo "$REPO" \
    --target main \
    --title "$TITLE" \
    --notes "$NOTES"
fi

echo
echo "Done:"
gh release view "$TAG" --repo "$REPO" --web=false
echo
echo "URL: https://github.com/${REPO}/releases/tag/${TAG}"
