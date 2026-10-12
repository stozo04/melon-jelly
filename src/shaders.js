// ---------------------------------------------------------------------------
// WGSL
// ---------------------------------------------------------------------------
const WGSL = /* wgsl */ `
struct G {
  vp: mat4x4f,
  ivp: mat4x4f,
  cam: vec4f,      // xyz eye, w time
  res: vec4f,      // w, h, 1/w, 1/h
  key: vec4f,      // xyz direction towards key light
  fill: vec4f,     // xyz direction towards fill light
  sigma: vec4f,    // flesh absorption (per unit length)
  scat: vec4f,     // flesh in-scatter colour
  pith: vec4f,     // pale rind colour
  skinA: vec4f,    // rind base green
  skinB: vec4f,    // rind stripe green
  tint: vec4f,     // colour of light transmitted through the jelly (floor), w = strength
  prm: vec4f,      // apex.xy (material space), radius R, exposure
  sph: array<vec4f, 25>,  // shadow proxy spheres
  bub: array<vec4f, 14>,  // air bubbles
};
@group(0) @binding(0) var<uniform> g : G;
@group(0) @binding(1) var sceneTex : texture_2d<f32>;
@group(0) @binding(2) var backTex : texture_2d<f32>;
@group(0) @binding(3) var samp : sampler;

const PI : f32 = 3.14159265;
const BG : vec3f = vec3f(1.16, 1.14, 1.10);

fn hash31(p: vec3f) -> f32 {
  var q = fract(p * 0.1031);
  q += dot(q, q.zyx + 31.32);
  return fract((q.x + q.y) * q.z);
}
fn vnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = mix(mix(hash31(i), hash31(i + vec3f(1.0, 0.0, 0.0)), u.x),
              mix(hash31(i + vec3f(0.0, 1.0, 0.0)), hash31(i + vec3f(1.0, 1.0, 0.0)), u.x), u.y);
  let b = mix(mix(hash31(i + vec3f(0.0, 0.0, 1.0)), hash31(i + vec3f(1.0, 0.0, 1.0)), u.x),
              mix(hash31(i + vec3f(0.0, 1.0, 1.0)), hash31(i + vec3f(1.0, 1.0, 1.0)), u.x), u.y);
  return mix(a, b, u.z);
}
fn fbm(p: vec3f) -> f32 {
  return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03 + 7.1) + 0.125 * vnoise(p * 4.07 + 3.7);
}
fn aces(x: vec3f) -> vec3f {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0));
}
fn encode(c: vec3f) -> vec3f {
  return pow(aces(c * g.prm.w), vec3f(1.0 / 2.2));
}
fn project(p: vec3f) -> vec2f {
  let c = g.vp * vec4f(p, 1.0);
  let n = c.xy / c.w;
  return vec2f(n.x * 0.5 + 0.5, 0.5 - n.y * 0.5);
}

// ---- procedural studio -----------------------------------------------------
fn softbox(d: vec3f, dir: vec3f, hw: f32, hh: f32, soft: f32) -> f32 {
  let c = dot(d, dir);
  if (c <= 0.05) { return 0.0; }
  let r = normalize(cross(vec3f(0.0, 1.0, 0.0), dir));
  let u = cross(dir, r);
  let x = abs(dot(d, r) / c);
  let y = abs(dot(d, u) / c);
  return (1.0 - smoothstep(hw, hw + soft, x)) * (1.0 - smoothstep(hh, hh + soft, y));
}
fn envMap(d: vec3f, rough: f32) -> vec3f {
  let s = rough * 0.9;
  var c = mix(vec3f(0.46, 0.46, 0.48), vec3f(0.92, 0.92, 0.95), smoothstep(-0.2, 0.95, d.y));
  c = mix(c, vec3f(0.70, 0.68, 0.66), 1.0 - smoothstep(-0.4, 0.0, d.y));
  let key = softbox(d, normalize(vec3f(-0.95, 0.32, 0.20)), 0.55, 1.2, 0.25 + s) * 6.0;
  let top = softbox(d, normalize(vec3f(0.15, 1.0, 0.05)), 0.9, 0.35, 0.3 + s) * 2.2;
  let fil = softbox(d, normalize(vec3f(0.95, 0.25, 0.15)), 0.35, 1.0, 0.25 + s) * 2.6;
  let rim = softbox(d, normalize(vec3f(0.55, 0.25, -0.85)), 0.8, 0.18, 0.2 + s) * 3.5;
  return c * 0.95 + vec3f(1.0, 0.97, 0.93) * key + vec3f(1.0) * top + vec3f(0.92, 0.96, 1.0) * fil + vec3f(1.0) * rim;
}

// ---- fullscreen ------------------------------------------------------------
struct FOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vsFull(@builtin(vertex_index) vi: u32) -> FOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let xy = p[vi];
  var o: FOut;
  o.pos = vec4f(xy, 0.0, 1.0);
  o.uv = vec2f(xy.x * 0.5 + 0.5, 0.5 - xy.y * 0.5);
  return o;
}

// soft shadow + ambient occlusion from a union of spheres that follow the jelly
fn jellyOcc(p: vec3f) -> vec2f {
  var occ = 0.0;
  var ao = 0.0;
  let L = g.key.xyz;
  for (var i = 0; i < 25; i++) {
    let s = g.sph[i];
    if (s.w <= 0.0) { continue; }
    let rel = s.xyz - p;
    let tc = dot(rel, L);
    if (tc > 0.0) {
      let dist = length(rel - L * tc);
      let pw = 0.06 + 0.16 * tc;
      occ += 1.0 - smoothstep(s.w * 0.4, s.w + pw, dist);
    }
    let d2 = max(dot(rel, rel), 0.01);
    ao += s.w * s.w / d2 * clamp(rel.y / sqrt(d2), 0.0, 1.0);
  }
  return vec2f(1.0 - exp(-occ * 0.5), 1.0 - exp(-ao * 0.40));
}

@fragment fn fsScene(in: FOut) -> @location(0) vec4f {
  let ndc = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let a = g.ivp * vec4f(ndc, 0.0, 1.0);
  let b = g.ivp * vec4f(ndc, 1.0, 1.0);
  let ro = g.cam.xyz;
  let rd = normalize(b.xyz / b.w - a.xyz / a.w);
  var col = BG * (1.0 + 0.05 * clamp(rd.y, 0.0, 1.0));
  if (rd.y < -0.0004) {
    let t = -ro.y / rd.y;
    let p = ro + rd * t;
    let r2 = dot(p.xz, p.xz);
    var base = BG * (1.0 + 0.075 * exp(-r2 * 0.05));
    let oc = jellyOcc(p);
    let sh = mix(vec3f(1.0), g.tint.rgb, clamp(oc.x * g.tint.w, 0.0, 1.0));
    base = base * sh * (1.0 - 0.45 * oc.y);
    base += g.tint.rgb * oc.y * 0.10;
    col = mix(base, BG, smoothstep(16.0, 70.0, t));
  }
  return vec4f(col, 1.0);
}

@fragment fn fsBlit(in: FOut) -> @location(0) vec4f {
  let c = textureSampleLevel(sceneTex, samp, in.uv, 0.0).rgb;
  let n = hash31(vec3f(in.pos.xy, 3.0)) - 0.5;
  return vec4f(encode(c) + n / 255.0, 1.0);
}

// ---- jelly body ------------------------------------------------------------
struct JIn { @location(0) pos: vec3f, @location(1) nrm: vec3f, @location(2) rest: vec3f };
struct JOut {
  @builtin(position) clip: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) rest: vec3f,
};
@vertex fn vsJelly(i: JIn) -> JOut {
  var o: JOut;
  o.clip = g.vp * vec4f(i.pos, 1.0);
  o.wp = i.pos;
  o.n = i.nrm;
  o.rest = i.rest;
  return o;
}

// back faces: outward normal + distance from the camera (thickness / exit refraction)
@fragment fn fsBack(in: JOut) -> @location(0) vec4f {
  return vec4f(normalize(in.n), length(in.wp - g.cam.xyz));
}

fn skinColor(rest: vec3f) -> vec3f {
  let rp = rest.xy - g.prm.xy;
  let arc = atan2(rp.y, rp.x) * g.prm.z;
  let z = rest.z;
  let warp = fbm(vec3f(arc * 1.4, z * 1.1, 3.0)) * 2.6;
  let f = arc * 3.0 + warp + z * 0.9;
  let n1 = fbm(vec3f(f, 1.7, z * 0.8));
  let stripe = smoothstep(0.36, 0.5, n1);
  let mott = fbm(vec3f(arc * 9.0, z * 9.0, 11.0));
  let base = g.skinA.rgb * (0.85 + 0.45 * mott);
  return mix(base, g.skinB.rgb, stripe * 0.92);
}

fn lookupUV(P: vec3f, I: vec3f, N: vec3f, Nb: vec3f, d: f32, ior: f32) -> vec2f {
  let r1 = refract(I, N, 1.0 / ior);
  let X = P + r1 * d;
  var r2 = refract(r1, -Nb, ior);
  if (dot(r2, r2) < 0.5) { r2 = r1; }
  return project(X + r2 * 1.25);
}
fn sceneAt(uv: vec2f, rad: f32) -> vec3f {
  let asp = g.res.x / g.res.y;
  var acc = vec3f(0.0);
  for (var i = 0; i < 6; i++) {
    let a = f32(i) * 2.39996;
    let r = sqrt((f32(i) + 0.5) / 6.0) * rad;
    let o = vec2f(cos(a) / asp, sin(a)) * r;
    acc += textureSampleLevel(sceneTex, samp, clamp(uv + o, vec2f(0.001), vec2f(0.999)), 0.0).rgb;
  }
  return acc / 6.0;
}

@fragment fn fsJelly(in: JOut) -> @location(0) vec4f {
  let P = in.wp;
  let N = normalize(in.n);
  let V = normalize(g.cam.xyz - P);
  let I = -V;
  let ndv = clamp(dot(N, V), 0.0, 1.0);
  let R = g.prm.z;
  let rp = in.rest.xy - g.prm.xy;
  let r0 = length(rp);
  let nz = fbm(vec3f(in.rest.xy * 3.1, in.rest.z * 3.1));
  let rr = r0 + (nz - 0.44) * 0.07;
  let wSkin = smoothstep(R - 0.05, R - 0.018, rr);
  let wFl = 1.0 - smoothstep(R - 0.44, R - 0.35, rr);
  let wPith = max(0.0, 1.0 - wSkin - wFl);

  let key = g.key.xyz;
  let fil = g.fill.xyz;
  let kw = clamp((dot(N, key) + 0.35) / 1.35, 0.0, 1.0);
  let fw = clamp((dot(N, fil) + 0.35) / 1.35, 0.0, 1.0);
  let lit = (0.34 + 0.72 * kw + 0.28 * fw) * mix(0.62, 1.0, smoothstep(-0.7, 0.3, N.y));

  // thickness from the back-face pre-pass
  let bk = textureLoad(backTex, vec2<i32>(in.clip.xy), 0);
  let fd = length(P - g.cam.xyz);
  var thick = 0.05;
  var Nb = -N;
  if (bk.w > 0.0) {
    thick = clamp(bk.w - fd, 0.02, 3.0);
    Nb = normalize(bk.xyz);
  }

  // refraction (slight dispersion), soft because jelly is a little cloudy
  let rad = 0.002 + 0.003 * thick;
  let uvR = lookupUV(P, I, N, Nb, thick, 1.325);
  let uvG = lookupUV(P, I, N, Nb, thick, 1.34);
  let uvB = lookupUV(P, I, N, Nb, thick, 1.355);
  let tr = vec3f(sceneAt(uvR, rad).r, sceneAt(uvG, rad).g, sceneAt(uvB, rad).b);

  // ruby flesh: Beer-Lambert absorption, paler towards the rind, fibrous variation
  let paleness = smoothstep(R - 1.25, R - 0.5, rr);
  let fib = vnoise(vec3f(atan2(rp.y, rp.x) * 34.0, r0 * 1.6, in.rest.z * 2.0));
  let modu = 0.82 + 0.28 * fib + 0.2 * nz;
  let sig = g.sigma.rgb * mix(1.0, 0.42, paleness) * modu;
  let Tf = exp(-sig * thick);
  var flesh = tr * Tf + g.scat.rgb * (1.0 - Tf) * lit * (1.0 + 0.5 * paleness);
  flesh += g.scat.rgb * pow(1.0 - ndv, 2.5) * exp(-thick * 2.2) * 0.8;

  // tiny air bubbles inside the volume (ray-sphere along the refracted path)
  let r1 = refract(I, N, 1.0 / 1.34);
  var cover = 0.0;
  var rimB = 0.0;
  var spec = 0.0;
  let nb = i32(g.sigma.w);
  for (var i = 0; i < 14; i++) {
    if (i >= nb) { break; }
    let b = g.bub[i];
    let oc = P - b.xyz;
    let bq = dot(oc, r1);
    let cq = dot(oc, oc) - b.w * b.w;
    let disc = bq * bq - cq;
    if (disc > 0.0) {
      let t0 = -bq - sqrt(disc);
      if (t0 > 0.0 && t0 < thick) {
        let hp = P + r1 * t0;
        let bn = normalize(hp - b.xyz);
        cover = max(cover, 1.0);
        rimB = max(rimB, pow(1.0 - abs(dot(bn, r1)), 2.0));
        spec = max(spec, pow(max(dot(reflect(r1, bn), key), 0.0), 40.0));
      }
    }
  }
  flesh = flesh * (1.0 - 0.14 * cover) + cover * (vec3f(1.0, 0.72, 0.70) * (0.04 + 0.16 * rimB) * lit + vec3f(1.0) * spec * 0.7);

  // pale rind: translucent, slightly greener towards the skin
  let tp = clamp((R - 0.05 - rr) / 0.32, 0.0, 1.0);
  var pAl = mix(vec3f(0.62, 0.80, 0.44), g.pith.rgb, smoothstep(0.0, 0.55, tp));
  pAl = mix(pAl, g.pith.rgb * vec3f(1.0, 0.94, 0.93), smoothstep(0.75, 1.0, tp));
  let Tp = exp(-vec3f(0.55, 0.40, 0.75) * thick);
  let pith = mix(tr * Tp, pAl * lit, 0.58);

  // glossy green skin with irregular dark stripes
  let skin = skinColor(in.rest) * (0.14 + 0.62 * lit) + g.skinA.rgb * 0.04;

  var col = flesh * wFl + pith * wPith + skin * wSkin;

  // Fresnel reflection of the studio + sharp key sparkle
  let rough = mix(0.10, 0.22, wSkin) + 0.12 * wPith;
  let F0 = mix(0.035, 0.05, wSkin);
  let F = F0 + (1.0 - F0) * pow(1.0 - ndv, 5.0);
  // a whisper of low-frequency surface wobble so flat faces catch soft, jelly-like sheen
  let bp = in.rest * 1.35;
  let bump = vec3f(vnoise(bp + vec3f(3.1, 0.0, 0.0)), vnoise(bp + vec3f(0.0, 7.7, 0.0)), vnoise(bp + vec3f(0.0, 0.0, 5.3))) - vec3f(0.5);
  let Nr = normalize(N + bump * mix(0.20, 0.06, wSkin));
  let env = envMap(reflect(I, Nr), rough);
  col = col * (1.0 - F) + env * F * (1.0 + 0.4 * wSkin);
  let H = normalize(V + key);
  let sp = pow(max(dot(Nr, H), 0.0), mix(520.0, 140.0, wSkin + wPith));
  col += vec3f(1.0, 0.98, 0.95) * sp * 1.4;
  return vec4f(encode(col), 1.0);
}

// ---- seeds -----------------------------------------------------------------
struct SIn {
  @location(0) pos: vec3f, @location(1) nrm: vec3f,
  @location(2) m0: vec4f, @location(3) m1: vec4f, @location(4) m2: vec4f, @location(5) m3: vec4f,
};
struct SOut { @builtin(position) clip: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) lp: vec3f };
@vertex fn vsSeed(i: SIn) -> SOut {
  let M = mat4x4f(i.m0, i.m1, i.m2, i.m3);
  let w = M * vec4f(i.pos, 1.0);
  var o: SOut;
  o.clip = g.vp * w;
  o.wp = w.xyz;
  o.n = (M * vec4f(i.nrm, 0.0)).xyz;
  o.lp = i.pos;
  return o;
}
fn seedShade(in: SOut) -> vec3f {
  var N = normalize(in.n);
  let V = normalize(g.cam.xyz - in.wp);
  if (dot(N, V) < 0.0) { N = -N; }
  let ndv = clamp(dot(N, V), 0.0, 1.0);
  let F = 0.06 + 0.94 * pow(1.0 - ndv, 5.0);
  let kw = clamp(dot(N, g.key.xyz) * 0.5 + 0.5, 0.0, 1.0);
  let tip = smoothstep(-0.07, -0.03, in.lp.x);
  let base = mix(vec3f(0.05, 0.035, 0.028), vec3f(0.028, 0.018, 0.016), tip) * (0.5 + 0.8 * kw);
  let env = envMap(reflect(-V, N), 0.14);
  return base + env * F * 0.9;
}
@fragment fn fsSeedA(in: SOut) -> @location(0) vec4f { return vec4f(seedShade(in), 1.0); }
@fragment fn fsSeed(in: SOut) -> @location(0) vec4f { return vec4f(encode(seedShade(in)), 1.0); }

// ---- wireframe ---------------------------------------------------------------
struct LIn { @location(0) pos: vec3f, @location(1) nrm: vec3f };
@vertex fn vsLineS(i: LIn) -> @builtin(position) vec4f {
  return g.vp * vec4f(i.pos + normalize(i.nrm) * 0.012, 1.0);
}
@vertex fn vsLineI(i: LIn) -> @builtin(position) vec4f {
  return g.vp * vec4f(i.pos, 1.0);
}
@fragment fn fsLineS() -> @location(0) vec4f { return vec4f(1.0, 0.93, 0.90, 0.55); }
@fragment fn fsLineI() -> @location(0) vec4f { return vec4f(1.0, 0.86, 0.84, 0.07); }
`;
