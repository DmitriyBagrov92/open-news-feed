// Bubble Battle view: viewpoint clusters rendered as physics bubbles.
// Matter.js runs headless in the page coordinates of a tall scrollable
// space; DOM buttons are synced to the bodies each frame. The page itself
// scrolls — the engine never does. Clusters stay united (rest-length
// springs + progressive anchor pull + collision-packed layout, overlap is
// physically impossible), bubbles pick animated fights with each other,
// every cluster auto-summarizes itself when scrolled into view, and both
// titles and summaries follow the translation setting live.

import { el, clear } from './dom.js';
import { t } from './i18n.js';
import { api } from './api.js';
import { prefs } from './prefs.js';
import { openPreview } from './modal.js';
import { relTime } from './time.js';
import { summarize, translateTexts, toBullets } from './ai.js';
import { initHoverTip } from './tooltip.js';

const TOPIC_BAND = 44;        // reserved height for the topic label
const CLUSTER_GAP = 84;       // clearance between clusters
const BRIEF_FULL_H = 210;     // packing reserve for an expanded brief tile
const BRIEF_MAX_H = 360;      // hard ceiling — rows are line-clamped anyway
const BRIEF_THINK_H = 52;     // collapsed "thinking" pill height
const BRIEF_CLEAR = 24;       // invisible margin: news tiles keep this gap
const STALE_MS = 5 * 60_000;  // refetch on enter() when older than this
const CLICK_PX = 6;           // pointer travel below this = click, not drag
const CLICK_MS = 400;
const BUBBLE_GAP = 12;        // minimum clearance between bubble rims
const FIGHT_EVERY_MS = 4500;

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

