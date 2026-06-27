#!/bin/sh
# pre-push-tests.sh -- 3RIC test gate for .githooks/pre-push.
#
# Runs the project's fast tests before every push and BLOCKS the push if they
# fail. The gate is "fail-closed when the artifacts exist, fail-open when they
# don't": if a build output is present we run its tests and block on failure; if
# nothing is built yet (e.g. a docs-only push from a fresh clone) we warn and
# skip, so you're not forced into a full build just to push.
#
# Covers the critical path -- the host and web emulators must stay consistent
# with the real hardware build:
#   1. Web (WASM) headless node tests  -- web/test_*.cjs   (needs web/build.ps1 output)
#   2. C++ VM unit tests               -- Badger6502VMTest (needs an MSVC build)
#
# Escape hatch for routine, test-irrelevant pushes:  SKIP_TEST_GUARD=1 git push
# (Both gates below are fail-open by design; there is no separate non-bypassable
#  critical-path gate yet -- add one here once an executable eval suite exists.)
set -eu

if [ "${SKIP_TEST_GUARD:-}" = "1" ]; then
  echo "pre-push-tests: SKIP_TEST_GUARD=1 -- skipping tests." >&2
  exit 0
fi

ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cd "$ROOT"

fail=0

# --- 1. Web (WASM) headless node tests --------------------------------------
# Resolve node: PATH first, then an emsdk-bundled node (the web build uses emsdk).
NODE=""
if command -v node >/dev/null 2>&1; then
  NODE=node
elif [ -n "${EMSDK:-}" ] && [ -d "${EMSDK}/node" ]; then
  NODE=$(ls "${EMSDK}"/node/*/bin/node.exe 2>/dev/null | head -n 1 || true)
elif [ -n "${HOME:-}" ] && [ -d "${HOME}/emsdk/node" ]; then
  NODE=$(ls "${HOME}"/emsdk/node/*/bin/node.exe 2>/dev/null | head -n 1 || true)
fi

if [ -z "$NODE" ]; then
  echo "pre-push-tests: node not found (PATH or emsdk) -- skipping web tests." >&2
elif [ ! -f web/badger6502.js ] || [ ! -f web/data/badger6502.bin ]; then
  echo "pre-push-tests: web WASM build not present -- run web/build.ps1 first; skipping web tests." >&2
else
  echo "pre-push-tests: running web headless tests with '$NODE'..." >&2
  for t in web/test_*.cjs; do
    [ -f "$t" ] || continue
    echo "  -> $t" >&2
    if ! "$NODE" "$t"; then
      echo "pre-push-tests: FAILED $t" >&2
      fail=1
    fi
  done
fi

# --- 2. C++ VM unit tests (Badger6502VMTest) --------------------------------
# Run only if both vstest.console.exe and a built test DLL are available; this
# avoids forcing a heavy MSBuild inside the push. Build the solution (Visual
# Studio or msbuild) to arm this gate.
VSWHERE="/c/Program Files (x86)/Microsoft Visual Studio/Installer/vswhere.exe"
VSTEST=""
if [ -x "$VSWHERE" ]; then
  VSTEST=$("$VSWHERE" -latest -products '*' -find '**/vstest.console.exe' 2>/dev/null | head -n 1 || true)
  if [ -n "$VSTEST" ] && command -v cygpath >/dev/null 2>&1; then
    VSTEST=$(cygpath -u "$VSTEST")
  fi
fi

TESTDLL=""
if [ -d emulator/Badger6502VMTest ]; then
  TESTDLL=$(find emulator/Badger6502VMTest -name Badger6502VMTest.dll -type f 2>/dev/null | head -n 1 || true)
fi

if [ -z "$VSTEST" ]; then
  echo "pre-push-tests: vstest.console.exe not found -- skipping C++ VM tests." >&2
elif [ -z "$TESTDLL" ]; then
  echo "pre-push-tests: Badger6502VMTest.dll not built -- build the solution to arm this gate; skipping." >&2
else
  DLLARG=$TESTDLL
  command -v cygpath >/dev/null 2>&1 && DLLARG=$(cygpath -w "$TESTDLL")
  echo "pre-push-tests: running C++ VM tests -> $TESTDLL" >&2
  if ! "$VSTEST" "$DLLARG" /Logger:console >&2; then
    echo "pre-push-tests: FAILED Badger6502VMTest" >&2
    fail=1
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo "pre-push-tests: TESTS FAILED -- push blocked. (Override with SKIP_TEST_GUARD=1 only if you know why.)" >&2
  exit 1
fi

echo "pre-push-tests: all available test suites passed." >&2
exit 0
