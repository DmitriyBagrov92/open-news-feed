// Bubble Battle clustering: groups articles from lean-tagged sources that
// cover the SAME story, so the client can show the coverage spectrum side
// by side. Pure in-memory computation over store.battlePool(), cached per
// store refresh (keyed on stats().updatedAt — no timers).

import { createHash } from 'node:crypto';
import { battlePool, stats } from './store.js';

const MAX_BATTLES = 20;
const MAX_MEMBERS = 9;
const MAX_PER_SOURCE = 2;
const JACCARD_MIN = 0.25;
// a strong token shared by more than this fraction of the pool stops being
// evidence of "same story" (think "trump") and is demoted to weak
const DF_CAP = 0.25;
const POSTING_CAP = 50;

// ~130 stopwords: standard English + headline junk that never identifies a
// story ("says", "report", "watch", "live"…).
const STOP = new Set(`
a about above after again against all am an and any are as at be because been
before being below between both but by can did do does doing down during each
few for from further had has have having he her here hers him his how i if in
into is it its itself just me more most my no nor not now of off on once only
or other our out over own same she should so some such than that the their
them then there these they this those through to too under until up very was
we were what when where which while who whom why will with you your
says say said saying report reports reporting watch video live breaking
exclusive opinion news update updates amid new latest today yesterday
tomorrow week year years day days man woman people first last look looks
make makes get gets top big best worst way ways thing things need needs
know knows see sees still back call calls plan plans set sets show shows
`.trim().split(/\s+/));

/* ── tokenization ──────────────────────────────────────────────────────── */

