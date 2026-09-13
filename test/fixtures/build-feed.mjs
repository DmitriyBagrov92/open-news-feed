// Generates test/fixtures/feed.json and feed.fresh.json — a deterministic
// newsroom for the test suite. Run `node test/fixtures/build-feed.mjs`
// after editing. Ages are minutes-before-now (the store's 7-day window is
// relative), URLs live on allowlisted hosts so /api/article can be
// exercised: three of them resolve to pages/*.html through the fixture
// fetch stub, the rest 404 → the preview falls back to the description.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const IMG = (n) => `https://images.example.net/fixture/${n}.jpg`;
const feed = [];
let n = 0;
const add = (source, host, title, description, { ageMin, image = true, category, slug } = {}) => {
  n += 1;
  feed.push({
    source,
    title,
    description,
    url: `https://${host}/fixture/${slug || 'story-' + n}`,
    image: image ? IMG(n) : null,
    ...(category ? { category } : {}),
    ageMin,
  });
};

// ── world (mainstream, lean-tagged where the registry says so) ──────────
add('bbc-world', 'www.bbc.com', 'Coastal towns brace as Storm Idris nears the Atlantic seaboard', 'Forecasters expect landfall on Thursday night; ferries and schools are already closed along the coast.', { ageMin: 4, slug: 'story-a' });
add('guardian-world', 'www.theguardian.com', 'Supreme Court to hear challenge to sweeping import tariffs', 'The justices agreed to take the case on an expedited schedule, with arguments set for next month.', { ageMin: 9, slug: 'story-b' });
add('aljazeera', 'www.aljazeera.com', 'Ceasefire talks resume in Cairo after week-long pause', 'Mediators say a framework for a phased truce is on the table for the first time since spring.', { ageMin: 15 });
add('npr-world', 'www.npr.org', 'Federal Reserve expected to hold rates as inflation cools', 'Markets price a pause at Wednesday’s meeting, with the statement wording in focus.', { ageMin: 22, image: false });
add('sky-world', 'news.sky.com', 'Rail strike enters third day as talks collapse again', 'Unions and the operator traded blame after an overnight session ended without agreement.', { ageMin: 31, slug: 'story-c' });
add('dw-world', 'www.dw.com', 'Berlin coalition agrees on 2027 budget after marathon session', 'The compromise trims defence growth and keeps the debt brake intact.', { ageMin: 47 });
add('france24', 'www.france24.com', 'Paris unveils plan to pedestrianise the Seine embankments', 'The scheme would close two kilometres of quayside road to cars by 2028.', { ageMin: 58 });
add('abc-au', 'www.abc.net.au', 'Great Barrier Reef survey finds partial recovery after bleaching', 'Scientists caution that the gains are fragile going into a warm summer.', { ageMin: 75, image: false });
add('euronews', 'www.euronews.com', 'EU ministers back new rules on AI in hiring', 'The regulation would require human review of automated rejections.', { ageMin: 92 });
add('tass', 'tass.com', 'Northern Sea Route shipping season extended by six weeks', 'Ice conditions allowed convoys to run into November for the first time.', { ageMin: 130 });
add('scmp', 'www.scmp.com', 'Hong Kong pilots four-day week for civil servants', 'The trial covers 3,000 staff across two departments for six months.', { ageMin: 160 });
add('japantimes', 'www.japantimes.co.jp', 'Tokyo commuters face first fare rise in a decade', 'The operator cites energy costs and a shrinking ridership base.', { ageMin: 200, image: false });
add('straitstimes', 'www.straitstimes.com', 'Singapore tightens rules on e-scooter batteries after fires', 'Only certified packs may be sold from January.', { ageMin: 240 });
add('mee', 'www.middleeasteye.net', 'Ceasefire talks in Cairo: what each side wants', 'A guide to the sticking points as mediators push for a phased truce.', { ageMin: 260 });
add('timesofisrael', 'www.timesofisrael.com', 'Knesset committee advances judicial appointments bill', 'The vote sends the measure to a first reading next week.', { ageMin: 300 });
add('jpost', 'www.jpost.com', 'Ceasefire talks resume in Cairo, officials cautiously optimistic', 'Israeli officials said the Cairo framework is closer than previous rounds.', { ageMin: 320 });
add('toi-world', 'timesofindia.indiatimes.com', 'Monsoon withdrawal delayed by a week, IMD says', 'Farmers in the north are advised to hold sowing until the rains clear.', { ageMin: 400 });
add('allafrica', 'allafrica.com', 'Kenya launches continent’s largest solar-storage plant', 'The 300 MW site near Nairobi will power 600,000 homes.', { ageMin: 520, image: false });
add('mercopress', 'en.mercopress.com', 'Falklands fishing licences hit record value', 'Squid catches drove the season to a new high.', { ageMin: 700 });

