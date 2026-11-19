const W = 1920, H = 1080, DT = 1 / 60;
const CENTER = { x: W / 2, y: H / 2 };
const paths = {
  circle:   t => ({ x: CENTER.x + 380 * Math.cos(t * 2.2), y: CENTER.y + 300 * Math.sin(t * 2.2) }),
  figure8:  t => ({ x: CENTER.x + 500 * Math.sin(t * 1.7), y: CENTER.y + 300 * Math.sin(t * 3.4) }),
  jumps:    t => { const P = [[200,200],[1700,900],[300,900],[1600,150],[900,540],[100,500]][Math.floor(t * 1.5) % 6]; return { x: P[0], y: P[1] }; },
  scribble: t => ({ x: CENTER.x + 600 * Math.sin(t * 5.3) * Math.cos(t * 1.1), y: CENTER.y + 350 * Math.sin(t * 7.1 + 1) }),
  spiralIn: t => { const r = 450 * Math.max(0.05, 1 - t / 12); return { x: CENTER.x + r * Math.cos(t * 4), y: CENTER.y + r * 0.7 * Math.sin(t * 4) }; },
  nearEdge: t => ({ x: 60 + ((t * 300) % 1800), y: 40 + 20 * Math.sin(t * 3) }),
  sitOnBase:t => ({ x: 40 + 30 * Math.sin(t * 2), y: 30 + 20 * Math.cos(t * 3) }),
  cornerSweep: t => { const s = (t * 400) % (2 * (W + H) - 200) + 100; const L = 2 * (W + H); const q = s % L;
      const e = 30; if (q < W) return { x: q, y: e }; if (q < W + H) return { x: W - e, y: q - W }; if (q < 2 * W + H) return { x: W - (q - W - H), y: H - e }; return { x: e, y: H - (q - 2 * W - H) }; },
  stop_go:  t => { const ph = Math.floor(t / 1.2) % 4; const a = [[300,300],[1500,300],[1500,800],[300,800]][ph]; const b = [[300,300],[1500,300],[1500,800],[300,800]][(ph + 1) % 4]; const u = Math.min(1, (t % 1.2) / 0.5); return { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u }; },
};
// seeded random walk with occasional warps
function rng(seed) { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
function randomWalk(seed) {
  const r = rng(seed); let x = r() * W, y = r() * H, vx = 0, vy = 0, last = -1;
  const cache = new Map();
  return t => { const f = Math.round(t * 60); while (last < f) { last++;
      vx = vx * 0.96 + (r() - 0.5) * 140; vy = vy * 0.96 + (r() - 0.5) * 140; x += vx * DT * 2; y += vy * DT * 2;
      if (r() < 0.004) { x = r() * W; y = r() * H; }
      x = Math.max(0, Math.min(W, x)); y = Math.max(0, Math.min(H, y)); cache.set(last, { x, y }); } return cache.get(f); };
}
for (let s = 1; s <= 6; s++) paths['fuzz' + s] = randomWalk(s * 7919);

module.exports = paths;
