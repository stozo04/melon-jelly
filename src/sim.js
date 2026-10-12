// ---------------------------------------------------------------------------
// Geometry + soft-body simulation (CPU, XPBD on a tetrahedral mesh)
// ---------------------------------------------------------------------------
const CFG = {
  R: 2.4,                 // wedge radius (apex -> rind), sim units (1 unit ~ 5 cm)
  ALPHA: Math.PI / 6,     // half opening angle
  T: 0.85,                // slab thickness
  NP: 9,                  // cells per patch side (cross-section = 3 structured quad patches)
  U: [0, 0.07, 0.2, 0.425], // layer offsets from a face (half stack, centre last)
  BEVEL: 0.22,            // rounding radius of the face edges
  TIP_R: 0.17,            // tip rounding radius
  CORNER_R: 0.24,         // rind corner rounding radius
  G: 12,                  // illustrative gravity (units / s^2)
  UNIT_CM: 5,             // 1 sim unit in cm (display only)
  DENSITY: 1.02,          // g / cm^3 (display only)
};

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Rounded circular-sector outline in the local frame (apex at origin, axis +x).
// Returns the dense polyline plus indices of the key points used to split it into patches.
function buildContour() {
  const a = CFG.ALPHA, R = CFG.R, rt = CFG.TIP_R, ro = CFG.CORNER_R;
  const dt = rt / Math.sin(a), cc = R - ro, phic = a - Math.asin(ro / cc);
  const P = [], key = {};
  const arc = (cx, cy, r, a0, a1, n, name) => {
    for (let i = 0; i <= n; i++) {
      if (name && i === n / 2) key[name] = P.length;
      const t = a0 + (a1 - a0) * i / n; P.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
  };
  arc(dt, 0, rt, Math.PI / 2 + a, 1.5 * Math.PI - a, 28, 'T');
  key.edgeLoA = P.length - 1;
  arc(cc * Math.cos(phic), -cc * Math.sin(phic), ro, 1.5 * Math.PI - a, 2 * Math.PI - phic, 20, 'Lo');
  arc(0, 0, R, -phic, phic, 64, 'Ma');
  arc(cc * Math.cos(phic), cc * Math.sin(phic), ro, phic, Math.PI / 2 + a, 20, 'Uo');
  key.edgeUpA = P.length - 1;
  return { P, key };
}
function rayHit(poly, ox, oy, ang) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const ex = q[0] - p[0], ey = q[1] - p[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const px = p[0] - ox, py = p[1] - oy;
    const t = (px * ey - py * ex) / den;
    const u = (px * dy - py * dx) / den;
    if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = t;
  }
  return [ox + dx * best, oy + dy * best];
}

function tetVol(p, a, b, c, d) {
  const e1x = p[3 * b] - p[3 * a], e1y = p[3 * b + 1] - p[3 * a + 1], e1z = p[3 * b + 2] - p[3 * a + 2];
  const e2x = p[3 * c] - p[3 * a], e2y = p[3 * c + 1] - p[3 * a + 1], e2z = p[3 * c + 2] - p[3 * a + 2];
  const e3x = p[3 * d] - p[3 * a], e3y = p[3 * d + 1] - p[3 * a + 1], e3z = p[3 * d + 2] - p[3 * a + 2];
  return (e1x * (e2y * e3z - e2z * e3y) + e1y * (e2z * e3x - e2x * e3z) + e1z * (e2x * e3y - e2y * e3x)) / 6;
}