// ── business ────────────────────────────────────────────────────────────
add('bbc-business', 'www.bbc.com', 'Federal Reserve holds rates steady, signals patience', 'The central bank kept its benchmark unchanged and said it wants more evidence on inflation.', { ageMin: 12 });
add('guardian-business', 'www.theguardian.com', 'Supermarket price war deepens as Tesco cuts 1,000 lines', 'Rivals are expected to respond within days.', { ageMin: 34 });
add('cnbc', 'www.cnbc.com', 'Chipmaker Vela posts record quarter on data-centre demand', 'Shares rose 8% after hours on guidance above estimates.', { ageMin: 66, image: false });
add('yahoo-finance', 'finance.yahoo.com', 'Oil slips below $70 as inventories build', 'Analysts see a soft floor unless OPEC+ trims output.', { ageMin: 110 });
add('fortune', 'fortune.com', 'The four-day week is spreading to factories', 'Manufacturers report lower turnover after pilots in three states.', { ageMin: 190 });
add('ft', 'www.ft.com', 'Bond markets brace for heavy autumn issuance', 'Treasuries face a record refunding calendar.', { ageMin: 310, image: false });

// ── technology ──────────────────────────────────────────────────────────
add('verge', 'www.theverge.com', 'Chrome ships on-device AI to every desktop user', 'The Prompt API leaves its origin trial with a smaller model download.', { ageMin: 7 });
add('techcrunch', 'techcrunch.com', 'Startup Orbis raises $120M to map the ocean floor', 'The round values the company at $1.1B.', { ageMin: 40 });
add('ars', 'arstechnica.com', 'Linux 7.2 lands with a rewritten scheduler', 'Benchmarks show gains on hybrid CPUs.', { ageMin: 85, image: false });
add('wired', 'www.wired.com', 'The quiet return of the small web', 'Personal sites are growing again, and the tools are better than ever.', { ageMin: 150 });
add('engadget', 'www.engadget.com', 'Review: the first foldable that survives a pocket', 'Durability finally matches the price.', { ageMin: 230 });
add('bbc-tech', 'www.bbc.com', 'Regulator opens probe into app store fees', 'Developers welcomed the inquiry; the platform said it would cooperate.', { ageMin: 280 });
add('hackernews', 'news.ycombinator.com', 'Show HN: a news reader that runs its AI on your device', 'Open source, no accounts, no tracking.', { ageMin: 330, image: false });

// ── science ─────────────────────────────────────────────────────────────
add('sciencedaily', 'www.sciencedaily.com', 'Bacteria found thriving in concrete could cut cement emissions', 'The strain self-heals cracks in lab tests.', { ageMin: 18 });
add('nature', 'www.nature.com', 'Fusion experiment sustains plasma for a record 22 minutes', 'The result edges toward continuous operation.', { ageMin: 95 });
add('nasa', 'www.nasa.gov', 'Artemis crew completes final dress rehearsal', 'Launch remains targeted for the spring window.', { ageMin: 170 });
add('phys-org', 'phys.org', 'Ancient ice core reveals 1.2 million years of climate', 'The Antarctic record is the oldest continuous one recovered.', { ageMin: 260, image: false });
add('bbc-science', 'www.bbc.com', 'Rare comet visible to the naked eye this weekend', 'Look west after sunset for a faint tail.', { ageMin: 350 });
add('newscientist', 'www.newscientist.com', 'Why sleep before a test beats cramming', 'A new study measures memory consolidation directly.', { ageMin: 480 });

