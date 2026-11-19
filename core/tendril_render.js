// Tendril renderer — shared by the bench (browser canvas) and the KWin QML
// effect (QtQuick Canvas 2D). Pure drawing: reads the model, never mutates it.
//   const r = TendrilRender.create();  r.draw(ctx, model, pointer, W, H);
var TendrilRender = (function () {
"use strict";
function create() {
  let ctx, model, P, chain, target, W = 0, H = 0, lastClawAngle = 0;
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const norm = (x, y) => { const m = Math.hypot(x, y) || 1; return { x: x / m, y: y / m }; };
  const rot = (v, a) => { const c = Math.cos(a), s = Math.sin(a); return { x: v.x * c - v.y * s, y: v.x * s + v.y * c }; };
  const lerpPt = (A, B, t) => ({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t });
  const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const clawReach = () => model.clawReach();

const C = {
  casing: "#262d33", seam: "#0b0f12", bolt: "#1c2226",
  clawFill: "#454e56", clawHi: "#c4ced3", clawDark: "#0f1418",
  lens: "#ff4d3d", lensCore: "#ffd7ac", spark: "#ffe4b0",
};
function poly(pts, fill, stroke, sw) {
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.lineWidth = sw || 1; ctx.lineJoin = "miter"; ctx.strokeStyle = stroke; ctx.stroke(); }
}
function line(a, b, w, color, cap) {
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  ctx.lineWidth = w; ctx.lineCap = cap || "butt"; ctx.strokeStyle = color; ctx.stroke();
}
function ngon(c, r, ang, sides, fill, stroke, sw) {
  const pts = [];
  for (let i = 0; i < sides; i++) { const a = ang + (i + 0.5) * (Math.PI * 2 / sides); pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }); }
  poly(pts, fill, stroke, sw);
}
function dot(p, r, fill) { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fillStyle = fill; ctx.fill(); }

