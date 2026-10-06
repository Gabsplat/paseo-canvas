#!/usr/bin/env bash
# Bundles the real Lienzo canvas for a browser. react-native-web and react-dom are NOT project dependencies: they are
# installed in a throwaway directory ($LIENZO_RN, default /tmp/lienzo-rn-harness) and only aliased in for this bundle.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../../.." && pwd)"; deps="${LIENZO_RN:-/tmp/lienzo-rn-harness}"; out="$root/dist/rn-harness"
mode="${LIENZO_BUILD_MODE:-development}"; dev=true
case "$mode" in development) ;; production) dev=false ;; *) echo 'LIENZO_BUILD_MODE must be development or production' >&2; exit 1 ;; esac
if [ ! -d "$deps/node_modules/react-native-web" ]; then
  mkdir -p "$deps"; printf '{ "name": "lienzo-rn-harness", "private": true, "dependencies": { "react": "19.1.0", "react-dom": "19.1.0", "react-native-web": "0.21.3" } }\n' > "$deps/package.json"
  (cd "$deps" && pnpm install --ignore-workspace)
fi
mkdir -p "$out"
node "$root"/node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild "$here/main.tsx" --bundle --format=iife --jsx=automatic --log-level=warning \
  --define:process.env.NODE_ENV="\"$mode\"" --define:__DEV__="$dev" --define:global=globalThis \
  --alias:react="$deps/node_modules/react" --alias:react-dom="$deps/node_modules/react-dom" --alias:react-native="$deps/node_modules/react-native-web" \
  --alias:@getpaseo/plugin/client/react-native="$here/host-rn.tsx" --alias:@getpaseo/plugin/client="$here/host-client.ts" --alias:node:crypto="$here/node-crypto.ts" \
  --outfile="$out/real.js"
cp "$here/index.html" "$out/index.html"; echo "$out"
cp "$here/image-fixture.svg" "$here/web-fixture.html" "$out/"
# Small synthetic local media. They never use the user's files or a network download.
if [ ! -f "$out/clip.mp4" ]; then ffmpeg -v error -y -f lavfi -i 'testsrc2=size=320x200:rate=24' -t 8 -c:v libx264 -pix_fmt yuv420p -movflags +faststart "$out/clip.mp4"; fi
if [ ! -f "$out/audio.wav" ]; then ffmpeg -v error -y -f lavfi -i 'sine=frequency=440:duration=4' "$out/audio.wav"; fi