// options.onArticles(articles) — app.js feeds the plasma timeline with the
// freshness histogram of everything on this page.
export function initBattle(options = {}) {
  const { section, onArticles } = options;
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
  let clusters = []; // { battle, anchor, radius, bubbles, links, mounted, briefEl, topicEl }
  let active = false;
  let staticMode = false;
  let fightTimer = null;
  let lastScrollY = 0;
  let pendingKick = 0;
  let clusterObserver = null;
  const bubbleArticle = new WeakMap(); // button el → article (tooltip resolve)
  const translated = new Map();        // articleId:lang → { title, description }
  const briefCache = new Map();        // battleId:lang → bullets[]
  let sizeFactor = levelFactor(prefs.gridSize || 0);

  const abort = { scroll: null };

  function levelFactor(level) {
    return 1 + (level || 0) * 0.22; // -2 → 0.56 … +2 → 1.44
  }

  const langActive = () => prefs.autoTranslate && (prefs.targetLang || 'en') !== 'en';

  /* ── data ──────────────────────────────────────────────────────────────── */

  async function ensureData() {
    if (battles.length && Date.now() - fetchedAt < STALE_MS) return false;
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
    onArticles?.(battles.flatMap((b) => b.articles));
    return true;
  }

  /* ── shared DOM builders ───────────────────────────────────────────────── */

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
      el('span', { class: 'bubble-title', text: article.title }),
      el('time', { class: 'bubble-time mono', datetime: article.publishedAt, text: relTime(article.publishedAt) })
    );
    btn.append(inner);
    bubbleArticle.set(btn, article);
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

  // r = HALF of the square tile's side (iOS-style rounded squares carry
  // more text than circles at the same footprint)
  function radiusFor(article, viewportW) {
    const age = Date.now() - Date.parse(article.publishedAt);
    const fresh = Math.max(0, 1 - age / (48 * 3600_000)); // 0..1
    let r = 42 + fresh * 22 + (article.image ? 6 : 0);
    if (viewportW < 640) r *= 0.72;
    return Math.max(34, Math.min(78, Math.round(r)));
  }

  // squares meet at corners — pack with an effective radius between the
  // half-side and the half-diagonal so relaxation can never interlock them
  const packR = (r) => r * 1.18;

  /* ── overlap-free cluster layout ───────────────────────────────────────── */

  // Golden-angle ring seed + pairwise relaxation AROUND the central brief
  // core (coreR): tiles start packed with clear rims and never sit on the
  // summary — it is one of the colliding elements, not an overlay.
  function layoutCluster(items, coreR = 0) {
    items.forEach((it, j) => {
      const a = j * 2.399963;
      const d = coreR + packR(it.r) + 6 + (j % 3) * 26;
      it.x = Math.cos(a) * d;
      // bias the seed toward a wide, low silhouette — the page reads top
      // to bottom, so vertical spread is the expensive direction
      it.y = Math.sin(a) * d * 0.72;
    });
    for (let iter = 0; iter < 80; iter += 1) {
      let moved = false;
      for (let i = 0; i < items.length; i += 1) {
        // keep clear of the central brief core
        const it = items[i];
        const dc = Math.hypot(it.x, it.y) || 0.01;
        const minC = coreR + packR(it.r);
        if (coreR && dc < minC) {
          it.x += (it.x / dc) * (minC - dc);
          it.y += (it.y / dc) * (minC - dc);
          moved = true;
        }
        for (let k = i + 1; k < items.length; k += 1) {
          const a = items[i];
          const b = items[k];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 0.01;
          const min = packR(a.r) + packR(b.r) + BUBBLE_GAP;
          if (d < min) {
            const push = (min - d) / 2;
            dx /= d;
            dy /= d;
            a.x -= dx * push;
            a.y -= dy * push;
            b.x += dx * push;
            b.y += dy * push;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    // cluster radius = farthest rim from the centroid
    let R = coreR;
    for (const it of items) R = Math.max(R, Math.hypot(it.x, it.y) + packR(it.r));
    return R;
  }

  /* ── static fallback ───────────────────────────────────────────────────── */

  function buildStatic() {
    staticMode = true;
    section.classList.add('battle--static');
    linksCanvas.hidden = true;
    clear(space);
    space.style.height = 'auto';
    for (const battle of battles) {
      const group = el('div', { class: 'battle-group' });
      group.append(el('p', { class: 'battle-topic mono', text: battle.topic.join(' · ') }));
      const wrapEl = el('div', { class: 'battle-group-bubbles' });
      const cluster = { battle };
      for (const article of battle.articles) {
        const r = Math.round(radiusFor(article, innerWidth) * sizeFactor);
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
    if (!engine) {
      engine = Engine.create({ enableSleeping: true, gravity: { x: 0, y: 0 } });
      engine.positionIterations = 8; // overlap is prohibited — resolve hard
      engine.velocityIterations = 6;
      wireEngineEvents();
    }
    world = engine.world;
    Composite.clear(world, false);
    clusterObserver?.disconnect();
    clusterObserver = new IntersectionObserver(onClusterVisible, { rootMargin: '60px 0px' });
    clear(space);
    clusters = [];

    if (!battles.length) {
      showEmpty();
      return;
    }

    const w = space.clientWidth;

    // Accumulated vertical layout: every cluster gets exactly the height it
    // needs — topic band, bubble field (2R), then a RESERVED band for its
    // AI brief. Nothing can ever overlap the neighbours, whatever the radii.
    let yCursor = 40;

    battles.forEach((battle, i) => {
      const items = battle.articles.map((article) => ({
        article,
        r: Math.round(radiusFor(article, innerWidth) * sizeFactor),
      }));
      // the AI brief is a colliding tile at the heart of the group; the
      // layout reserves its EXPANDED size so growth never forces a reflow
      const briefW = Math.min(340, w * 0.72);
      const coreR = Math.hypot((briefW + BRIEF_CLEAR * 2) / 2, (BRIEF_FULL_H + BRIEF_CLEAR * 2) / 2) * 0.9;
      const R = layoutCluster(items, coreR);
      // vertical band = the ACTUAL extents of the packed layout, not the
      // bounding circle — clusters are wide and low, and the circle model
      // left a dead zone above/below that grew with tile size and count
      let yMin = -(BRIEF_FULL_H / 2 + BRIEF_CLEAR);
      let yMax = BRIEF_FULL_H / 2 + BRIEF_CLEAR;
      let xR = briefW / 2 + BRIEF_CLEAR;
      for (const it of items) {
        // true tile extents (+8px breath), not the inflated packing radius
        yMin = Math.min(yMin, it.y - it.r - 8);
        yMax = Math.max(yMax, it.y + it.r + 8);
        xR = Math.max(xR, Math.abs(it.x) + it.r + 8);
      }
      const topicY = yCursor;
      const anchor = {
        x: Math.max(xR + 20, Math.min(w - xR - 20, w * (0.5 + (i % 2 ? 0.12 : -0.12)))),
        y: topicY + TOPIC_BAND - yMin,
      };
      yCursor = anchor.y + yMax + CLUSTER_GAP;

      const topicEl = el('p', { class: 'battle-topic mono', text: battle.topic.join(' · ') });
      topicEl.style.top = topicY + 'px';
      space.append(topicEl);

      // the brief tile: a static chamfered body the bubbles collide with
      const briefEl = el('div', { class: 'battle-brief', hidden: true });
      space.append(briefEl);

      const cluster = {
        battle, anchor, radius: R, bubbles: [], mounted: false, topicEl, briefEl,
        briefW, briefH: BRIEF_THINK_H,
        // the body is padded by BRIEF_CLEAR on every side — colliding news
        // tiles stop at the invisible rim, leaving a clean visual gap
        briefBody: Matter.Bodies.rectangle(
          anchor.x, anchor.y,
          briefW + BRIEF_CLEAR * 2, BRIEF_THINK_H + BRIEF_CLEAR * 2,
          { isStatic: true, chamfer: { radius: 18 + BRIEF_CLEAR } }
        ),
      };
      syncBrief(cluster);
      items.forEach(({ article, r, x, y }) => {
        // chamfered rectangle = the tile's true collision shape (a circle
        // collider would let square corners overlap); no rotation — text
        // must stay readable
        const body = Matter.Bodies.rectangle(anchor.x + x, anchor.y + y, r * 2, r * 2, {
          chamfer: { radius: r * 0.44 },
          restitution: 0.85,
          frictionAir: 0.06,
          mass: (r * r) / 2000,
        });
        Matter.Body.setInertia(body, Infinity);
        const btn = bubbleButton(article, r);
        wireDrag(cluster, article, body, btn);
        space.append(btn);
        // paint EVERY bubble's position immediately — unmounted clusters
        // must not pile up unstyled at the page origin
        btn.style.transform = `translate3d(${body.position.x - r}px, ${body.position.y - r}px, 0)`;
        cluster.bubbles.push({ article, body, btn, r, baseR: r / sizeFactor });
      });
      // both the topic AND the brief band count as "the cluster is in
      // view" — the first group's band sits below the fold on open, and
      // watching only the topic cancelled its pending brief on scroll
      cluster.visTargets = new Set();
      clusterObserver.observe(topicEl);
      clusterObserver.observe(briefEl);
      clusters.push(cluster);
    });
    space.style.height = yCursor + 40 + 'px';

    // rest-length springs to the 2 nearest siblings: the group stays united
    // but the springs can never pull two bubbles INTO each other
    for (const cluster of clusters) {
      cluster.links = [];
      const bs = cluster.bubbles;
      for (let i = 0; i < bs.length; i += 1) {
        const dists = bs
          .map((other, j) => ({
            j,
            d: i === j ? Infinity : Math.hypot(bs[i].body.position.x - other.body.position.x, bs[i].body.position.y - other.body.position.y),
          }))
          .sort((a, b) => a.d - b.d)
          .slice(0, 2);
        for (const { j } of dists) {
          if (j > i || !dists.some((x) => x.j === i)) {
            cluster.links.push(
              Matter.Constraint.create({
                bodyA: bs[i].body,
                bodyB: bs[j].body,
                length: packR(bs[i].r) + packR(bs[j].r) + BUBBLE_GAP + 6,
                stiffness: 0.004,
                damping: 0.08,
              })
            );
          }
        }
      }
    }

    updateMounts(true);
    applyTranslationsSoon();
  }

  function wireEngineEvents() {
    // centripetal pull + consolidated scroll kick + hard speed clamp
    Matter.Events.on(engine, 'beforeUpdate', () => {
      const kick = pendingKick;
      pendingKick = 0;
      for (const cluster of clusters) {
        if (!cluster.mounted) continue;
        for (const { body } of cluster.bubbles) {
          const dx = cluster.anchor.x - body.position.x;
          const dy = cluster.anchor.y - body.position.y;
          const dist = Math.hypot(dx, dy);
          // progressive spring: gentle inside the cluster radius, firm out
          // (the outer zone guards the reserved brief band below the group)
          const k = (dist > cluster.radius + 50 ? 2e-5 : 3e-6) * body.mass;
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

  }

  const bodyBubble = new Map(); // body.id → bubble record

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
        if (cluster.briefBody) Matter.Composite.add(world, cluster.briefBody);
        for (const b of cluster.bubbles) bodyBubble.set(b.body.id, b);
        cluster.mounted = true;
      } else if (!should && cluster.mounted) {
        Matter.Composite.remove(world, cluster.bubbles.map((b) => b.body));
        Matter.Composite.remove(world, cluster.links);
        if (cluster.briefBody) Matter.Composite.remove(world, cluster.briefBody);
        for (const b of cluster.bubbles) bodyBubble.delete(b.body.id);
        cluster.mounted = false;
      }
    }
  }

  /* ── card-size slider integration ──────────────────────────────────────── */

  function applySizeLevel(level) {
    const next = levelFactor(level);
    if (Math.abs(next - sizeFactor) < 0.001) return;
    sizeFactor = next;
    if (staticMode || !clusters.length) {
      if (battles.length) (staticMode ? buildStatic : buildPhysics)();
      return;
    }
    for (const cluster of clusters) {
      for (const bubble of cluster.bubbles) {
        const nr = Math.round(bubble.baseR * sizeFactor);
        const scale = nr / bubble.r;
        if (Math.abs(scale - 1) < 0.01) continue;
        Matter.Body.scale(bubble.body, scale, scale);
        bubble.r = nr;
        bubble.btn.style.width = bubble.btn.style.height = nr * 2 + 'px';
      }
      for (const link of cluster.links || []) {
        const a = bodyBubble.get(link.bodyA.id) || cluster.bubbles.find((b) => b.body === link.bodyA);
        const b = bodyBubble.get(link.bodyB.id) || cluster.bubbles.find((b) => b.body === link.bodyB);
        if (a && b) link.length = packR(a.r) + packR(b.r) + BUBBLE_GAP + 6;
      }
      let R = 0;
      for (const b of cluster.bubbles) R = Math.max(R, b.r * 2.6);
      cluster.radius = Math.max(cluster.radius, R);
    }
  }

  /* ── per-cluster: auto summary + lazy translation ──────────────────────── */

  function onClusterVisible(entries) {
    for (const entry of entries) {
      const cluster = clusters.find((c) => c.topicEl === entry.target || c.briefEl === entry.target);
      if (!cluster) continue;
      if (entry.isIntersecting) cluster.visTargets.add(entry.target);
      else cluster.visTargets.delete(entry.target);
      if (cluster.visTargets.size) {
        if (!cluster.briefTimer) {
          // a beat of dwell time so fast scrolling doesn't summarize everything
          cluster.briefTimer = setTimeout(() => {
            cluster.briefTimer = null;
            runClusterBrief(cluster);
          }, 700);
        }
        if (langActive()) translateCluster(cluster);
      } else {
        clearTimeout(cluster.briefTimer);
        cluster.briefTimer = null;
      }
    }
  }

  // Position + size the brief tile's DOM and swap its physics body when the
  // size changes. Width/height are CSS-transitioned, so every state change
  // (pill → thinking → expanded content) animates; the fresh static body
  // makes neighbours shove aside rather than get overlapped.
  function syncBrief(cluster) {
    const b = cluster.briefEl;
    b.style.width = cluster.briefW + 'px';
    b.style.height = cluster.briefH + 'px';
    b.style.transform = `translate3d(${cluster.anchor.x - cluster.briefW / 2}px, ${cluster.anchor.y - cluster.briefH / 2}px, 0)`;
  }

  function setBriefSize(cluster, h) {
    if (cluster.briefH === h) return;
    cluster.briefH = h;
    syncBrief(cluster);
    if (!Matter || staticMode || !cluster.briefBody) return;
    const wasMounted = cluster.mounted;
    if (wasMounted) Matter.Composite.remove(world, cluster.briefBody);
    cluster.briefBody = Matter.Bodies.rectangle(
      cluster.anchor.x, cluster.anchor.y,
      cluster.briefW + BRIEF_CLEAR * 2, h + BRIEF_CLEAR * 2,
      { isStatic: true, chamfer: { radius: 18 + BRIEF_CLEAR } }
    );
    if (wasMounted) Matter.Composite.add(world, cluster.briefBody);
    // the grown tile shoves its neighbours aside — wake them so they react
    for (const bubble of cluster.bubbles) Matter.Sleeping.set(bubble.body, false);
  }

  // The battle brief is about CONTRAST: how the same story is framed on
  // each side. The AI rung gets a lean-labeled corpus and a differences
  // prompt; the deterministic fallback shows each lean's own freshest
  // headline side by side — the framing gap speaks for itself.
  async function runClusterBrief(cluster) {
    if (!active) return;
    const lang = langActive() ? prefs.targetLang : 'en';
    const key = cluster.battle.id + ':' + lang;
    const briefEl = cluster.briefEl;
    if (!briefEl || briefEl.dataset.key === key) return;
    let payload = briefCache.get(key);
    if (!payload) {
      briefEl.hidden = false;
      briefEl.dataset.key = key;
      briefEl.classList.add('is-thinking');
      briefEl.classList.remove('is-ready');
      clear(briefEl);
      briefEl.append(
        el('span', { class: 'battle-brief-spin', 'aria-hidden': 'true' }),
        el('span', { class: 'battle-brief-thinking mono', text: t('brief.working') })
      );
      setBriefSize(cluster, BRIEF_THINK_H);
      try {
        const result = await summarize({
          mode: 'brief',
          topic: cluster.battle.topic.join(' ') + ' — how left, center and right coverage DIFFERS',
          articles: cluster.battle.articles.map((a) => ({
            title: `${a.lean.toUpperCase()}: ${a.title}`,
            description: a.description || '',
            source: a.source?.name || '',
          })),
          targetLang: lang,
        });
        if (result.provider === 'local') {
          // extractive can't contrast — build the distinctive-framing rows
          payload = { rows: contrastRows(cluster) };
          if (lang !== 'en') {
            const texts = payload.rows.map((r) => r.text);
            const tr = await translateTexts(texts, lang, { sourceLang: 'en' }).catch(() => null);
            if (tr && tr.texts.length === texts.length) {
              payload.rows.forEach((r, i) => { r.text = tr.texts[i]; });
            }
          }
        } else {
          payload = { bullets: toBullets(result.summary, 3) };
        }
        briefCache.set(key, payload);
      } catch {
        briefEl.classList.remove('is-thinking');
        briefEl.hidden = true;
        delete briefEl.dataset.key;
        setBriefSize(cluster, BRIEF_THINK_H);
        return;
      }
    }
    if (!active) return;
    briefEl.dataset.key = key;
    clear(briefEl);
    briefEl.classList.remove('is-thinking');
    const inner = el('div', { class: 'battle-brief-body' });
    inner.append(el('span', { class: 'battle-brief-head mono', text: t('battle.diffHead') }));
    const list = el('ul', { class: 'battle-brief-list' });
    if (payload.bullets) {
      for (const line of payload.bullets) list.append(el('li', { text: line }));
    } else {
      for (const row of payload.rows) {
        const li = el('li', { 'data-lean': row.lean });
        li.append(
          el('strong', { class: 'mono', text: t('battle.' + row.lean) + ' · ' + row.source }),
          document.createTextNode(' ' + row.text)
        );
        list.append(li);
      }
    }
    inner.append(list);
    briefEl.append(inner);
    briefEl.hidden = false;
    // the tile takes exactly the size of its content (body padding
    // included in scrollHeight) — the CSS transition animates the growth
    // while the swapped physics body shoves the news tiles aside
    const target = Math.min(BRIEF_MAX_H, inner.scrollHeight + 6);
    setBriefSize(cluster, target);
    requestAnimationFrame(() => briefEl.classList.add('is-ready'));
  }

  // Deterministic contrast analysis: what does each side say that the
  // others DON'T. Tokens (words + capitalized phrases) unique to a lean's
  // headlines are its distinctive framing — that difference is the row.
  const CONTRAST_STOP = new Set(
    ('the a an and or but for with from into over under after before because ' +
      'says said would could should about their there these those than that this ' +
      'have has been will more most some what when where which while news update ' +
      'live breaking report video watch amid').split(' ')
  );

  function contrastTokens(title) {
    const words = String(title).split(/[^A-Za-z0-9’']+/).filter(Boolean);
    const out = new Map(); // lower → display
    for (let i = 0; i < words.length; i += 1) {
      const w = words[i];
      const lower = w.toLowerCase();
      if (lower.length < 4 || CONTRAST_STOP.has(lower)) continue;
      const next = words[i + 1];
      if (/^[A-Z]/.test(w) && next && /^[A-Z]/.test(next)) {
        out.set(lower + ' ' + next.toLowerCase(), w + ' ' + next);
      }
      out.set(lower, /^[A-Z]/.test(w) ? w : lower);
    }
    return out;
  }

  function contrastRows(cluster) {
    const byLean = {};
    for (const a of cluster.battle.articles) {
      const slot = (byLean[a.lean] ??= { tokens: new Map(), sources: new Set(), freshest: a });
      slot.sources.add(a.source?.name || '');
      if (a.publishedAt > slot.freshest.publishedAt) slot.freshest = a;
      for (const [lower, display] of contrastTokens(a.title)) {
        const cur = slot.tokens.get(lower) || { display, n: 0 };
        cur.n += 1;
        slot.tokens.set(lower, cur);
      }
    }
    const order = ['left', 'center', 'right'].filter((l) => byLean[l]);
    return order.map((lean) => {
      const others = new Set(
        order.filter((o) => o !== lean).flatMap((o) => [...byLean[o].tokens.keys()])
      );
      // phrases only this side uses — prefer repeated and multi-word ones
      const distinct = [...byLean[lean].tokens.entries()]
        .filter(([lower]) => !others.has(lower) && ![...others].some((t) => t.includes(lower)))
        .sort((a, b) => b[1].n - a[1].n || b[0].length - a[0].length)
        .slice(0, 3)
        .map(([, v]) => v.display);
      return {
        lean,
        source: [...byLean[lean].sources].slice(0, 2).join(', '),
        text: distinct.length
          ? `${t('battle.frames')} ${distinct.map((w) => '“' + w + '”').join(', ')}`
          : byLean[lean].freshest.title,
      };
    });
  }

  async function translateCluster(cluster) {
    const lang = prefs.targetLang;
    const todo = cluster.bubbles
      ? cluster.bubbles.map((b) => ({ article: b.article, btn: b.btn }))
      : [];
    const missing = todo.filter(({ article }) => !translated.has(article.id + ':' + lang));
    if (missing.length) {
      // title + description per article: ≤9 articles → ≤18 texts, one call
      const texts = missing.flatMap(({ article }) => [article.title, article.description || '']);
      const res = await translateTexts(texts, lang, { sourceLang: 'en' }).catch(() => null);
      if (!res) return;
      missing.forEach(({ article }, i) => {
        translated.set(article.id + ':' + lang, {
          title: res.texts[i * 2],
          description: res.texts[i * 2 + 1],
        });
      });
    }
    if (!langActive() || prefs.targetLang !== lang) return; // changed mid-flight
    for (const { article, btn } of todo) {
      const tr = translated.get(article.id + ':' + lang);
      if (!tr) continue;
      const titleEl = btn.querySelector('.bubble-title');
      if (titleEl && btn.dataset.translated !== lang) {
        titleEl.textContent = tr.title;
        btn.dataset.translated = lang;
        btn.setAttribute('aria-label', `${article.source?.name} — ${tr.title}`);
      }
    }
  }

  function revertTranslations() {
    for (const cluster of clusters) {
      for (const { article, btn } of cluster.bubbles || []) {
        if (!btn.dataset.translated) continue;
        delete btn.dataset.translated;
        const titleEl = btn.querySelector('.bubble-title');
        if (titleEl) titleEl.textContent = article.title;
        btn.setAttribute('aria-label', `${article.source?.name} — ${article.title}`);
      }
      // stale-language summaries rebuild on next visibility
      if (cluster.briefEl) delete cluster.briefEl.dataset.key;
    }
  }

  function applyTranslationsSoon() {
    if (!langActive()) return;
    // visible clusters translate immediately; the rest as they scroll in
    for (const cluster of clusters) {
      const rect = cluster.topicEl?.getBoundingClientRect();
      if (rect && rect.top < innerHeight && rect.bottom > 0) translateCluster(cluster);
    }
  }

  function onLangChange() {
    revertTranslations();
    if (active && !staticMode) applyTranslationsSoon();
  }

  /* ── drag vs click ─────────────────────────────────────────────────────── */

  function wireDrag(cluster, article, body, btn) {
    let dragging = null;
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
    const finish = () => {
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
      if (e.detail === 0) openBubble(cluster, article, btn);
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
    const link = getComputedStyle(section).getPropertyValue('--battle-link').trim() || 'rgba(255,255,255,0.16)';
    for (const cluster of clusters) {
      if (!cluster.mounted) continue;
      const ay = cluster.anchor.y + rect.top;
      const cull = cluster.radius + 260;
      if (ay < -cull || ay > h + cull) continue;
      // a soft halo unites the group visually
      const halo = ctx.createRadialGradient(
        cluster.anchor.x + rect.left, ay, cluster.radius * 0.3,
        cluster.anchor.x + rect.left, ay, cluster.radius + 40
      );
      halo.addColorStop(0, 'rgba(127,127,127,0.05)');
      halo.addColorStop(1, 'rgba(127,127,127,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cluster.anchor.x + rect.left, ay, cluster.radius + 40, 0, Math.PI * 2);
      ctx.fill();
      // constraint lines
      ctx.lineWidth = 1;
      ctx.strokeStyle = link;
      for (const l of cluster.links || []) {
        ctx.beginPath();
        ctx.moveTo(l.bodyA.position.x + rect.left, l.bodyA.position.y + rect.top);
        ctx.lineTo(l.bodyB.position.x + rect.left, l.bodyB.position.y + rect.top);
        ctx.stroke();
      }
    }
  }

  /* ── the fight: bubbles punch each other ───────────────────────────────── */

  function startFights() {
    stopFights();
    fightTimer = setInterval(() => {
      if (document.hidden || !engine || !active) return;
      const rect = space.getBoundingClientRect();
      const visible = clusters.filter((c) => {
        if (!c.mounted) return false;
        const y = c.anchor.y + rect.top;
        return y > -100 && y < innerHeight + 100;
      });
      if (!visible.length) return;
      const cluster = visible[Math.floor(Math.random() * visible.length)];
      const bs = cluster.bubbles;
      if (bs.length < 2) return;
      // pick two OPPOSING viewpoints when possible — that's the battle
      const a = bs[Math.floor(Math.random() * bs.length)];
      const foes = bs.filter((b) => b !== a && b.article.lean !== a.article.lean);
      const b = (foes.length ? foes : bs.filter((x) => x !== a))[0];
      if (!b) return;
      const dx = b.body.position.x - a.body.position.x;
      const dy = b.body.position.y - a.body.position.y;
      const d = Math.hypot(dx, dy) || 1;
      const v = 8.5;
      a.fighting = b.fighting = true;
      a.btn.classList.add('bubble--fighter');
      b.btn.classList.add('bubble--fighter');
      Matter.Sleeping.set(a.body, false);
      Matter.Sleeping.set(b.body, false);
      Matter.Body.setVelocity(a.body, { x: (dx / d) * v, y: (dy / d) * v });
      Matter.Body.setVelocity(b.body, { x: (-dx / d) * v * 0.85, y: (-dy / d) * v * 0.85 });
      setTimeout(() => {
        a.fighting = b.fighting = false;
        a.btn.classList.remove('bubble--fighter');
        b.btn.classList.remove('bubble--fighter');
      }, 1300);
    }, FIGHT_EVERY_MS);
  }

  function stopFights() {
    clearInterval(fightTimer);
    fightTimer = null;
  }

  /* ── scroll / resize ───────────────────────────────────────────────────── */

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
        cluster.anchor.x = Math.max(
          cluster.radius + 20,
          Math.min(w - cluster.radius - 20, w * (0.5 + (i % 2 ? 0.14 : -0.14)))
        );
      });
    }, 200);
  }

  /* ── lifecycle ─────────────────────────────────────────────────────────── */

  async function enter() {
    active = true;
    let fresh = false;
    try {
      fresh = await ensureData();
    } catch {
      clear(space);
      space.append(el('p', { class: 'battle-empty', text: t('battle.error') }));
      return;
    }
    if (!active) return;
    if (reducedMotion.matches) {
      buildStatic();
      options.onBuilt?.();
      return;
    }
    try {
      Matter = await loadMatter();
    } catch {
      buildStatic();
      options.onBuilt?.();
      return;
    }
    if (!active) return;
    if (fresh || !clusters.length) buildPhysics();
    else applyTranslationsSoon();
    options.onBuilt?.();
    lastScrollY = scrollY;
    abort.scroll = new AbortController();
    const signal = abort.scroll.signal;
    addEventListener('scroll', onScroll, { passive: true, signal });
    addEventListener('resize', onResize, { signal });
    document.addEventListener('visibilitychange', onVisibility, { signal });
    document.addEventListener('meridian:langchange', onLangChange, { signal });
    document.addEventListener('meridian:gridsize', (e) => applySizeLevel(e.detail?.level || 0), { signal });
    startFights();
    lastTick = 0;
    if (!rafId) rafId = requestAnimationFrame(frame);
    initTip();
  }

  let tipReady = false;
  function initTip() {
    if (tipReady) return;
    tipReady = true;
    // same hover tooltip as the main grid, translation-aware
    initHoverTip({
      root: space,
      selector: '.bubble',
      ignore: null, // the bubble itself is a button — nothing to skip inside
      articleFor: (elBtn) => bubbleArticle.get(elBtn),
      textFor: (article, elBtn) => {
        const lang = elBtn.dataset.translated;
        return (lang && translated.get(article.id + ':' + lang)) || article;
      },
    });
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
    stopFights();
    abort.scroll?.abort();
    abort.scroll = null;
    // DOM + engine stay cached for cheap re-entry
  }

  function destroy() {
    leave();
    clusterObserver?.disconnect();
    if (Matter && engine) {
      Matter.Events.off(engine);
      Matter.Composite.clear(engine.world, false);
      Matter.Engine.clear(engine);
    }
    engine = null;
    clusters = [];
    clear(space);
  }

  // Timeline points for the right-rail timescale: every bubble, in page
  // order (clusters top to bottom). Non-monotonic in time — battles are
  // ranked by lean diversity, not freshness.
  function timelineItems() {
    const out = [];
    for (const cluster of clusters) {
      for (const { article, btn } of cluster.bubbles || []) {
        out.push({ t: Date.parse(article.publishedAt), el: btn });
      }
    }
    if (!out.length && staticMode) {
      for (const btn of space.querySelectorAll('.bubble')) {
        const article = bubbleArticle.get(btn);
        if (article) out.push({ t: Date.parse(article.publishedAt), el: btn });
      }
    }
    return out;
  }

  return { enter, leave, destroy, timelineItems };
}