function buildBody() {
  const A = CFG.ALPHA, R = CFG.R, T = CFG.T, n = CFG.NP, U = CFG.U, RHO = CFG.BEVEL;
  const NH = U.length, NL = 2 * NH - 1;
  const { P: poly, key } = buildContour();
  const cx0 = 2 * R * Math.sin(A) / (3 * A);   // centroid of the sector along the axis
  const Cc = [cx0, 0];

  // arclength parameterisation of the closed outline
  const cum = [0];
  for (let i = 0; i < poly.length; i++) { const q = poly[(i + 1) % poly.length]; cum.push(cum[i] + Math.hypot(q[0] - poly[i][0], q[1] - poly[i][1])); }
  const per = cum[poly.length];
  const at = (s) => {
    s = ((s % per) + per) % per;
    let lo = 0, hi = poly.length;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const p = poly[lo], q = poly[(lo + 1) % poly.length], t = (s - cum[lo]) / (cum[lo + 1] - cum[lo]);
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  };
  const sT = cum[key.T], sMl = (cum[key.edgeLoA] + cum[key.edgeLoA + 1]) / 2, sLo = cum[key.Lo], sMa = cum[key.Ma], sUo = cum[key.Uo];
  const sMu = (cum[key.edgeUpA] + per) / 2;
  const curve = (s0, s1) => {
    if (s1 < s0) s1 += per;
    const out = [];
    for (let i = 0; i <= n; i++) out.push(at(s0 + (s1 - s0) * i / n));
    return out;
  };
  const cTM = curve(sT, sMl), cML = curve(sMl, sLo), cLA = curve(sLo, sMa), cAU = curve(sMa, sUo), cUM = curve(sUo, sMu), cMT = curve(sMu, sT);
  const rev = (c) => c.slice().reverse();
  const Ml = at(sMl), Mu = at(sMu), Ma = at(sMa);
  const seg = (A_, B_) => { const o = []; for (let i = 0; i <= n; i++) o.push([A_[0] + (B_[0] - A_[0]) * i / n, A_[1] + (B_[1] - A_[1]) * i / n]); return o; };
  // patches: P00 = Cc, u runs Cc->A, v runs Cc->B, far corner C
  const patches = [
    { A: Ml, B: Mu, C: at(sT), cb: seg(Cc, Ml), cl: seg(Cc, Mu), ct: cMT, cr: rev(cTM) },
    { A: Ma, B: Ml, C: at(sLo), cb: seg(Cc, Ma), cl: seg(Cc, Ml), ct: cML, cr: rev(cLA) },
    { A: Mu, B: Ma, C: at(sUo), cb: seg(Cc, Mu), cl: seg(Cc, Ma), ct: cAU, cr: rev(cUM) },
  ];
  // 2D columns (deduplicated) and quad cells
  const colMap = new Map(), cols = [], cells = [];
  const colId = (x, y) => {
    const k = Math.round(x * 2e4) * 1000003 + Math.round(y * 2e4);
    let id = colMap.get(k);
    if (id === undefined) { id = cols.length; colMap.set(k, id); cols.push([x, y]); }
    return id;
  };
  for (const p of patches) {
    const grid = [];
    for (let j = 0; j <= n; j++) {
      const v = j / n, row = [];
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const x = (1 - v) * p.cb[i][0] + v * p.ct[i][0] + (1 - u) * p.cl[j][0] + u * p.cr[j][0]
          - ((1 - u) * (1 - v) * Cc[0] + u * (1 - v) * p.A[0] + (1 - u) * v * p.B[0] + u * v * p.C[0]);
        const y = (1 - v) * p.cb[i][1] + v * p.ct[i][1] + (1 - u) * p.cl[j][1] + u * p.cr[j][1]
          - ((1 - u) * (1 - v) * Cc[1] + u * (1 - v) * p.A[1] + (1 - u) * v * p.B[1] + u * v * p.C[1]);
        row.push(colId(x, y));
      }
      grid.push(row);
    }
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) cells.push([grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]);
  }
  const nCol = cols.length, nV = nCol * NL;

  const layerZ = [], layerIn = [];
  for (let k = 0; k < NL; k++) {
    const u = k < NH ? U[k] : U[NL - 1 - k];
    layerZ.push(k < NH ? -T / 2 + u : T / 2 - u);
    layerIn.push(u >= RHO ? 0 : RHO - Math.sqrt(RHO * RHO - (RHO - u) * (RHO - u)));
  }
  const rest = new Float32Array(nV * 3), rest0 = new Float32Array(nV * 3);
  for (let c = 0; c < nCol; c++) {
    const [px, py] = cols[c];
    const dx = px - Cc[0], dy = py - Cc[1], dl = Math.hypot(dx, dy);
    let D = 1;
    if (dl > 1e-9) { const hit = rayHit(poly, Cc[0], Cc[1], Math.atan2(dy, dx)); D = Math.hypot(hit[0] - Cc[0], hit[1] - Cc[1]); }
    for (let k = 0; k < NL; k++) {
      const f = dl > 1e-9 ? 1 - layerIn[k] / D : 1;
      const lx = Cc[0] + dx * f, ly = Cc[1] + dy * f;
      const v = (k * nCol + c) * 3;
      // local (x along axis, y lateral, z extrusion) -> world (X=y, Y=z+T/2, Z=x-cx0)
      rest[v] = ly; rest[v + 1] = layerZ[k] + T / 2; rest[v + 2] = lx - cx0;
      rest0[v] = px; rest0[v + 1] = py; rest0[v + 2] = layerZ[k];
    }
  }

  // each quad cell x layer -> hexahedron -> 6 tets (Kuhn: all paths 000 -> 111)
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const tl = [];
  for (let k = 0; k < NL - 1; k++) for (const q of cells) {
    const vid = (a, b, c) => (k + c) * nCol + (a === 0 ? (b === 0 ? q[0] : q[3]) : (b === 0 ? q[1] : q[2]));
    for (const pm of perms) {
      const c = [0, 0, 0], v = [vid(0, 0, 0)];
      for (const ax of pm) { c[ax]++; v.push(vid(c[0], c[1], c[2])); }
      if (tetVol(rest, v[0], v[1], v[2], v[3]) < 0) { const t = v[2]; v[2] = v[3]; v[3] = t; }
      tl.push(v[0], v[1], v[2], v[3]);
    }
  }
  const tets = Int32Array.from(tl), nT = tets.length / 4;

  let bcx = 0, bcy = 0, bcz = 0;
  for (let v = 0; v < nV; v++) { bcx += rest[3 * v]; bcy += rest[3 * v + 1]; bcz += rest[3 * v + 2]; }
  bcx /= nV; bcy /= nV; bcz /= nV;
  const tri = [];
  const quad = (a, b, c, d) => {
    const ux = rest[3 * b] - rest[3 * a], uy = rest[3 * b + 1] - rest[3 * a + 1], uz = rest[3 * b + 2] - rest[3 * a + 2];
    const vx = rest[3 * c] - rest[3 * a], vy = rest[3 * c + 1] - rest[3 * a + 1], vz = rest[3 * c + 2] - rest[3 * a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (rest[3 * a] + rest[3 * c]) / 2 - bcx, my = (rest[3 * a + 1] + rest[3 * c + 1]) / 2 - bcy, mz = (rest[3 * a + 2] + rest[3 * c + 2]) / 2 - bcz;
    if (nx * mx + ny * my + nz * mz >= 0) tri.push(a, b, c, a, c, d); else tri.push(a, c, b, a, d, c);
  };
  for (const k of [0, NL - 1]) for (const q of cells) quad(k * nCol + q[0], k * nCol + q[1], k * nCol + q[2], k * nCol + q[3]);
  const bcount = new Map();
  for (const q of cells) for (let e = 0; e < 4; e++) {
    let a = q[e], b = q[(e + 1) % 4]; if (a > b) { const t = a; a = b; b = t; }
    const key = a * nCol + b; bcount.set(key, (bcount.get(key) || 0) + 1);
  }
  const isBoundaryCol = new Uint8Array(nCol);
  for (const [key, cnt] of bcount) if (cnt === 1) {
    const a = Math.floor(key / nCol), b = key % nCol;
    isBoundaryCol[a] = 1; isBoundaryCol[b] = 1;
    for (let k = 0; k < NL - 1; k++) quad(k * nCol + a, k * nCol + b, (k + 1) * nCol + b, (k + 1) * nCol + a);
  }
  const tris = Uint32Array.from(tri);

  const emap = new Map(), el = [], tetEdges = new Int32Array(nT * 6);
  const pairs = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]];
  for (let t = 0; t < nT; t++) for (let q = 0; q < 6; q++) {
    let a = tets[4 * t + pairs[q][0]], b = tets[4 * t + pairs[q][1]];
    if (a > b) { const s = a; a = b; b = s; }
    const key = a * nV + b;
    let e = emap.get(key);
    if (e === undefined) { e = el.length / 2; emap.set(key, e); el.push(a, b); }
    tetEdges[6 * t + q] = e;
  }
  const edges = Uint32Array.from(el);
  const sset = new Set(), sel = [];
  for (let f = 0; f < tris.length; f += 3) for (let q = 0; q < 3; q++) {
    let a = tris[f + q], b = tris[f + (q + 1) % 3];
    if (a > b) { const s = a; a = b; b = s; }
    const key = a * nV + b;
    if (!sset.has(key)) { sset.add(key); sel.push(a, b); }
  }
  const sedges = Uint32Array.from(sel);

  // proxy spheres (floor shadows): interior mid-layer vertices on a loose Poisson pattern
  const proxy = [], mid = (NL - 1) >> 1;
  for (let c = 0; c < nCol && proxy.length < 25; c++) {
    if (isBoundaryCol[c]) continue;
    const bx = cols[c][0], by = cols[c][1];
    const hit = rayHit(poly, Cc[0], Cc[1], Math.atan2(by - Cc[1], bx - Cc[0]));
    if (Math.hypot(hit[0] - bx, hit[1] - by) < 0.22) continue;
    if (proxy.every((p) => Math.hypot(cols[p][0] - bx, cols[p][1] - by) > 0.4)) proxy.push(c);
  }
  const proxyIdx = new Int32Array(25).fill(-1);
  proxy.forEach((c, i) => { proxyIdx[i] = mid * nCol + c; });

  return { nV, nT, NL, nCol, cx0, rest, rest0, tets, tris, edges, sedges, tetEdges, layerZ, proxyIdx, cols, cells };
}

