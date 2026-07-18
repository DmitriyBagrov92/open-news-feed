// A real, living sun behind the wordmark — three.js (vendored, CSP-safe).
// Boiling fbm plasma surface with vertex displacement, an additive corona,
// and a stream of glowing particles flowing from the sun to the right
// corner where the timescale rail begins. Pauses when hidden; renders a
// single frame under prefers-reduced-motion; app.js falls back silently
// if WebGL or the vendor module is unavailable.

import * as THREE from '../vendor/three.module.js';

const NOISE_GLSL = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm(vec3 p){
  float f=0.0, a=0.5;
  for(int i=0;i<5;i++){ f+=a*snoise(p); p*=2.02; a*=0.5; }
  return f;
}
`;

const SUN_VERT = NOISE_GLSL + `
uniform float uTime;
varying vec3 vNormal;
varying vec3 vPos;
void main(){
  vNormal = normal;
  // the limb boils: small radial displacement driven by slow noise
  float d = fbm(normal * 2.4 + vec3(uTime * 0.11)) * 0.045;
  vec3 displaced = position * (1.0 + d);
  vPos = displaced;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

const SUN_FRAG = NOISE_GLSL + `
uniform float uTime;
uniform float uFlare;
varying vec3 vNormal;
varying vec3 vPos;
void main(){
  // granulation: two drifting fbm layers over the sphere surface
  vec3 p = normalize(vPos);
  float n1 = fbm(p * 3.0 + vec3(uTime * 0.05, uTime * 0.03, 0.0));
  float n2 = fbm(p * 7.5 - vec3(0.0, uTime * 0.08, uTime * 0.04));
  float heat = clamp(0.55 + 0.55 * n1 + 0.35 * n2 + uFlare * 0.25, 0.0, 1.6);

  // color ramp: ember -> orange -> gold -> white-hot
  vec3 ember = vec3(0.45, 0.09, 0.02);
  vec3 orange = vec3(0.95, 0.38, 0.06);
  vec3 gold  = vec3(1.0, 0.78, 0.30);
  vec3 hot   = vec3(1.0, 0.97, 0.86);
  vec3 col = mix(ember, orange, smoothstep(0.15, 0.6, heat));
  col = mix(col, gold, smoothstep(0.6, 0.95, heat));
  col = mix(col, hot, smoothstep(0.95, 1.35, heat));

  // limb darkening + rim flare, view-dependent
  float facing = dot(normalize(vNormal), vec3(0.0, 0.0, 1.0));
  col *= 0.55 + 0.6 * smoothstep(0.0, 0.9, facing);
  col += vec3(1.0, 0.45, 0.12) * pow(1.0 - abs(facing), 2.2) * (0.55 + uFlare * 0.5);

  gl_FragColor = vec4(col, 1.0);
}
`;

const CORONA_FRAG = NOISE_GLSL + `
uniform float uTime;
uniform float uFlare;
varying vec2 vUv;
void main(){
  vec2 c = vUv - 0.5;
  float r = length(c) * 2.0;
  float ang = atan(c.y, c.x);
  // streaks rotating slowly around the disc
  float streaks = fbm(vec3(ang * 1.6, r * 3.0 - uTime * 0.12, uTime * 0.05));
  float falloff = smoothstep(1.0, 0.32, r) * (0.5 + 0.5 * streaks);
  falloff *= smoothstep(0.28, 0.42, r); // hole for the disc itself
  vec3 col = mix(vec3(1.0, 0.55, 0.15), vec3(1.0, 0.85, 0.5), streaks);
  gl_FragColor = vec4(col, falloff * (0.5 + uFlare * 0.6));
}
`;

const PARTICLE_VERT = `
attribute float aProgress;
attribute float aSeed;
uniform float uTime;
uniform float uWidth;
uniform float uFlare;
varying float vFade;
void main(){
  float p = fract(aProgress + uTime * (0.045 + aSeed * 0.05) * (1.0 + uFlare));
  // path: a coherent river from the sun's limb to the right corner
  // (world units = one sun radius, so amplitudes stay sub-radius)
  float x = mix(0.9, uWidth, pow(p, 0.85));
  float wob = sin(p * 18.0 + aSeed * 40.0) * 0.30
            + sin(p * 5.0 + aSeed * 13.0 + uTime * 0.7) * 0.16;
  float spread = 0.35 + aSeed * 0.5;
  float y = wob * spread * (0.4 + 0.6 * p);
  vFade = smoothstep(0.0, 0.06, p) * (1.0 - smoothstep(0.82, 1.0, p));
  vec4 mv = modelViewMatrix * vec4(x, y, 0.0, 1.0);
  gl_PointSize = (2.6 + aSeed * 2.4) * (1.0 - p * 0.55);
  gl_Position = projectionMatrix * mv;
}
`;

const PARTICLE_FRAG = `
varying float vFade;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.05, length(d)) * vFade;
  gl_FragColor = vec4(1.0, 0.62, 0.2, a * 0.85);
}
`;

export function initSun(canvas) {
  if (!canvas) return null;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch {
    return null;
  }
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  // orthographic, pixel-ish units: origin at the sun's center
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);

  const uniforms = {
    uTime: { value: 0 },
    uFlare: { value: 0 },
  };

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(1, 96, 96),
    new THREE.ShaderMaterial({
      vertexShader: SUN_VERT,
      fragmentShader: SUN_FRAG,
      uniforms,
    })
  );
  scene.add(sun);

  const corona = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 5.6),
    new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: CORONA_FRAG,
      uniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  corona.position.z = -1.5;
  scene.add(corona);

  // particle stream: local coords, scaled/positioned per resize
  const COUNT = 1600;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
  const progress = new Float32Array(COUNT);
  const seed = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i += 1) {
    progress[i] = Math.random();
    seed[i] = Math.random();
  }
  geo.setAttribute('aProgress', new THREE.BufferAttribute(progress, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const streamUniforms = {
    uTime: uniforms.uTime,
    uFlare: uniforms.uFlare,
    uWidth: { value: 100 },
  };
  const stream = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: streamUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  scene.add(stream);

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let raf = 0;
  let flare = 0;
  const start = performance.now();

  // Layout: sun centered on the wordmark (left), stream running to the
  // right edge. World units = css pixels via the ortho camera.
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    const sunX = getComputedStyle(document.documentElement).getPropertyValue('--pad');
    const pad = parseFloat(sunX) || 24;
    // a big sun centered ABOVE the wordmark (content sits on the band's
    // bottom edge); the river leaves its limb toward the right corner
    const cx = pad + 95;
    const cy = h * 0.38;
    const r = Math.min(h * 0.38, 68);
    camera.left = -cx / r;
    camera.right = (w - cx) / r;
    camera.top = cy / r;
    camera.bottom = -(h - cy) / r;
    camera.updateProjectionMatrix();
    streamUniforms.uWidth.value = (w - cx - 26) / r;
  }

  function render(now) {
    uniforms.uTime.value = (now - start) / 1000;
    flare = Math.max(0, flare - 0.008);
    uniforms.uFlare.value = flare;
    renderer.render(scene, camera);
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    render(now);
  }

  function play() {
    if (raf || document.hidden) return;
    resize();
    if (reducedMotion.matches) {
      render(performance.now());
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
    resize();
    if (reducedMotion.matches) render(performance.now());
  }).observe(canvas);

  play();

  return {
    // fresh news: the sun flares and the stream accelerates briefly
    pulse() {
      flare = 1;
      if (reducedMotion.matches) render(performance.now());
    },
  };
}
