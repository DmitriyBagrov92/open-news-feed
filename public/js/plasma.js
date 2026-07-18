// The timeline IS the plasma. The band maps the last 24 hours left → right:
// per-hour article density modulates plasma energy along x, the palette
// breathes with the real UTC time of day, and fresh news fires a flare at
// the NOW edge. Raw WebGL — GPU-fast, zero dependencies, CSP-safe.
// Degrades to the CSS gradient without WebGL; renders a static frame under
// prefers-reduced-motion; pauses when the tab is hidden.

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform float u_time;    // seconds since load (flow motion)
uniform float u_clock;   // UTC time of day, 0..1 (palette phase)
uniform float u_pulse;   // fresh-news flare at the NOW edge, 0..1
uniform float u_vert;    // 0 = horizontal band, 1 = vertical rail (NOW on top)
uniform float u_water;   // 0 = solar plasma (dark theme), 1 = ocean water (light)
uniform vec2  u_res;
uniform float u_hist[24]; // news density along the axis, oldest -> now, 0..1

// density along the timeline with smooth interpolation between hours
float densityAt(float x) {
  float pos = clamp(x, 0.0, 1.0) * 23.0;
  float i = floor(pos);
  float f = pos - i;
  float a = 0.0;
  float b = 0.0;
  for (int k = 0; k < 24; k++) {
    float fk = float(k);
    a += u_hist[k] * step(abs(fk - i), 0.25);
    b += u_hist[k] * step(abs(fk - (i + 1.0)), 0.25);
  }
  return mix(a, b, smoothstep(0.0, 1.0, f));
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  // the time axis: x for the band, y (top = NOW) for the rail
  float ax = mix(uv.x, uv.y, u_vert);
  // the cross axis (for the edge vignette)
  float cx = mix(uv.y, uv.x, u_vert);
  float d = densityAt(ax);
  float t = u_time * 0.22;

  vec2 p = uv * mix(vec2(7.0, 1.8), vec2(1.8, 7.0), u_vert);
  p.x += 0.4 * sin(p.y * 1.9 + t * 0.7);
  p.y += 0.25 * sin(p.x * 1.1 - t * 0.5);

  // busy hours churn faster and hotter
  float churn = 0.6 + 1.1 * d;
  float v = sin(p.x + t * churn)
          + sin((p.y + t) * 1.4)
          + sin((p.x + p.y + t * churn) * 0.6)
          + sin(length(p - vec2(3.5 + sin(t * 0.35) * 2.5, 0.9)) * 2.0 - t)
          + 0.5 * sin(p.x * 2.3 - t * 1.7 * churn);
  float s = v * 0.2 + 0.5;

  // Two elements, one flow. Dark: solar plasma (ember -> magma -> gold).
  // Light: ocean water (abyss -> deep blue -> azure -> foam).
  // The palette breathes with the real time of day (u_clock).
  float phase = u_clock * 6.2831853;
  vec3 c1 = mix(vec3(0.07, 0.02, 0.03), vec3(0.02, 0.09, 0.18), u_water);
  vec3 c2 = mix(vec3(0.45 + 0.05 * sin(phase), 0.12, 0.04),
                vec3(0.04, 0.28 + 0.04 * sin(phase), 0.55), u_water);
  vec3 c3 = mix(vec3(0.93, 0.42 + 0.05 * sin(phase + 1.7), 0.10),
                vec3(0.10, 0.55 + 0.05 * sin(phase + 1.7), 0.85), u_water);
  vec3 c4 = mix(vec3(1.00, 0.86 + 0.04 * cos(phase), 0.55),
                vec3(0.78, 0.94 + 0.03 * cos(phase), 1.00), u_water);
  vec3 col = mix(c1, c2, smoothstep(0.05, 0.5, s));
  col = mix(col, c3, smoothstep(0.5, 0.78, s));
  col = mix(col, c4, smoothstep(0.8, 1.0, s));

  // news density powers the flow; fresh news flares in from the NOW edge
  float energy = 0.14 + 0.6 * d;
  energy += u_pulse * exp(-(1.0 - ax) * 14.0) * 0.9;

  float vig = smoothstep(0.0, 0.22, cx) * smoothstep(1.0, 0.78, cx);
  float lum = energy * (0.35 + 0.65 * vig);

  // dark theme: emission on void (quiet stays black, busy burns)
  vec3 fire = col * lum;
  // light theme: the mapping INVERTS for a white page — quiet water stays
  // pale, busy water runs deep blue
  vec3 pale = vec3(0.88, 0.945, 0.99);
  vec3 deep = mix(vec3(0.12, 0.47, 0.78), vec3(0.02, 0.20, 0.46), s);
  vec3 waterCol = mix(pale, deep, clamp(lum * 1.25, 0.0, 1.0));
  col = mix(fire, waterCol, u_water);

  // hairline NOW cursor at the fresh end of the axis
  float nowLine = smoothstep(0.9955, 0.997, ax) * smoothstep(0.9995, 0.998, ax);
  vec3 nowCol = mix(vec3(1.0, 0.88, 0.6), vec3(0.03, 0.30, 0.60), u_water);
  col = mix(col, nowCol, nowLine * (0.5 + 0.5 * sin(u_time * 2.2)));

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

const noop = { setHistogram() {}, pulse() {} };

export function initPlasma(canvas, { vertical = false } = {}) {
  if (!canvas) return noop;
  let gl;
  try {
    gl = canvas.getContext('webgl', { antialias: false, depth: false, stencil: false });
  } catch {
    gl = null;
  }
  if (!gl) return noop; // CSS gradient fallback stays

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return noop;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return noop;
  gl.useProgram(program);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uTime = gl.getUniformLocation(program, 'u_time');
  const uClock = gl.getUniformLocation(program, 'u_clock');
  const uPulse = gl.getUniformLocation(program, 'u_pulse');
  const uVert = gl.getUniformLocation(program, 'u_vert');
  const uWater = gl.getUniformLocation(program, 'u_water');
  const uRes = gl.getUniformLocation(program, 'u_res');
  const uHist = gl.getUniformLocation(program, 'u_hist');
  gl.uniform1f(uVert, vertical ? 1 : 0);

  // element follows the theme: fire in the dark, water in daylight
  const isLight = () => document.documentElement.getAttribute('data-theme') === 'light';
  let water = isLight() ? 1 : 0;
  new MutationObserver(() => {
    water = isLight() ? 1 : 0;
    if (reducedMotion.matches) draw(performance.now());
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // sensible default until the first histogram arrives
  let hist = new Float32Array(24).fill(0.45);
  let pulseLevel = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let raf = 0;
  const start = performance.now();

  function resize() {
    const scale = Math.min(devicePixelRatio || 1, 2) * 0.5;
    const w = Math.max(1, Math.round(canvas.clientWidth * scale));
    const h = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }

  function draw(now) {
    resize();
    const date = new Date();
    const clock =
      (date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds()) / 86400;
    pulseLevel = Math.max(0, pulseLevel - 0.006); // ~6s decay at 60fps
    gl.uniform1f(uTime, (now - start) / 1000);
    gl.uniform1f(uClock, clock);
    gl.uniform1f(uWater, water);
    gl.uniform1f(uPulse, pulseLevel);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1fv(uHist, hist);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    draw(now);
  }

  function play() {
    if (raf || document.hidden) return;
    if (reducedMotion.matches) {
      draw(performance.now());
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function pause() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  document.addEventListener('visibilitychange', () => (document.hidden ? pause() : play()));
  reducedMotion.addEventListener?.('change', () => {
    pause();
    play();
  });
  new ResizeObserver(() => {
    if (reducedMotion.matches) draw(performance.now());
  }).observe(canvas);

  play();

  return {
    // counts: 24 numbers, oldest hour first — normalized against their peak
    setHistogram(counts) {
      if (!Array.isArray(counts) || counts.length !== 24) return;
      const peak = Math.max(1, ...counts);
      hist = new Float32Array(counts.map((n) => Math.pow(Math.min(1, n / peak), 0.65)));
      if (reducedMotion.matches) draw(performance.now());
    },
    // fresh news arrived: flare the NOW edge
    pulse() {
      pulseLevel = 1;
      if (reducedMotion.matches) draw(performance.now());
    },
  };
}