// Seeds and air bubbles, anchored to the deformable mesh through barycentric coordinates
function buildDecor(B) {
  const rnd = mulberry32(20261012);
  const { rest, tris, tets, NL, cx0 } = B;
  const A = CFG.ALPHA, R = CFG.R;
  const toLocal = (x, z) => [z + cx0, x]; // (lx, ly)

  const seeds = [];
  for (const face of [NL - 1, 0]) {
    // triangles of this face
    const ft = [];
    for (let f = 0; f < tris.length; f += 3) {
      const a = tris[f], b = tris[f + 1], c = tris[f + 2];
      const k = (v) => Math.floor(v / B.nCol);
      if (k(a) === face && k(b) === face && k(c) === face) ft.push([a, b, c]);
    }
    const placed = [];
    let tries = 0;
    while (placed.length < 9 && tries++ < 6000) {
      const lx = 0.8 + rnd() * (R - 0.8 - 0.5), ly = (rnd() * 2 - 1) * lx * Math.tan(A);
      const dUp = lx * Math.sin(A) - ly * Math.cos(A), dLo = lx * Math.sin(A) + ly * Math.cos(A);
      if (dUp < 0.3 || dLo < 0.3) continue;
      if (placed.some((p) => Math.hypot(p[0] - lx, p[1] - ly) < 0.36)) continue;
      placed.push([lx, ly]);
    }
    for (const [lx, ly] of placed) {
      for (const [a, b, c] of ft) {
        const [ax, ay] = toLocal(rest[3 * a], rest[3 * a + 2]), [bx, by] = toLocal(rest[3 * b], rest[3 * b + 2]), [cx, cy] = toLocal(rest[3 * c], rest[3 * c + 2]);
        const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        const u = ((by - cy) * (lx - cx) + (cx - bx) * (ly - cy)) / den;
        const v = ((cy - ay) * (lx - cx) + (ax - cx) * (ly - cy)) / den;
        const w = 1 - u - v;
        if (u >= -1e-6 && v >= -1e-6 && w >= -1e-6) {
          let ang = Math.atan2(ly, lx) + (rnd() - 0.5) * 0.7;
          if (rnd() < 0.15) ang += Math.PI;
          seeds.push({ tri: [a, b, c], bary: [u, v, w], dirLocal: ang, scale: 1.2 + rnd() * 0.3, face });
          break;
        }
      }
    }
  }
  // initial in-plane angle relative to the host triangle frame is derived in the renderer (needs normals)

  const bubbles = [];
  let tries = 0;
  while (bubbles.length < 14 && tries++ < 5000) {
    const lx = 0.7 + rnd() * (R - 1.4), ly = (rnd() * 2 - 1) * lx * Math.tan(A);
    const dUp = lx * Math.sin(A) - ly * Math.cos(A), dLo = lx * Math.sin(A) + ly * Math.cos(A);
    if (dUp < 0.35 || dLo < 0.35) continue;
    const y = 0.22 + rnd() * (CFG.T - 0.44);
    const rad = 0.016 + Math.pow(rnd(), 2) * 0.03;
    const px = ly, pz = lx - cx0;
    // find containing tet
    let found = null;
    for (let t = 0; t < B.nT && !found; t++) {
      const i0 = tets[4 * t], i1 = tets[4 * t + 1], i2 = tets[4 * t + 2], i3 = tets[4 * t + 3];
      const V = tetVol(rest, i0, i1, i2, i3);
      // barycentric via sub-volumes using a temp array
      const tmp = new Float32Array([px, y, pz]);
      const q = new Float32Array(15);
      const set = (s, v) => { q[3 * s] = rest[3 * v]; q[3 * s + 1] = rest[3 * v + 1]; q[3 * s + 2] = rest[3 * v + 2]; };
      set(0, i0); set(1, i1); set(2, i2); set(3, i3); q[12] = tmp[0]; q[13] = tmp[1]; q[14] = tmp[2];
      const b0 = tetVol(q, 4, 1, 2, 3) / V, b1 = tetVol(q, 0, 4, 2, 3) / V, b2 = tetVol(q, 0, 1, 4, 3) / V, b3 = tetVol(q, 0, 1, 2, 4) / V;
      if (b0 >= 0 && b1 >= 0 && b2 >= 0 && b3 >= 0) found = { tet: [i0, i1, i2, i3], bary: [b0, b1, b2, b3], r: rad };
    }
    if (found) bubbles.push(found);
  }
  return { seeds, bubbles };
}

