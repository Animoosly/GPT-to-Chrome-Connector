#!/usr/bin/env bash
# Builds dist/ChatGPTChromeConnector-Setup-<version>.exe from Linux or macOS.
# Needs: node (same major/minor/patch as NODE_VERSION below), makensis, osslsigncode, wine (for rcedit), curl.
set -euo pipefail
cd "$(dirname "$0")"
BUILD="$PWD"
ROOT="$(cd .. && pwd)"
NODE_VERSION="$(node -p process.versions.node)"   # SEA blob must match the embedded node.exe exactly
VERSION="$(node -p "require('$ROOT/server/package.json').version")"
EXE=ChatGPTChromeConnector.exe
mkdir -p vendor out "$ROOT/dist"

echo "==> Downloading Windows binaries (node $NODE_VERSION, cloudflared, rcedit)"
[ -f "vendor/node-$NODE_VERSION.exe" ] || curl -fsSL -o "vendor/node-$NODE_VERSION.exe" "https://nodejs.org/dist/v$NODE_VERSION/win-x64/node.exe"
[ -f vendor/cloudflared.exe ] || curl -fsSL -o vendor/cloudflared.exe https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
[ -f vendor/rcedit.exe ] || curl -fsSL -o vendor/rcedit.exe https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe

echo "==> Bundling server"
cd "$ROOT/server"
[ -d node_modules/esbuild ] || npm install --no-audit --no-fund
npx --no-install esbuild index.js --bundle --platform=node --target=node22 --format=cjs \
  --define:PACKAGED=true --external:bufferutil --external:utf-8-validate \
  --log-level=warning --log-override:empty-import-meta=silent --outfile="$BUILD/out/bundle.cjs"
cd "$BUILD"

echo "==> Creating single-executable blob"
cat > out/sea-config.json <<EOF
{ "main": "out/bundle.cjs", "output": "out/sea-prep.blob", "disableExperimentalSEAWarning": true, "useCodeCache": false, "useSnapshot": false }
EOF
node --experimental-sea-config out/sea-config.json

echo "==> Building $EXE"
rm -f "out/$EXE"
osslsigncode remove-signature -in "vendor/node-$NODE_VERSION.exe" -out "out/$EXE" >/dev/null
export WINEDEBUG=-all WINEPREFIX="${WINEPREFIX:-$BUILD/.wine}"
wine vendor/rcedit.exe "out/$EXE" --set-icon assets/icon.ico \
  --set-version-string ProductName "ChatGPT Chrome Connector" \
  --set-version-string FileDescription "ChatGPT Chrome Connector" \
  --set-version-string CompanyName "" --set-version-string LegalCopyright "" \
  --set-version-string OriginalFilename "$EXE" --set-version-string InternalName "ChatGPTChromeConnector" \
  --set-file-version "$VERSION" --set-product-version "$VERSION" 2>/dev/null
npx --prefix "$ROOT/server" --no-install postject "out/$EXE" NODE_SEA_BLOB out/sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 >/dev/null

# Switch the PE subsystem from console (3) to GUI (2) so no black console window appears.
node -e '
const fs=require("fs"),f=process.argv[1],b=fs.readFileSync(f);
const pe=b.readUInt32LE(0x3c); if(b.toString("latin1",pe,pe+4)!=="PE\0\0") throw "not a PE file";
const off=pe+24+68; if(b.readUInt16LE(off)!==3) throw "unexpected subsystem "+b.readUInt16LE(off);
b.writeUInt16LE(2,off); fs.writeFileSync(f,b);' "out/$EXE"

echo "==> Building installer"
makensis -V2 -DVERSION="$VERSION" installer.nsi
ls -lh "$ROOT/dist/"
