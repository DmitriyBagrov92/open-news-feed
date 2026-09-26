// Objectionable-content screen for comments — the "method for filtering
// objectionable material" of App Store Guideline 1.2, applied on the server so
// every client gets it. Deliberately narrow: slurs against groups, explicit
// threats, incitement to self-harm, link and flood spam. Heated language and
// plain profanity stay (news comments get heated; readers can report, and
// three reports hide a comment). Words with an innocent everyday sense
// ("a chink in the armour", "to retard growth") are left to reports.
// A match is refused with 422 `objectionable`.
//
// Evasions handled: letter case, diacritics, common digit/symbol swaps
// (n1gg3r), stretched letters (faggggot — but never fewer letters than the
// word has, so "Niger" is not "nigger") and letters spaced out with
// separators (k.i.k.e). Matching runs on a normalized copy; the stored body
// is never altered.

// Matched as whole words, with an optional plural ending (-s/-z only: "spic"
// + "es" is spices).
const SLURS = [
  'nigger', 'nigga', 'niggah', 'sandnigger', 'gook', 'spic', 'wetback', 'beaner',
  'kike', 'raghead', 'towelhead', 'zipperhead', 'jigaboo', 'gyppo', 'pikey', 'paki',
  'faggot', 'tranny', 'shemale',
];

// Matched as whole phrases, any whitespace between the words. First-person
// and imperative forms only: "this debt is gonna kill you" is not a threat.
const THREATS = [
  'kill yourself', 'kill urself', 'kys', 'hope you die', 'hope u die',
  'i will kill you', 'ill kill you', 'im going to kill you', 'i am going to kill you',
  'im gonna kill you', 'i will rape', 'rape you', 'gas the jews', 'heil hitler', 'sieg heil',
];

const SWAPS = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'l', '+': 't' };

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// "faggot" → f{1,}a{1,}g{2,}o{1,}t{1,}: letters may repeat, never shrink
const stretchable = (word) => word.replace(/(.)\1*/gu, (run) => `${escape(run[0])}{${run.length},}`);
const wholeWords = (alternatives, suffix = '') =>
  new RegExp(`(?<!\\p{L})(?:${alternatives.join('|')})${suffix}(?!\\p{L})`, 'u');

const SLUR_RE = wholeWords(SLURS.map(stretchable), '[sz]?');
const THREAT_RE = wholeWords(THREATS.map((phrase) => phrase.split(' ').map(stretchable).join('\\s+')));
const LINK_RE = /\bhttps?:\/\/|\bwww\./gi;
const FLOOD_RE = /(.)\1{29,}/su;

// Lower-cased, diacritics stripped, apostrophes dropped (i'll → ill), digits
// and symbols read as the letters they imitate.
export function normalizeForScreen(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[0134578@$!|+]/g, (c) => SWAPS[c] ?? c);
}

// Three or more single letters spaced out with separators ("k . i . k . e",
// "n-i-g-g-e-r") joined back into one word.
function joinSpaced(text) {
  return text.replace(/(?<!\p{L})\p{L}(?:[\s.\-_*•·]+\p{L}(?!\p{L})){2,}/gu, (run) => run.replace(/[^\p{L}]+/gu, ''));
}

// → { ok: true } | { ok: false, reason: 'slur' | 'threat' | 'links' | 'flood' }
export function screenComment(body) {
  const raw = String(body ?? '');
  if ((raw.match(LINK_RE) || []).length > 2) return { ok: false, reason: 'links' };
  if (FLOOD_RE.test(raw)) return { ok: false, reason: 'flood' };
  const text = normalizeForScreen(raw);
  for (const variant of [text, joinSpaced(text)]) {
    if (SLUR_RE.test(variant)) return { ok: false, reason: 'slur' };
    if (THREAT_RE.test(variant)) return { ok: false, reason: 'threat' };
  }
  return { ok: true };
}
