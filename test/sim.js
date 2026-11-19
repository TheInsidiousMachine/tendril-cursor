#!/usr/bin/env node
// Headless acceptance harness for core/tendril_core.js (omega-beam model). Exit code != 0 on failure.
//   node test/sim.js         scripted + fuzz scenarios, prints metrics, enforces limits
const path = require('path');
const Core = require(path.join(__dirname, '..', 'core', 'tendril_core.js'));
const W = 1920, H = 1080, DT = 1 / 60;

const { ptPoly, contacts } = require('./sim_lib.js');

function run(name, pathFn, secs, params) {
  const m = Core.create(params);
  const diag = Math.hypot(W, H);
  const st = { foldMax: 0, cinchMax: 0, stillTurn: 0, cramped: 0, frames: 0, maxArm: 0, crossF: 0, nearF: 0, nanF: 0, tipErr: 0, jointJump: 0, maxJoints: 0, baseNearF: 0, cuts: 0, sumJoints: 0 };
  let prevV = null, prevTip = null, sinceWarp = 999, prevFace = null; const cinchAge = new Map();
  for (let f = 0; f < secs * 60; f++) {
    const p = pathFn(f / 60);
    m.step(DT, p.x, p.y, W, H);
    const v = m.verts;
    if (v.some(n => !isFinite(n.x) || !isFinite(n.y))) { st.nanF++; continue; }
    st.frames++;
    const warp = prevTip && Math.hypot(p.x - prevTip.x, p.y - prevTip.y) > m.P.warpDist;
    sinceWarp = warp ? 0 : sinceWarp + 1;
    st.maxArm = Math.max(st.maxArm, m.armLength() / diag);
    st.maxJoints = Math.max(st.maxJoints, m.joints); st.sumJoints += m.joints;
    // cramped: claw within ~2 claw-lengths of the mount, arm shorter than the claw itself.
    // Hidden under mount+claw; reported, not judged.
    const cramped = Math.hypot(m.shoulder.x - m.tip.x, m.shoulder.y - m.tip.y) < m.clawBodyLen() * 2.2;
    if (cramped) st.cramped++;
    const c = contacts(m); if (!cramped && c.cross) st.crossF++; if (!cramped && c.near) st.nearF++;
    if (sinceWarp > 90 && Math.hypot(v[0].x - m.tip.x, v[0].y - m.tip.y) < 75) st.baseNearF++;
    // parked pointer: the claw must not rotate (it is holding something)
    if (prevTip && prevFace !== null && p.x === prevTip.x && p.y === prevTip.y) st.stillTurn = Math.max(st.stillTurn, Math.abs(m.facingAng - prevFace));
    prevFace = m.facingAng;
    st.tipErr = Math.max(st.tipErr, Math.hypot(m.tip.x - p.x, m.tip.y - p.y));
    // world-anchored corners stay put: a corner that existed last frame may only ease
    // (just spawned) or be the unzip front (first corner, slides along its own leg)
    const js = v.filter(n => n.k === 'j');
    if (prevV && !warp) js.forEach((n, idx) => { if (idx === 0 || n.age < 0.25 || n.c) return; if (n.f) { const o = prevV.get(n.id); if (o) st.foldMax = Math.max(st.foldMax, Math.hypot(n.x - o.x, n.y - o.y)); return; } /* front slides; a fresh corner is still snapping out */ const o = prevV.get(n.id); if (o) st.jointJump = Math.max(st.jointJump, Math.hypot(n.x - o.x, n.y - o.y)); });
    // a cinching loop must close quickly (it is visible while it does)
    for (const n of js) if (n.c) { const a = (cinchAge.get(n.id) || 0) + 1; cinchAge.set(n.id, a); st.cinchMax = Math.max(st.cinchMax, a / 60); }
    prevV = new Map(js.map(n => [n.id, { x: n.x, y: n.y }])); prevTip = p;
  }
  st.cuts = m.cuts;
  return st;
}

const paths = require('./paths.js');
const LIM = { armMax: Core.DEFAULTS.armMax + 1e-6, tipErr: 1e-6, jointJump: 12 };

let fail = 0;
console.log('scenario      frames  arm/diag  crossF  nearF  jointJump  maxJ  avgJ  cuts/min  cramped  cinch(s)');
for (const [name, fn] of Object.entries(paths)) {
  const secs = 14, st = run(name, fn, secs);
  const bad = [];
  if (st.nanF) bad.push('NaN');
  if (st.maxArm > LIM.armMax) bad.push('arm too long');
  if (st.crossF) bad.push('self-cross');
  if (st.nearF / st.frames > 0.01) bad.push('touching itself');
  if (st.tipErr > LIM.tipErr) bad.push('tip!=pointer');
  if (st.jointJump > LIM.jointJump) bad.push('corner pop');
  if (st.foldMax > 20) bad.push('fold glide too fast ' + st.foldMax.toFixed(1));
  if (st.cinchMax > Math.max(0.6, Core.DEFAULTS.cinchTime * 1.7)) bad.push('cinch too slow ' + st.cinchMax.toFixed(2) + 's');
  if (st.stillTurn > 1e-9) bad.push('claw turned while parked ' + st.stillTurn.toFixed(3));
  if (st.baseNearF / st.frames > 0.02) bad.push('base on claw ' + st.baseNearF);
  if (bad.length) fail++;
  console.log(name.padEnd(13), String(st.frames).padStart(6), st.maxArm.toFixed(2).padStart(9), String(st.crossF).padStart(7),
    String(st.nearF).padStart(6), st.jointJump.toFixed(1).padStart(10), String(st.maxJoints).padStart(5),
    (st.sumJoints / st.frames).toFixed(1).padStart(5), (st.cuts / secs * 60).toFixed(0).padStart(9), String(st.cramped).padStart(8), st.cinchMax.toFixed(2).padStart(9),
    bad.length ? '  FAIL: ' + bad.join(', ') : '  ok');
}
console.log(fail ? `\n${fail} FAILING` : '\nALL PASS');
if (require.main === module) process.exit(fail ? 1 : 0);
