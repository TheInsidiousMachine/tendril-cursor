// Tendril core model — ONE source of truth shared by the bench (browser),
// the headless test harness (node), and the KWin QML effect.
//
// LINEAGE (read before changing the architecture)
// -----------------------------------------------
// v1 trail model: the arm WAS the claw's recorded breadcrumb trail, reeled in at
//   a capped rate. Unbounded history -> ~80,000 px arms, knots, 1,000 px pops.
// v2 pure function: the arm was a function of (base, claw) only. Could not knot,
//   but had no memory of the path, so it only swung and straightened.
// v3 THIS — "omega beam": the arm keeps a SHORT list of world-anchored corners
//   taken from the claw's path. A corner is laid only where the path strays more
//   than `bendTol` from a straight line, so a straight move stays one straight
//   leg and a winding move leaves sharp angular cuts that stay put. The base then
//   unzips them oldest-first (after `reelHold`, at `reelSpeed`) until only the
//   last `restCorners` bends remain: at rest the arm keeps the shape of how it
//   arrived instead of straightening out.
//
// The memory is bounded BY CONSTRUCTION, which is what v1 lacked:
//   - at most `maxJoints` corners (least significant one merged away);
//   - total length hard-capped at `armMax` x screen diagonal (base unzips faster);
//   - if two non-neighbouring parts of the arm (or the arm and the claw) come
//     within `clearance` of each other, the loop between them cinches shut into
//     the contact point over about `cinchTime` seconds;
//   - a corner folded sharper than `minAngle` folds away (this is also how a
//     pointer reversal "rewinds" the arm along its own path).
// So the arm cannot cross itself, cannot knot, cannot grow.
//
// Contract: verts = [base, corners..., hinge]
//           chain = verts resampled at `seg` (kept for metrics / old callers)
//           The claw tip is ALWAYS exactly the pointer (hotspot fidelity).

var TendrilCore = (function () {
"use strict";

var TWO_PI = Math.PI * 2;
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function dist(ax, ay, bx, by) { return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by)); }
function dp(a, b) { return dist(a.x, a.y, b.x, b.y); }
function wrapPi(a) { a = ((a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI; return a; }
function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }

// parameter t of the point on segment ab closest to p
function segParam(p, a, b) {
  var dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  return L2 > 1e-12 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L2, 0, 1) : 0;
}
function lineDist(p, a, b) {        // distance from p to the infinite line ab
  var dx = b.x - a.x, dy = b.y - a.y, L = Math.sqrt(dx * dx + dy * dy);
  if (L < 1e-9) return dp(p, a);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / L;
}
// closest approach of segments ab, cd -> { d, s (on ab), t (on cd) }
function segSeg(a, b, c, d) {
  var rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y, den = rx * sy - ry * sx;
  if (Math.abs(den) > 1e-9) {
    var qx = c.x - a.x, qy = c.y - a.y;
    var t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return { d: 0, s: t, t: u };
  }
  var best = { d: Infinity, s: 0, t: 0 }, k, q;
  k = segParam(a, c, d); q = lerp(c, d, k); if (dp(a, q) < best.d) best = { d: dp(a, q), s: 0, t: k };
  k = segParam(b, c, d); q = lerp(c, d, k); if (dp(b, q) < best.d) best = { d: dp(b, q), s: 1, t: k };
  k = segParam(c, a, b); q = lerp(a, b, k); if (dp(c, q) < best.d) best = { d: dp(c, q), s: k, t: 0 };
  k = segParam(d, a, b); q = lerp(a, b, k); if (dp(d, q) < best.d) best = { d: dp(d, q), s: k, t: 1 };
  return best;
}
function polyLen(pts) {
  var L = 0;
  for (var i = 1; i < pts.length; i++) L += dp(pts[i], pts[i - 1]);
  return L;
}