function resample(pts, s) {
  if (pts.length < 2) return pts.map(p => ({ x: p.x, y: p.y }));
  const out = [{ x: pts[0].x, y: pts[0].y }];
  let prev = { x: pts[0].x, y: pts[0].y }, carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const cur = pts[i];
    let seg = dist(prev.x, prev.y, cur.x, cur.y);
    while (seg > 0.0001 && carry + seg >= s) {
      const f = (s - carry) / seg;
      prev = { x: prev.x + (cur.x - prev.x) * f, y: prev.y + (cur.y - prev.y) * f };
      out.push({ x: prev.x, y: prev.y });
      seg = dist(prev.x, prev.y, cur.x, cur.y); carry = 0;
    }
    carry += seg; prev = { x: cur.x, y: cur.y };
  }
  const last = pts[pts.length - 1];
  if (dist(last.x, last.y, out[out.length - 1].x, out[out.length - 1].y) > s * 0.35) out.push({ x: last.x, y: last.y });
  return out;
}
// A plate's shading only varies ACROSS the tube, so one gradient serves a whole
// straight leg (pass it as `fill`); building one per plate was most of the frame
// cost in Qt's software Canvas.
function plateGradient(c, n, w) {
  const g = ctx.createLinearGradient(c.x - n.x * w, c.y - n.y * w, c.x + n.x * w, c.y + n.y * w);
  g.addColorStop(0.00, "#141a1e"); g.addColorStop(0.20, "#434d55"); g.addColorStop(0.46, "#9ba7ae");
  g.addColorStop(0.60, "#606a72"); g.addColorStop(1.00, "#10151a");
  return g;
}
function drawScale(c, d, w, BAND, fill) {
  const n = { x: -d.y, y: d.x };
  const front = BAND * 0.60, back = BAND * 0.80, chev = w * 0.52;
  const P0 = { x: c.x - d.x * back + n.x * w, y: c.y - d.y * back + n.y * w };
  const P1 = { x: c.x - d.x * back - n.x * w, y: c.y - d.y * back - n.y * w };
  const P2 = { x: c.x + d.x * front - n.x * w, y: c.y + d.y * front - n.y * w };
  const P3 = { x: c.x + d.x * (front + chev), y: c.y + d.y * (front + chev) };
  const P4 = { x: c.x + d.x * front + n.x * w, y: c.y + d.y * front + n.y * w };
  poly([P0, P1, P2, P3, P4], fill || plateGradient(c, n, w), null);
  line(P2, P3, 1.5, C.seam); line(P3, P4, 1.5, C.seam);
  line(P2, P3, 0.7, "rgba(198,208,214,0.42)"); line(P3, P4, 0.7, "rgba(198,208,214,0.42)");
}
function armPath() {
  // the polyline vertices when the model provides them (sharp corners), else the chain
  return (model.verts && model.verts.length >= 2) ? model.verts : chain;
}
function strokePath(pts) {
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
}
// Each straight leg is its own plated tube, square-cut at its ends. At a bend
// the outside is a bevelled chamfer of plain casing (never a spike) and the
// inside overlap is split along the bisector, with one seam across the joint.
function cornerInfo(pts, i) {
  const V = pts[i], da = norm(pts[i - 1].x - V.x, pts[i - 1].y - V.y), db = norm(pts[i + 1].x - V.x, pts[i + 1].y - V.y);
  const half = Math.acos(clamp(da.x * db.x + da.y * db.y, -1, 1)) / 2;   // half the interior angle
  return { da, db, half, bis: norm(da.x + db.x, da.y + db.y) };
}
function quad(a, b, c, d) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.closePath(); }
function drawArm() {
  const pts = armPath();
  if (pts.length < 2) return;
  const w = P.armWidth, BAND = Math.max(7, w * 0.9);
  ctx.save(); ctx.lineJoin = "bevel"; ctx.lineCap = "butt";
  strokePath(pts);
  ctx.lineWidth = w * 2 + 5; ctx.strokeStyle = C.seam; ctx.stroke();
  ctx.lineWidth = w * 2; ctx.strokeStyle = C.casing; ctx.stroke();
  ctx.restore();
  if (pts === chain) {                          // legacy smooth chain: plates follow the curve
    const line2 = resample(pts, BAND * 0.58);
    for (let i = line2.length - 1; i >= 1; i--) {
      const prv = line2[Math.max(0, i - 1)], nxt = line2[Math.min(line2.length - 1, i + 1)];
      drawScale(line2[i], norm(nxt.x - prv.x, nxt.y - prv.y), w, BAND);
    }
    return;
  }
  const corner = new Array(pts.length).fill(null);
  for (let i = 1; i < pts.length - 1; i++) {
    const c = cornerInfo(pts, i);
    if (c.half < Math.PI / 2 - 0.02) corner[i] = c;
  }
  const back = BAND * 0.80, front = BAND * 0.60 + w * 0.52, step = BAND * 0.58, R = w + 2.5, BIG = 1e4;
  for (let i = pts.length - 1; i >= 1; i--) {
    const A = pts[i - 1], B = pts[i], L = dist(A.x, A.y, B.x, B.y);
    if (L < 1e-3) continue;
    const d = { x: (B.x - A.x) / L, y: (B.y - A.y) / L }, n = { x: -d.y, y: d.x };
    ctx.save();
    ctx.beginPath();                            // own tube, square-cut at both vertices
    quad({ x: A.x + n.x * R, y: A.y + n.y * R }, { x: B.x + n.x * R, y: B.y + n.y * R },
         { x: B.x - n.x * R, y: B.y - n.y * R }, { x: A.x - n.x * R, y: A.y - n.y * R });
    ctx.clip();
    for (const [V, c, into] of [[A, corner[i - 1], d], [B, corner[i], { x: -d.x, y: -d.y }]]) {
      if (!c) continue;                         // keep only this leg's side of the bisector
      let m = { x: -c.bis.y, y: c.bis.x };
      if (m.x * into.x + m.y * into.y < 0) m = { x: -m.x, y: -m.y };
      const p1 = { x: V.x + c.bis.x * BIG, y: V.y + c.bis.y * BIG }, p2 = { x: V.x - c.bis.x * BIG, y: V.y - c.bis.y * BIG };
      ctx.beginPath();
      quad(p1, p2, { x: p2.x + m.x * BIG, y: p2.y + m.y * BIG }, { x: p1.x + m.x * BIG, y: p1.y + m.y * BIG });
      ctx.clip();
    }
    const n2 = Math.max(1, Math.ceil((L + back + front) / step));
    const legFill = plateGradient(A, n, w);
    for (let k = n2; k >= 0; k--) {
      const s = -back + k * step;
      drawScale({ x: A.x + d.x * s, y: A.y + d.y * s }, d, w, BAND, legFill);
    }
    ctx.restore();
  }
  for (let i = 1; i < pts.length - 1; i++) {   // one seam across each joint: inner crease -> chamfer
    const c = corner[i];
    if (!c) continue;
    const V = pts[i];
    const legs = Math.min(dist(V.x, V.y, pts[i - 1].x, pts[i - 1].y), dist(V.x, V.y, pts[i + 1].x, pts[i + 1].y));
    const rin = Math.min(w / Math.sin(c.half), legs), rout = w * Math.sin(c.half);
    const inner = { x: V.x + c.bis.x * rin, y: V.y + c.bis.y * rin }, outer = { x: V.x - c.bis.x * rout, y: V.y - c.bis.y * rout };
    line(inner, outer, 2, C.seam);
    line(lerpPt(V, inner, 0.2), lerpPt(V, outer, 0.8), 0.8, "rgba(198,208,214,0.3)");
  }
}
function drawMount() {
  
  const m = chain.length ? chain[0] : { x: 0, y: H / 2 };
  const w = P.armWidth;
  let edge;
  if (m.y <= 0.6) edge = 2; else if (m.y >= H - 0.6) edge = 3; else if (m.x <= 0.6) edge = 0; else edge = 1;
  const along = (edge < 2) ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const into = edge === 0 ? { x: 1, y: 0 } : edge === 1 ? { x: -1, y: 0 } : edge === 2 ? { x: 0, y: 1 } : { x: 0, y: -1 };
  const hw = w * 2.6, depth = w * 2.2;
  poly([
    { x: m.x - along.x * hw, y: m.y - along.y * hw },
    { x: m.x + along.x * hw, y: m.y + along.y * hw },
    { x: m.x + along.x * hw * 0.6 + into.x * depth, y: m.y + along.y * hw * 0.6 + into.y * depth },
    { x: m.x - along.x * hw * 0.6 + into.x * depth, y: m.y - along.y * hw * 0.6 + into.y * depth },
  ], "#333b42", C.seam, 2);
  for (const t of [-0.6, 0.6]) {
    const b = { x: m.x + along.x * hw * t + into.x * depth * 0.4, y: m.y + along.y * hw * t + into.y * depth * 0.4 };
    dot(b, w * 0.2, C.bolt); ctx.lineWidth = 1; ctx.strokeStyle = "#8f9ba3"; ctx.stroke();
  }
}
function drawAperture() {
  // occlude the tendril where it feeds into the base so it reads as infinite spool
  if (chain.length < 2) return;
  const m = chain[0], w = P.armWidth;
  const d = norm(chain[1].x - m.x, chain[1].y - m.y);
  const ang = Math.atan2(d.y, d.x);
  ngon(m, w * 1.5, ang, 6, "#1b2126", "#8f9ba3", 1.6);
  ngon(m, w * 1.02, ang, 6, "#070a0c", "#2c3a42", 1.2);
}

