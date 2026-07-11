#!/usr/bin/env bash
# Publish one immutable GitHub Release after the full local release preflight.
# Optional env: REPO, BASE_BRANCH
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPO="${REPO:-linhongcun/visual-edit-for-grok}"
BASE_BRANCH="${BASE_BRANCH:-main}"
VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"
TITLE="Visual Capture for Grok v${VERSION}"
DMG="release/Visual-Capture-for-Grok-${VERSION}-arm64.dmg"
CHECKSUM="${DMG}.sha256"
APP="release/mac-arm64/Visual Capture for Grok.app"

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI not found. Install: https://cli.github.com/" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "error: gh is not authenticated" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  echo "error: release requires a clean worktree" >&2
  git status --short >&2
  exit 1
fi

if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "error: release $TAG already exists; published assets are immutable" >&2
  exit 1
fi

if git rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null; then
  echo "error: local tag $TAG already exists" >&2
  exit 1
fi

if git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "error: remote tag $TAG already exists" >&2
  exit 1
fi

git fetch --quiet origin "$BASE_BRANCH"
LOCAL_HEAD="$(git rev-parse HEAD)"
REMOTE_HEAD="$(git rev-parse "origin/$BASE_BRANCH")"
if [[ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]]; then
  echo "error: HEAD ($LOCAL_HEAD) is not origin/$BASE_BRANCH ($REMOTE_HEAD)" >&2
  echo "Push or update the branch before publishing." >&2
  exit 1
fi

npm ci --registry=https://registry.npmjs.org
npm run release:preflight

SIGNATURE_INFO="$(codesign -dv --verbose=4 "$APP" 2>&1)"
if grep -Eq 'Signature=adhoc|TeamIdentifier=not set' <<<"$SIGNATURE_INFO"; then
  if [[ "${VEFG_ALLOW_ADHOC_PUBLISH:-0}" != "1" ]]; then
    echo "error: refusing to publish an ad-hoc signed app by default" >&2
    echo "Use Developer ID + notarization, or explicitly set VEFG_ALLOW_ADHOC_PUBLISH=1 for a local/test release." >&2
    exit 1
  fi
  echo "warning: explicitly publishing an ad-hoc, non-notarized build" >&2
  SIGNING_NOTE="This build is ad-hoc signed, not Developer ID notarized; see README.md if Gatekeeper blocks it."
else
  spctl --assess --type execute --verbose=2 "$APP"
  SIGNING_NOTE="This build passed the local Gatekeeper assessment."
fi

if [[ ! -f "$DMG" ]]; then
  echo "error: release preflight did not produce $DMG" >&2
  exit 1
fi

# Recheck after the lengthy build so concurrent publishers cannot replace a release.
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1 ||
  git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "error: $TAG appeared while preflight was running; refusing to overwrite it" >&2
  exit 1
fi

(
  cd "$(dirname "$DMG")"
  shasum -a 256 "$(basename "$DMG")"
) >"$CHECKSUM"

NOTES_FILE="$(mktemp -t vefg-release-notes.XXXXXX)"
trap 'rm -f "$NOTES_FILE"' EXIT

awk -v version="$VERSION" '
  index($0, "## [" version "]") == 1 { found = 1; next }
  found && /^## \[/ { exit }
  found { print }
' CHANGELOG.md >"$NOTES_FILE"

if [[ ! -s "$NOTES_FILE" ]]; then
  echo "error: CHANGELOG.md has no notes for $VERSION" >&2
  exit 1
fi

cat >>"$NOTES_FILE" <<EOF

### Install

1. Download **$(basename "$DMG")**.
2. Open the DMG and drag **Visual Capture for Grok** to Applications.
3. ${SIGNING_NOTE}

Requirements: macOS Apple Silicon (arm64) and the Grok Build CLI.
EOF

echo "Publishing $TAG at $LOCAL_HEAD to $REPO"
gh release create "$TAG" "$DMG" "$CHECKSUM" \
  --repo "$REPO" \
  --target "$LOCAL_HEAD" \
  --title "$TITLE" \
  --notes-file "$NOTES_FILE"

echo "Published: https://github.com/${REPO}/releases/tag/${TAG}"
