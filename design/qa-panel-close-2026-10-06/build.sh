#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
scratch="$root/design/whiteboard-harness"
deps="${LIENZO_RN:-/tmp/lienzo-rn-harness}"
if [ ! -d "$deps/node_modules/react-native-web" ]; then
  mkdir -p "$deps"
  printf '{ "name": "lienzo-rn-harness", "private": true, "dependencies": { "react": "19.1.0", "react-dom": "19.1.0", "react-native-web": "0.21.3" } }\n' > "$deps/package.json"
  (cd "$deps" && pnpm install --ignore-workspace)
fi
mkdir -p "$root/dist/panel-qa"
node "$root"/node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild "$scratch/main.tsx" --bundle --format=iife --jsx=automatic --log-level=warning \
 --define:process.env.NODE_ENV='"production"' --define:__DEV__=false --define:global=globalThis \
 --alias:react="$deps/node_modules/react" --alias:react-dom="$deps/node_modules/react-dom" --alias:react-native="$deps/node_modules/react-native-web" \
 --alias:zod="$root/node_modules/zod" \
 --alias:@getpaseo/plugin="$root/node_modules/@getpaseo/plugin/dist/index.js" \
 --alias:@getpaseo/plugin/client/react-native="$scratch/host-rn.tsx" --alias:@getpaseo/plugin/client="$here/host-client.ts" \
 --alias:node:crypto="$root/design/graph-harness/real/node-crypto.ts" --outfile="$root/dist/panel-qa/real.js"
printf '<!doctype html><meta charset="utf-8"><title>Lienzo Panel QA, datos de ejemplo</title><body><script src="real.js"></script></body>\n' > "$root/dist/panel-qa/index.html"
cp "$scratch"/*.cjs "$root/dist/panel-qa/"
cp "$here/panel-close.cjs" "$root/dist/panel-qa/"
cp -r "$scratch/fixtures" "$root/dist/panel-qa/"
