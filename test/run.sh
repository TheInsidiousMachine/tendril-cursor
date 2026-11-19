#!/usr/bin/env bash
# Everything that can be checked without installing into KWin.
set -e
cd "$(dirname "$0")/.."
node test/sim.js
node test/fuzz.js 24
test/qml_smoke.sh >/dev/null && echo "qml smoke: ok"
