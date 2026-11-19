#!/usr/bin/env bash
# Offscreen QML smoke test of the real TendrilView. Usage: test/qml_smoke.sh [out.png]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-/tmp/tendril_qml_smoke.png}"
D="$(mktemp -d)"; trap 'rm -rf "$D"' EXIT
for n in core:TendrilCore render:TendrilRender; do
  src="$ROOT/core/tendril_${n%%:*}.js"; { echo ".pragma library"; cat "$src"; } > "$D/${n##*:}.js"
done
cp "$ROOT/qml/TendrilView.qml" "$D/"
sed "s|property string out: \"\"|property string out: \"$OUT\"|" "$ROOT/test/qml_smoke.qml" > "$D/smoke.qml"
QT_FORCE_STDERR_LOGGING=1 QT_QPA_PLATFORM=offscreen timeout 60 qml-qt6 "$D/smoke.qml" 2>&1 | tee "$D/log"
grep -q "RESULT saved=true" "$D/log" && ! grep -qiE "error|TypeError|ReferenceError|is not a|warning" "$D/log"
