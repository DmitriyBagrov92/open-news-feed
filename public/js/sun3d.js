// The living sun — three.js (vendored, CSP-safe), full-viewport scene
// rendered BEHIND the content. The sun burns in the top-left corner under
// the news; it emits a continuous stream of plasma particles that meander
// on randomized curves under the cards and converge on the right-rail
// timescale, filling it along its whole length — a smooth, gapless flow.
// Pauses when hidden; static frame under prefers-reduced-motion.

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
  float d = fbm(normal * 2.4 + vec3(uTime * 0.11)) * 0.045;
  vec3 displaced = position * (1.0 + d);
  vPos = displaced;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;

// A star, not a textured ball: light first. Blinding white-gold core,
// fiery limb with noise-driven flame licks; granulation is only a faint
// breath over the glare.
const SUN_FRAG = NOISE_GLSL + `
uniform float uTime;
uniform float uFlare;
varying vec3 vNormal;
varying vec3 vPos;
void main(){
  vec3 p = normalize(vPos);
  float n1 = fbm(p * 4.0 + vec3(uTime * 0.05, uTime * 0.03, 0.0));
  float n2 = fbm(p * 9.0 - vec3(0.0, uTime * 0.07, uTime * 0.035));
  float granule = 0.5 + 0.5 * n1 + 0.3 * n2;

  float facing = clamp(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0, 1.0);
  vec3 limb  = vec3(1.0, 0.30, 0.05);
  vec3 fire  = vec3(1.0, 0.55, 0.12);
  vec3 gold  = vec3(1.0, 0.85, 0.45);
  vec3 white = vec3(1.0, 0.98, 0.92);
  vec3 col = mix(limb, fire, smoothstep(0.0, 0.35, facing));
  col = mix(col, gold, smoothstep(0.35, 0.75, facing));
  col = mix(col, white, smoothstep(0.68, 0.98, facing));

  // living surface: a faint shimmer, never a dark blotch
  col *= 0.9 + 0.14 * granule + uFlare * 0.1;

  // flame licks around the limb
  float rimN = fbm(vec3(p.x * 6.0, p.y * 6.0, uTime * 0.25));
  col += vec3(1.0, 0.45, 0.10) * pow(1.0 - facing, 3.0) * (0.7 + 0.7 * rimN + uFlare * 0.8);

  gl_FragColor = vec4(col, 1.0);
}
`;

// The shine itself: an additive radial blaze drawn OVER the disc.
const GLOW_FRAG = `
uniform float uFlare;
varying vec2 vUv;
void main(){
  float r = length(vUv - 0.5) * 2.0;
  float core = pow(smoothstep(1.0, 0.0, r), 2.0);
  float halo = pow(smoothstep(1.0, 0.15, r), 1.4) * 0.35;
  vec3 col = mix(vec3(1.0, 0.72, 0.28), vec3(1.0, 0.96, 0.85), core);
  gl_FragColor = vec4(col, (core * 0.9 + halo) * (1.0 + uFlare * 0.5));
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
  float streaks = fbm(vec3(ang * 1.6, r * 3.0 - uTime * 0.12, uTime * 0.05));
  // wide, soft halo — the glow owns the space around the sun
  float falloff = smoothstep(1.0, 0.2, r) * (0.55 + 0.45 * streaks);
  falloff *= smoothstep(0.16, 0.3, r);
  vec3 col = mix(vec3(1.0, 0.55, 0.15), vec3(1.0, 0.85, 0.5), streaks);
  gl_FragColor = vec4(col, falloff * (0.55 + uFlare * 0.6));
}
`;

// Each particle follows its own cubic Bézier from the sun's limb, meanders
// under the news, and lands somewhere along the rail — aRand picks the
// curve, the wobble adds life on top.
const PARTICLE_VERT = `
attribute float aProgress;
attribute float aSeed;
attribute vec4 aRand;
uniform float uTime;
uniform float uFlare;
uniform vec2 uSun;    // sun center, px
uniform float uSunR;  // sun radius, px
uniform vec3 uRail;   // x, top, bottom of the rail, px
uniform vec2 uSize;   // viewport px
varying float vFade;
varying float vHeat;

vec2 bezier(vec2 p0, vec2 p1, vec2 p2, vec2 p3, float t){
  float u = 1.0 - t;
  return u*u*u*p0 + 3.0*u*u*t*p1 + 3.0*u*t*t*p2 + t*t*t*p3;
}

void main(){
  float speed = 0.028 + aSeed * 0.03;
  float t = fract(aProgress + uTime * speed * (1.0 + uFlare * 0.8));

  // launch point on the sun's limb, biased toward the right hemisphere
  float ang = (aRand.x - 0.5) * 2.4;
  vec2 p0 = uSun + vec2(cos(ang), sin(ang)) * uSunR * 1.02;

  // wander controls: dip under the news at a per-particle depth
  vec2 p1 = vec2(
    mix(uSize.x * 0.22, uSize.x * 0.5, aRand.y),
    mix(uSun.y + 40.0, uSize.y * 0.85, aRand.z)
  );
  vec2 p2 = vec2(
    mix(uSize.x * 0.55, uSize.x * 0.9, aRand.z),
    mix(uRail.y, uSize.y * 0.95, aRand.w)
  );
  // destination: the rail, distributed along its WHOLE length (fills it)
  vec2 p3 = vec2(uRail.x, mix(uRail.y, uRail.z, aRand.w));

  vec2 pos = bezier(p0, p1, p2, p3, t);

  // life on the path: perpendicular-ish wobble, fading as it docks
  float wob = sin(t * 14.0 + aSeed * 40.0) + 0.5 * sin(t * 33.0 + aSeed * 17.0 + uTime * 0.8);
  pos += vec2(wob * 6.0, wob * 9.0) * (1.0 - t) * (0.4 + aSeed * 0.6);

  vFade = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.93, 1.0, t) * 0.65);
  vHeat = 1.0 - t * 0.6;

  vec4 mv = modelViewMatrix * vec4(pos, 0.0, 1.0);
  gl_PointSize = (2.2 + aSeed * 2.6) * (1.0 - t * 0.35);
  gl_Position = projectionMatrix * mv;
}
`;

