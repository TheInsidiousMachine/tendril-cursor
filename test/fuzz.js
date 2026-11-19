#!/usr/bin/env node
// Wide random soak: many seeds x several screen sizes. Counts hard failures only.
const Core = require('../core/tendril_core.js');
const sizes = [[1920, 1080], [2560, 1440], [1366, 768], [3840, 2160], [1080, 1920]];
const DT = 1 / 60;
const { contacts } = require('./sim_lib.js');
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function segX(a, b, c, d) { const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y, den = rx * sy - ry * sx; if (Math.abs(den) < 1e-9) return false; const qx = c.x - a.x, qy = c.y - a.y, t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den; return t > 0 && t < 1 && u > 0 && u < 1; }
let frames = 0, cross = 0, nan = 0, maxArmRatio = 0, overlap = 0, worst = null;
const seeds = +process.argv[2] || 40;
for (const [W, H] of sizes) for (let sd = 1; sd <= seeds; sd++) {
  const r = rng(sd * 104729 + W); const m = Core.create(); let x = r() * W, y = r() * H, vx = 0, vy = 0;
  const mode = sd % 4;
  for (let f = 0; f < 60 * 25; f++) {
    // mixture: random walk, hover-still, straight sweeps, warps
    if (mode === 0 || mode === 1) { vx = vx * 0.96 + (r() - 0.5) * 140; vy = vy * 0.96 + (r() - 0.5) * 140; x += vx * DT * 2; y += vy * DT * 2; if (r() < 0.004) { x = r() * W; y = r() * H; } }
    else if (mode === 2) { if (f % 90 === 0) { vx = (r() - 0.5) * 3000; vy = (r() - 0.5) * 3000; } x += vx * DT; y += vy * DT; if (r() < 0.2 && f % 200 > 150) { vx = vy = 0; } }
    else { if (f % 120 === 0) { x = r() * W; y = r() * H; } else { x += Math.sin(f * 0.05) * 3; y += Math.cos(f * 0.07) * 3; } }
    x = Math.max(0, Math.min(W - 1, x)); y = Math.max(0, Math.min(H - 1, y));
    m.step(DT, x, y, W, H);
    frames++;
    if (m.verts.some(n => !isFinite(n.x) || !isFinite(n.y))) { nan++; continue; }
    const cramped = Math.hypot(m.shoulder.x - m.tip.x, m.shoulder.y - m.tip.y) < m.clawBodyLen() * 2.2;
    if (cramped) continue;
    const c = contacts(m);
    if (c.cross) { cross++; if (!worst) worst = { W, H, sd, f }; }
    if (c.near) overlap++;
    maxArmRatio = Math.max(maxArmRatio, m.armLength() / Math.hypot(W, H));
  }
}
console.log({ frames, crossFrames: cross, overlapFrames: overlap, nan, maxArmRatio: +maxArmRatio.toFixed(2), firstCross: worst });
process.exit(nan || cross || overlap / frames > 0.002 || maxArmRatio > Core.DEFAULTS.armMax + 1e-6 ? 1 : 0);
