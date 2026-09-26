// The deterministic "HOW COVERAGE DIFFERS" analysis of a Bubble Battle
// cluster — pure logic, no DOM (the iOS app replays it from golden vectors).
//
// Stance detection: the difference that matters is the ATTITUDE — who
// attacks the story's subject and who cheers it. Verb/noun lexicons of
// hostile vs approving headline language score each side's tone; the
// verdict is backed by that side's most polarized headline as evidence.
export const STANCE_NEG = /\b(slams?|blasts?|rips?|attacks?|fail(?:s|ure|ures)?|dangerous|scandal|crisis|chaos|threats?|disaster|corrupt(?:ion)?|lies?|expos\w+|betray\w*|collaps\w+|worst|warns?|accus\w+|destroy\w*|fears?|blames?|mocks?|fraud|revisionism|problem|debacle|meltdown|dodge\w*|desperate|refus\w+|denies|deny)\b/i;
export const STANCE_POS = /\b(wins?|won|supports?|backs?|defends?|prais\w+|boosts?|leads?|victory|success|celebrat\w+|flex\w*|triumph\w*|vows?|cheers?|surg\w+|stronger?|record|welcomes?|endors\w+|rall\w+)\b/i;

export function stanceOf(articles) {
  let score = 0;
  let evidence = null;
  let best = 0;
  for (const a of articles) {
    let v = 0;
    if (STANCE_NEG.test(a.title)) v -= 1;
    if (STANCE_POS.test(a.title)) v += 1;
    score += v;
    if (v !== 0 && Math.abs(v) >= Math.abs(best)) {
      best = v;
      evidence = a.title;
    }
  }
  return { score, evidence };
}

// One row per lean present, left → center → right: the side's first two
// outlets, its stance and the receipt (its most polarized headline).
export function contrastRows(battle) {
  const byLean = {};
  for (const a of battle.articles) {
    const slot = (byLean[a.lean] ??= { articles: [], sources: new Set() });
    slot.articles.push(a);
    slot.sources.add(a.source?.name || '');
  }
  return ['left', 'center', 'right']
    .filter((l) => byLean[l])
    .map((lean) => {
      const { score, evidence } = stanceOf(byLean[lean].articles);
      return {
        lean,
        source: [...byLean[lean].sources].slice(0, 2).join(', '),
        stance: score < 0 ? 'critical' : score > 0 ? 'supportive' : 'neutral',
        evidence,
      };
    });
}