// ---------------------------------------------------------------------------
class Sim {
  constructor(B) {
    this.B = B;
    const { nV, nT, tets, edges, tetEdges, rest, rest0 } = B;
    this.nV = nV;
    this.pos = new Float32Array(rest);
    this.prev = new Float32Array(nV * 3);
    this.vel = new Float32Array(nV * 3);
    this.vyIn = new Float32Array(nV);
    this.pen = new Float32Array(nV);
    this.w = new Float32Array(nV);
    const nE = edges.length / 2;
    this.nE = nE;
    this.restVol = new Float32Array(nT);
    this.aV0 = new Float32Array(nT);
    this.restLen = new Float32Array(nE);
    this.aE0 = new Float32Array(nE);
    const Ve = new Float32Array(nE), mass = new Float32Array(nV);
    const mult = (r0) => 1 + 1.4 * smooth(CFG.R - 0.55, CFG.R - 0.3, r0);
    const rad0 = (v) => Math.hypot(rest0[3 * v], rest0[3 * v + 1]);
    let total = 0;
    for (let t = 0; t < nT; t++) {
      const a = tets[4 * t], b = tets[4 * t + 1], c = tets[4 * t + 2], d = tets[4 * t + 3];
      const V = tetVol(rest, a, b, c, d);
      this.restVol[t] = V; total += V;
      this.aV0[t] = V / mult((rad0(a) + rad0(b) + rad0(c) + rad0(d)) / 4);
      mass[a] += V / 4; mass[b] += V / 4; mass[c] += V / 4; mass[d] += V / 4;
      for (let q = 0; q < 6; q++) Ve[tetEdges[6 * t + q]] += V / 6;
    }
    for (let v = 0; v < nV; v++) this.w[v] = 1 / mass[v];
    for (let e = 0; e < nE; e++) {
      const a = edges[2 * e], b = edges[2 * e + 1];
      const L = Math.hypot(rest[3 * a] - rest[3 * b], rest[3 * a + 1] - rest[3 * b + 1], rest[3 * a + 2] - rest[3 * b + 2]);
      this.restLen[e] = L;
      this.aE0[e] = L * L / (mult((rad0(a) + rad0(b)) / 2) * Ve[e]);
    }
    this.mass = mass; this.totalVol = total;
    this.massGrams = total * Math.pow(CFG.UNIT_CM, 3) * CFG.DENSITY;
    this.grab = null;
    this.iters = 1; this.grabAlpha = 8e-4; this.grabR = 0.34; this.maxStretch = 2.4; this.handleSpeed = 5; this.vmax = 22;
    this.setParams(0.5, 0.35);
    this.reset(0);
  }

