// Shared geometry checks for the sim / snapshot tools.
function segSegDist(a, b, c, d) {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y, den = rx * sy - ry * sx;
  if (Math.abs(den) > 1e-9) {
    const qx = c.x - a.x, qy = c.y - a.y, t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
    if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) return { d: 0, s: t, t: u };
  }
  const pt = (p, a, b) => { const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-12;
    const k = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)); return [Math.hypot(p.x - a.x - dx * k, p.y - a.y - dy * k), k]; };
  let best = { d: Infinity, s: 0, t: 0 }, r;
  r = pt(a, c, d); if (r[0] < best.d) best = { d: r[0], s: 0, t: r[1] };
  r = pt(b, c, d); if (r[0] < best.d) best = { d: r[0], s: 1, t: r[1] };
  r = pt(c, a, b); if (r[0] < best.d) best = { d: r[0], s: r[1], t: 0 };
  r = pt(d, a, b); if (r[0] < best.d) best = { d: r[0], s: r[1], t: 1 };
  return best;
}
function ptPoly(p, v) {
  let m = Infinity;
  for (let i = 0; i < v.length - 1; i++) {
    const a = v[i], b = v[i + 1], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-12;
    const k = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
    m = Math.min(m, Math.hypot(p.x - a.x - dx * k, p.y - a.y - dy * k));
  }
  return m;
}
// Arm + claw as segments; report true crossings and near-contacts between parts
// that are far apart ALONG the arm (same rule the model enforces, slightly relaxed).
function contacts(m) {
  const v = m.verts, segs = [];
  for (let i = 0; i < v.length - 1; i++) segs.push([v[i], v[i + 1]]);
  segs.push([m.hinge, m.tip]);
  const cum = [0]; for (const s of segs) cum.push(cum[cum.length - 1] + Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y));
  const clr = m.P.clearance * m.P.armWidth;
  let cross = 0, near = 0;
  for (let j = segs.length - 1; j >= 2; j--) for (let i = 1; i <= j - 2; i++) {
    if (segs[i][0].c || segs[i][1].c || segs[j][0].c || segs[j][1].c) continue;   // loop mid-cinch (by design)
    const r = segSegDist(segs[i][0], segs[i][1], segs[j][0], segs[j][1]);
    const gap = (cum[j] + r.t * (cum[j + 1] - cum[j])) - (cum[i] + r.s * (cum[i + 1] - cum[i]));
    if (r.d === 0 && gap > 1) cross++;
    else if (r.d < clr * 0.9 && gap > clr * 3.2) near++;
  }
  return { cross, near };
}

module.exports = { segSegDist, ptPoly, contacts };
