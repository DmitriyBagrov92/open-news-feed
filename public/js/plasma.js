// The timeline as plasma: a WebGL fragment shader renders slow cosmic plasma
// behind the wire-strip clocks. Raw WebGL — GPU-fast, zero dependencies,
// CSP-safe. Degrades to the CSS gradient when WebGL is unavailable, renders
// a single static frame under prefers-reduced-motion, pauses when hidden.

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform float u_time;
uniform vec2 u_res;

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = uv * vec2(7.0, 1.8);
  float t = u_time * 0.28;

  float v = sin(p.x + t)
          + sin((p.y + t) * 1.4)
          + sin((p.x + p.y + t) * 0.6)
          + sin(length(p - vec2(3.5 + sin(t * 0.35) * 2.5, 0.9)) * 2.0 - t)
          + 0.5 * sin(p.x * 2.3 - t * 1.7);
  float s = v * 0.21 + 0.5;

  // void indigo -> nebula violet -> magenta -> plasma cyan
  vec3 c1 = vec3(0.04, 0.02, 0.12);
  vec3 c2 = vec3(0.32, 0.14, 0.72);
  vec3 c3 = vec3(0.82, 0.18, 0.56);
  vec3 c4 = vec3(0.12, 0.78, 0.98);
  vec3 col = mix(c1, c2, smoothstep(0.05, 0.5, s));
  col = mix(col, c3, smoothstep(0.5, 0.78, s));
  col = mix(col, c4, smoothstep(0.8, 1.0, s));

  // keep the band deep so the clock text stays readable
  float vig = smoothstep(0.0, 0.3, uv.y) * smoothstep(1.0, 0.7, uv.y);
  col *= 0.18 + 0.38 * vig;
  gl_FragColor = vec4(col, 1.0);
}
`;

const FPS_INTERVAL = 1000 / 30; // the band is small; 30fps is plenty

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

export function initPlasma(canvas) {
  if (!canvas) return;
  let gl;
  try {
    gl = canvas.getContext('webgl', { antialias: false, depth: false, stencil: false });
  } catch {
    gl = null;
  }
  if (!gl) return; // CSS gradient fallback stays

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
  gl.useProgram(program);

  // one fullscreen triangle
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uTime = gl.getUniformLocation(program, 'u_time');
  const uRes = gl.getUniformLocation(program, 'u_res');

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let raf = 0;
  let last = 0;
  const start = performance.now();

  function resize() {
    // half-resolution render upscaled by the browser — invisible on a
    // 36px-tall band, halves the GPU cost
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
    gl.uniform1f(uTime, (now - start) / 1000);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (now - last < FPS_INTERVAL) return;
    last = now;
    draw(now);
  }

  function play() {
    if (raf || document.hidden) return;
    if (reducedMotion.matches) {
      draw(performance.now()); // one static cosmic frame
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
}
