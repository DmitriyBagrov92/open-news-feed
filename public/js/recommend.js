// Taste engine for "Your Feed" — pure logic, no DOM, no fetch. The profile
// lives in prefs.taste (device-only, never sent to the server): weights per
// source, category and title entity, accumulated from likes (+) and
// dislikes (−) in the onboarding.

import { entityTokens } from './ai.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function bump(obj, key, delta) {
  if (!key) return;
  obj[key] = clamp((obj[key] || 0) + delta, -50, 50);
}

// dir: 1 = like, -1 = dislike. Mutates taste in place (caller persists).
export function applyRating(taste, article, dir) {
  bump(taste.sources, article.source?.id, 2 * dir);
  bump(taste.cats, article.category, dir);
  for (const tok of [...entityTokens(article.title).keys()].slice(0, 6)) {
    bump(taste.tokens, tok, dir);
  }
  taste.rated.unshift(article.id);
  taste.rated.splice(300);
  taste.count += 1;
}

// Onboarding deck: diverse and unseen — round-robin across categories,
// at most one story per source, rated/saved excluded. ~40 candidates.
export function pickOnboardingCandidates(articles, taste, savedIds, max = 40) {
  const rated = new Set(taste.rated);
  const usedSources = new Set();
  const byCat = new Map();
  for (const a of articles) {
    if (rated.has(a.id) || savedIds.has(a.id)) continue;
    if (!byCat.has(a.category)) byCat.set(a.category, []);
    byCat.get(a.category).push(a);
  }
  const lanes = [...byCat.values()];
  const out = [];
  for (let round = 0; out.length < max; round += 1) {
    let took = false;
    for (const lane of lanes) {
      while (lane.length) {
        const a = lane.shift();
        if (usedSources.has(a.source?.id)) continue;
        usedSources.add(a.source?.id);
        out.push(a);
        took = true;
        break;
      }
      if (out.length >= max) break;
    }
    if (!took) break;
  }
  return out;
}

// Personalized ranking. score = source affinity + category affinity +
// entity overlap + freshness. Clamps keep one favourite source from
// drowning everything; freshness keeps stale favourites off the top.
export function rankForYou(articles, taste, savedIds, now = Date.now()) {
  const rated = new Set(taste.rated);
  const scored = [];
  for (const a of articles) {
    if (rated.has(a.id) || savedIds.has(a.id)) continue;
    const srcW = taste.sources[a.source?.id] || 0;
    const catW = taste.cats[a.category] || 0;
    let tokW = 0;
    for (const tok of entityTokens(a.title).keys()) tokW += taste.tokens[tok] || 0;
    const ageHours = Math.max(0, (now - Date.parse(a.publishedAt)) / 3600_000);
    const score =
      2 * clamp(srcW, -6, 6) +
      1.5 * clamp(catW, -6, 6) +
      clamp(tokW, -4, 4) +
      Math.max(0, 2 * (1 - ageHours / 24));
    scored.push({ a, score });
  }
  scored.sort(
    (x, y) => y.score - x.score || (x.a.publishedAt < y.a.publishedAt ? 1 : -1)
  );

  const personalized = scored.some(({ score }) => score > 2.05); // beats bare freshness
  // diversity: at most 4 stories per source in the final list
  const perSource = new Map();
  const top = [];
  for (const { a } of scored) {
    const sid = a.source?.id || '?';
    if ((perSource.get(sid) || 0) >= 4) continue;
    perSource.set(sid, (perSource.get(sid) || 0) + 1);
    top.push(a);
    if (top.length >= 30) break;
  }
  return { articles: top, personalized };
}
