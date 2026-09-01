#!/usr/bin/env bash
# Each card has two renderers — the Python generator (committed assets, and the
# fallback) and the Worker's TypeScript one (served live). They must agree byte
# for byte, or the README changes depending on which one answered.
#
#   card       scripts/generate_fastfetch.py    ↔ worker/src/card.ts
#   languages  scripts/generate_lang_treemap.py ↔ worker/src/languages.ts
#
# Usage: tests/parity.sh   (needs python3 and node >= 22 on PATH)
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$HERE")
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# node resolves relative TS imports by exact filename, so give them extensions
cp "$ROOT"/worker/src/*.ts "$HERE"/*.json "$WORK/"
cp "$HERE"/render_ts.ts "$HERE"/render_lang_ts.ts "$WORK/"
sed -i -E 's#from "\./(marina|github|card|languages)"#from "./\1.ts"#g' "$WORK"/*.ts

status=0
check() {
  local name=$1 py=$2 ts=$3
  python3 "$HERE/$py"                       > "$WORK/$name.py.svg"
  node --experimental-strip-types "$WORK/$ts" > "$WORK/$name.ts.svg"
  if diff -u "$WORK/$name.py.svg" "$WORK/$name.ts.svg"; then
    echo "✓ $name renderers agree ($(wc -l < "$WORK/$name.py.svg") lines)"
  else
    echo "✗ $name renderers have diverged — see the diff above" >&2
    status=1
  fi
}

check card      render_py.py      render_ts.ts
check languages render_lang_py.py render_lang_ts.ts

exit $status
