#!/usr/bin/env bash
# Measure the installed effect's real frame/render cost inside KWin: runs the
# in-effect demo scribble for N seconds (default 8) and prints the stats lines.
set -u
CFG="$HOME/.config/tendril-cursor/params.json"; mkdir -p "$(dirname "$CFG")"
saved=$(cat "$CFG" 2>/dev/null || echo '{}')
since=$(date '+%Y-%m-%d %H:%M:%S')
python3 - "$CFG" "$saved" <<'PY'
import json, sys, os
p, saved = sys.argv[1], json.loads(sys.argv[2] or "{}")
saved.update({"debugFps": 1, "debugDemo": 1})
open(p + ".tmp", "w").write(json.dumps(saved)); os.replace(p + ".tmp", p)
PY
sleep "${1:-8}"
printf '%s' "$saved" > "$CFG.tmp" && mv "$CFG.tmp" "$CFG"
sleep 1
journalctl --user --since "$since" --no-pager | grep -E "tendril .*frames" | sed 's/.*kwin_wayland\[[0-9]*\]: //'
