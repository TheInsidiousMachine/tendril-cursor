# Tuning Tendril

**The easy way:** run `tendril-cursor tune` (or press Alt+Space and type
"Tendril Cursor Settings"). Move the sliders and the desktop cursor changes
right away. **Defaults** puts every setting back. **Copy values** copies
your current settings as JSON.

**By hand:** edit `~/.config/tendril-cursor/params.json`. It is a flat JSON
object of `name: number`, and only the values you change need to be in it:

```json
{ "armWidth": 24, "reelSpeed": 300, "restCorners": 1 }
```

`{}` or a missing file means all defaults. The effect reloads the file within
about 40 ms of any save. Unknown names are ignored, and so are values that
aren't numbers.

You can try the same settings in the browser playground
(`tendril-bench.html`, or the hosted copy) before you change your desktop.

## Main settings

| Name | Slider | Default | Range | Effect |
|---|---|---|---|---|
| `bendTol` | Bend sensitivity | 30 | 8–120 px | How far your path must stray from a straight line before the arm takes a corner. Low = many small cuts, high = a few big ones. |
| `reelHold` | Hold | 0.55 | 0–3 s | How long a new corner stays put before the base may reel it in. |
| `reelSpeed` | Reel speed | 420 | 60–2000 px/s | How fast the base reels corners in. |
| `cinchTime` | Loop close time | 0.35 | 0.05–2 s | How long a loop takes to pull tight when the arm crosses its own path. |
| `restCorners` | Rest bends | 2 | 0–4 | How many bends from your path the arm keeps once it settles. 0 = it straightens out. |
| `armWidth` | Thickness | 18.5 | 6–34 px | Thickness of the arm. |

## Advanced

| Name | Default | Effect |
|---|---|---|
| `minSeg` | 50 | Shortest leg (px) a new corner may create. |
| `minAngle` | 1.50 | Sharpest bend kept, in radians (1.5 ≈ 86°). Sharper bends open out and disappear. |
| `clearance` | 2.2 | How close (× arm width) two parts of the arm may get before that loop pulls shut. |
| `maxJoints` | 14 | Maximum number of corners. |
| `armMax` | 1.25 | Maximum arm length, × screen diagonal. |
| `armSoft` | 0.70 | Arm length (× diagonal) where reeling starts to speed up. |
| `reelBoost` | 3.0 | How much faster it reels past `armSoft` (extra px/s per px of extra length). |
| `restSlack` | 1.6 | Keeps the rest bends only while the arm is shorter than this × the base-to-claw distance. |
| `jointTau` | 0.05 | Seconds a new corner takes to snap out of a straight leg. |
| `foldTau`, `foldSpeed` | 0.10, 540 | How quickly too-sharp bends glide flat (time constant in s, speed cap in px/s). |
| `clawScale` | 1.15 | Claw size. |
| `faceRate` | 16 | Fastest the claw can turn (rad/s). |
| `fingers` | 4 | Number of claw fingers (2–4). |
| `openSpread` | 0.49 | How far apart the open fingers spread. |
| `clawSpeed` | 0.30 | How fast the jaws open and close. |
| `settleBack` | 1.32 | Claw body length relative to its reach. |
| `baseDelayMs` | 230 | Delay (ms) before the base starts to follow. |
| `baseSpeed` | 40 | Top speed of the base along the edge (px per frame). |
| `baseAccel`, `baseCommit`, `baseCorner`, `cornerRound` | 4, 0.36, 1400, 150 | How the base accelerates, commits to a direction, and rounds screen corners. |
| `baseDodge` | 160 | How far (px) the base keeps away from the claw. |
| `seg` | 15 | Sampling step for the internal chain (metrics). Leave it alone. |
| `warpDist` | 220 | A pointer jump bigger than this (px per frame) counts as a teleport: the arm re-poses instead of stretching. |

## Debug switches (effect only)

| Name | Effect |
|---|---|
| `debugFps: 1` | Logs frame interval and tick/render cost to the journal every 240 frames (`journalctl --user -g "tendril .*frames"`). |
| `debugDemo: 1` | The effect draws its own scribble instead of following the mouse. |

`tools/perf-probe.sh` sets both for a few seconds and then restores your file.

The defaults themselves live in `DEFAULTS` at the top of
`core/tendril_core.js`, and that is the authoritative list.