const PARTICLE_FRAG = `
varying float vFade;
varying float vHeat;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.05, length(d)) * vFade;
  vec3 col = mix(vec3(1.0, 0.42, 0.15), vec3(1.0, 0.75, 0.3), vHeat);
  gl_FragColor = vec4(col, a * 0.8);
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
  // pixel-space ortho camera: (0,0) top-left, y grows down
  const camera = new THREE.OrthographicCamera(0, 100, 0, 100, -500, 500);

  const uniforms = {
    uTime: { value: 0 },
    uFlare: { value: 0 },
  };

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(1, 96, 96),
    new THREE.ShaderMaterial({ vertexShader: SUN_VERT, fragmentShader: SUN_FRAG, uniforms })
  );
  scene.add(sun);

  const corona = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 5.6),
    new THREE.ShaderMaterial({
      vertexShader:
        'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: CORONA_FRAG,
      uniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  corona.position.z = -1;
  scene.add(corona);

  // the blaze layer over the disc — this is what makes it SHINE
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.9, 2.9),
    new THREE.ShaderMaterial({
      vertexShader:
        'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: GLOW_FRAG,
      uniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    })
  );
  glow.position.z = 2;
  glow.renderOrder = 3;
  scene.add(glow);

  // dense, phase-uniform stream = smooth and gapless
  const COUNT = 2400;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
  const progress = new Float32Array(COUNT);
  const seed = new Float32Array(COUNT);
  const rand = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i += 1) {
    progress[i] = i / COUNT; // uniform phases — no clumps, no gaps
    seed[i] = Math.random();
    rand[i * 4] = Math.random();
    rand[i * 4 + 1] = Math.random();
    rand[i * 4 + 2] = Math.random();
    rand[i * 4 + 3] = Math.random();
  }
  geo.setAttribute('aProgress', new THREE.BufferAttribute(progress, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aRand', new THREE.BufferAttribute(rand, 4));
  const streamUniforms = {
    uTime: uniforms.uTime,
    uFlare: uniforms.uFlare,
    uSun: { value: new THREE.Vector2(140, 100) },
    uSunR: { value: 66 },
    uRail: { value: new THREE.Vector3(1400, 90, 800) },
    uSize: { value: new THREE.Vector2(1440, 900) },
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
  // document-space anchor: the sun stays glued to the header as it scrolls
  const anchor = { cx: 150, cyDoc: 100, r: 46 };

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio || 1, 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);

    camera.left = 0;
    camera.right = w;
    camera.top = 0;
    camera.bottom = h;
    camera.updateProjectionMatrix();

    const wireH = 36;
    // the sun is BACKGROUND: centered exactly ON the wordmark (both axes),
    // the text burns on top of the disc — measured from the DOM
    const wm = document.querySelector('.wordmark');
    const rect = wm ? wm.getBoundingClientRect() : null;
    // fits exactly between the clocks band and the tabs bar — no flat cuts
    const r = 36;
    const sy = window.scrollY || 0;
    if (rect) {
      anchor.cx = rect.left + rect.width / 2;
      anchor.cyDoc = rect.top + rect.height / 2 + sy;
    } else {
      anchor.cx = 150;
      anchor.cyDoc = wireH + 44;
    }
    anchor.r = r;
    sun.scale.setScalar(r);
    corona.scale.setScalar(r * 1.35); // wider halo plane
    glow.scale.setScalar(r);

    streamUniforms.uSunR.value = r;
    // rail geometry mirrors the CSS: right:12px, canvas 14px wide,
    // top wire+52, bottom 26
    streamUniforms.uRail.value.set(w - 19, wireH + 52, h - 26);
    streamUniforms.uSize.value.set(w, h);
  }

  function render(now) {
    uniforms.uTime.value = (now - start) / 1000;
    flare = Math.max(0, flare - 0.008);
    uniforms.uFlare.value = flare;
    // glue the sun to the header (canvas is viewport-fixed)
    const cy = anchor.cyDoc - (window.scrollY || 0);
    sun.position.set(anchor.cx, cy, 0);
    sun.rotation.y = uniforms.uTime.value * 0.045; // slow solar rotation
    corona.position.set(anchor.cx, cy, -1);
    glow.position.set(anchor.cx, cy, 2);
    streamUniforms.uSun.value.set(anchor.cx, cy);
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
  // the wordmark's width settles once the display font loads — re-anchor
  document.fonts?.ready?.then(() => {
    resize();
    if (reducedMotion.matches) render(performance.now());
  });

  play();

  return {
    pulse() {
      flare = 1;
      if (reducedMotion.matches) render(performance.now());
    },
  };
}
