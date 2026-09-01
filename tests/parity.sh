#!/usr/bin/env bash
# The card has two renderers — scripts/generate_fastfetch.py (committed assets,
# and the fallback) and worker/src/card.ts (served live). They must agree byte
# for byte, or the README changes depending on which one answered.
#
# Usage: tests/parity.sh   (needs python3 and node >= 22 on PATH)
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$HERE")
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# node resolves relative TS imports by exact filename, so give them extensions
cp "$ROOT"/worker/src/*.ts "$HERE/fixture.json" "$WORK/"
cp "$HERE/render_ts.ts" "$WORK/"
sed -i -E 's#from "\./(marina|github|card)"#from "./\1.ts"#g' "$WORK"/*.ts

python3 "$HERE/render_py.py"                       > "$WORK/py.svg"
node --experimental-strip-types "$WORK/render_ts.ts" > "$WORK/ts.svg"

if diff -u "$WORK/py.svg" "$WORK/ts.svg"; then
  echo "✓ renderers agree ($(wc -l < "$WORK/py.svg") lines)"
else
  echo "✗ renderers have diverged — see the diff above" >&2
  exit 1
fi
