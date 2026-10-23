#!/bin/sh
set -eu
test "$(uname -m)" = x86_64
mkdir -p release/artifacts release/verification
node tools/test-platform.mjs
node tools/wordcount-test.mjs
npm run package:linux -- --ci -- --locked
version=$(node -p 'require("./package.json").version')
bundle="${CARGO_TARGET_DIR:-src-tauri/target}/release/bundle"
deb="$bundle/deb/Aropyt_${version}_amd64.deb"
appimage="$bundle/appimage/Aropyt_${version}_amd64.AppImage"
test "$(dpkg-deb --field "$deb" Architecture)" = amd64
dpkg -i "$deb"
dbus-run-session -- xvfb-run -a node tools/verify-packaged.mjs linux-x64-deb /usr/bin/aropyt "$deb"
dbus-run-session -- xvfb-run -a node tools/verify-packaged.mjs linux-x64-appimage "$appimage" "$appimage"
cp "$deb" "$appimage" release/artifacts/