  setParams(firm, damp) {
    this.firm = firm; this.damp = damp;
    this.E = 70 * Math.pow(14, firm);
    this.invE = 1 / this.E;
    this.invK = 1 / (6 * this.E);
    this.dampC = 0.8 + 14 * Math.pow(damp, 1.5);
  }

  reset(drop) {
    this.grab = null;
    this.pos.set(this.B.rest);
    for (let v = 0; v < this.nV; v++) this.pos[3 * v + 1] += drop;
    this.prev.set(this.pos);
    this.vel.fill(0);
    this.calm = 0;
  }

  nudge() {
    const { pos, vel, nV } = this;
    const ang = Math.random() * Math.PI * 2, s = 1.6 + Math.random() * 1.0;
    const dx = Math.cos(ang) * s, dz = Math.sin(ang) * s;
    const spin = (Math.random() < 0.5 ? -1 : 1) * (2.5 + Math.random() * 1.5);
    for (let v = 0; v < nV; v++) {
      const px = pos[3 * v], pz = pos[3 * v + 2], py = pos[3 * v + 1];
      vel[3 * v] += dx * 0.5 + spin * -pz * 0.5;
      vel[3 * v + 1] += 2.8 + py * 0.5;
      vel[3 * v + 2] += dz * 0.5 + spin * px * 0.5;
    }
  }