// ── sports ──────────────────────────────────────────────────────────────
add('espn', 'www.espn.com', 'Shelton sets up US Open final against Alcaraz', 'The American won a five-set thriller to reach his first Grand Slam final on Sunday.', { ageMin: 5 });
add('bbc-sport', 'www.bbc.com', 'Europe lead 7-5 going into Solheim Cup singles', 'Sunday’s twelve matches decide the trophy.', { ageMin: 50 });
add('guardian-sport', 'www.theguardian.com', 'Wrexham suffer heaviest loss under Reynolds in 6-0 rout', 'West Ham ran riot on Friday night.', { ageMin: 120, image: false });

// ── culture ─────────────────────────────────────────────────────────────
add('variety', 'variety.com', 'Box office: “Ignition” opens to $48M', 'The thriller beat projections in its first weekend.', { ageMin: 28 });
add('thr', 'www.hollywoodreporter.com', 'Emmys move to a single-night ceremony', 'The academy says the shorter show will air live in every time zone.', { ageMin: 140 });
add('rollingstone', 'www.rollingstone.com', 'The 50 best albums of the year so far', 'From bedroom pop to big-tent country.', { ageMin: 210, image: false });
add('bbc-culture', 'www.bbc.com', 'Turner Prize shortlist announced', 'Four artists compete for the £25,000 award.', { ageMin: 290 });
add('guardian-culture', 'www.theguardian.com', 'Review: a Hamlet that runs on batteries', 'Two hours of electric theatre.', { ageMin: 360 });

// ── health ──────────────────────────────────────────────────────────────
add('bbc-health', 'www.bbc.com', 'NHS to offer weight-loss jab through GPs from January', 'Eligibility starts with the highest-risk patients.', { ageMin: 36 });
add('statnews', 'www.statnews.com', 'FDA panel backs first oral treatment for migraine prevention', 'A decision is due within weeks.', { ageMin: 180, image: false });
add('who', 'www.who.int', 'WHO declares end of mpox emergency', 'Cases have fallen for six consecutive months.', { ageMin: 420 });

// ── older tail: enough for a second page (infinite scroll) ──────────────
const tails = [
  ['bbc-world', 'www.bbc.com', 'world'], ['guardian-world', 'www.theguardian.com', 'world'], ['npr-world', 'www.npr.org', 'world'],
  ['bbc-business', 'www.bbc.com', 'business'], ['cnbc', 'www.cnbc.com', 'business'], ['verge', 'www.theverge.com', 'technology'],
  ['ars', 'arstechnica.com', 'technology'], ['nature', 'www.nature.com', 'science'], ['espn', 'www.espn.com', 'sports'],
  ['variety', 'variety.com', 'culture'], ['bbc-health', 'www.bbc.com', 'health'], ['euronews', 'www.euronews.com', 'world'],
];
for (let i = 0; i < 24; i += 1) {
  const [source, host, cat] = tails[i % tails.length];
  add(source, host, `Archive ${i + 1}: an earlier ${cat} story from ${source}`, `Background reading number ${i + 1} — kept so the feed has a second page.`, { ageMin: 900 + i * 240, image: i % 3 !== 0 });
}
// same-source duplicate title → deduped by toArticles (one survives)
add('bbc-world', 'www.bbc.com', 'Coastal towns brace as Storm Idris nears the Atlantic seaboard', 'Duplicate of the lead story with a different URL.', { ageMin: 6 });
// too old for the window → dropped
add('bbc-world', 'www.bbc.com', 'Ancient history: a story from nine days ago', 'Must never appear.', { ageMin: 9 * 24 * 60 });

