#!/usr/bin/env node
// Debug snapshots: node test/snap.js <scenario> <outprefix> [frame...]   (finds worst contact frame if none given)
const fs = require('fs'), cp = require('child_process');
const Core = require('../core/tendril_core.js');
const { contacts } = require('./sim_lib.js');
const W = 1920, H = 1080, DT = 1 / 60;
function render(m, file, label) {
  const poly = a => a.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W / 2}" height="${H / 2}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#14181c"/>
  ${(m.ghosts || []).map(g => `<polyline points="${poly(g.pts)}" fill="none" stroke="#ff5030" stroke-opacity="0.5" stroke-width="6"/>`).join('')}
  <polyline points="${poly(m.verts)}" fill="none" stroke="#3a444c" stroke-width="${m.P.armWidth * 2}" stroke-linejoin="miter"/>
  <polyline points="${poly(m.guide)}" fill="none" stroke="#f0b429" stroke-width="2"/>
  <polyline points="${poly(m.verts)}" fill="none" stroke="#70d8f2" stroke-width="2"/>
  ${m.verts.map(p => `<circle cx="${p.x}" cy="${p.y}" r="${p.k === 'j' ? 7 : 4}" fill="${p.k === 'j' ? '#ff4d3d' : '#70d8f2'}"/>`).join('')}
  <line x1="${m.hinge.x}" y1="${m.hinge.y}" x2="${m.tip.x}" y2="${m.tip.y}" stroke="#ff4d3d" stroke-width="10" stroke-linecap="round"/>
  <circle cx="${m.base.x}" cy="${m.base.y}" r="14" fill="#8f9ba3"/>
  <text x="20" y="40" fill="#fff" font-size="30" font-family="monospace">${label}</text></svg>`;
  fs.writeFileSync(file + '.svg', s);
  cp.execSync(`rsvg-convert ${file}.svg -o ${file}.png`);
}
module.exports = { render };
if (require.main === module) {
  const [scn, out, ...fr] = process.argv.slice(2);
  const sim = require('./paths.js');
  const m = Core.create(); const want = new Set(fr.map(Number)); let worst = { x: -1, f: 0 };
  for (let f = 0; f < 840; f++) {
    const p = sim[scn](f / 60); m.step(DT, p.x, p.y, W, H);
    if (want.has(f)) render(m, out + '_' + f, scn + ' f' + f);
    const cr = Math.hypot(m.shoulder.x - m.tip.x, m.shoulder.y - m.tip.y) < m.clawBodyLen() * 2.2;
    const c = contacts(m), x = cr ? 0 : c.cross * 10 + c.near;
    if (x > worst.x) worst = { x, f, c };
  }
  console.log('worst contact frame', worst);
  if (!fr.length) { const m2 = Core.create(); for (let f = 0; f <= worst.f; f++) { const p = sim[scn](f / 60); m2.step(DT, p.x, p.y, W, H); } render(m2, out + '_worst', scn + ' worst f' + worst.f + ' ' + JSON.stringify(worst.c)); }
}
