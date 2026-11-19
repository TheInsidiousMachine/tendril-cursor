# AGENTS.md — Tendril Cursor

A machine-oriented guide. For humans, start at README.md.

## What this is

A KWin (KDE Plasma 6, Wayland) effect that replaces the mouse cursor with a
procedural robotic arm. An invisible XCursor theme hides the real cursor.
The effect draws the arm on KWin's overlay layer, one QtQuick scene per output.
The arm's shape comes from the pointer's path: corners are pinned in place on
the screen and reeled in by a base on the screen edge ("omega beam" look).

## Single source of truth

- `core/tendril_core.js`: the model. `TendrilCore.create(params)` returns
  `M`, with `M.step(dt, px, py, W, H)`, `M.reset(px, py, W, H)`, `M.P` (live params),
  `M.DEFAULTS`, and `M.verts` (`[{x, y, k: 'b'|'j'|'h'}]`, base → corners
  → hinge), plus `M.tip`, `M.hinge`, `M.facingAng`, `M.asleep`.
- `core/tendril_render.js`: Canvas 2D drawing.
  `TendrilRender.create().draw(ctx, M, pointer, W, H)`.
- Both files are plain ES5. The browser bench, the node tests and QML all
  load them. CMake prepends `.pragma library` to generate the QML copies.
  Do not add syntax that QML's JS engine or ES5 cannot parse, and do not add
  `import`/`export`.

## Contracts (tests enforce most of them)

1. The claw tip equals the pointer, every frame.
2. The arm never crosses itself (`crossFrames: 0` in the soak).
3. Settled corners don't move (≤ 0.4 px/frame).
4. While the pointer is parked, the claw never rotates.
5. A crossed loop cinches shut within `max(0.6, cinchTime × 1.7)` s. It never
   vanishes in a single frame.
6. Arm length ≤ `armMax` × the screen diagonal.
7. The model runs fixed 1/60 s steps. `step(dt)` runs `round(acc / (1/60))`
   steps, at most 8.

## Hard-won pitfalls (don't repeat these)

- **Never base the effect on `KWin::QuickSceneEffect`.** It is the
  full-screen effect base: it grabs input and paints only its own scene, which
  blacks out the desktop. Use a plain `KWin::Effect` plus
  `KWin::OffscreenQuickScene` per output (the same pattern as KWin's showfps).
- Get pointer data from `EffectsHandler::mouseChanged`. `pointerMotion()` only
  reaches effects that grab the mouse.
- Rendering is manual and frame-synced: `setAutomaticRepaint(false)`, then
  in `prePaintScreen` call QML `tick(dt)` and then `scene->update(frame)`. Call
  `scheduleFrame()` in `postPaintScreen` only while `tick` returns true.
- KWin never unloads effect libraries, and the Qt resource registry is global
  to the process. So every build has a unique ID `tendril_<timestamp>` (plugin
  file name and qrc prefix, set in CMakeLists.txt). Never overwrite a loaded
  `.so` in place: `install.sh` installs to a temp name, then renames it.
- QML `console.log` is disabled on Fedora, and output goes to journald unless
  `QT_FORCE_STDERR_LOGGING=1`. Tests use `console.warn` with that variable set.
- Offscreen QML benchmarks don't reflect performance inside KWin. Measure with
  `tools/perf-probe.sh`, which uses the `debugFps` and `debugDemo` params.
- The invisible cursor theme has to list every cursor name. A missing name
  falls back to a visible cursor through `Inherits`.

## Verify a change

```bash
test/run.sh                                  # must print ALL PASS, crossFrames: 0, "qml smoke: ok"
node test/snap.js <scenario> <outprefix>     # worst-contact frame of a paths.js scenario -> SVG + PNG (needs rsvg-convert)
# browser: open tendril-bench.html?demo=zigzag|circle|scribble|tour|straight|hairpin
#          add &manual=1 and call window.benchAdvance(seconds) for deterministic screenshots
```

To test on the real desktop: `./install.sh`, then `tendril-cursor off && tendril-cursor on`.
`on` refuses and unloads if more than 35% of the screen changes when the
effect loads.

## Runtime interfaces

- Params: `~/.config/tendril-cursor/params.json`, a flat `{name: number}` that
  overrides `DEFAULTS`. The effect watches it; unknown keys are ignored.
- Tuner API (`tools/tendril-tune`, 127.0.0.1:8766): `GET/POST /api/params`,
  `GET /api/status` → `{effect: bool}`.
- CLI: `tendril-cursor on|off|try|status|tune`.
- Params reference: docs/tuning.md. Design notes: docs/how-it-works.md.