// Splits a title into weak tokens (all informative words) and strong tokens
// (capitalized entities — joined bigrams for multi-word names — and long
// numbers). Strong tokens carry the "same story" signal.
export function tokenize(title) {
  const words = String(title).split(/[^A-Za-z0-9$%']+/).filter(Boolean);
  const all = new Set();
  const strong = new Set();
  const display = new Map(); // lower → original casing (for topic labels)

  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    const lower = w.toLowerCase().replace(/'s$/, '');
    if (lower.length < 3 && !/^\d{2,}$/.test(lower)) continue;
    if (STOP.has(lower)) continue;
    all.add(lower);
    if (/^\d{2,}$/.test(lower)) {
      strong.add(lower);
      continue;
    }
    if (/^[A-Z]/.test(w)) {
      display.set(lower, w);
      // adjacent capitalized words form one entity: "Supreme Court"
      const next = words[i + 1];
      if (next && /^[A-Z]/.test(next)) {
        const nl = next.toLowerCase().replace(/'s$/, '');
        if (!STOP.has(nl) && nl.length >= 3) {
          const bigram = lower + '_' + nl;
          strong.add(bigram);
          display.set(bigram, w + ' ' + next);
        }
      }
      strong.add(lower);
    }
  }
  return { all, strong, display };
}

/* ── clustering ────────────────────────────────────────────────────────── */

function jaccard(a, b) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter || 1);
}

function sharedStrong(a, b) {
  let n = 0;
  for (const t of a) if (b.has(t)) n += 1;
  return n;
}

class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x) {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

function compute() {
  const pool = battlePool();
  const docs = pool.map((a) => ({ article: a, ...tokenize(a.title) }));

  // demote ubiquitous strong tokens (df > 25% of pool) to weak: they name a
  // protagonist, not a story
  const df = new Map();
  for (const d of docs) for (const t of d.strong) df.set(t, (df.get(t) || 0) + 1);
  const dfCap = Math.max(3, Math.floor(docs.length * DF_CAP));
  for (const d of docs) {
    for (const t of [...d.strong]) if ((df.get(t) || 0) > dfCap) d.strong.delete(t);
  }

  // inverted index strong-token → doc indices; only pairs sharing a strong
  // token are ever compared (pool ~500 → well under 100ms)
  const index = new Map();
  docs.forEach((d, i) => {
    for (const t of d.strong) {
      if (!index.has(t)) index.set(t, []);
      const list = index.get(t);
      if (list.length < POSTING_CAP) list.push(i);
    }
  });

  const uf = new UnionFind(docs.length);
  for (const list of index.values()) {
    for (let x = 0; x < list.length; x += 1) {
      for (let y = x + 1; y < list.length; y += 1) {
        const a = docs[list[x]];
        const b = docs[list[y]];
        if (uf.find(list[x]) === uf.find(list[y])) continue;
        const shared = sharedStrong(a.strong, b.strong);
        // ≥2 shared entities, or 1 entity AND high overall similarity —
        // the AND-gate stops headline clichés from false-merging stories
        if (shared >= 2 || (shared >= 1 && jaccard(a.all, b.all) >= JACCARD_MIN)) {
          uf.union(list[x], list[y]);
        }
      }
    }
  }

  const groups = new Map();
  docs.forEach((d, i) => {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(d);
  });

  const battles = [];
  for (const members of groups.values()) {
    const leans = new Set(members.map((d) => d.article.lean));
    const sourceIds = new Set(members.map((d) => d.article.source.id));
    if (leans.size < 2 || sourceIds.size < 2) continue;
    const trimmed = trimCluster(members);
    const leanCounts = { left: 0, center: 0, right: 0 };
    for (const d of trimmed) leanCounts[d.article.lean] += 1;
    battles.push({
      id: battleId(trimmed),
      topic: topicOf(trimmed),
      leans: leanCounts,
      leanCount: Object.values(leanCounts).filter(Boolean).length,
      newest: trimmed.reduce((m, d) => (d.article.publishedAt > m ? d.article.publishedAt : m), ''),
      articles: trimmed.map((d) => ({ ...d.article })),
    });
  }

  battles.sort(
    (a, b) =>
      b.leanCount - a.leanCount ||
      b.articles.length - a.articles.length ||
      (a.newest < b.newest ? 1 : -1)
  );
  const top = battles.slice(0, MAX_BATTLES).map(({ leanCount, newest, ...rest }) => rest);
  return { battles: top, updatedAt: new Date().toISOString() };
}

// Lean-balanced trim: round-robin right → left → center, newest first
// within each lean, at most 2 per source, at most 9 total.
function trimCluster(members) {
  const byLean = { right: [], left: [], center: [] };
  for (const d of members) byLean[d.article.lean]?.push(d);
  for (const list of Object.values(byLean)) {
    list.sort((a, b) => (a.article.publishedAt < b.article.publishedAt ? 1 : -1));
  }
  const perSource = new Map();
  const out = [];
  const order = ['right', 'left', 'center'];
  for (let round = 0; out.length < MAX_MEMBERS; round += 1) {
    let took = false;
    for (const lean of order) {
      if (out.length >= MAX_MEMBERS) break;
      const list = byLean[lean];
      while (list.length) {
        const d = list.shift();
        const sid = d.article.source.id;
        if ((perSource.get(sid) || 0) >= MAX_PER_SOURCE) continue;
        perSource.set(sid, (perSource.get(sid) || 0) + 1);
        out.push(d);
        took = true;
        break;
      }
    }
    if (!took) break;
  }
  return out;
}

function topicOf(members) {
  // most frequent strong tokens across the trimmed cluster, shown with
  // their original casing
  const freq = new Map();
  const display = new Map();
  for (const d of members) {
    for (const t of d.strong) {
      freq.set(t, (freq.get(t) || 0) + 1);
      if (!display.has(t) && d.display.has(t)) display.set(t, d.display.get(t));
    }
  }
  return [...freq.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 3)
    .map(([t]) => display.get(t) || t.replaceAll('_', ' '));
}

function battleId(members) {
  const ids = members.map((d) => d.article.id).sort().join(',');
  return createHash('sha1').update(ids).digest('hex').slice(0, 12);
}

/* ── cached entry point ────────────────────────────────────────────────── */

let cache = { key: null, payload: null };

export function getBattles() {
  const key = stats().updatedAt;
  if (!cache.payload || cache.key !== key) {
    cache = { key, payload: compute() };
  }
  return cache.payload;
}
