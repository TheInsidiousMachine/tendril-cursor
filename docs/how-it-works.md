# How Tendril works

## The idea

A normal cursor is a small picture the compositor moves around. Tendril
hides that picture with an invisible cursor theme and draws its own pointer
inside KWin, the KDE Plasma compositor. Because KWin draws it on top of
everything, the arm can stretch across the whole screen.

The look it aims for is a beam that cuts sharp angles: it moves in straight
lines and makes clean geometric turns. It doesn't wiggle like a rope.

## The arm model (`core/tendril_core.js`)

The arm is a list of points: `base → corners… → hinge → claw tip`.

1. **Tip = pointer.** The claw tip is exactly where the pointer is, every
   frame. Nothing about the arm can make a click land somewhere else.
2. **Corners from your path.** The model watches the path the claw's hinge
   takes since the last corner. If that path strays more than `bendTol` px
   from a straight line, it places a corner there, pinned to the screen.
   A straight move never creates a corner.
3. **Reeling in.** Each corner waits `reelHold` seconds, then the base
   unzips corners oldest first at `reelSpeed` px/s. The base walks along its
   screen edge to follow. The longer the arm gets, the faster the reel runs.
4. **Rest shape.** The reel stops when `restCorners` bends are left. The
   arm settles in the shape of how it got there instead of a straight line.
5. **Claw stays still when you do.** While the pointer is parked, the claw
   never rotates, even while the arm behind it is still being reeled in.

### Why it can't tangle

The memory is bounded by construction:

- **Corner limit:** at most `maxJoints` corners. Past that, the least
  important one is merged away.
- **Length limit:** the arm can be at most `armMax` × the screen diagonal.
  Past `armSoft`, the reel speeds up.
- **Self-touch:** if two parts of the arm, or the arm and the claw, come
  within `clearance` × the arm's width of each other, the loop between them
  pulls shut into the contact point over about `cinchTime` seconds. It
  closes smoothly instead of vanishing.
- **Too-sharp bends:** a bend sharper than `minAngle` opens out and
  disappears, because a thick tube can't show a hairpin cleanly. This is
  also how moving the pointer back along its own path "rewinds" the arm.

A simulation over 15 scripted paths plus a 180,000-frame random soak
(`test/run.sh`) checks for zero self-crossings, zero NaNs, settled corners
that don't drift, loops that close in time, and a claw that doesn't turn
while parked.

### Fixed timestep

The model always advances in steps of exactly 1/60 s. Each call to
`step(dt)` runs the nearest whole number of steps for the time that passed,
so on a 60 Hz display that is one step per frame, locked to the display.

## Drawing (`core/tendril_render.js`)

The renderer uses plain Canvas 2D, so the browser bench and the QtQuick
`Canvas` share the same code.

- Each straight leg is its own armoured tube with one shading gradient.
  Plates are square-cut at the leg's ends.
- The outside of each bend is cut flat (a bevel join), and one seam runs
  along the bend line, so bends look clean, with no spikes.
- Then the mount on the screen edge, the claw's hinge and the claw are drawn.

## Inside KWin (`src/`, `qml/`)

- `TendrilEffect` is a plain `KWin::Effect`. It does **not** grab the
  keyboard or mouse. It doesn't use `QuickSceneEffect` either: that is
  the base class for full-screen effects like Overview, and it hides the
  desktop.
- One `OffscreenQuickScene` per screen. It draws on KWin's overlay layer,
  on top of the normal desktop.
- Pointer position and buttons come from `EffectsHandler::mouseChanged`.
- **Frame-synced:** in `prePaintScreen` the effect calls the QML `tick(dt)`
  and renders the scene for that frame. It asks for another frame only while
  the arm is still moving. When nothing moves, it draws nothing and costs
  nothing.
- The canvas is rasterised on a worker thread (`Canvas.Threaded`), which
  keeps KWin's main thread free. Measured inside KWin on a 1080p display:
  frame interval mean 16.7 ms, 95th percentile 17.6 ms.

### Live settings

The effect watches `~/.config/tendril-cursor/params.json`. It watches both
the file and its folder, so editors that save by renaming still work. Any
change is applied within about 40 ms. `tools/tendril-tune` is a tiny local
server (127.0.0.1 only) that serves the bench page and writes that file
when you move a slider.

### Build IDs

KWin never unloads an effect's library, and Qt's resource registry is shared
across the whole process. So each build gets a unique ID,
`tendril_<timestamp>`, for both the plugin and its QML resources. A new build
can then load into the running session with no log-out, and an old build
can't shadow the new one's QML. `install.sh` keeps exactly one build
installed, and `tendril-cursor` finds it automatically.

### Hiding the normal cursor

`cursor-theme/TendrilInvisible` is an XCursor theme where every cursor name
(156 of them: arrows, resize, text, busy…) is a transparent image. Every
name has to be listed. Without that, a missing name falls back to a visible
cursor from another theme. `tendril-cursor on` applies it to Plasma and to
X11 apps (through `xrdb`), and saves your old theme for `off`.

## Measuring performance

`tools/perf-probe.sh` turns on `debugFps` and `debugDemo` for a few
seconds. The effect then draws its own scribble, with no real mouse needed,
and logs frame timing to the journal. Afterwards it restores your settings.
Note that offline QML benchmarks (`QT_QPA_PLATFORM=offscreen`) don't
reflect performance inside KWin, so measure in KWin.