  // --- picking -------------------------------------------------------------
  raycast(ox, oy, oz, dx, dy, dz) {
    const { pos } = this, tris = this.B.tris;
    let best = Infinity, bi = -1, bu = 0, bv = 0;
    for (let f = 0; f < tris.length; f += 3) {
      const a = tris[f] * 3, b = tris[f + 1] * 3, c = tris[f + 2] * 3;
      const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
      const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const tx = ox - pos[a], ty = oy - pos[a + 1], tz = oz - pos[a + 2];
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t > 0 && t < best) { best = t; bi = f; bu = u; bv = v; }
    }
    if (bi < 0) return null;
    return { t: best, x: ox + dx * best, y: oy + dy * best, z: oz + dz * best, tri: bi / 3 };
  }

  beginGrab(hit, axis) {
    const { pos, nV } = this;
    const rg = this.grabR, idx = [], wgt = [], off = [];
    for (let v = 0; v < nV; v++) {
      const dx = pos[3 * v] - hit.x, dy = pos[3 * v + 1] - hit.y, dz = pos[3 * v + 2] - hit.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < rg) {
        const q = 1 - (d / rg) * (d / rg);
        idx.push(v); wgt.push(0.15 + 0.85 * q * q); off.push(dx, dy, dz);
      }
    }
    this.grab = {
      n: idx.length, idx: Int32Array.from(idx), wgt: Float32Array.from(wgt),
      off0: Float32Array.from(off), off: Float32Array.from(off),
      tgt: [hit.x, hit.y, hit.z], axis: axis.slice(), angle: 0, maxD: this.maxStretch,
    };
  }
  updateGrab(wx, wy, wz, angle, dtFrame) {
    const g = this.grab; if (!g) return;
    const { pos } = this;
    // rotated offsets (twist about the view axis)
    if (angle !== g.angle) {
      g.angle = angle;
      const c = Math.cos(angle), s = Math.sin(angle), [ax, ay, az] = g.axis;
      for (let j = 0; j < g.n; j++) {
        const x = g.off0[3 * j], y = g.off0[3 * j + 1], z = g.off0[3 * j + 2];
        const dot = ax * x + ay * y + az * z;
        const cx = ay * z - az * y, cy = az * x - ax * z, cz = ax * y - ay * x;
        g.off[3 * j] = x * c + cx * s + ax * dot * (1 - c);
        g.off[3 * j + 1] = y * c + cy * s + ay * dot * (1 - c);
        g.off[3 * j + 2] = z * c + cz * s + az * dot * (1 - c);
      }
    }
    // current handle position (where the grabbed patch currently sits)
    let hx = 0, hy = 0, hz = 0, ws = 0;
    for (let j = 0; j < g.n; j++) {
      const v = g.idx[j] * 3, w = g.wgt[j];
      hx += (pos[v] - g.off[3 * j]) * w; hy += (pos[v + 1] - g.off[3 * j + 1]) * w; hz += (pos[v + 2] - g.off[3 * j + 2]) * w; ws += w;
    }
    hx /= ws; hy /= ws; hz /= ws;
    let dx = wx - hx, dy = wy - hy, dz = wz - hz;
    const d = Math.hypot(dx, dy, dz);
    if (d > g.maxD) { const s = g.maxD / d; dx *= s; dy *= s; dz *= s; }
    const k = 1 - Math.exp(-28 * dtFrame);
    let mx = (hx + dx - g.tgt[0]) * k, my = (hy + dy - g.tgt[1]) * k, mz = (hz + dz - g.tgt[2]) * k;
    const ml = Math.hypot(mx, my, mz), cap = this.handleSpeed * dtFrame;   // bounded handle speed keeps elements from inverting
    if (ml > cap) { const q = cap / ml; mx *= q; my *= q; mz *= q; }
    g.tgt[0] += mx; g.tgt[1] += my; g.tgt[2] += mz;
    if (g.tgt[1] < 0.15) g.tgt[1] = 0.15;
  }
  endGrab() { this.grab = null; }

  // --- stepping ------------------------------------------------------------
  step(dt, S) {
    // adaptive substeps: fast motion (hard landings, yanks) gets finer steps, a resting jelly stays cheap
    let vm = 0; const v0 = this.vel;
    for (let i = 0; i < v0.length; i += 3) { const q = v0[i] * v0[i] + v0[i + 1] * v0[i + 1] + v0[i + 2] * v0[i + 2]; if (q > vm) vm = q; }
    const sp = Math.sqrt(vm);
    S = Math.min(Math.ceil(S * 3.2), Math.round(S * (1 + Math.max(0, sp - 2.5) * 0.4)));
    this.lastSub = S;
    const h = dt / S;
    for (let s = 0; s < S; s++) this.sub(h);
    this.dampEdges(dt);
    // settle: kill residual jitter when nothing is happening
    if (!this.grab) {
      let m = 0; const v = this.vel;
      for (let i = 0; i < v.length; i++) { const a = v[i] < 0 ? -v[i] : v[i]; if (a > m) m = a; }
      this.calm = m < 0.025 ? this.calm + dt : 0;
      if (this.calm > 0.4) v.fill(0);
    } else this.calm = 0;
  }

  sub(h) {
    const { pos, prev, vel, w, pen, vyIn, nV } = this;
    const { tets, edges } = this.B;
    const nT = this.B.nT, nE = this.nE;
    const g = CFG.G, damp = Math.exp(-0.3 * h), vmax = this.vmax;
    for (let i = 0; i < nV; i++) {
      const o = 3 * i;
      let vx = vel[o] * damp, vy = vel[o + 1] * damp - g * h, vz = vel[o + 2] * damp;
      const sp = vx * vx + vy * vy + vz * vz;
      if (sp > vmax * vmax) { const s = vmax / Math.sqrt(sp); vx *= s; vy *= s; vz *= s; }
      vyIn[i] = vy;
      prev[o] = pos[o]; prev[o + 1] = pos[o + 1]; prev[o + 2] = pos[o + 2];
      pos[o] += vx * h; pos[o + 1] += vy * h; pos[o + 2] += vz * h;
      vel[o] = vx; vel[o + 1] = vy; vel[o + 2] = vz;
    }
    const ih2 = 1 / (h * h);
    const cE = this.invE * ih2, cV = this.invK * ih2;
    const aE0 = this.aE0, rl = this.restLen;
    const iters = this.grab ? this.iters : 1;
    for (let it = 0; it < iters; it++) {
    for (let e = 0; e < nE; e++) {
      const ia = edges[2 * e], ib = edges[2 * e + 1], a = 3 * ia, b = 3 * ib;
      const dx = pos[a] - pos[b], dy = pos[a + 1] - pos[b + 1], dz = pos[a + 2] - pos[b + 2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-9;
      const wa = w[ia], wb = w[ib];
      const dl = -(len - rl[e]) / (wa + wb + aE0[e] * cE) / len;
      pos[a] += wa * dl * dx; pos[a + 1] += wa * dl * dy; pos[a + 2] += wa * dl * dz;
      pos[b] -= wb * dl * dx; pos[b + 1] -= wb * dl * dy; pos[b + 2] -= wb * dl * dz;
    }
    const rv = this.restVol, aV0 = this.aV0;
    for (let t = 0; t < nT; t++) {
      const i0 = tets[4 * t], i1 = tets[4 * t + 1], i2 = tets[4 * t + 2], i3 = tets[4 * t + 3];
      const a = 3 * i0, b = 3 * i1, c = 3 * i2, d = 3 * i3;
      const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
      const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
      const e3x = pos[d] - pos[a], e3y = pos[d + 1] - pos[a + 1], e3z = pos[d + 2] - pos[a + 2];
      const g1x = (e2y * e3z - e2z * e3y) / 6, g1y = (e2z * e3x - e2x * e3z) / 6, g1z = (e2x * e3y - e2y * e3x) / 6;
      const g2x = (e3y * e1z - e3z * e1y) / 6, g2y = (e3z * e1x - e3x * e1z) / 6, g2z = (e3x * e1y - e3y * e1x) / 6;
      const g3x = (e1y * e2z - e1z * e2y) / 6, g3y = (e1z * e2x - e1x * e2z) / 6, g3z = (e1x * e2y - e1y * e2x) / 6;
      const g0x = -(g1x + g2x + g3x), g0y = -(g1y + g2y + g3y), g0z = -(g1z + g2z + g3z);
      const Vc = e1x * g1x + e1y * g1y + e1z * g1z; // signed volume (g1 already carries the 1/6)
      const w0 = w[i0], w1 = w[i1], w2 = w[i2], w3 = w[i3];
      const den = w0 * (g0x * g0x + g0y * g0y + g0z * g0z) + w1 * (g1x * g1x + g1y * g1y + g1z * g1z) +
        w2 * (g2x * g2x + g2y * g2y + g2z * g2z) + w3 * (g3x * g3x + g3y * g3y + g3z * g3z) + aV0[t] * cV;
      const dlam = -(Vc - rv[t]) / den;
      pos[a] += w0 * dlam * g0x; pos[a + 1] += w0 * dlam * g0y; pos[a + 2] += w0 * dlam * g0z;
      pos[b] += w1 * dlam * g1x; pos[b + 1] += w1 * dlam * g1y; pos[b + 2] += w1 * dlam * g1z;
      pos[c] += w2 * dlam * g2x; pos[c + 1] += w2 * dlam * g2y; pos[c + 2] += w2 * dlam * g2z;
      pos[d] += w3 * dlam * g3x; pos[d + 1] += w3 * dlam * g3y; pos[d + 2] += w3 * dlam * g3z;
    }
    }
    // pointer constraint
    const gr = this.grab;
    if (gr) {
      const ag = this.grabAlpha * ih2;
      for (let j = 0; j < gr.n; j++) {
        const i = gr.idx[j], o = 3 * i;
        const k = w[i] / (w[i] + ag / gr.wgt[j]);
        pos[o] -= k * (pos[o] - (gr.tgt[0] + gr.off[3 * j]));
        pos[o + 1] -= k * (pos[o + 1] - (gr.tgt[1] + gr.off[3 * j + 1]));
        pos[o + 2] -= k * (pos[o + 2] - (gr.tgt[2] + gr.off[3 * j + 2]));
      }
    }
    // collisions: floor + soft room bounds
    for (let i = 0; i < nV; i++) {
      const o = 3 * i;
      pen[i] = 0;
      if (pos[o + 1] < 0) { pen[i] = -pos[o + 1]; pos[o + 1] = 0; }
      if (pos[o] < -5.5) pos[o] = -5.5; else if (pos[o] > 5.5) pos[o] = 5.5;
      if (pos[o + 2] < -4.5) pos[o + 2] = -4.5; else if (pos[o + 2] > 3.8) pos[o + 2] = 3.8;
      if (pos[o + 1] > 7) pos[o + 1] = 7;
    }
    // velocities, Coulomb friction and restitution at the floor
    const ih = 1 / h, mu = 0.55;
    for (let i = 0; i < nV; i++) {
      const o = 3 * i;
      let vx = (pos[o] - prev[o]) * ih, vy = (pos[o + 1] - prev[o + 1]) * ih, vz = (pos[o + 2] - prev[o + 2]) * ih;
      const p = pen[i];
      if (p > 0) {
        const sp = Math.hypot(vx, vz);
        if (sp > 1e-9) {
          const dv = mu * p * ih, k = Math.max(0, sp - dv) / sp;
          vx *= k; vz *= k;
        }
        if (vyIn[i] < -1.5) vy = -0.22 * vyIn[i]; else if (vy < 0) vy = 0;
      }
      vel[o] = vx; vel[o + 1] = vy; vel[o + 2] = vz;
    }
  }

  // relative-velocity damping along edges: kills internal vibration, not rigid motion
  dampEdges(dt) {
    const { vel, w } = this, edges = this.B.edges;
    const kd = 1 - Math.exp(-this.dampC * dt);
    const pos = this.pos;
    for (let e = 0; e < this.nE; e++) {
      const ia = edges[2 * e], ib = edges[2 * e + 1], a = 3 * ia, b = 3 * ib;
      let dx = pos[a] - pos[b], dy = pos[a + 1] - pos[b + 1], dz = pos[a + 2] - pos[b + 2];
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-9; dx /= l; dy /= l; dz /= l;
      const rel = (vel[a] - vel[b]) * dx + (vel[a + 1] - vel[b + 1]) * dy + (vel[a + 2] - vel[b + 2]) * dz;
      const wa = w[ia], wb = w[ib], s = kd * rel / (wa + wb);
      vel[a] -= wa * s * dx; vel[a + 1] -= wa * s * dy; vel[a + 2] -= wa * s * dz;
      vel[b] += wb * s * dx; vel[b + 1] += wb * s * dy; vel[b + 2] += wb * s * dz;
    }
  }

  // --- diagnostics ----------------------------------------------------------
  stats() {
    const { pos, vel, mass, nV } = this, { tets, nT } = this.B;
    let ke = 0, vol = 0, inv = 0, minV = Infinity;
    for (let i = 0; i < nV; i++) ke += 0.5 * mass[i] * (vel[3 * i] ** 2 + vel[3 * i + 1] ** 2 + vel[3 * i + 2] ** 2);
    for (let t = 0; t < nT; t++) {
      const v = tetVol(pos, tets[4 * t], tets[4 * t + 1], tets[4 * t + 2], tets[4 * t + 3]);
      vol += v; if (v <= 0) inv++;
      const r = v / this.restVol[t]; if (r < minV) minV = r;
    }
    // KE in mJ using the illustrative unit system (1 unit = UNIT_CM, density g/cm^3)
    const m = CFG.UNIT_CM / 100, kg = m * m * m * 1000 * CFG.DENSITY;
    const keJ = ke * kg * m * m;
    return { ke, keMJ: keJ * 1000, relVol: vol / this.totalVol, inverted: inv, minTetRatio: minV, finite: Number.isFinite(ke) && Number.isFinite(vol) };
  }
}
