#!/usr/bin/env bash
# Renders the app icon and the DMG background from the HTML in this folder with headless Chromium.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; out="$here/../build"; profile="$(mktemp -d)"
shot() { chromium --headless=new --no-first-run --user-data-dir="$profile" --hide-scrollbars --default-background-color=00000000 --force-device-scale-factor="$3" --window-size="$2" --screenshot="$4" "file://$here/$1" >/dev/null 2>&1; }
shot icon.html 1024,1024 1 "$out/icon.png"
shot background.html 660,400 1 "$out/background.png"
shot background.html 660,400 2 "$out/background@2x.png"
rm -rf "$profile"