// ── native-language feeds (German) ──────────────────────────────────────
add('tagesschau', 'www.tagesschau.de', 'Bundestag beschließt Haushalt nach Marathonsitzung', 'Der Kompromiss hält die Schuldenbremse ein.', { ageMin: 20 });
add('spiegel', 'www.spiegel.de', 'Bahnstreik geht in den dritten Tag', 'Die Gespräche wurden in der Nacht abgebrochen.', { ageMin: 45 });
add('zeit', 'www.zeit.de', 'Warum die Vier-Tage-Woche in Fabriken ankommt', 'Erste Pilotprojekte melden weniger Kündigungen.', { ageMin: 130, image: false });

// ── Bubble Battle clusters: left / center / right on the same stories ───
// battles.compute needs ≥2 shared strong tokens (capitalised words) per pair
// and ≥2 leans + ≥2 sources per cluster, all within 48 h.
add('fox-news', 'www.foxnews.com', 'Supreme Court takes up Trump Tariffs case in win for White House', 'Conservatives hailed the decision to fast-track the Tariffs appeal.', { ageMin: 30 });
add('nypost', 'nypost.com', 'Supreme Court to rule on Trump Tariffs before Christmas', 'The Tariffs fight heads to the justices on an expedited timeline.', { ageMin: 70 });
add('thenation', 'www.thenation.com', 'The Supreme Court Just Handed Trump Tariffs a Lifeline', 'Progressives warn the Tariffs ruling could entrench executive power.', { ageMin: 55 });
add('salon', 'www.salon.com', 'Why the Supreme Court Tariffs case is really about Trump', 'A legal scholar on what the Tariffs argument reveals.', { ageMin: 110 });
add('thehill', 'thehill.com', 'Supreme Court sets December arguments in Trump Tariffs dispute', 'Both parties are preparing briefs for the Tariffs case.', { ageMin: 40 });

add('fox-news', 'www.foxnews.com', 'Federal Reserve holds Rates as Powell resists pressure', 'The Fed kept Rates unchanged despite calls for a cut.', { ageMin: 150 });
add('dailywire', 'www.dailywire.com', 'Federal Reserve keeps Rates high, Powell blames spending', 'The Rates decision drew criticism from the White House.', { ageMin: 190 });
add('motherjones', 'www.motherjones.com', 'The Federal Reserve held Rates. Workers will pay.', 'Economists say the Rates pause hits borrowers first.', { ageMin: 165 });
add('npr-politics', 'www.npr.org', 'Federal Reserve leaves Rates unchanged at 4.25%', 'Powell said the Rates path depends on inflation data.', { ageMin: 175 });

add('washexaminer', 'www.washingtonexaminer.com', 'Ceasefire talks in Cairo stall as Hamas balks', 'The Cairo round ended without a Ceasefire framework.', { ageMin: 240 });
add('dailykos', 'www.dailykos.com', 'Ceasefire talks: Cairo mediators say a deal is close', 'Reports from Cairo point to progress on the Ceasefire.', { ageMin: 260 });
add('csmonitor', 'www.csmonitor.com', 'In Cairo, Ceasefire talks turn to the day after', 'Mediators in Cairo are drafting Ceasefire guarantees.', { ageMin: 250 });

const fresh = [
  { source: 'bbc-world', host: 'www.bbc.com', title: 'Breaking: Storm Idris makes landfall near Portsmouth', description: 'Gusts of 90 mph were recorded as the storm came ashore.' },
  { source: 'espn', host: 'www.espn.com', title: 'Breaking: Shelton wins the US Open in four sets', description: 'The first American men’s champion since 2003.' },
  { source: 'cnbc', host: 'www.cnbc.com', title: 'Breaking: Vela shares jump 12% at the open', description: 'Investors cheered the data-centre guidance.' },
].map((s, i) => ({
  source: s.source,
  title: s.title,
  description: s.description,
  url: `https://${s.host}/fixture/fresh-${i + 1}`,
  image: i === 0 ? IMG('fresh') : null,
  ageMin: 0,
}));

writeFileSync(path.join(here, 'feed.json'), JSON.stringify(feed, null, 2) + '\n');
writeFileSync(path.join(here, 'feed.fresh.json'), JSON.stringify(fresh, null, 2) + '\n');
console.log(`feed.json: ${feed.length} items, feed.fresh.json: ${fresh.length}`);
