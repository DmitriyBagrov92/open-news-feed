// Bubble Battle view: viewpoint clusters rendered as physics bubbles.
// Matter.js runs headless in the page coordinates of a tall scrollable
// space; DOM buttons are synced to the bodies each frame. The page itself
// scrolls — the engine never does — and scrolling kicks impulses into the
// nearby bubbles. Reduced motion (or a missing vendor) degrades to a
// static flex layout of the same bubbles.

import { el, clear } from './dom.js';
import { t } from './i18n.js';
import { api } from './api.js';
import { prefs } from './prefs.js';
import { openPreview } from './modal.js';
import { relTime } from './time.js';

const PITCH = 520;            // vertical distance between cluster anchors
const STALE_MS = 5 * 60_000;  // refetch on enter() when older than this
const CLICK_PX = 6;           // pointer travel below this = click, not drag
const CLICK_MS = 400;

// Matter's UMD wrapper needs `this` as root — import() would hand it
// undefined, so the vendor loads via an injected script tag (CSP 'self').
function loadMatter() {
  return new Promise((resolve, reject) => {
    if (window.Matter) return resolve(window.Matter);
    const s = document.createElement('script');
    s.src = 'vendor/matter.js';
    s.onload = () => resolve(window.Matter);
    s.onerror = () => reject(new Error('vendor missing'));
    document.head.append(s);
  });
}

