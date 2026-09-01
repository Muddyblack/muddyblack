#!/usr/bin/env bash
# Runs the Worker's logic outside Cloudflare, before you deploy.
#
#   worker/test/run.sh e2e     hits the live GitHub API, writes /tmp/card.svg
#   worker/test/run.sh bench   renders in a loop, reports steady-state CPU
#
# src/ uses extensionless imports because that is what wrangler/esbuild wants;
# node resolves by exact filename, so everything is copied to a temp dir with
# the extensions written in. Needs node >= 22 and, for e2e, $GITHUB_TOKEN.
set -euo pipefail

MODE="${1:-e2e}"
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$(dirname "$HERE")")
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/src" "$WORK/tests"
cp "$ROOT"/worker/src/*.ts "$WORK/src/"
cp "$HERE"/*.ts            "$WORK/src/"
cp "$ROOT"/tests/fixture.json "$WORK/tests/"
sed -i -E 's#from "(\.\./src/|\./)(marina|github|card)(\.ts)?"#from "./\2.ts"#g' "$WORK/src"/*.ts
sed -i -E 's#\.\./\.\./tests/fixture\.json#../tests/fixture.json#'              "$WORK/src"/*.ts

case "$MODE" in
  e2e)
    : "${GITHUB_TOKEN:?set GITHUB_TOKEN (a token with no scopes is enough for public data)}"
    node --experimental-strip-types "$WORK/src/e2e.ts" /tmp/card.svg
    echo "  wrote /tmp/card.svg — open it to check the render"
    ;;
  bench)
    node --experimental-strip-types "$WORK/src/bench.ts"
    ;;
  *) echo "usage: $0 [e2e|bench]" >&2; exit 2 ;;
esac