var DEFAULTS = {
  // ---- beam path (the omega behaviour)
  bendTol:      30,     // px the claw's path may stray from a straight leg before a corner is cut there
  minSeg:       50,     // px: shortest leg a new corner may create
  reelHold:     0.55,   // s a corner stays put before the base may start unzipping it
  reelSpeed:    420,    // px/s the base unzips corners
  reelBoost:    3.0,    // extra unzip px/s per px of arm beyond armSoft
  armSoft:      0.70,   // x screen diagonal: arm length where unzipping speeds up
  armMax:       1.25,   // x screen diagonal: hard length cap
  maxJoints:    14,
  minAngle:     1.50,   // rad (~86 deg): bends sharper than this glide open and go. A tube this thick only
                        // looks clean down to ~90 deg; sharper and the legs overlap into a tangle
  clearance:    2.2,    // x armWidth: closest two parts of the arm may come before the loop is pinched off
  jointTau:     0.05,   // s a new corner takes to snap out of the straight leg
  cinchTime:    0.35,   // s (about): a crossed-over loop pulls tight into the crossing (no snap)
  foldTau:      0.10,   // s a corner takes to glide flat when it folds away
  foldSpeed:    540,    // px/s cap on that glide
  // ---- rest shape
  restCorners:  2,      // bends the reel leaves in place once it has caught up (0 = straighten)
  restSlack:    1.6,    // ...unless the arm is still longer than this x the base->claw distance
  // ---- look
  seg:          15,
  armWidth:     18.5,
  warpDist:     220,    // px/frame: pointer moves faster than this are teleports
  // ---- claw
  clawScale:    1.15,
  settleBack:   1.32,   // claw body length = reach * settleBack
  faceRate:     16.0,   // rad/s max claw re-aim rate
  fingers:      4,
  openSpread:   0.49,
  clawSpeed:    0.30,
  // ---- base servo
  baseDelayMs:  230,
  baseSpeed:    40.0,
  baseAccel:    4.00,
  baseCommit:   0.36,
  baseCorner:   1400,
  baseDodge:    160,
  cornerRound:  150
};

