# Packaging guide

How to produce the **Visual Capture for Grok** macOS application from this repo.

## Prerequisites

- macOS on **Apple Silicon** (`arm64`)
- Node.js 22.12+ (required by Electron 43 / `@electron/rebuild` 4)
- Xcode Command Line Tools (for native `node-pty` rebuild)
- Clean checkout with `package-lock.json` committed

## Verified local release build

```bash
cd visual-edit-for-grok
npm ci --registry=https://registry.npmjs.org
npm run release:preflight
```

The preflight requires a clean macOS arm64 worktree and runs:

1. auto-discovered unit suites, TypeScript validation and `vite build`
2. unpackaged Electron/CDP smoke
3. `electron-builder --mac` →
   - `release/mac-arm64/Visual Capture for Grok.app`  
   - `release/Visual-Capture-for-Grok-<version>-arm64.dmg`
4. packaged-app smoke, `codesign --verify`, bundle version/architecture checks,
   `hdiutil verify` and update-metadata validation

For local validation of an intentional uncommitted change, set
`VEFG_RELEASE_ALLOW_DIRTY=1`; the publishing script never permits this bypass.

### Publish a new GitHub Release

```bash
./scripts/publish-release.sh
```

Publishing requires a clean `HEAD` equal to `origin/main`, runs the complete
official-registry `npm ci` + preflight again, and refuses any existing
local/remote tag or GitHub Release.
Published assets are never replaced; each DMG is accompanied by a SHA-256 file.
Publishing refuses an ad-hoc signature by default. Until Developer ID signing
and notarization are configured, a deliberate local/test release requires
`VEFG_ALLOW_ADHOC_PUBLISH=1`; this does not make the build Gatekeeper-trusted.

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
| `npm run typecheck` | TypeScript validation without emit |
| `npm run check` | Unit suites + typecheck + renderer build |
| `npm run test:electron` | Production build + isolated Electron integration smoke |
| `npm run test:packaged` | Same integration smoke against `release/mac-arm64/*.app` |
| `npm run release:preflight` | Full integrity gate through codesign + verified DMG; not a notarization check |

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
npm run release:preflight
```

The same gate runs in `.github/workflows/ci.yml` on GitHub's macOS arm64 runner.
For an already-built artifact, the core manual checks are:

```bash
codesign --verify --deep --strict --verbose=2 \
  "release/mac-arm64/Visual Capture for Grok.app"
hdiutil verify "release/Visual-Capture-for-Grok-<version>-arm64.dmg"
npm run test:packaged
```

## Artifacts & git

`release/` is gitignored (large binaries).  
Rebuild on each machine or archive the DMG outside the repo for backup.
