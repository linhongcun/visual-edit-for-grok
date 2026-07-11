# Packaging guide

How to produce the **Visual Capture for Grok** macOS application from this repo.

## Prerequisites

- macOS on **Apple Silicon** (`arm64`)
- Node.js 22.12+ (required by Electron 43 / `@electron/rebuild` 4)
- Xcode Command Line Tools (for native `node-pty` rebuild)
- `npm install` completed successfully

## One-shot release

```bash
cd visual-edit-for-grok
npm install
npm run dist
```

This runs:

1. `vite build` → `dist/` (renderer)
2. `electron-builder --mac` →  
   - `release/mac-arm64/Visual Capture for Grok.app`  
   - `release/Visual-Capture-for-Grok-<version>-arm64.dmg`

### Install for daily use

```bash
cp -R "release/mac-arm64/Visual Capture for Grok.app" /Applications/
xattr -cr "/Applications/Visual Capture for Grok.app"
open -a "Visual Capture for Grok"
```

## Scripts

| Script | Output |
|--------|--------|
| `npm run pack` | `.app` only (`electron-builder --mac dir`) |
| `npm run dist` | `.app` + `.dmg` |
| `npm run dist:dmg` | DMG target (rebuilds package as needed) |
| `npm run build` | Renderer only (`dist/`) |
| `npm run test:electron` | Production build + isolated Electron integration smoke |
| `npm run test:packaged` | Same integration smoke against `release/mac-arm64/*.app` |

## Config location

Packaging is configured in `package.json` → `"build"`:

| Key | Value / notes |
|-----|----------------|
| `appId` | `com.local.visual-capture-for-grok` |
| `productName` | `Visual Capture for Grok` |
| `directories.output` | `release/` |
| `directories.buildResources` | `build/` (icons) |
| `asarUnpack` | `node_modules/node-pty/**` (required for PTY) |
| `electronVersion` | `43.1.0` |
| `mac.target` | `dir` + `dmg`, arch `arm64` |
| `mac.identity` | `"-"` (explicit ad-hoc local signature) |
| `mac.icon` | `build/icon.icns` |

## Icons

| File | Use |
|------|-----|
| `build/icon.icns` | macOS bundle icon |
| `build/icon.png` | 1024 master / window window icon in dev |
| `build/icon.iconset/` | Source set for `iconutil` |

Regenerate `.icns` after editing PNGs:

```bash
iconutil -c icns build/icon.iconset -o build/icon.icns
```

## Native module (`node-pty`)

- Dev: `npm run rebuild` or `postinstall` → `@electron/rebuild`
- Package: `electron-builder` runs rebuild for Electron’s ABI
- Runtime: module must live in **`app.asar.unpacked`** (configured via `asarUnpack`)

If the packaged terminal fails to start, re-run `npm run dist` (do not only copy an old `.app`).

## Signing & notarization

Current release is **ad-hoc signed** (`identity: "-"`) so bundle integrity can
be verified locally. It is still not Developer ID signed or notarized, so a
first-launch Gatekeeper override may be required.

For App Store / wide distribution you would need:

1. Apple Developer ID Application certificate  
2. Hardened runtime + entitlements appropriate for PTY / network  
3. `electron-builder` `mac.identity` + notarize hook  
4. Gatekeeper staple  

That is **out of scope** for the current local product.

## Verify a build

```bash
# Structure
ls "release/mac-arm64/Visual Capture for Grok.app/Contents/MacOS/"
find "release/mac-arm64/Visual Capture for Grok.app" -name "pty.node" | head

# Launch smoke
open -a "release/mac-arm64/Visual Capture for Grok.app"
# or
open -a "Visual Capture for Grok"   # if installed to /Applications
```

Expect: window titled **Visual Capture for Grok**, left terminal, right preview, toolbar Aim / Frame / Re-send.

## Artifacts & git

`release/` is gitignored (large binaries).  
Rebuild on each machine or archive the DMG outside the repo for backup.
