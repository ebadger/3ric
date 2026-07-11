#!/bin/sh
# pre-push-tests.sh -- 3ric project test gate (runs on every push via .githooks/pre-push).
#
# Fast, cross-platform checks that need no WASM build: the 65C02 assembler encoding tests.
# If a WASM build is already present (web/badger6502.js), also run the emulator boot smoke
# test. The heavier web/test_*.cjs and codegen program tests need a full `web/build.ps1`
# build and Emscripten, so they run manually / in CI, not here. The C++ Badger6502VMTest
# suite runs in Visual Studio. This gate fails OPEN when no Node runtime is found.
#
# Escape hatch (routine skip): SKIP_TEST_GUARD=1 git push ...
set -eu

if [ "${SKIP_TEST_GUARD:-}" = "1" ]; then
  echo "pre-push-tests: SKIP_TEST_GUARD=1 -- skipping tests." >&2
  exit 0
fi

# Find a Node runtime. On the primary dev machine Node lives inside emsdk, not on PATH.
NODE=""
if command -v node >/dev/null 2>&1; then
  NODE=node
else
  for _n in "$HOME"/emsdk/node/*/bin/node "$HOME"/emsdk/node/*/bin/node.exe; do
    if [ -x "$_n" ]; then NODE="$_n"; break; fi
  done
fi

if [ -z "$NODE" ]; then
  echo "pre-push-tests: no Node runtime found -- skipping (fail-open)." >&2
  exit 0
fi

REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)

echo "pre-push-tests: running 65C02 assembler encoding tests..." >&2
"$NODE" "$REPO_ROOT/codegen/tools/asm6502.test.mjs" || exit 1

# Only runnable once the WASM emulator has been built at least once.
if [ -f "$REPO_ROOT/web/badger6502.js" ]; then
  echo "pre-push-tests: WASM build present -- running emulator boot smoke test..." >&2
  "$NODE" "$REPO_ROOT/web/test_boot.cjs" || exit 1
fi

echo "pre-push-tests: OK." >&2
exit 0
