#!/bin/sh
# Runs the rule tests with JavaScriptCore (built into macOS), then optional checks:
#   - every generated regex compiles under Edge's RE2 limits (needs: pip install google-re2)
#   - manifest.json, schema.json and referenced files are valid
# On Windows, run the JS tests with Node 22 or later instead: node tests/rules.test.js
set -e
cd "$(dirname "$0")/.."
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
PY=${PYTHON:-python3}

if [ -x "$JSC" ]; then
  OUT=$("$JSC" -m tests/rules.test.js) || { echo "$OUT" | grep -v '^REGEX '; exit 1; }
elif command -v node >/dev/null; then
  OUT=$(node tests/rules.test.js) || { echo "$OUT" | grep -v '^REGEX '; exit 1; }
else
  echo "Need JavaScriptCore (macOS) or Node to run the tests"; exit 1
fi
echo "$OUT" | grep -v '^REGEX '
echo "$OUT" | sed -n 's/^REGEX //p' | "$PY" tests/check_static.py
