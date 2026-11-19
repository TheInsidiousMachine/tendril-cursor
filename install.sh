#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD="$ROOT/build"

echo "KWin: $(kwin_wayland --version)"
echo "Configuring Tendril Cursor..."
cmake -S "$ROOT" -B "$BUILD" -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr
cmake --build "$BUILD" -j"$(nproc)"

echo "Installing KWin effect..."
# Atomic rename, never an in-place overwrite: KWin keeps a loaded effect library
# mapped for the life of the session, and rewriting a mapped .so can crash it.
PLUGDIR=$(qtpaths6 --query QT_INSTALL_PLUGINS)/kwin/effects/plugins
NEW=$(ls -t "$BUILD"/bin/kwin/effects/plugins/tendril_*.so | head -1)
ID=$(basename "$NEW" .so)
sudo install -m 0755 "$NEW" "$PLUGDIR/.$ID.so.new"
sudo mv -f "$PLUGDIR/.$ID.so.new" "$PLUGDIR/$ID.so"
# exactly one tendril build installed; older ids (incl. the old fullscreen "tendrilcursor") go.
# Unlinking a library KWin still has mapped is safe.
for old in "$PLUGDIR"/tendril*.so; do [ "$old" = "$PLUGDIR/$ID.so" ] || sudo rm -f "$old"; done
rm -f "$BUILD"/bin/kwin/effects/plugins/tendril*.so
echo "Effect id: $ID"
kwriteconfig6 --file kwinrc --group Plugins --key tendrilcursorEnabled --delete 2>/dev/null || true

echo "Installing invisible cursor theme..."
mkdir -p "$HOME/.local/share/icons"
rm -rf "$HOME/.local/share/icons/TendrilInvisible"
cp -a "$ROOT/cursor-theme/TendrilInvisible" "$HOME/.local/share/icons/"

echo "Installing tendril-cursor on/off tool + KRunner launchers..."
mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications"
ln -sf "$ROOT/tools/tendril-cursor" "$HOME/.local/bin/tendril-cursor"
for m in on off tune; do
  sed "s|\$HOME|$HOME|g" "$ROOT/tools/tendril-cursor-$m.desktop" > "$HOME/.local/share/applications/tendril-cursor-$m.desktop"
done

echo
printf '%s\n' "Installed. Turn it on:   tendril-cursor on"
printf '%s\n' "Turn it off (also: Alt+Space, 'Tendril Cursor Off'):   tendril-cursor off"
printf '%s\n' "Live settings (no restart):   tendril-cursor tune"
printf '%s\n' "After changing the code, run ./install.sh again then: tendril-cursor off && tendril-cursor on"