export function initBattle({ section }) {
  const space = section.querySelector('#battleSpace');
  const linksCanvas = section.querySelector('#battleLinks');
  const status = section.querySelector('#battleStatus');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  let Matter = null;
  let engine = null;
  let world = null;
  let rafId = null;
  let lastTick = 0;
  let fetchedAt = 0;
  let battles = [];
  let clusters = []; // { battle, anchor, bubbles: [{ article, body, elBtn, r }], links, mounted }
  let active = false;
  let staticMode = false;
  let idleTimer = null;
  let lastScrollY = 0;
  let pendingKick = 0;

  const abort = { scroll: null, resize: null, visibility: null };

  /* ── data ──────────────────────────────────────────────────────────────── */

  async function ensureData() {
    if (battles.length && Date.now() - fetchedAt < STALE_MS) return;
    status.textContent = '…';
    const res = await api.battles();
    const hidden = new Set(prefs.hiddenSources);
    battles = (res.battles || [])
      .map((b) => ({ ...b, articles: b.articles.filter((a) => !hidden.has(a.source.id)) }))
      .filter((b) => {
        const leans = new Set(b.articles.map((a) => a.lean));
        return b.articles.length >= 2 && leans.size >= 2;
      });
    fetchedAt = Date.now();
    status.textContent = res.updatedAt ? relTime(res.updatedAt) : '';
  }

  /* ── DOM builders (shared by physics and static modes) ─────────────────── */

  function bubbleButton(article, r) {
    const btn = el('button', {
      class: 'bubble',
      type: 'button',
      'data-lean': article.lean,
      'aria-label': `${article.source?.name} — ${article.title}`,
    });
    btn.style.width = btn.style.height = r * 2 + 'px';
    if (article.image && /^https?:\/\//i.test(article.image)) {
      btn.classList.add('bubble--img');
      // the URL is already encoded — only escape quotes for the css string
      btn.style.backgroundImage = `url("${article.image.replace(/["\\]/g, '\\$&')}")`;
    }
    const inner = el('span', { class: 'bubble-in' });
    inner.append(
      el('span', { class: 'bubble-src mono', text: article.source?.name || '' }),
      el('span', { class: 'bubble-title', text: article.title })
    );
    btn.append(inner);
    return btn;
  }

  function openBubble(cluster, article, btn) {
    openPreview(article, {
      cardFor: () => btn,
      // prev/next walks the other viewpoints of the SAME story
      getAdjacent: (a, dir) => {
        const list = cluster.battle.articles;
        const i = list.findIndex((x) => x.id === a.id);
        return i === -1 ? null : list[i + dir] || null;
      },
    });
  }

  function radiusFor(article, viewportW) {
    const age = Date.now() - Date.parse(article.publishedAt);
    const fresh = Math.max(0, 1 - age / (48 * 3600_000)); // 0..1
    let r = 44 + fresh * 26 + (article.image ? 8 : 0);
    if (viewportW < 640) r *= 0.72;
    return Math.max(36, Math.min(86, Math.round(r)));
  }

  /* ── static fallback ───────────────────────────────────────────────────── */

  function buildStatic() {
    staticMode = true;
    section.classList.add('battle--static');
    linksCanvas.hidden = true;
    clear(space);
    for (const battle of battles) {
      const group = el('div', { class: 'battle-group' });
      group.append(el('p', { class: 'battle-topic mono', text: battle.topic.join(' · ') }));
      const wrapEl = el('div', { class: 'battle-group-bubbles' });
      const cluster = { battle };
      for (const article of battle.articles) {
        const r = radiusFor(article, innerWidth);
        const btn = bubbleButton(article, r);
        btn.addEventListener('click', () => openBubble(cluster, article, btn));
        wrapEl.append(btn);
      }
      group.append(wrapEl);
      space.append(group);
    }
    if (!battles.length) showEmpty();
  }

  function showEmpty() {
    clear(space);
    space.append(el('p', { class: 'battle-empty', text: t('battle.empty') }));
    space.style.height = 'auto';
  }

  /* ── physics mode ──────────────────────────────────────────────────────── */

  function buildPhysics() {
    staticMode = false;
    section.classList.remove('battle--static');
    linksCanvas.hidden = false;
    const { Engine, Composite } = Matter;
    engine = engine || Engine.create({ enableSleeping: true, gravity: { x: 0, y: 0 } });
    world = engine.world;
    Composite.clear(world, false);
    clear(space);
    clusters = [];

    if (!battles.length) {
      showEmpty();
      return;
    }

    const w = space.clientWidth;
    space.style.height = battles.length * PITCH + 120 + 'px';

    battles.forEach((battle, i) => {
      const anchor = { x: w * (0.5 + (i % 2 ? 0.16 : -0.16)), y: i * PITCH + PITCH / 2 };
      const topicEl = el('p', { class: 'battle-topic mono', text: battle.topic.join(' · ') });
      topicEl.style.top = anchor.y - PITCH / 2 + 46 + 'px';
      space.append(topicEl);
      const cluster = { battle, anchor, bubbles: [], mounted: false };
      battle.articles.forEach((article, j) => {
        const r = radiusFor(article, innerWidth);
        const angle = (j / battle.articles.length) * Math.PI * 2;
        const dist = 60 + (j % 3) * 46;
        const body = Matter.Bodies.circle(
          anchor.x + Math.cos(angle) * dist,
          anchor.y + Math.sin(angle) * dist,
          r,
          { restitution: 0.9, frictionAir: 0.06, mass: (r * r) / 2000 }
        );
        const btn = bubbleButton(article, r);
        wireDrag(cluster, article, body, btn, r);
        space.append(btn);
        cluster.bubbles.push({ article, body, btn, r });
      });
      clusters.push(cluster);
    });

    // constraints to the 2 nearest siblings (a full mesh turns rigid)
    for (const cluster of clusters) {
      cluster.links = [];
      const bs = cluster.bubbles;
      for (let i = 0; i < bs.length; i += 1) {
        const dists = bs
          .map((other, j) => ({ j, d: i === j ? Infinity : Math.hypot(bs[i].body.position.x - other.body.position.x, bs[i].body.position.y - other.body.position.y) }))
          .sort((a, b) => a.d - b.d)
          .slice(0, 2);
        for (const { j } of dists) {
          if (j > i || !dists.some((x) => x.j === i)) {
            cluster.links.push(
              Matter.Constraint.create({
                bodyA: bs[i].body,
                bodyB: bs[j].body,
                stiffness: 0.001,
                damping: 0.05,
              })
            );
          }
        }
      }
    }

    // centripetal pull toward each cluster's anchor + one consolidated
    // scroll kick per tick + a hard speed clamp so no interaction can ever
    // blast a bubble off its cluster
    Matter.Events.on(engine, 'beforeUpdate', () => {
      const kick = pendingKick;
      pendingKick = 0;
      for (const cluster of clusters) {
        if (!cluster.mounted) continue;
        for (const { body } of cluster.bubbles) {
          const dx = cluster.anchor.x - body.position.x;
          const dy = cluster.anchor.y - body.position.y;
          const dist = Math.hypot(dx, dy);
          // progressive spring: gentle nearby, firm when strays far
          const k = (dist > 320 ? 9e-6 : 3e-6) * body.mass;
          Matter.Body.applyForce(body, body.position, { x: dx * k, y: dy * k });
          if (kick) {
            Matter.Sleeping.set(body, false);
            Matter.Body.applyForce(body, body.position, {
              x: (Math.random() - 0.5) * Math.abs(kick) * 4e-7 * body.mass,
              y: -kick * 2.5e-6 * body.mass,
            });
          }
          const speed = Math.hypot(body.velocity.x, body.velocity.y);
          if (speed > 14) {
            Matter.Body.setVelocity(body, {
              x: (body.velocity.x / speed) * 14,
              y: (body.velocity.y / speed) * 14,
            });
          }
        }
      }
    });

    updateMounts(true);
  }

  // mount/unmount clusters around the viewport to keep the live-body budget
  function updateMounts(force = false) {
    const top = scrollY - innerHeight * 2;
    const bottom = scrollY + innerHeight * 3;
    const spaceTop = space.getBoundingClientRect().top + scrollY;
    for (const cluster of clusters) {
      const y = spaceTop + cluster.anchor.y;
      const should = y > top && y < bottom;
      if (should === cluster.mounted && !force) continue;
      if (should && !cluster.mounted) {
        Matter.Composite.add(world, cluster.bubbles.map((b) => b.body));
        Matter.Composite.add(world, cluster.links);
        cluster.mounted = true;
      } else if (!should && cluster.mounted) {
        Matter.Composite.remove(world, cluster.bubbles.map((b) => b.body));
        Matter.Composite.remove(world, cluster.links);
        cluster.mounted = false;
      }
    }
  }

  /* ── drag vs click ─────────────────────────────────────────────────────── */

  function wireDrag(cluster, article, body, btn, r) {
    let dragging = null; // { constraint, x0, y0, t0, moved }
    btn.addEventListener('pointerdown', (e) => {
      if (staticMode || !engine) return;
      btn.setPointerCapture(e.pointerId);
      const p = toSpace(e);
      dragging = {
        x0: e.clientX,
        y0: e.clientY,
        t0: performance.now(),
        moved: false,
        constraint: Matter.Constraint.create({
          bodyA: body,
          pointB: p,
          stiffness: 0.2,
          damping: 0.1,
          length: 0,
        }),
      };
      Matter.Composite.add(world, dragging.constraint);
      Matter.Sleeping.set(body, false);
    });
    btn.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      if (Math.hypot(e.clientX - dragging.x0, e.clientY - dragging.y0) > CLICK_PX) {
        dragging.moved = true;
        btn.classList.add('is-dragging');
      }
      dragging.constraint.pointB = toSpace(e);
    });
    const finish = (e) => {
      if (!dragging) return;
      Matter.Composite.remove(world, dragging.constraint);
      const wasClick = !dragging.moved && performance.now() - dragging.t0 < CLICK_MS;
      btn.classList.remove('is-dragging');
      dragging = null;
      if (wasClick) openBubble(cluster, article, btn);
    };
    btn.addEventListener('pointerup', finish);
    btn.addEventListener('pointercancel', finish);
    // keyboard activation (Enter/Space fires click with no pointer events)
    btn.addEventListener('click', (e) => {
      if (e.detail === 0) openBubble(cluster, article, btn); // keyboard only
    });
  }

  function toSpace(e) {
    const rect = space.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /* ── frame loop ────────────────────────────────────────────────────────── */

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    const dt = lastTick ? Math.min(now - lastTick, 33) : 16;
    lastTick = now;
    Matter.Engine.update(engine, dt);
    syncDom();
    drawLinks();
  }

  function syncDom() {
    const margin = innerHeight * 1.5;
    for (const cluster of clusters) {
      if (!cluster.mounted) continue;
      for (const { body, btn, r } of cluster.bubbles) {
        const { x, y } = body.position;
        btn.style.transform = `translate3d(${x - r}px, ${y - r}px, 0)`;
      }
    }
  }

  function drawLinks() {
    const ctx = linksCanvas.getContext('2d');
    const w = innerWidth;
    const h = innerHeight;
    if (linksCanvas.width !== w) linksCanvas.width = w;
    if (linksCanvas.height !== h) linksCanvas.height = h;
    ctx.clearRect(0, 0, w, h);
    const rect = space.getBoundingClientRect();
    ctx.lineWidth = 1;
    ctx.strokeStyle = getComputedStyle(section).getPropertyValue('--battle-link') || 'rgba(255,255,255,0.16)';
    for (const cluster of clusters) {
      if (!cluster.mounted || !cluster.links) continue;
      for (const link of cluster.links) {
        const a = link.bodyA.position;
        const b = link.bodyB.position;
        const ay = a.y + rect.top;
        const by = b.y + rect.top;
        if ((ay < -100 && by < -100) || (ay > h + 100 && by > h + 100)) continue;
        ctx.beginPath();
        ctx.moveTo(a.x + rect.left, ay);
        ctx.lineTo(b.x + rect.left, by);
        ctx.stroke();
      }
    }
  }

  /* ── ambient life + scroll impulses ────────────────────────────────────── */

  function startIdleKicks() {
    stopIdleKicks();
    idleTimer = setInterval(() => {
      if (document.hidden || !engine) return;
      const visible = clusters.filter((c) => c.mounted).flatMap((c) => c.bubbles);
      if (!visible.length) return;
      const pick = visible[Math.floor(Math.random() * visible.length)];
      Matter.Sleeping.set(pick.body, false);
      Matter.Body.applyForce(pick.body, pick.body.position, {
        x: (Math.random() - 0.5) * 0.002 * pick.body.mass,
        y: (Math.random() - 0.5) * 0.002 * pick.body.mass,
      });
    }, 3000);
  }

  function stopIdleKicks() {
    clearInterval(idleTimer);
    idleTimer = null;
  }

  // scroll events fire far more often than physics ticks — accumulate the
  // delta and let beforeUpdate consume it exactly once per tick
  function onScroll() {
    updateMounts();
    if (!engine) return;
    const dv = scrollY - lastScrollY;
    lastScrollY = scrollY;
    pendingKick = Math.max(-300, Math.min(300, pendingKick + dv));
  }

  let resizeTimer = null;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (staticMode || !clusters.length) return;
      const w = space.clientWidth;
      clusters.forEach((cluster, i) => {
        cluster.anchor.x = w * (0.5 + (i % 2 ? 0.16 : -0.16));
      });
      // bodies glide to the new anchors via the standing attraction
    }, 200);
  }

  /* ── lifecycle ─────────────────────────────────────────────────────────── */

  async function enter() {
    active = true;
    try {
      await ensureData();
    } catch {
      clear(space);
      space.append(el('p', { class: 'battle-empty', text: t('battle.error') }));
      return;
    }
    if (!active) return; // user already left the tab
    if (reducedMotion.matches) {
      buildStatic();
      return;
    }
    try {
      Matter = await loadMatter();
    } catch {
      buildStatic();
      return;
    }
    if (!active) return;
    buildPhysics();
    lastScrollY = scrollY;
    abort.scroll = new AbortController();
    addEventListener('scroll', onScroll, { passive: true, signal: abort.scroll.signal });
    addEventListener('resize', onResize, { signal: abort.scroll.signal });
    document.addEventListener('visibilitychange', onVisibility, { signal: abort.scroll.signal });
    startIdleKicks();
    lastTick = 0;
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  function onVisibility() {
    if (document.hidden) pauseLoop();
    else if (active && engine && !staticMode && !rafId) {
      lastTick = 0;
      rafId = requestAnimationFrame(frame);
    }
  }

  function pauseLoop() {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  function leave() {
    active = false;
    pauseLoop();
    stopIdleKicks();
    abort.scroll?.abort();
    abort.scroll = null;
    // DOM + engine stay cached for cheap re-entry
  }

  function destroy() {
    leave();
    if (Matter && engine) {
      Matter.Events.off(engine);
      Matter.Composite.clear(engine.world, false);
      Matter.Engine.clear(engine);
    }
    engine = null;
    clusters = [];
    clear(space);
  }

  return { enter, leave, destroy };
}