function ik2(p, t, a, b, bendSign) {
  let dx = t.x - p.x, dy = t.y - p.y;
  let d = Math.hypot(dx, dy) || 1e-6;
  d = clamp(d, Math.abs(a - b) + 0.5, a + b - 0.5);
  const u = norm(dx, dy);
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const kd = rot(u, Math.acos(cosA) * bendSign);
  return { x: p.x + kd.x * a, y: p.y + kd.y * a };
}
function drawFinger(p, knee, tip, side, s, w) {
  const w1 = w * 0.5 * s, w2 = w * 0.36 * s;
  const d1 = norm(knee.x - p.x, knee.y - p.y), n1 = { x: -d1.y, y: d1.x };
  const d2 = norm(tip.x - knee.x, tip.y - knee.y), n2 = { x: -d2.y, y: d2.x };
  const out = [
    { x: p.x + n1.x * w1, y: p.y + n1.y * w1 },
    { x: knee.x + n1.x * w2, y: knee.y + n1.y * w2 },
    { x: knee.x + n2.x * w2, y: knee.y + n2.y * w2 },
    { x: tip.x, y: tip.y },
    { x: knee.x - n2.x * w2, y: knee.y - n2.y * w2 },
    { x: knee.x - n1.x * w2, y: knee.y - n1.y * w2 },
    { x: p.x - n1.x * w1, y: p.y - n1.y * w1 },
  ];
  ctx.save(); ctx.translate(0, 3); poly(out, "rgba(0,0,0,0.26)", null); ctx.restore();
  poly(out, C.clawFill, C.clawDark, 1.4);
  line({ x: knee.x + n1.x * w2, y: knee.y + n1.y * w2 }, { x: knee.x - n1.x * w2, y: knee.y - n1.y * w2 }, 1.2, C.seam);
  const io = side >= 0 ? 1 : -1;
  line({ x: p.x + io * n1.x * w1, y: p.y + io * n1.y * w1 }, { x: knee.x + io * n1.x * w2, y: knee.y + io * n1.y * w2 }, 1, C.clawHi);
  line({ x: knee.x + io * n2.x * w2, y: knee.y + io * n2.y * w2 }, tip, 0.9, C.clawHi);
  dot(knee, 2.2 * s, C.bolt);
}
function drawClaw() {
  const hinge = chain.length ? chain[chain.length - 1] : model.hinge;   // where the tendril connects — the claw swings about THIS point
  const grab = target.seen ? target : { x: hinge.x + 1, y: hinge.y };
  let dx = grab.x - hinge.x, dy = grab.y - hinge.y, d = Math.hypot(dx, dy);
  const ang = d < 1 ? lastClawAngle : Math.atan2(dy, dx);
  lastClawAngle = ang;
  const f = { x: Math.cos(ang), y: Math.sin(ang) }, n = { x: -Math.sin(ang), y: Math.cos(ang) };
  const s = P.clawScale, w = P.armWidth;
  const hubR = w * 1.15 * s;
  const boneA = clawReach() * 0.54, boneB = clawReach() * 0.46, reach = boneA + boneB;
  const jawGrip = model.jawGrip;
  const ge = smooth(clamp(jawGrip, 0, 1));
  const flare = jawGrip < 0 ? -jawGrip : 0;

  // the housing sits FORWARD of the hinge; the lens is in the housing, not on the pivot
  const hub = { x: hinge.x + f.x * hubR * 1.05, y: hinge.y + f.y * hubR * 1.05 };

  // hinge knuckle
  line(hinge, hub, w * 1.1 * s, "#2b333a", "round");
  ngon(hinge, w * 0.62 * s, ang, 6, "#323b43", C.seam, 1.5);
  dot(hinge, w * 0.24 * s, "#8f9ba3");

  ngon(hub, hubR, ang, 8, "#39424a", C.seam, 2);
  ngon(hub, hubR * 0.55, ang, 8, "#242c32", "rgba(198,208,214,0.25)", 1);
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  const lg = ctx.createRadialGradient(hub.x, hub.y, 0, hub.x, hub.y, hubR * 0.9);
  lg.addColorStop(0, "rgba(255,80,62,0.5)"); lg.addColorStop(1, "rgba(255,80,62,0)");
  ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(hub.x, hub.y, hubR * 0.9, 0, 7); ctx.fill();
  ctx.restore();
  ngon(hub, hubR * 0.32, ang, 6, C.lens, "#560d09", 1.2);
  dot(hub, hubR * 0.12, C.lensCore);

  const nF = Math.round(P.fingers);
  for (let k = 0; k < nF; k++) {
    const u = nF === 1 ? 0 : (k / (nF - 1)) * 2 - 1;
    const side = u === 0 ? (k % 2 ? 1 : -1) : Math.sign(u);
    const pivot = { x: hub.x + n.x * u * hubR * 0.85 + f.x * hubR * 0.35, y: hub.y + n.y * u * hubR * 0.85 + f.y * hubR * 0.35 };
    const restDir = rot(f, side * (P.openSpread + flare * 0.6));
    const restT = { x: pivot.x + restDir.x * reach * 0.95, y: pivot.y + restDir.y * reach * 0.95 };
    const T = lerpPt(restT, grab, ge);
    drawFinger(pivot, ik2(pivot, T, boneA, boneB, side >= 0 ? 1 : -1), T, side, s, w);
  }
  if (jawGrip > 0.7) {
    const g = (jawGrip - 0.7) / 0.3;
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const rg = ctx.createRadialGradient(grab.x, grab.y, 0, grab.x, grab.y, 20 * g);
    rg.addColorStop(0, "rgba(255,228,176,0.55)"); rg.addColorStop(1, "rgba(255,228,176,0)");
    ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(grab.x, grab.y, 20 * g, 0, 7); ctx.fill();
    ctx.restore();
  }
  dot(grab, 2, C.spark);
}


  function draw(c, m, pointer, w, h) {
    ctx = c; model = m; P = m.P; target = pointer; W = w; H = h; chain = m.chain;
    if (!chain.length) return;
    drawMount();
    drawArm();
    drawAperture();
    drawClaw();
  }
  return { draw: draw };
}
var api = { create: create };
return api;
})();
if (typeof module !== "undefined" && module.exports) module.exports = TendrilRender;