function create(userParams) {
  var P = {};
  var k;
  for (k in DEFAULTS) P[k] = DEFAULTS[k];
  if (userParams) for (k in userParams) P[k] = userParams[k];

  var M = {
    P: P, DEFAULTS: DEFAULTS,
    W: 1920, H: 1080,
    tip: { x: 0, y: 0 },        // pointer == claw tip (exact)
    hinge: { x: 0, y: 0 },
    facing: { x: 1, y: 0 },
    facingAng: 0,
    base: { x: 0, y: 0 },
    baseNormal: { x: 0, y: 1 },
    shoulder: { x: 0, y: 0 },
    verts: [],                  // [{x,y,k}] k: b base, j corner, h hinge
    chain: [],                  // verts resampled at P.seg
    guide: [],                  // claw path since the last corner (debug)
    joints: 0,
    cuts: 0,                    // pinch-offs since reset (metrics)
    jawGrip: 0,
    leftPressed: false, rightPressed: false,
    moving: false,
    mountVel: 0,
    idle: 0,                    // consecutive steps with no visible change
    asleep: false,              // nothing will change until the input does (host may stop stepping)
    started: false
  };

  var acc = 0, phase = 0;
  var prevTip = null;
  var velVec = { x: 0, y: 0 };
  var hist = [];                // tip history for the base delay line
  var mountPerim = null, smoothTargetPerim = null, baseHeading = 0, dodgeSide = 0;
  var joints = [];              // {x,y,tx,ty,born}: world-anchored corners, base side first
  var buf = [];                 // hinge path since the anchor
  var warped = false;
  var pointerMoving = false;    // this step
  var lastSig = NaN, lastInput = 0, lastButtons = '';
  var settling = false;         // reset warm-up: claw may aim while the pointer is still

  function clawReach() { return P.armWidth * 2.85 * P.clawScale; }
  function clawBodyLen() { return clawReach() * P.settleBack; }
  M.clawReach = clawReach;
  M.clawBodyLen = clawBodyLen;
  function diag() { return Math.sqrt(M.W * M.W + M.H * M.H); }

  // ---------------------------------------------------------------- perimeter
  function perimToXY(p, W, H) {
    var L = 2 * (W + H); p = ((p % L) + L) % L;
    if (p < W) return { x: p, y: 0 };
    p -= W; if (p < H) return { x: W, y: p };
    p -= H; if (p < W) return { x: W - p, y: H };
    p -= W; return { x: 0, y: H - p };
  }
  function xyToPerim(x, y, W, H) {
    var dT = y, dR = W - x, dB = H - y, dL = x;
    var m = Math.min(dT, dR, dB, dL);
    if (m === dT) return clamp(x, 0, W);
    if (m === dR) return W + clamp(y, 0, H);
    if (m === dB) return W + H + clamp(W - x, 0, W);
    return 2 * W + H + clamp(H - y, 0, H);
  }
  function shortWrap(diff, L) { diff = ((diff % L) + L) % L; return diff > L / 2 ? diff - L : diff; }
  function edgeOf(perim, W, H) {
    var L = 2 * (W + H); perim = ((perim % L) + L) % L;
    if (perim < W) return 0;
    if (perim < W + H) return 1;
    if (perim < 2 * W + H) return 2;
    return 3;
  }
  function edgeTable(W, H) {
    return [
      { proj: function (x) { return clamp(x, 0, W); }, pd: function (x, y) { return Math.abs(y); }, lo: { x: 0, y: 0 }, hi: { x: W, y: 0 }, loAdj: 3, hiAdj: 1 },
      { proj: function (x, y) { return W + clamp(y, 0, H); }, pd: function (x) { return Math.abs(W - x); }, lo: { x: W, y: 0 }, hi: { x: W, y: H }, loAdj: 0, hiAdj: 2 },
      { proj: function (x) { return W + H + clamp(W - x, 0, W); }, pd: function (x, y) { return Math.abs(H - y); }, lo: { x: W, y: H }, hi: { x: 0, y: H }, loAdj: 1, hiAdj: 3 },
      { proj: function (x, y) { return 2 * W + H + clamp(H - y, 0, H); }, pd: function (x) { return Math.abs(x); }, lo: { x: 0, y: H }, hi: { x: 0, y: 0 }, loAdj: 2, hiAdj: 0 }
    ];
  }
  var EDGE_NORMAL = [{ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }];

  // Mount normal, continuous round corners (no 90 deg snap when the base turns one).
  function mountNormal(b, W, H) {
    var d = [Math.abs(b.y), Math.abs(W - b.x), Math.abs(H - b.y), Math.abs(b.x)];
    var nx = 0, ny = 0;
    for (var e = 0; e < 4; e++) {
      var w = Math.max(0, 1 - d[e] / P.cornerRound);
      nx += EDGE_NORMAL[e].x * w; ny += EDGE_NORMAL[e].y * w;
    }
    var m = Math.sqrt(nx * nx + ny * ny) || 1;
    return { x: nx / m, y: ny / m };
  }

  function delayedTip() {
    var want = phase - P.baseDelayMs / 1000;
    if (!hist.length) return { x: M.tip.x, y: M.tip.y };
    if (want <= hist[0].t) return { x: hist[0].x, y: hist[0].y };
    for (var i = hist.length - 1; i >= 0; i--) {
      if (hist[i].t <= want) {
        var a = hist[i], b = hist[Math.min(i + 1, hist.length - 1)];
        var f = b.t > a.t ? (want - a.t) / (b.t - a.t) : 0;
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      }
    }
    return { x: hist[hist.length - 1].x, y: hist[hist.length - 1].y };
  }

  // Where the base wants to sit: on its own edge under the (delayed) claw, round
  // a corner only when the claw is genuinely nearer the next edge, and never
  // within `baseDodge` of the live claw (forbidden arc on the perimeter loop).
  function baseAimPerim(cx, cy, curPerim, W, H, nx, ny) {
    var T = edgeTable(W, H), L = 2 * (W + H);
    var be = edgeOf(curPerim, W, H);
    var cur = T[be];
    var dCur = cur.pd(cx, cy);
    var aim = cur.proj(cx, cy);
    var CZ = P.baseCorner, MG = 24;
    var lo = T[cur.loAdj], hi = T[cur.hiAdj];
    if (lo.pd(cx, cy) + MG < dCur && dist(cx, cy, cur.lo.x, cur.lo.y) < CZ) aim = lo.proj(cx, cy);
    else if (hi.pd(cx, cy) + MG < dCur && dist(cx, cy, cur.hi.x, cur.hi.y) < CZ) aim = hi.proj(cx, cy);

    var D = P.baseDodge;
    if (D <= 0) return aim;
    cx = nx; cy = ny;
    var an = T[be].proj(cx, cy);
    var ap = perimToXY(an, W, H);
    if (dist(ap.x, ap.y, cx, cy) >= D) { dodgeSide = 0; return aim; }
    var aimDelayed = aim; aim = an;

    var STEP = 6, fwd = 0, bwd = 0, q;
    for (q = STEP; q < L / 2; q += STEP) { var f = perimToXY(aim + q, W, H); if (dist(f.x, f.y, cx, cy) >= D) break; fwd = q; }
    for (q = STEP; q < L / 2; q += STEP) { var g = perimToXY(aim - q, W, H); if (dist(g.x, g.y, cx, cy) >= D) break; bwd = q; }
    fwd += STEP; bwd += STEP;
    var dc = shortWrap(curPerim - aim, L);
    var side = dodgeSide;
    if (dc > fwd) side = 1; else if (dc < -bwd) side = -1;
    else if (side === 0) side = dc >= 0 ? 1 : -1;
    dodgeSide = side;
    var endP = side > 0 ? aim + fwd : aim - bwd;
    var rel = shortWrap(aimDelayed - aim, L);
    if (side > 0 ? rel > fwd : rel < -bwd) return aimDelayed;
    return endP;
  }

  function updateMount() {
    var W = M.W, H = M.H, L = 2 * (W + H);
    // While corners exist the base chases the reel front (the oldest corner it is
    // unzipping), not the pointer: it stays with the path the arm laid down instead
    // of racing off and dragging the whole arm. With no corners it trails the claw.
    var dh = joints.length ? { x: joints[0].x, y: joints[0].y } : delayedTip();
    if (mountPerim === null) {
      var r0 = xyToPerim(dh.x, dh.y, W, H);
      mountPerim = r0; smoothTargetPerim = r0; M.mountVel = 0; return;
    }
    var raw = baseAimPerim(dh.x, dh.y, mountPerim, W, H, M.tip.x, M.tip.y);
    smoothTargetPerim = ((smoothTargetPerim + shortWrap(raw - smoothTargetPerim, L) * 0.16) % L + L) % L;

    var diff = shortWrap(smoothTargetPerim - mountPerim, L);
    var farDiff = diff > 0 ? diff - L : diff + L;
    var ambiguous = Math.min(Math.abs(diff), Math.abs(farDiff)) > L * 0.18;
    var useDiff = diff;
    if (ambiguous && baseHeading !== 0 && (diff > 0 ? 1 : -1) !== baseHeading) {
      useDiff = (Math.abs(diff) + L * P.baseCommit < Math.abs(farDiff)) ? diff : farDiff;
    }
    if (Math.abs(useDiff) > 2) baseHeading = useDiff > 0 ? 1 : -1;
    if (!ambiguous && Math.abs(useDiff) < 3) baseHeading = 0;

    var sgn = useDiff > 0 ? 1 : (useDiff < 0 ? -1 : 1);
    var brakeV = sgn * Math.sqrt(2 * P.baseAccel * Math.abs(useDiff));
    // while corners exist the base walks with the reel, it does not race and sweep the first leg
    // (dodging the claw still gets full speed)
    var vmax = joints.length && dodgeSide === 0 ? Math.min(P.baseSpeed, P.reelSpeed / 60) : P.baseSpeed;
    var want = clamp(useDiff * 0.25, -vmax, vmax);
    if (Math.abs(brakeV) < Math.abs(want)) want = brakeV;
    M.mountVel += clamp(want - M.mountVel, -P.baseAccel, P.baseAccel);
    if (Math.abs(useDiff) < 0.5 && Math.abs(M.mountVel) < 0.5) { M.mountVel = 0; baseHeading = 0; mountPerim = smoothTargetPerim; }
    else {
      var next = ((mountPerim + M.mountVel) % L + L) % L;
      // never step so that the first leg swings into the claw or the rest of the arm
      if (joints.length && dodgeSide === 0 && !legBlocked(perimToXY(mountPerim, W, H)) && legBlocked(perimToXY(next, W, H))) M.mountVel = 0;
      else mountPerim = next;
    }
  }
  function legBlocked(b) {
    var clr = P.clearance * P.armWidth, J0 = joints[0];
    if (segSeg(b, J0, M.hinge, M.tip).d < clr) return true;
    for (var i = 1; i < joints.length; i++) {
      var A = joints[i], B = i + 1 < joints.length ? joints[i + 1] : M.hinge;
      if (segSeg(b, J0, A, B).d < clr * 0.5) return true;
    }
    return false;
  }

  // the vertex the live leg (anchor -> hinge) hangs from
  function anchor() {
    return joints.length ? joints[joints.length - 1] : M.base;
  }

  function resetBuf() { buf = [{ x: M.hinge.x, y: M.hinge.y }]; }
  var jointId = 0;
  function newJoint(x, y, tx, ty) { return { x: x, y: y, tx: tx, ty: ty, born: phase, id: ++jointId }; }

  // --------------------------------------------------------------- corners
  // Online polyline simplification of the hinge's path: the live leg is the
  // straight line anchor -> hinge; when a recorded path point strays further
  // than bendTol from that line, the arm is pinned there (a corner).
  function detectCorners() {
    for (var iter = 0; iter < 4; iter++) {
      var A = anchor(), Hn = M.hinge;
      if (A.collapse) return;                               // the arm is cinching back to an earlier bend
      if (joints.length) A = { x: A.tx, y: A.ty };          // where the last corner settles, not where it is animating
      var best = -1, bestD = 0;
      for (var i = 0; i < buf.length; i++) {
        var p = buf[i];
        if (dp(p, A) < P.minSeg || dp(p, Hn) < P.minSeg || dp(p, M.base) < 2 * P.minSeg) continue;
        if (dp(p, M.tip) < clawBodyLen() * 1.1 + P.minSeg * 0.5) continue;   // would be peeled off by the claw at once
        var d = lineDist(p, A, Hn);
        if (d > bestD) { bestD = d; best = i; }
      }
      if (bestD <= P.bendTol || joints.length >= P.maxJoints + 2) return;
      var K = buf[best];
      // the path doubled back too sharply for a clean bend: don't pin it, let the leg swing
      var ka = Math.atan2(A.y - K.y, A.x - K.x), kb = Math.atan2(Hn.y - K.y, Hn.x - K.x);
      if (Math.abs(wrapPi(ka - kb)) < P.minAngle * 1.1) { buf = buf.slice(best + 1); if (!buf.length) resetBuf(); continue; }
      // spawn on the straight leg and snap out, so the new corner never pops
      var sp = lerp(A, Hn, segParam(K, A, Hn));
      joints.push(newJoint(sp.x, sp.y, K.x, K.y));
      buf = buf.slice(best + 1);
      if (!buf.length) resetBuf();
    }
  }

  function vertexBefore(i) { return i > 0 ? joints[i - 1] : M.base; }
  function vertexAfter(i) { return i < joints.length - 1 ? joints[i + 1] : M.hinge; }

  // Corners that would look bad glide flat (onto the line between their
  // neighbours) and go once flat. Never an instant pop.
  //   - folded sharper than minAngle (this is also how a pointer doubling back rewinds)
  //   - insignificant: barely off the line between its neighbours
  //   - a leg shorter than minLeg: stubby legs read as a garbled zigzag
  function removeJoint(i) { var wasLast = i === joints.length - 1; joints.splice(i, 1); if (wasLast) resetBuf(); }
  function relax() {
    var minLeg = Math.max(P.minSeg, P.armWidth * 2.5);
    for (var i = joints.length - 1; i >= 0; i--) {
      var J = joints[i], A = vertexBefore(i), B = vertexAfter(i), live = i === joints.length - 1;
      if (J.collapse) continue;
      var la = dp(J, A), lb = dp(J, B);
      if (la < 1e-6 || lb < 1e-6) { removeJoint(i); continue; }
      if (!J.folding) {
        var ang = Math.acos(clamp(((A.x - J.x) * (B.x - J.x) + (A.y - J.y) * (B.y - J.y)) / (la * lb), -1, 1));
        if (ang < P.minAngle) J.folding = true;
        else if (!live && phase - J.born > 0.2) {
          var T = { x: J.tx, y: J.ty };
          if (dp(T, lerp(A, B, segParam(T, A, B))) < P.bendTol * 0.4 || la < minLeg) J.folding = true;
        }
      }
      if (J.folding) {
        var q = lerp(A, B, segParam(J, A, B));
        J.tx = q.x; J.ty = q.y;
        if (dp(J, q) < 1) removeJoint(i);
      }
    }
  }

  // Too many corners: merge the least significant one (smallest triangle).
  function capJoints() {
    while (joints.length > P.maxJoints) {
      var bi = 0, ba = Infinity;
      for (var i = 0; i < joints.length - 1; i++) {        // never the live corner
        var A = vertexBefore(i), J = joints[i], B = vertexAfter(i);
        if (J.collapse) continue;
        var area = Math.abs((J.x - A.x) * (B.y - A.y) - (J.y - A.y) * (B.x - A.x));
        if (area < ba) { ba = area; bi = i; }
      }
      joints.splice(bi, 1);
    }
  }

  // Base end unzips: the oldest corner slides along its leg toward the next one
  // and merges into it. Bends nearer the claw stay put until the front reaches them.
  function unzip(distance, force) {
    var clr = P.clearance * P.armWidth;
    while (distance > 0 && joints.length) {
      var J = joints[0], N = joints.length > 1 ? joints[1] : M.hinge;
      if (J.collapse) { if (force) { joints.shift(); continue; } return; }
      var d = dp(J, N);
      if (!force) {
        // the reel never swings the first leg into the (possibly parked) claw; it waits
        var to = d <= distance ? N : lerp(J, N, distance / d);
        if (segSeg(M.base, to, M.hinge, M.tip).d < clr && segSeg(M.base, J, M.hinge, M.tip).d >= clr) return;
      }
      if (d <= distance) {
        joints.shift(); distance -= d;
        if (!joints.length) resetBuf();
      } else {
        var t = distance / d;
        J.x += (N.x - J.x) * t; J.y += (N.y - J.y) * t; J.tx = J.x; J.ty = J.y;
        distance = 0;
      }
    }
  }
  function reel(dt) {
    if (!joints.length || phase - joints[0].born < P.reelHold) return;
    var L = polyLen(M.verts);
    if (joints.length <= P.restCorners && L <= P.restSlack * dp(M.base, M.hinge)) return;   // rest shape
    var v = P.reelSpeed + Math.max(0, L - P.armSoft * diag()) * P.reelBoost;
    unzip(v * dt);
  }

  function buildVerts() {
    var v = [{ x: M.base.x, y: M.base.y, k: 'b' }];
    for (var i = 0; i < joints.length; i++) v.push({ x: joints[i].x, y: joints[i].y, k: 'j', id: joints[i].id, age: phase - joints[i].born, c: !!joints[i].collapse, f: !!joints[i].folding });
    v.push({ x: M.hinge.x, y: M.hinge.y, k: 'h' });
    return v;
  }
  var JOINT0 = 1;                 // verts index of joints[0]

  // Two non-neighbouring parts of the arm (or the arm and the claw) within
  // `clearance`: pinch the loop between them off at the contact point.
  function resolveContacts() {
    var clr = P.clearance * P.armWidth, gapMin = clr * 3;
    for (var pass = 0; pass < 6; pass++) {
      var v = buildVerts();
      var segs = [];
      for (var i = 0; i < v.length - 1; i++) segs.push([v[i], v[i + 1]]);
      segs.push([M.hinge, M.tip]);                          // the claw
      var cum = [0];
      for (i = 0; i < segs.length; i++) cum.push(cum[i] + dp(segs[i][0], segs[i][1]));
      var hit = null, nClaw = segs.length - 1;
      for (var j = nClaw; j >= 2 && !hit; j--) {
        for (i = 0; i <= j - 2; i++) {
          if (segs[i][0].c || segs[i][1].c || segs[j][0].c || segs[j][1].c) continue;   // already cinching
          var r = segSeg(segs[i][0], segs[i][1], segs[j][0], segs[j][1]);
          if (r.d >= clr) continue;
          // a true crossing is always cut; a near-miss only between parts far apart along the arm
          var ai = cum[i] + r.s * (cum[i + 1] - cum[i]), aj = cum[j] + r.t * (cum[j + 1] - cum[j]);
          if (r.d > 0 && aj - ai < gapMin) continue;
          if (r.d > 0 && j === nClaw && !pointerMoving) continue;   // parked claw: only a real crossing counts
          // only corners can be removed: a contact with nothing between to remove is left alone
          var firstJ = Math.max(0, i + 1 - JOINT0), lastJ = j === nClaw ? joints.length - 1 : Math.min(joints.length - 1, j - JOINT0);
          if (lastJ < firstJ) continue;
          hit = { i: i, j: j, s: r.s, t: r.t }; break;
        }
      }
      if (!hit) return;
      M.cuts++;
      // Cinch, never snap: the loop's corners glide into the contact point (like a
      // lasso pulling tight) and are removed when they arrive (see stepFixed).
      var X = lerp(segs[hit.i][0], segs[hit.i][1], hit.s), isClaw = hit.j === nClaw;
      var keepAfter = isClaw ? joints.length : Math.max(0, hit.j + 1 - JOINT0);
      var loopFrom = Math.max(0, hit.i + 1 - JOINT0);
      var head = joints.slice(0, loopFrom), loop = joints.slice(loopFrom, keepAfter), tail = joints.slice(keepAfter);
      var before = head.length ? head[head.length - 1] : M.base, pin = null, target;
      target = X;                                       // the loop shrinks into the crossing point
      // arm over arm: a bend stays pinned there. Claw over arm: no pin (it would sit
      // under the claw); once closed the arm runs straight from the bend before to the claw.
      if (!isClaw && dp(X, before) > (head.length ? 2 : P.minSeg)) pin = newJoint(X.x, X.y, X.x, X.y);
      for (var q = 0; q < loop.length; q++) { loop[q].collapse = { x: target.x, y: target.y }; loop[q].folding = false; }
      joints = head.concat(pin ? [pin] : [], loop, tail);
      resetBuf();
    }
  }

  function enforceLength() {
    var cap = P.armMax * diag();
    for (var g = 0; g < 40; g++) {
      var L = polyLen(buildVerts());
      if (L <= cap || !joints.length) return;
      unzip(Math.max(4, L - cap), true);
    }
  }

  function resample(v, seg) {
    var out = [{ x: v[0].x, y: v[0].y }];
    for (var i = 1; i < v.length; i++) {
      var a = v[i - 1], b = v[i], d = dp(a, b);
      var n = Math.max(1, Math.ceil(d / seg));
      for (var s = 1; s <= n; s++) out.push(lerp(a, b, s / n));
    }
    return out;
  }

  // ------------------------------------------------------------------ step
  var FIXED = 1 / 60;

  function stepFixed(dt) {
    phase += dt;
    var tipStep = prevTip !== null ? dp(M.tip, prevTip) : 0;
    warped = tipStep > P.warpDist;
    pointerMoving = tipStep > 0.25;
    if (prevTip && !warped) {
      var a = 1 - Math.exp(-dt / 0.10);
      velVec.x += ((M.tip.x - prevTip.x) / dt - velVec.x) * a;
      velVec.y += ((M.tip.y - prevTip.y) / dt - velVec.y) * a;
    } else velVec = { x: 0, y: 0 };
    var sp = Math.sqrt(velVec.x * velVec.x + velVec.y * velVec.y);
    M.moving = sp > 60;
    prevTip = { x: M.tip.x, y: M.tip.y };
    hist.push({ t: phase, x: M.tip.x, y: M.tip.y });
    while (hist.length > 2 && hist[0].t < phase - 2.0) hist.shift();

    updateMount();
    M.base = perimToXY(mountPerim, M.W, M.H);
    M.baseNormal = mountNormal(M.base, M.W, M.H);
    M.shoulder = M.base;

    if (warped && M.verts.length) {
      joints = [];
    }

    // claw: body along the live leg, so the arm feeds it from behind. A corner the
    // claw no longer fits past (pointer doubled back onto it) peels off = rewind.
    var bl = clawBodyLen();
    while (joints.length && dp(joints[joints.length - 1], M.tip) < bl * 1.05) {
      joints.pop();
      resetBuf();
    }
    var A = anchor();
    // Re-aim only while the pointer moves. When it is parked the claw holds its
    // grip orientation no matter what the reel does behind it.
    if ((settling || tipStep > 0.25) && dp(A, M.tip) > bl * 1.05) {
      var want = Math.atan2(M.tip.y - A.y, M.tip.x - A.x);
      var d = wrapPi(want - M.facingAng), maxStep = P.faceRate * dt;
      M.facingAng = warped ? want : wrapPi(M.facingAng + clamp(d, -maxStep, maxStep));
    }
    M.facing = { x: Math.cos(M.facingAng), y: Math.sin(M.facingAng) };
    M.hinge = { x: M.tip.x - M.facing.x * bl, y: M.tip.y - M.facing.y * bl };

    if (warped || !buf.length) resetBuf();
    else if (dp(buf[buf.length - 1], M.hinge) >= 3) {
      buf.push({ x: M.hinge.x, y: M.hinge.y });
      if (buf.length > 600) buf.splice(0, 1);
    }

    detectCorners();
    var aj = 1 - Math.exp(-dt / P.jointTau);
    var af = 1 - Math.exp(-dt / P.foldTau), vmaxF = P.foldSpeed * dt;
    for (var i = 0; i < joints.length; i++) {
      var Jn = joints[i], ex = Jn.tx - Jn.x, ey = Jn.ty - Jn.y;
      if (Jn.collapse) {                                 // cinch: fast ease into the contact point
        var cx = Jn.collapse.x - Jn.x, cy = Jn.collapse.y - Jn.y, cl = Math.sqrt(cx * cx + cy * cy);
        // one knob: ease time constant, floor speed and cap speed all scale with cinchTime
        var ct = Math.max(0.02, P.cinchTime);
        var cs = Math.min(cl, clamp(cl * (1 - Math.exp(-dt / (ct * 0.26))), 245 / ct * dt, 840 / ct * dt));
        if (cl > 1e-9) { Jn.x += cx / cl * cs; Jn.y += cy / cl * cs; }
        Jn.tx = Jn.x; Jn.ty = Jn.y;
      } else if (Jn.folding) {                                  // fold: a visible glide, speed-capped
        var el = Math.sqrt(ex * ex + ey * ey), st = Math.min(el * af, i === joints.length - 1 ? vmaxF * 2 : vmaxF);
        if (el > 1e-9) { Jn.x += ex / el * st; Jn.y += ey / el * st; }
      } else { Jn.x += ex * aj; Jn.y += ey * aj; }
    }
    for (var ci = joints.length - 1; ci >= 0; ci--)
      if (joints[ci].collapse && dp(joints[ci], joints[ci].collapse) < 1) removeJoint(ci);
    relax();
    reel(dt);
    capJoints();

    resolveContacts();
    enforceLength();

    M.verts = buildVerts();
    M.chain = resample(M.verts, P.seg);
    M.guide = buf;
    M.joints = joints.length;

    var gt = M.rightPressed ? -0.3 : (M.leftPressed ? 1 : 0);
    M.jawGrip += clamp(gt - M.jawGrip, -P.clawSpeed, P.clawSpeed);

    // sleep detection: a fixed point is reached when nothing visible changed for a
    // while AND every timer that could still change something has run out
    var btn = (M.leftPressed ? 'L' : '') + (M.rightPressed ? 'R' : '');
    if (pointerMoving || btn !== lastButtons) lastInput = phase;
    lastButtons = btn;
    var sig = M.tip.x * 1.3 + M.tip.y * 2.7 + M.facingAng * 101 + M.jawGrip * 37 + M.verts.length * 1009;
    for (var vi = 0; vi < M.verts.length; vi++) sig += M.verts[vi].x * (vi + 1) * 0.013 + M.verts[vi].y * (vi + 3) * 0.017;
    if (!(Math.abs(sig - lastSig) < 1e-3)) { M.idle = 0; lastSig = sig; } else M.idle++;
    var timersDone = phase - lastInput > P.baseDelayMs / 1000 + 0.1;
    for (var ji = 0; ji < joints.length && timersDone; ji++)
      if (phase - joints[ji].born < P.reelHold + 0.05 || joints[ji].folding || joints[ji].collapse) timersDone = false;
    M.asleep = M.idle > 20 && timersDone;
  }

  // Public: advance by wall dt with the current pointer position.
  M.step = function (dt, px, py, W, H) {
    M.W = W; M.H = H;
    M.tip.x = px; M.tip.y = py;
    if (!M.started) M.reset(px, py, W, H);
    // Phase-locked to the display: take the NEAREST whole number of fixed steps, so a
    // 60 Hz display gets exactly one step per frame and timer jitter never yields a
    // frame with no step (visible judder) or two (a lurch).
    acc += Math.min(dt, 0.25);
    var n = Math.min(8, Math.floor(acc / FIXED + 0.5));
    for (var i = 0; i < n; i++) stepFixed(FIXED);
    acc = clamp(acc - n * FIXED, -FIXED * 0.5, FIXED * 0.5);
  };

  M.reset = function (px, py, W, H) {
    M.W = W; M.H = H;
    M.tip = { x: px, y: py };
    prevTip = null; velVec = { x: 0, y: 0 };
    hist = []; acc = 0; phase = 0;
    joints = []; buf = []; M.verts = []; M.cuts = 0;
    mountPerim = null; smoothTargetPerim = null; baseHeading = 0; dodgeSide = 0;
    M.mountVel = 0; M.jawGrip = 0; M.idle = 0; M.asleep = false; lastSig = NaN; lastInput = 0;
    M.facingAng = Math.atan2(H / 2 - py, W / 2 - px);
    M.started = true;
    settling = true;
    for (var i = 0; i < 30; i++) stepFixed(FIXED);
    settling = false;
    M.cuts = 0;
  };

  M.armLength = function () { return polyLen(M.verts); };
  return M;
}

var api = { create: create, DEFAULTS: DEFAULTS };
return api;
})();
if (typeof module !== "undefined" && module.exports) module.exports = TendrilCore;
