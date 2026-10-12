// ---------------------------------------------------------------------------
// Application: WebGPU renderer, input, UI
// ---------------------------------------------------------------------------
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- tiny matrix library (column-major, WebGPU depth 0..1) ----------------
  const M4 = {
    persp(fovy, asp, n, f) {
      const t = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
      o[0] = t / asp; o[5] = t; o[10] = f / (n - f); o[11] = -1; o[14] = f * n / (n - f); return o;
    },
    lookAt(e, c, u) {
      let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2]; let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
      let xx = u[1] * zz - u[2] * zy, xy = u[2] * zx - u[0] * zz, xz = u[0] * zy - u[1] * zx; l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
        -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
    },
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s;
      }
      return o;
    },
    inv(m) {
      const o = new Float32Array(16);
      const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7],
        a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
      const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11,
        b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30,
        b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
      let d = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06; d = 1 / d;
      o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * d; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * d;
      o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * d; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * d;
      o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * d; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * d;
      o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * d; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * d;
      o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * d; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * d;
      o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * d; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * d;
      o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * d; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * d;
      o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * d; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * d;
      return o;
    },
  };
  const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

  // ---- colourways -------------------------------------------------------------
  const PRESETS = [
    { name: 'Ruby Rind', flesh: '#b3122e', rind: '#1f6a2c',
      sigma: [1.9, 4.2, 3.8], scat: [0.46, 0.008, 0.02], pith: [0.93, 0.96, 0.80], skinA: [0.085, 0.36, 0.105], skinB: [0.012, 0.085, 0.035], tint: [0.80, 0.26, 0.28] },
    { name: 'Rosé Sorbet', flesh: '#f06a78', rind: '#4f9a4a',
      sigma: [0.85, 2.3, 1.9], scat: [0.62, 0.13, 0.16], pith: [0.97, 0.95, 0.86], skinA: [0.20, 0.50, 0.21], skinB: [0.05, 0.22, 0.09], tint: [0.95, 0.55, 0.57] },
    { name: 'Golden Hour', flesh: '#f2a81d', rind: '#6f8a1c',
      sigma: [0.32, 0.75, 3.8], scat: [0.62, 0.42, 0.03], pith: [0.95, 0.97, 0.76], skinA: [0.36, 0.45, 0.10], skinB: [0.07, 0.20, 0.05], tint: [0.95, 0.76, 0.34] },
  ];
  const presetVec = (p) => [].concat(p.sigma, p.scat, p.pith, p.skinA, p.skinB, p.tint);

  // ---- UI state -------------------------------------------------------------------
  const ui = {
    preset: 0, firm: 0.5, damp: 0.35, slow: reduced, mesh: false, paused: false,
  };
  const colorNow = new Float32Array(presetVec(PRESETS[0]));
  let colorTarget = presetVec(PRESETS[0]);

  function buildUI() {
    const wrap = $('presets');
    PRESETS.forEach((p, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'preset'; b.setAttribute('aria-pressed', String(i === 0));
      b.innerHTML = '<span class="sw" style="background:linear-gradient(135deg,' + p.flesh + ' 0 58%,' + p.rind + ' 58% 100%)"></span><span>' + p.name + '</span>';
      b.addEventListener('click', () => {
        ui.preset = i; colorTarget = presetVec(p);
        if (reduced) colorNow.set(colorTarget);
        [...wrap.children].forEach((c, j) => c.setAttribute('aria-pressed', String(j === i)));
      });
      wrap.appendChild(b);
    });
    const fr = $('firm'), dr = $('damp');
    const sync = () => {
      ui.firm = fr.value / 100; ui.damp = dr.value / 100;
      $('firmV').textContent = ui.firm.toFixed(2); $('dampV').textContent = ui.damp.toFixed(2);
      if (sim) sim.setParams(ui.firm, ui.damp);
    };
    fr.addEventListener('input', sync); dr.addEventListener('input', sync);
    $('slow').checked = ui.slow;
    $('slow').addEventListener('change', (e) => { ui.slow = e.target.checked; });
    $('mesh').addEventListener('change', (e) => { ui.mesh = e.target.checked; });
    $('nudge').addEventListener('click', () => { if (sim && !ui.paused) sim.nudge(); });
    $('reset').addEventListener('click', () => { if (sim) { drag = null; sim.reset(reduced ? 0 : 0.45); } });
    $('pause').addEventListener('click', () => {
      ui.paused = !ui.paused; $('pause').textContent = ui.paused ? 'Resume' : 'Pause';
      $('pause').setAttribute('aria-pressed', String(ui.paused));
    });
    sync();
  }

  // ---- model ----------------------------------------------------------------------
  const body = buildBody();
  const decor = buildDecor(body);
  let sim = new Sim(body);
  sim.reset(reduced ? 0 : 0.45);
  buildUI();
  sim.setParams(ui.firm, ui.damp);

  const nrm = new Float32Array(body.nV * 3);
  function computeNormals(pos, out) {
    out.fill(0);
    const t = body.tris;
    for (let f = 0; f < t.length; f += 3) {
      const a = t[f] * 3, b = t[f + 1] * 3, c = t[f + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      out[a] += nx; out[a + 1] += ny; out[a + 2] += nz; out[b] += nx; out[b + 1] += ny; out[b + 2] += nz; out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
    }
    for (let i = 0; i < out.length; i += 3) {
      const l = Math.hypot(out[i], out[i + 1], out[i + 2]) || 1; out[i] /= l; out[i + 1] /= l; out[i + 2] /= l;
    }
  }
  computeNormals(body.rest, nrm);

  // seeds: frame of the host surface triangle (position + smooth normal) -> rigid placement
  const SEED_SINK = 0.011;
  const frame = { p: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], n: [0, 0, 1] };
  function seedFrame(s, pos, nr) {
    const [a, b, c] = s.tri, [u, v, w] = s.bary;
    const f = frame;
    for (let k = 0; k < 3; k++) f.p[k] = u * pos[3 * a + k] + v * pos[3 * b + k] + w * pos[3 * c + k];
    let n = [u * nr[3 * a] + v * nr[3 * b] + w * nr[3 * c], u * nr[3 * a + 1] + v * nr[3 * b + 1] + w * nr[3 * c + 1], u * nr[3 * a + 2] + v * nr[3 * b + 2] + w * nr[3 * c + 2]];
    n = norm3(n);
    const ex = pos[3 * b] - pos[3 * a], ey = pos[3 * b + 1] - pos[3 * a + 1], ez = pos[3 * b + 2] - pos[3 * a + 2];
    const d = ex * n[0] + ey * n[1] + ez * n[2];
    const x = norm3([ex - n[0] * d, ey - n[1] * d, ez - n[2] * d]);
    f.n = n; f.x = x; f.y = [n[1] * x[2] - n[2] * x[1], n[2] * x[0] - n[0] * x[2], n[0] * x[1] - n[1] * x[0]];
    return f;
  }
  decor.seeds.forEach((s) => {
    const f = seedFrame(s, body.rest, nrm);
    const dir = [Math.sin(s.dirLocal), 0, Math.cos(s.dirLocal)];
    s.psi = Math.atan2(dir[0] * f.y[0] + dir[1] * f.y[1] + dir[2] * f.y[2], dir[0] * f.x[0] + dir[1] * f.x[1] + dir[2] * f.x[2]);
  });

  // ---- camera ---------------------------------------------------------------------
  const cam = { az: 0.42, el: 0.72, dist: 6.2, tx: 0, ty: 0.5, tz: -0.25 };
  let canvasW = 1, canvasH = 1, eye = [0, 0, 0], viewProj = null, invViewProj = null, camFwd = [0, 0, -1];
  function updateCamera() {
    const asp = canvasW / canvasH;
    const dist = Math.max(cam.dist, 8.4 / asp * 0.78) ;
    eye = [cam.tx + dist * Math.sin(cam.az) * Math.cos(cam.el), cam.ty + dist * Math.sin(cam.el), cam.tz + dist * Math.cos(cam.az) * Math.cos(cam.el)];
    const view = M4.lookAt(eye, [cam.tx, cam.ty, cam.tz], [0, 1, 0]);
    const proj = M4.persp(30 * Math.PI / 180, asp, 0.5, 120);
    if (window.innerWidth > 880) { proj[8] = -0.10; proj[9] = 0.10; }   // lens shift: slice sits right of the title, above the readouts
    viewProj = M4.mul(proj, view); invViewProj = M4.inv(viewProj);
    camFwd = norm3([cam.tx - eye[0], cam.ty - eye[1], cam.tz - eye[2]]);
  }
  function pickRay(cx, cy, canvas) {
    const r = canvas.getBoundingClientRect();
    const nx = (cx - r.left) / r.width * 2 - 1, ny = 1 - (cy - r.top) / r.height * 2;
    const un = (z) => {
      const m = invViewProj, x = nx, y = ny;
      const px = m[0] * x + m[4] * y + m[8] * z + m[12], py = m[1] * x + m[5] * y + m[9] * z + m[13], pz = m[2] * x + m[6] * y + m[10] * z + m[14], pw = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [px / pw, py / pw, pz / pw];
    };
    const a = un(0), b = un(1);
    return { o: a, d: norm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]) };
  }

  // ---- input ----------------------------------------------------------------------
  let drag = null, hoverReq = null, extraPtr = null, twist = 0;
  function attachInput(canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (drag && drag.id !== e.pointerId) {  // second finger while holding: twist
        if (drag.mode === 'grab' && !extraPtr) {
          extraPtr = { id: e.pointerId, x: e.clientX, y: e.clientY };
          drag.twist0 = twist; drag.ang0 = Math.atan2(extraPtr.y - drag.y, extraPtr.x - drag.x);
          try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic or already-released pointer */ }
        }
        return;
      }
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic or already-released pointer */ }
      const ray = pickRay(e.clientX, e.clientY, canvas);
      const hit = ui.paused ? null : sim.raycast(ray.o[0], ray.o[1], ray.o[2], ray.d[0], ray.d[1], ray.d[2]);
      twist = 0;
      if (hit) {
        sim.beginGrab(hit, camFwd);
        drag = { id: e.pointerId, mode: 'grab', x: e.clientX, y: e.clientY, plane: [hit.x, hit.y, hit.z] };
        canvas.style.cursor = 'grabbing';
        $('hint').classList.add('seen');
      } else {
        drag = { id: e.pointerId, mode: 'orbit', x: e.clientX, y: e.clientY };
      }
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (extraPtr && e.pointerId === extraPtr.id && drag) {
        extraPtr.x = e.clientX; extraPtr.y = e.clientY;
        twist = drag.twist0 - (Math.atan2(extraPtr.y - drag.y, extraPtr.x - drag.x) - drag.ang0);
        return;
      }
      if (drag && e.pointerId === drag.id) {
        if (drag.mode === 'orbit') {
          cam.az = Math.max(-1.15, Math.min(1.15, cam.az - (e.clientX - drag.x) * 0.006));
          cam.el = Math.max(0.12, Math.min(1.3, cam.el + (e.clientY - drag.y) * 0.005));
        }
        drag.x = e.clientX; drag.y = e.clientY;
      } else if (!drag && e.pointerType === 'mouse') {
        hoverReq = { x: e.clientX, y: e.clientY };
      }
    });
    const up = (e) => {
      if (extraPtr && e.pointerId === extraPtr.id) { extraPtr = null; return; }
      if (drag && e.pointerId === drag.id) {
        if (drag.mode === 'grab') sim.endGrab();
        drag = null; extraPtr = null; canvas.style.cursor = 'default';
      }
    };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (drag && drag.mode === 'grab') twist += e.deltaY * 0.0022;
      else cam.dist = Math.max(4.6, Math.min(11, cam.dist * (1 + e.deltaY * 0.0012)));
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (!drag || drag.mode !== 'grab') return;
      if (e.key === 'q' || e.key === 'Q') twist -= 0.12; else if (e.key === 'e' || e.key === 'E') twist += 0.12;
    });
  }

  // ---- WebGPU ---------------------------------------------------------------------
  function fail(title, msg) {
    const el = $('nogpu'); el.hidden = false;
    el.querySelector('h2').textContent = title; el.querySelector('p').textContent = msg;
    const s = $('status'); s.dataset.state = 'off'; s.querySelector('span').textContent = 'WEBGPU · UNAVAILABLE';
    $('canvas').style.display = 'none';
  }

  async function start() {
    if (!navigator.gpu) {
      fail('WebGPU isn’t available here', 'Melon Jelly is rendered with native WebGPU and WGSL shaders, and there is deliberately no fallback renderer. Try a current Chrome, Edge, Safari 26 or Firefox build with WebGPU enabled (a secure context such as https:// or a local file is required).');
      return;
    }
    let adapter, device;
    try {
      adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error('No suitable GPU adapter was found.');
      device = await adapter.requestDevice();
    } catch (err) {
      fail('Couldn’t start WebGPU', String(err && err.message || err)); return;
    }
    const canvas = $('canvas');
    const ctx = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: 'opaque' });
    const errors = [];
    device.addEventListener('uncapturederror', (e) => { errors.push(e.error.message); console.error('WebGPU:', e.error.message); showErr(e.error.message); });
    device.lost.then((info) => { const s = $('status'); s.dataset.state = 'off'; s.querySelector('span').textContent = 'WEBGPU · LOST'; console.error('device lost', info.message); });
    function showErr(m) { const el = $('gpuerr'); el.hidden = false; el.textContent = 'Renderer error: ' + m; }

    const module = device.createShaderModule({ code: WGSL });
    const info = await module.getCompilationInfo();
    const bad = info.messages.filter((m) => m.type === 'error');
    if (bad.length) { bad.forEach((m) => console.error('WGSL', m.lineNum + ':' + m.linePos, m.message)); showErr(bad.map((m) => m.lineNum + ': ' + m.message).join(' | ')); return; }

    // ---- buffers
    const U = GPUBufferUsage;
    const mk = (size, usage, data) => {
      const b = device.createBuffer({ size: Math.max(16, (size + 3) & ~3), usage });
      if (data) device.queue.writeBuffer(b, 0, data);
      return b;
    };
    const posBuf = mk(sim.pos.byteLength, U.VERTEX | U.COPY_DST, sim.pos);
    const nrmBuf = mk(nrm.byteLength, U.VERTEX | U.COPY_DST, nrm);
    const restBuf = mk(body.rest0.byteLength, U.VERTEX | U.COPY_DST, body.rest0);
    const triBuf = mk(body.tris.byteLength, U.INDEX | U.COPY_DST, body.tris);
    const sEdgeBuf = mk(body.sedges.byteLength, U.INDEX | U.COPY_DST, body.sedges);
    const edgeBuf = mk(body.edges.byteLength, U.INDEX | U.COPY_DST, body.edges);

    // seed mesh (teardrop)
    const SL = 0.15, SW = 0.052, SH = 0.03, RS = 16, PS = 14;
    const sp = (t, ph) => { const r = Math.pow(Math.sin(Math.PI * t), 0.6) * (0.35 + 0.65 * t); return [(t - 0.42) * SL, SW * r * Math.cos(ph), SH * r * Math.sin(ph)]; };
    const sv = [], si = [];
    for (let i = 0; i <= RS; i++) for (let j = 0; j <= PS; j++) {
      const t = i / RS, ph = j / PS * Math.PI * 2, e = 1e-3;
      const p = sp(t, ph);
      let n;
      if (i === 0) n = [-1, 0, 0]; else if (i === RS) n = [1, 0, 0];
      else {
        const a = sp(Math.min(1, t + e), ph), b = sp(Math.max(0, t - e), ph), c = sp(t, ph + e), d = sp(t, ph - e);
        const du = [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dv = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
        n = norm3([du[1] * dv[2] - du[2] * dv[1], du[2] * dv[0] - du[0] * dv[2], du[0] * dv[1] - du[1] * dv[0]]);
        if (n[1] * p[1] + n[2] * p[2] < 0) n = [-n[0], -n[1], -n[2]];
      }
      sv.push(p[0], p[1], p[2], n[0], n[1], n[2]);
    }
    for (let i = 0; i < RS; i++) for (let j = 0; j < PS; j++) {
      const a = i * (PS + 1) + j, b = a + 1, c = a + PS + 1, d = c + 1;
      si.push(a, c, b, b, c, d);
    }
    const seedVB = mk(sv.length * 4, U.VERTEX | U.COPY_DST, new Float32Array(sv));
    const seedIB = mk(si.length * 2 + 4, U.INDEX | U.COPY_DST, new Uint16Array(si));
    const nSeeds = decor.seeds.length;
    const seedInstData = new Float32Array(nSeeds * 16);
    const seedInst = mk(seedInstData.byteLength, U.VERTEX | U.COPY_DST);

    // uniforms
    const GF = 232;
    const gData = new Float32Array(GF);
    const gBuf = mk(GF * 4, U.UNIFORM | U.COPY_DST);

    // ---- layouts + pipelines
    const bglG = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
    const bglFull = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    const layG = device.createPipelineLayout({ bindGroupLayouts: [bglG] });
    const layFull = device.createPipelineLayout({ bindGroupLayouts: [bglFull] });
    const HDR = 'rgba16float', DEPTH = 'depth24plus', MSAA = 4;
    const jellyBuffers = [
      { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
      { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
      { arrayStride: 12, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x3' }] },
    ];
    const seedBuffers = [
      { arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] },
      { arrayStride: 64, stepMode: 'instance', attributes: [0, 1, 2, 3].map((k) => ({ shaderLocation: 2 + k, offset: 16 * k, format: 'float32x4' })) },
    ];
    const lineBuffers = [
      { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
      { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
    ];
    const alpha = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
    const msaaDS = (write, cmp) => ({ format: DEPTH, depthWriteEnabled: write, depthCompare: cmp });
    let pipes;
    device.pushErrorScope('validation');
    try {
      pipes = {
        scene: device.createRenderPipeline({ layout: layG, vertex: { module, entryPoint: 'vsFull' }, fragment: { module, entryPoint: 'fsScene', targets: [{ format: HDR }] }, primitive: { topology: 'triangle-list' } }),
        seedA: device.createRenderPipeline({ layout: layG, vertex: { module, entryPoint: 'vsSeed', buffers: seedBuffers }, fragment: { module, entryPoint: 'fsSeedA', targets: [{ format: HDR }] }, primitive: { cullMode: 'none' } }),
        back: device.createRenderPipeline({ layout: layG, vertex: { module, entryPoint: 'vsJelly', buffers: jellyBuffers }, fragment: { module, entryPoint: 'fsBack', targets: [{ format: HDR }] }, primitive: { cullMode: 'front' }, depthStencil: msaaDS(true, 'less') }),
        blit: device.createRenderPipeline({ layout: layFull, vertex: { module, entryPoint: 'vsFull' }, fragment: { module, entryPoint: 'fsBlit', targets: [{ format }] }, multisample: { count: MSAA }, depthStencil: msaaDS(false, 'always') }),
        jelly: device.createRenderPipeline({ layout: layFull, vertex: { module, entryPoint: 'vsJelly', buffers: jellyBuffers }, fragment: { module, entryPoint: 'fsJelly', targets: [{ format }] }, primitive: { cullMode: 'back' }, multisample: { count: MSAA }, depthStencil: msaaDS(true, 'less') }),
        seed: device.createRenderPipeline({ layout: layFull, vertex: { module, entryPoint: 'vsSeed', buffers: seedBuffers }, fragment: { module, entryPoint: 'fsSeed', targets: [{ format }] }, primitive: { cullMode: 'none' }, multisample: { count: MSAA }, depthStencil: msaaDS(true, 'less') }),
        lineS: device.createRenderPipeline({ layout: layFull, vertex: { module, entryPoint: 'vsLineS', buffers: lineBuffers }, fragment: { module, entryPoint: 'fsLineS', targets: [{ format, blend: alpha }] }, primitive: { topology: 'line-list' }, multisample: { count: MSAA }, depthStencil: msaaDS(false, 'less-equal') }),
        lineI: device.createRenderPipeline({ layout: layFull, vertex: { module, entryPoint: 'vsLineI', buffers: lineBuffers }, fragment: { module, entryPoint: 'fsLineI', targets: [{ format, blend: alpha }] }, primitive: { topology: 'line-list' }, multisample: { count: MSAA }, depthStencil: msaaDS(false, 'always') }),
      };
    } catch (err) { showErr(String(err.message || err)); return; }
    const verr = await device.popErrorScope();
    if (verr) { showErr(verr.message); return; }

    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    const bgG = device.createBindGroup({ layout: bglG, entries: [{ binding: 0, resource: { buffer: gBuf } }] });

    // size-dependent resources
    let tex = null, bgFull = null;
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
      if (tex && w === canvasW && h === canvasH) return;
      canvasW = w; canvasH = h; canvas.width = w; canvas.height = h;
      if (tex) ['scene', 'back', 'backDepth', 'msaa', 'msaaDepth'].forEach((k) => tex[k].destroy());
      const T = (f, u, s) => device.createTexture({ size: [w, h], format: f, usage: u, sampleCount: s || 1 });
      tex = {
        scene: T(HDR, GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING),
        back: T(HDR, GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING),
        backDepth: T(DEPTH, GPUTextureUsage.RENDER_ATTACHMENT),
        msaa: T(format, GPUTextureUsage.RENDER_ATTACHMENT, MSAA),
        msaaDepth: T(DEPTH, GPUTextureUsage.RENDER_ATTACHMENT, MSAA),
      };
      tex.sceneV = tex.scene.createView(); tex.backV = tex.back.createView(); tex.backDV = tex.backDepth.createView();
      tex.msaaV = tex.msaa.createView(); tex.msaaDV = tex.msaaDepth.createView();
      bgFull = device.createBindGroup({
        layout: bglFull,
        entries: [{ binding: 0, resource: { buffer: gBuf } }, { binding: 1, resource: tex.sceneV }, { binding: 2, resource: tex.backV }, { binding: 3, resource: sampler }],
      });
    }
    new ResizeObserver(resize).observe(canvas.parentElement);
    resize();
    attachInput(canvas);

    // ---- per-frame uniform packing
    const KEY = norm3([-0.5, 0.85, 0.45]), FILL = norm3([0.85, 0.38, 0.30]);
    const bgEnc = (() => { // page background == tone-mapped backdrop colour
      const f = (x) => { x = x * 1; const t = Math.max(0, Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14))); return Math.round(255 * Math.pow(t, 1 / 2.2)); };
      return 'rgb(' + f(1.16) + ',' + f(1.14) + ',' + f(1.10) + ')';
    })();
    document.documentElement.style.setProperty('--bg', bgEnc);

    function writeG(time) {
      gData.set(viewProj, 0); gData.set(invViewProj, 16);
      gData.set([eye[0], eye[1], eye[2], time], 32);
      gData.set([canvasW, canvasH, 1 / canvasW, 1 / canvasH], 36);
      gData.set([KEY[0], KEY[1], KEY[2], 1], 40); gData.set([FILL[0], FILL[1], FILL[2], 1], 44);
      const c = colorNow;
      gData.set([c[0], c[1], c[2], decor.bubbles.length], 48);        // sigma
      gData.set([c[3], c[4], c[5], 0], 52);                          // scat
      gData.set([c[6], c[7], c[8], 0], 56);                          // pith
      gData.set([c[9], c[10], c[11], 0], 60);                        // skinA
      gData.set([c[12], c[13], c[14], 0], 64);                       // skinB
      gData.set([c[15], c[16], c[17], 0.9], 68);                     // tint
      gData.set([0, 0, CFG.R, 1.0], 72);                             // apex (material space), R, exposure
      const pos = sim.pos;
      for (let i = 0; i < 25; i++) {
        const v = body.proxyIdx[i], o = 76 + 4 * i;
        if (v < 0) { gData[o + 3] = 0; continue; }
        gData[o] = pos[3 * v]; gData[o + 1] = pos[3 * v + 1]; gData[o + 2] = pos[3 * v + 2]; gData[o + 3] = 0.40;
      }
      for (let i = 0; i < 14; i++) {
        const o = 176 + 4 * i, b = decor.bubbles[i];
        if (!b) { gData[o + 3] = 0; continue; }
        let x = 0, y = 0, z = 0;
        for (let k = 0; k < 4; k++) { const v = b.tet[k] * 3, w = b.bary[k]; x += w * pos[v]; y += w * pos[v + 1]; z += w * pos[v + 2]; }
        gData[o] = x; gData[o + 1] = y; gData[o + 2] = z; gData[o + 3] = b.r;
      }
      device.queue.writeBuffer(gBuf, 0, gData);
    }

    let nBack = 0, nFront = 0;
    function updateSeeds() {
      const front = [], back = [];
      for (const s of decor.seeds) {
        const f = seedFrame(s, sim.pos, nrm);
        const facing = (eye[0] - f.p[0]) * f.n[0] + (eye[1] - f.p[1]) * f.n[1] + (eye[2] - f.p[2]) * f.n[2];
        const c = Math.cos(s.psi), sn = Math.sin(s.psi), k = s.scale;
        const ex = [c * f.x[0] + sn * f.y[0], c * f.x[1] + sn * f.y[1], c * f.x[2] + sn * f.y[2]];
        const ey = [-sn * f.x[0] + c * f.y[0], -sn * f.x[1] + c * f.y[1], -sn * f.x[2] + c * f.y[2]];
        const m = [ex[0] * k, ex[1] * k, ex[2] * k, 0, ey[0] * k, ey[1] * k, ey[2] * k, 0, f.n[0] * k, f.n[1] * k, f.n[2] * k, 0,
          f.p[0] - f.n[0] * SEED_SINK * k, f.p[1] - f.n[1] * SEED_SINK * k, f.p[2] - f.n[2] * SEED_SINK * k, 1];
        (facing > 0 ? front : back).push(m);
      }
      let o = 0;
      for (const m of back) { seedInstData.set(m, o); o += 16; }
      for (const m of front) { seedInstData.set(m, o); o += 16; }
      nBack = back.length; nFront = front.length;
      device.queue.writeBuffer(seedInst, 0, seedInstData);
    }

    function render() {
      const enc = device.createCommandEncoder();
      {
        const p = enc.beginRenderPass({ colorAttachments: [{ view: tex.sceneV, clearValue: { r: 1, g: 1, b: 1, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
        p.setPipeline(pipes.scene); p.setBindGroup(0, bgG); p.draw(3);
        if (nBack) {
          p.setPipeline(pipes.seedA); p.setBindGroup(0, bgG); p.setVertexBuffer(0, seedVB); p.setVertexBuffer(1, seedInst);
          p.setIndexBuffer(seedIB, 'uint16'); p.drawIndexed(si.length, nBack, 0, 0, 0);
        }
        p.end();
      }
      {
        const p = enc.beginRenderPass({
          colorAttachments: [{ view: tex.backV, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }],
          depthStencilAttachment: { view: tex.backDV, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
        });
        p.setPipeline(pipes.back); p.setBindGroup(0, bgG);
        p.setVertexBuffer(0, posBuf); p.setVertexBuffer(1, nrmBuf); p.setVertexBuffer(2, restBuf);
        p.setIndexBuffer(triBuf, 'uint32'); p.drawIndexed(body.tris.length);
        p.end();
      }
      {
        const p = enc.beginRenderPass({
          colorAttachments: [{ view: tex.msaaV, resolveTarget: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'discard' }],
          depthStencilAttachment: { view: tex.msaaDV, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
        });
        p.setPipeline(pipes.blit); p.setBindGroup(0, bgFull); p.draw(3);
        p.setPipeline(pipes.jelly); p.setBindGroup(0, bgFull);
        p.setVertexBuffer(0, posBuf); p.setVertexBuffer(1, nrmBuf); p.setVertexBuffer(2, restBuf);
        p.setIndexBuffer(triBuf, 'uint32'); p.drawIndexed(body.tris.length);
        if (nFront) {
          p.setPipeline(pipes.seed); p.setBindGroup(0, bgFull); p.setVertexBuffer(0, seedVB); p.setVertexBuffer(1, seedInst);
          p.setIndexBuffer(seedIB, 'uint16'); p.drawIndexed(si.length, nFront, 0, 0, nBack);
        }
        if (ui.mesh) {
          p.setVertexBuffer(0, posBuf); p.setVertexBuffer(1, nrmBuf);
          p.setPipeline(pipes.lineI); p.setBindGroup(0, bgFull); p.setIndexBuffer(edgeBuf, 'uint32'); p.drawIndexed(body.edges.length);
          p.setPipeline(pipes.lineS); p.setBindGroup(0, bgFull); p.setIndexBuffer(sEdgeBuf, 'uint32'); p.drawIndexed(body.sedges.length);
        }
        p.end();
      }
      device.queue.submit([enc.finish()]);
    }

    // ---- main loop
    let last = performance.now(), acc = 0, live = false, readoutT = 0, frames = 0, fpsT = 0, simMs = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      const dtReal = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
      resize(); updateCamera();

      // colourway tween
      const k = reduced ? 1 : 1 - Math.exp(-dtReal * 5);
      for (let i = 0; i < colorNow.length; i++) colorNow[i] += (colorTarget[i] - colorNow[i]) * k;

      // hover cursor
      if (hoverReq && !drag) {
        const ray = pickRay(hoverReq.x, hoverReq.y, canvas);
        const h = ui.paused ? null : sim.raycast(ray.o[0], ray.o[1], ray.o[2], ray.d[0], ray.d[1], ray.d[2]);
        canvas.style.cursor = h ? 'grab' : 'default'; hoverReq = null;
      }

      // pointer -> grab target on the camera-parallel plane through the grab point
      if (drag && drag.mode === 'grab') {
        const ray = pickRay(drag.x, drag.y, canvas);
        const dn = ray.d[0] * camFwd[0] + ray.d[1] * camFwd[1] + ray.d[2] * camFwd[2];
        const pl = drag.plane;
        const t = ((pl[0] - ray.o[0]) * camFwd[0] + (pl[1] - ray.o[1]) * camFwd[1] + (pl[2] - ray.o[2]) * camFwd[2]) / dn;
        sim.updateGrab(ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t, twist, dtReal);
      }

      // fixed-step simulation
      const t0 = performance.now();
      if (!ui.paused) {
        const speed = ui.slow ? 0.25 : 1;
        const step = ui.slow ? 1 / 240 : 1 / 60, subs = ui.slow ? 4 : 10;
        acc += dtReal * speed;
        let n = 0;
        while (acc >= step && n < 3 && performance.now() - t0 < 13) { sim.step(step, subs); acc -= step; n++; }
        if (acc >= step) acc = 0;   // fell behind: drop the backlog instead of spiralling
        const st = sim.stats();
        if (!st.finite) { sim.reset(0.2); drag = null; }
      } else acc = 0;
      simMs += performance.now() - t0;

      computeNormals(sim.pos, nrm);
      device.queue.writeBuffer(posBuf, 0, sim.pos);
      device.queue.writeBuffer(nrmBuf, 0, nrm);
      updateSeeds();
      writeG(now / 1000);
      render();

      if (!live) { live = true; const s = $('status'); s.dataset.state = 'live'; s.querySelector('span').textContent = 'WEBGPU · LIVE'; }
      readoutT += dtReal; frames++;
      if (readoutT > 0.12) {
        const st = sim.stats();
        $('rMass').textContent = '≈ ' + Math.round(sim.massGrams) + ' g';
        $('rVol').textContent = (st.relVol * 100).toFixed(1) + ' %';
        $('rKE').textContent = (st.keMJ < 10 ? st.keMJ.toFixed(2) : st.keMJ.toFixed(1)) + ' mJ';
        readoutT = 0;
      }
    }
    requestAnimationFrame(frame);

    const toScreen = (x, y, z) => {
      const m = viewProj, r = canvas.getBoundingClientRect();
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12], cy = m[1] * x + m[5] * y + m[9] * z + m[13], cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [r.left + (cx / cw * 0.5 + 0.5) * r.width, r.top + (0.5 - cy / cw * 0.5) * r.height];
    };
    window.__melon = { toScreen, sim, cam, ui, stats: () => sim.stats(), errors, simMsPerFrame: () => simMs / Math.max(1, frames), body, decor, get twist() { return twist; } };
  }

  start();
})();
