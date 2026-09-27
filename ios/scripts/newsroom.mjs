#!/usr/bin/env node
// The App Store newsroom: a fictional world for the marketing screenshots.
//
// The test fixtures (Tests/Fixtures/api) are captured from the real server and name real outlets,
// people and brands — fine for tests, not for marketing. This newsroom has the same shape (the
// FixtureServer reads it like the fixtures) but invented outlets on `.example` domains, invented
// stories with no real people or brands in them, and public-domain / CC0 photography from Wikimedia
// Commons. `ai.json` scripts the on-device model (FAKE_MODEL=showcase) so the brief, the key points
// and the forecast read like Apple Intelligence's.
//
//   node ios/scripts/newsroom.mjs            # writes Tests/Newsroom/{api/*.json, ai.json, CREDITS.md}
//   node ios/scripts/newsroom.mjs --images   # also downloads the photographs (git-ignored)
//   node ios/scripts/newsroom.mjs --captured-at <ISO> --out <dir>
//                                            # the same newsroom as of another instant, elsewhere
//
// scripts/appstore-screenshots.sh writes one as of today's 9:41 into build/ (the simulator's status
// bar keeps the real date, so the app's date has to be today's) — the committed one stays fixed.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME = path.resolve(HERE, '..', 'Tests', 'Newsroom');
const option = (name) => {
  const index = process.argv.indexOf(name);
  return index > 0 ? process.argv[index + 1] : undefined;
};
const OUT = option('--out') ? path.resolve(option('--out')) : HOME;
const CAPTURED_AT = new Date(option('--captured-at') ?? '2026-09-26T12:00:00.000Z').toISOString();
const at = (minutesAgo) => new Date(Date.parse(CAPTURED_AT) - minutesAgo * 60_000).toISOString();
const id12 = (text) => createHash('sha1').update(text).digest('hex').slice(0, 12);

// ── outlets ─────────────────────────────────────────────────────────────────
// Invented names on reserved `.example` domains. Leans only for the Bubble Battle outlets.
const OUTLETS = [
  { id: 'oakmere', name: 'Oakmere Chronicle', host: 'oakmere-chronicle.example', country: 'GB', category: 'world', lean: 'center' },
  { id: 'ferrow', name: 'The Ferrow Gazette', host: 'ferrow-gazette.example', country: 'GB', category: 'world', lean: 'left' },
  { id: 'brindle', name: 'Brindle Wire', host: 'brindlewire.example', country: 'US', category: 'world', lean: 'center' },
  { id: 'quai-neuf', name: 'Quai Neuf', host: 'quaineuf.example', country: 'FR', category: 'world' },
  { id: 'wattle-bay', name: 'Wattle Bay News', host: 'wattlebay.example', country: 'AU', category: 'world' },
  { id: 'minato', name: 'Minato Ledger', host: 'minatoledger.example', country: 'JP', category: 'world' },
  { id: 'nyota', name: 'Nyota Daily', host: 'nyotadaily.example', country: 'KE', category: 'world' },
  { id: 'pacific-lantern', name: 'Pacific Lantern', host: 'pacificlantern.example', country: 'SG', category: 'world' },
  { id: 'lindenblatt', name: 'Lindenblatt', host: 'lindenblatt.example', country: 'DE', category: 'world' },
  { id: 'bytewell', name: 'Bytewell', host: 'bytewell.example', country: 'US', category: 'technology' },
  { id: 'fieldline', name: 'Fieldline Science', host: 'fieldline.example', country: 'GB', category: 'science' },
  { id: 'ledgerline', name: 'Ledgerline Markets', host: 'ledgerline.example', country: 'US', category: 'business' },
  { id: 'tallyboard', name: 'Tallyboard Sport', host: 'tallyboard.example', country: 'GB', category: 'sports' },
  { id: 'velvet-aisle', name: 'The Velvet Aisle', host: 'velvetaisle.example', country: 'US', category: 'culture' },
  { id: 'remedy-desk', name: 'Remedy Desk', host: 'remedydesk.example', country: 'GB', category: 'health' },
  { id: 'quillon', name: 'The Quillon Report', host: 'quillon.example', country: 'US', category: 'battle', lean: 'left' },
  { id: 'calloway', name: 'Calloway Post', host: 'callowaypost.example', country: 'US', category: 'battle', lean: 'right' },
  { id: 'ambervale', name: 'Ambervale Courier', host: 'ambervale.example', country: 'US', category: 'battle', lean: 'right' },
];
const outlet = Object.fromEntries(OUTLETS.map((o) => [o.id, o]));

// ── photographs ─────────────────────────────────────────────────────────────
// Wikimedia Commons, public domain or CC0 only, no identifiable people up close, no logos.
const PHOTOS = {
  storm: { title: 'File:Cyclone Catarina from the ISS on March 26 2004.JPG', author: 'NASA, ISS Expedition 8 crew', license: 'Public domain' },
  aurora: { title: 'File:PIXNIO-1094468-aurora borealis.jpg', author: 'Yuliya (PIXNIO)', license: 'CC0' },
  dish: { title: 'File:Goldstone Apple Valley Radio Telescope (GAVRT) Solar Patrol (SVS14530 - 1).jpg', author: 'NASA Scientific Visualization Studio', license: 'Public domain' },
  marina: { title: 'File:Night skyline - Vancouver, Canada - DSC00075.JPG', author: 'Daderot', license: 'CC0' },
  wind: { title: 'File:Rampion Wind Farm 2023-07-09 162807.jpg', author: 'Andy Li', license: 'CC0' },
  stadium: { title: 'File:Stadium Seating.jpg', author: 'Velo City STL', license: 'CC0' },
  concert: { title: 'File:Mercedes-Benz Classic Days Salzburg 2006 - Salzburg entertainment (03).jpg', author: 'Bahnfrend', license: 'CC0' },
  forest: { title: 'File:Forest Away Path.jpg', author: 'Seaq68', license: 'CC0' },
  reef: { title: 'File:Coral Reef in the Red Sea.JPG', author: 'Mahmoud Habeeb', license: 'Public domain' },
  towers: { title: 'File:Hong Kong skyscrapers in a night of typhoon.jpg', author: 'Wilfredor', license: 'CC0' },
  seine: { title: "File:View up the Seine from Pont d'Iéna, Paris, 2016.jpg", author: 'DimiTalen', license: 'CC0' },
  chip: { title: 'File:D23 integrated circuit.jpg', author: 'Epop', license: 'CC0' },
  glacier: { title: 'File:Konrad Steffen Glacier Christiane Leister.jpg', author: 'Christiane Leister', license: 'CC0' },
  solar: { title: 'File:Solar Panels at Topaz Solar 4 (8159035850).jpg', author: 'USDA Forest Service, Pacific Southwest Region', license: 'Public domain' },
  court: { title: 'File:Futsal Tennis Court.jpg', author: 'ManoBV16', license: 'CC0' },
  museum: { title: 'File:Interior - Statens Museum for Kunst - DSC08266.JPG', author: 'Daderot', license: 'CC0' },
  platform: { title: 'File:Takanawa Gateway Station Platform Yamanote Line at night.jpg', author: 'SuFlyer', license: 'CC0' },
  coffee: { title: 'File:Rwandan-Coffee-Beans.jpg', author: 'Evan-Amos', license: 'CC0' },
  whale: { title: 'File:Humpback Whale Tail Dive Tongass HEH 19b (52502029662).jpg', author: 'USDA Forest Service, Alaska Region', license: 'Public domain' },
  vinyl: { title: 'File:Vinyl collection at a record store (Unsplash).jpg', author: 'Fabien Barral', license: 'CC0' },
  sailboat: { title: 'File:CS 27 Sailboat Poly Mer 2679.jpg', author: 'Ahunt', license: 'CC0' },
  wheat: { title: 'File:Indiana Wheat Harvest (20210628-NRCS-BJOC-001).jpg', author: 'USDA NRCS', license: 'Public domain' },
  comet: { title: 'File:NEOWISE Comet with Joshua Tree (50141053578).jpg', author: 'Joshua Tree National Park (NPS)', license: 'Public domain' },
  station: { title: 'File:Platforms of Helsingin päärautatieasema at night 2022-09-18 06.jpg', author: 'Leonhard Lenz', license: 'CC0' },
  switchbacks: { title: 'File:Switchback 140715-A-CA521-0111.jpg', author: 'U.S. Army, Sgt. Michael Selvage', license: 'Public domain' },
};
const IMAGE_HOST = 'https://images.newsroom.example/';

// ── the feed ────────────────────────────────────────────────────────────────
// Newest first. `slug` story-a/b/c are the stories the FixtureServer serves full text for (rich
// blocks, paragraphs, a paywall stub). `r` = [up, down, comments] seeded on the cards.
const STORIES = [
  { slug: 'story-a', src: 'oakmere', min: 4, photo: 'storm', r: [128, 6, 0],
    title: 'Storm Idris strengthens as it nears the Atlantic coast',
    description: 'Forecasters expect landfall late on Thursday; ferries are suspended and schools in three counties will close early.' },
  { src: 'fieldline', min: 9, photo: 'aurora', r: [86, 2, 9],
    title: 'Northern lights could reach as far south as Madrid this weekend',
    description: 'A burst of solar activity is set to push the aurora unusually far south on Saturday night, space-weather forecasters say.' },
  { src: 'bytewell', min: 13, photo: 'dish', r: [54, 3, 6],
    title: 'Forty shoebox satellites bring broadband to remote islands',
    description: 'The network went live this week, linking twelve island communities to fast internet for the first time.' },
  { slug: 'story-b', src: 'ferrow', min: 18, photo: 'marina', r: [97, 41, 23],
    title: 'Portwell votes tonight on the Congestion Charge',
    description: 'Supporters say the £6 daily fee would fund a new tram line; traders warn it will drive shoppers away.' },
  { src: 'ledgerline', min: 23, photo: 'wind', r: [61, 9, 4],
    title: 'Sandbar Wind Farm sends its first power to the grid',
    description: 'Tessary Energy says the 60-turbine project will supply 400,000 homes when it is complete next spring.' },
  { src: 'tallyboard', min: 27, photo: 'stadium', r: [143, 12, 31],
    title: 'Castlemere Athletic reach the cup final with a late comeback',
    description: 'Two goals in the last eight minutes send the second-tier side to their first final in 40 years.' },
  { src: 'velvet-aisle', min: 32, photo: 'concert', r: [38, 1, 2],
    title: 'A lost symphony gets its premiere, 90 years late',
    description: 'The score, found in an attic during a house sale, was performed for the first time by a student orchestra.' },
  { src: 'remedy-desk', min: 36, photo: 'forest', r: [72, 5, 11],
    title: 'Walking 7,000 steps a day may be enough, a large study finds',
    description: 'Researchers followed 90,000 adults for eight years; the benefits levelled off well below the popular 10,000 target.' },
  { src: 'wattle-bay', min: 41, photo: 'reef', r: [66, 1, 3],
    title: 'Reef survey finds coral recovering faster than expected',
    description: 'Divers recorded new growth at two-thirds of the monitored sites after a mild summer.' },
  { slug: 'story-c', src: 'brindle', min: 47, photo: 'towers', r: [29, 14, 8],
    title: 'Central Bank holds rates and points to a cut next spring',
    description: 'Policymakers said inflation is cooling but want more evidence; they will meet again in December.' },
  { src: 'quai-neuf', min: 52, photo: 'seine', r: [47, 6, 5],
    title: 'Paris turns another riverside road into a park',
    description: 'The 1.2-kilometre stretch along the Seine will open to walkers and cyclists in June.' },
  { src: 'bytewell', min: 58, photo: 'chip', r: [39, 4, 7],
    title: 'A new chip design cuts data-centre power use by a third',
    description: 'Engineers moved working memory next to the processor, so far less energy is spent shuttling data back and forth.' },
  { src: 'fieldline', min: 64, photo: 'glacier', r: [58, 2, 4],
    title: 'Ancient ice core reveals 1.2 million years of climate',
    description: 'The 2.8-kilometre core, drilled over five summers, extends the continuous record by 400,000 years.' },
  { src: 'nyota', min: 71, photo: 'solar', r: [44, 3, 2],
    title: 'Solar-storage plant brings round-the-clock power to northern Kenya',
    description: 'Batteries store the midday surplus, keeping clinics and schools lit after dark.' },
  { src: 'tallyboard', min: 77, photo: 'court', r: [52, 4, 6],
    title: 'Teenage qualifier stuns the top seed in straight sets',
    description: 'The 17-year-old, ranked 212th in the world, needed just 74 minutes to reach the quarter-finals.' },
  { src: 'velvet-aisle', min: 84, photo: 'museum', r: [31, 0, 1],
    title: 'Museum reopens its glass-roofed hall after a five-year restoration',
    description: 'More than 300 works return to the walls, including a gallery of sculpture unseen since 2019.' },
  { src: 'minato', min: 90, photo: 'platform', r: [23, 17, 12],
    title: 'Tokyo commuters face the first fare rise in a decade',
    description: 'Rail operators say the 10-yen increase will pay for platform doors at 40 more stations.' },
  { src: 'ledgerline', min: 97, photo: 'coffee', r: [19, 2, 1],
    title: 'Coffee prices ease as the harvest outlook improves',
    description: 'Futures fell 6% this week after rain returned to the main growing regions.' },
  { src: 'remedy-desk', min: 104, r: [34, 11, 9],
    title: 'Hospitals trial AI note-takers to cut doctors’ paperwork',
    description: 'Early results suggest clinicians save an hour a day; patients are asked for consent before each visit.' },
  { src: 'fieldline', min: 111, photo: 'whale', r: [91, 1, 5],
    title: 'Humpback whales return to a bay they left a century ago',
    description: 'Researchers counted 37 whales feeding in the bay this summer, the most since records began.' },
  { src: 'bytewell', min: 118, r: [27, 3, 4],
    title: 'The quiet return of the small web',
    description: 'Personal sites, hand-written newsletters and feed readers are finding a new audience.' },
  { src: 'quai-neuf', min: 126, photo: 'station', r: [64, 2, 8],
    title: 'Night trains return to three European routes',
    description: 'Sleeper services will link Paris, Vienna and Copenhagen again from December.' },
  { src: 'velvet-aisle', min: 134, photo: 'vinyl', r: [45, 6, 14],
    title: 'The 50 best albums of the year so far',
    description: 'From bedroom pop to a 70-minute jazz suite, the records we keep coming back to.' },
  { src: 'tallyboard', min: 142, photo: 'sailboat', r: [22, 0, 1],
    title: 'Record crowds line the harbour for the regatta finale',
    description: 'Light winds made for a tactical last race, decided by four seconds.' },
  { src: 'ledgerline', min: 150, photo: 'wheat', r: [18, 1, 0],
    title: 'Farmers expect a bumper wheat harvest after a mild spring',
    description: 'Yields are forecast 8% above the five-year average, which should keep bread prices in check.' },
  { src: 'remedy-desk', min: 159, r: [49, 3, 6],
    title: 'Why sleep before a test beats cramming',
    description: 'A night’s rest helps the brain file new memories, a review of 40 studies concludes.' },
  { src: 'pacific-lantern', min: 168, r: [15, 2, 3],
    title: 'Singapore tightens rules on e-scooter batteries',
    description: 'From January, only certified packs may be charged inside apartment blocks.' },
  { src: 'fieldline', min: 177, photo: 'comet', r: [77, 1, 10],
    title: 'A rare comet is visible to the naked eye this week',
    description: 'Look low in the west just after sunset; binoculars will show its twin tails.' },
  { src: 'bytewell', min: 186, r: [33, 8, 12],
    title: 'Review: the first foldable phone that survives a pocket',
    description: 'A tougher hinge and a screen without a crease, at last — but the battery still needs work.' },
  { src: 'remedy-desk', min: 196, r: [12, 1, 2],
    title: 'Flu season arrives early; vaccines are now at pharmacies',
    description: 'Doctors urge over-65s and people with asthma to book a jab before November.' },
  { src: 'tallyboard', min: 206, photo: 'switchbacks', r: [38, 2, 7],
    title: 'The mountain stage that decided the tour',
    description: 'Twenty-one hairpins, a headwind and a 40-second attack in the final kilometre.' },
  { src: 'ledgerline', min: 216, r: [9, 2, 0],
    title: 'Bond markets brace for heavy autumn issuance',
    description: 'Governments plan to borrow a record amount before the year ends.' },
  { src: 'velvet-aisle', min: 226, r: [26, 4, 3],
    title: 'Review: a Hamlet that runs on batteries',
    description: 'A staging lit only by hand-held lamps turns the old play into a ghost story.' },
  { src: 'oakmere', min: 236, r: [14, 1, 2],
    title: 'Lisbon adds night buses as the tourist season stretches into autumn',
    description: 'Six new routes will run until 4am through the end of November.' },
  { src: 'pacific-lantern', min: 247, r: [11, 0, 1],
    title: 'Monsoon withdrawal delayed by a week, forecasters say',
    description: 'Late rains helped reservoirs, but farmers are waiting to sow winter crops.' },
];

// Stories in the reader's language when it is German (feeds in other languages than English).
const GERMAN = [
  { src: 'lindenblatt', min: 20, photo: 'station', title: 'Nachtzüge kehren auf drei europäische Strecken zurück',
    description: 'Ab Dezember verbinden Schlafwagen wieder Paris, Wien und Kopenhagen.' },
  { src: 'lindenblatt', min: 66, title: 'Rheinufer wird autofrei: Stadt plant neue Promenade',
    description: 'Der zwei Kilometer lange Abschnitt soll im Sommer für Fußgänger und Radfahrer öffnen.' },
  { src: 'lindenblatt', min: 140, photo: 'wheat', title: 'Weizenernte fällt besser aus als erwartet',
    description: 'Die Erträge liegen acht Prozent über dem Fünfjahresmittel.' },
];

// The three stories a poll finds when NEW_STORIES=1.
const BREAKING = [
  { src: 'oakmere', title: 'Breaking: Storm Idris makes landfall near Portwell',
    description: 'Gusts of 88 mph were recorded at the harbour wall.' },
  { src: 'ledgerline', title: 'Breaking: Tessary Energy shares jump 9% at the open',
    description: 'Investors cheered the Sandbar Wind Farm’s early start.' },
  { src: 'tallyboard', title: 'Breaking: Castlemere Athletic sell out their cup final allocation',
    description: 'All 32,000 tickets went in under an hour.' },
];

// ── Bubble Battle ───────────────────────────────────────────────────────────
// One story, every angle: the feed's own lean-outlet story plus the battle outlets' takes.
const BATTLES = [
  // The stances come from the web's lexicon (battle-brief.js): left for the charge, right against.
  { topic: ['Congestion Charge', 'Congestion', 'Charge'], stories: [
    { feed: 'story-b' },
    { src: 'quillon', min: 25, title: 'Campaigners welcome a Congestion Charge that puts Portwell’s buses first',
      description: 'Cleaner air and a new tram line are worth a £6 fee, they argue.' },
    { src: 'oakmere', min: 30, title: 'Congestion Charge: what the £6 fee would cost Portwell, and what it would fund',
      description: 'Drivers, traders and bus users on what changes if tonight’s vote passes.' },
    { src: 'calloway', min: 28, title: 'Traders slam the Congestion Charge as a tax on the high street',
      description: 'Shop owners say the fee will empty the town centre.' },
    { src: 'brindle', min: 35, title: 'Council set for a tight vote on the Congestion Charge',
      description: 'Councillors are split almost evenly ahead of tonight’s meeting.' },
    { src: 'ambervale', min: 40, title: 'Drivers fear a new daily fee as the Congestion Charge vote looms',
      description: 'Commuters say buses cannot replace the car for night shifts.' },
  ] },
  // left against the hold, right for it
  { topic: ['Central Bank', 'Central', 'Bank'], stories: [
    { feed: 'story-c' },
    { src: 'quillon', min: 55, title: 'Central Bank fails renters again as rates stay high',
      description: 'Tenants and first-time buyers are paying for the bank’s caution, critics say.' },
    { src: 'calloway', min: 52, title: 'Savers cheer as the Central Bank holds firm on rates',
      description: 'Easy-access accounts keep paying above inflation for another quarter.' },
    { src: 'oakmere', min: 50, title: 'Central Bank leaves interest rates at 4.25% for a third meeting',
      description: 'The decision was unanimous; the next meeting is in December.' },
    { src: 'ferrow', min: 60, title: 'First-time buyers priced out as the Central Bank holds rates',
      description: 'Mortgage costs remain near a 15-year high.' },
    { src: 'ambervale', min: 65, title: 'Central Bank backs savers with a third hold on rates',
      description: 'Policymakers point to government borrowing as the reason inflation lingers.' },
  ] },
  // left for the wind farm, right against
  { topic: ['Sandbar Wind Farm', 'Sandbar', 'Wind'], stories: [
    { src: 'oakmere', min: 26, title: 'Sandbar Wind Farm sends first power ahead of schedule',
      description: 'Tessary Energy’s 60 turbines will be fully running by spring.' },
    { src: 'quillon', min: 33, title: 'Sandbar Wind Farm is a triumph for clean power',
      description: 'Cheaper than gas and built in under three years.' },
    { src: 'calloway', min: 38, title: 'Critics warn Sandbar Wind Farm subsidies will add £40 a year to bills',
      description: 'Bill payers are carrying the cost of the green push, they say.' },
    { src: 'ambervale', min: 43, title: 'Fishermen accuse Sandbar Wind Farm of closing their grounds',
      description: 'Trawler crews want compensation for the waters they have lost.' },
    { src: 'ferrow', min: 45, title: 'Sandbar Wind Farm opening shows what green investment can do',
      description: 'The project employed 1,200 people in a town that lost its shipyard.' },
    { src: 'brindle', min: 48, title: 'Sandbar Wind Farm on track as turbine costs fall',
      description: 'Developers say prices have dropped 20% since the project was approved.' },
  ] },
];

// ── full text ───────────────────────────────────────────────────────────────
const run = (text, extra = {}) => ({ text, ...extra });
const storyUrl = (src, slug) => `https://${outlet[src].host}/fixture/${slug}`;
const kebab = (title) => title.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

const BODIES = {
  'story-a': [
    { type: 'p', runs: [run('Forecasters expect Storm Idris to make landfall late on Thursday, bringing gusts of up to 90 miles an hour and a storm surge that could reach two metres along the southern coast. Ferry operators have suspended every crossing, and schools in three counties will close at noon.')] },
    { type: 'p', runs: [run('The national weather service raised its warning to amber on Wednesday morning, saying the system had strengthened faster than its models predicted. In Portwell, '), run('tonight’s council vote', { href: storyUrl('ferrow', 'story-b') }), run(' will go ahead as planned, officials said.')] },
    { type: 'h2', runs: [run('What to expect overnight')] },
    { type: 'ul', items: [[run('Winds peaking between midnight and 3am')], [run('Coastal roads closed from 8pm')], [run('Power cuts likely in exposed villages')]] },
    { type: 'quote', runs: [run('“This is the strongest system we have tracked this autumn,” the service’s duty forecaster said.')] },
    { type: 'p', runs: [run('Residents in low-lying areas have been advised to move cars to higher ground and to keep torches and water within reach. Emergency services said '), run('sandbags', { b: true }), run(' are available at three depots, and that volunteers will staff a helpline through the night.')] },
    { type: 'h3', runs: [run('After the storm')] },
    { type: 'p', runs: [run('Clean-up crews are on standby, with the first damage assessments expected by Friday afternoon. The council will publish a list of closed routes every two hours.')] },
  ],
  'story-b': [
    { type: 'p', runs: [run('Portwell’s councillors meet at 7pm to decide whether drivers entering the harbour district should pay a £6 daily Congestion Charge from next April.')] },
    { type: 'p', runs: [run('Supporters say the fee would raise about £14 million a year — enough to build a tram line between the station and the ferry terminal and to cut bus fares by a third.')] },
    { type: 'p', runs: [run('Traders on the high street have collected 8,000 signatures against the plan, warning that shoppers will drive to out-of-town retail parks instead.')] },
    { type: 'p', runs: [run('The vote is expected to be close: of 48 councillors, 23 have said they will back the charge and 21 oppose it.')] },
  ],
  'story-c': [{ type: 'p', runs: [run('Subscribe to read this story.')] }],
};

const plainText = (blocks) => blocks.map((b) => (b.items ? b.items.map((i) => i.map((r) => r.text).join('')).join('\n\n') : b.runs.map((r) => r.text).join(''))).join('\n\n');

// ── the conversation under story-a (the reader is Solar Jetty, as in the fixtures) ──
const ME = { name: 'Solar Jetty', avatar: { hue: 286, glyph: 0 }, authorKey: '4f84573aeaa507b3' };
const COMMENTS = [
  { id: 'cc00000000000004', name: 'Velvet Comet', avatar: { hue: 205, glyph: 7 }, authorKey: '7c2d91e0b4a36f18', at: at(20 / 60),
    body: 'Good that the schools close at noon this time. Last storm, pickup at three was chaos.', up: 7, down: 0, myVote: null },
  { id: 'cc00000000000002', name: 'Lunar Tundra', avatar: { hue: 63, glyph: 1 }, authorKey: '91813fec63b9fcfa', at: at(65 / 60),
    body: 'Anyone on the coast: stay safe tonight. The ferry office says refunds are automatic.', up: 12, down: 0, myVote: 1 },
  { id: 'cc00000000000003', name: 'Mellow Finch', avatar: { hue: 18, glyph: 14 }, authorKey: '09da35b6e04145be', at: at(110 / 60),
    body: 'Landfall forecasts have been drifting north all week. Worth checking again in the morning.', up: 3, down: 1, myVote: null },
  { id: 'cc00000000000001', ...ME, at: at(150 / 60),
    body: 'The ferry closures came early this time — sensible.', up: 5, down: 0, myVote: null, mine: true },
];

// ── the scripted on-device model (FAKE_MODEL=showcase) ──────────────────────
// `respond`: the first entry whose `match` occurs in the instructions + prompt answers; anything
// unscripted is refused (the ladders fall back as they would). `forecast.basis`: text found in the
// prompt's numbered story lines.
const AI = {
  respond: [
    { match: 'titled "Storm Idris strengthens', answer: [
      '- Storm Idris is expected to make landfall late on Thursday, with gusts of up to 90 mph and a surge of up to two metres.',
      '- Every ferry crossing is suspended and schools in three counties close at noon.',
      '- Winds should peak between midnight and 3am; coastal roads close from 8pm.',
      '- Sandbags are available at three depots, and volunteers will staff a helpline overnight.',
      '- The first damage assessments are due by Friday afternoon.',
    ].join('\n') },
    { match: 'titled "Portwell votes tonight', answer: [
      '- Portwell’s council votes at 7pm on a £6 daily charge for the harbour district.',
      '- The fee would raise about £14 million a year for a tram line and cheaper buses.',
      '- Traders have gathered 8,000 signatures against it.',
      '- 23 of 48 councillors back the charge and 21 oppose it.',
    ].join('\n') },
    { match: 'You write a news brief from independent news headlines', answer: [
      '- Storm Idris is due to make landfall late on Thursday; ferries are suspended and schools will close early.',
      '- The northern lights could be seen as far south as Madrid on Saturday night.',
      '- Portwell’s council votes tonight on a £6 Congestion Charge for the harbour district.',
      '- The Sandbar Wind Farm has sent its first power to the grid, ahead of schedule.',
      '- The Central Bank held rates and pointed to a cut next spring.',
      '- Castlemere Athletic reached their first cup final in 40 years.',
    ].join('\n') },
  ],
  forecast: [
    { headline: 'Portwell council approves the Congestion Charge in a close vote',
      why: 'Supporters say the £6 daily fee would pay for a new tram line, and the vote is tonight.',
      timeframe: '24h', confidence: 'medium', basis: ['Portwell votes tonight'] },
    { headline: 'Ferries stay in port until Saturday as Storm Idris makes landfall',
      why: 'Forecasters expect landfall late on Thursday, and every crossing is already suspended.',
      timeframe: '48h', confidence: 'medium', basis: ['Storm Idris'] },
    { headline: 'Aurora seen from Madrid and Lisbon on Saturday night',
      why: 'A burst of solar activity is set to push the aurora unusually far south this weekend.',
      timeframe: '3d', confidence: 'low', basis: ['Northern lights'] },
    { headline: 'Castlemere Athletic sell out their cup final allocation within a day',
      why: 'It is the club’s first final in 40 years, reached with two goals in the last eight minutes.',
      timeframe: '3d', confidence: 'low', basis: ['Castlemere'] },
    { headline: 'Tessary Energy signs a deal for a second offshore wind farm',
      why: 'Its first 60-turbine project is already sending power to the grid ahead of schedule.',
      timeframe: '7d', confidence: 'low', basis: ['Sandbar Wind Farm sends'] },
    { headline: 'Central Bank minutes show two members voted for a cut',
      why: 'Policymakers held rates but pointed to a cut next spring, and they meet again in December.',
      timeframe: '7d', confidence: 'low', basis: ['Central Bank holds rates'] },
  ],
};

// ── build ───────────────────────────────────────────────────────────────────
function article(story, { language = 'en', category } = {}) {
  const src = outlet[story.src];
  const url = storyUrl(story.src, story.slug ?? kebab(story.title));
  const [up, down, comments] = story.r ?? [0, 0, 0];
  const out = {
    id: id12(url),
    title: story.title,
    description: story.description,
    url,
    image: story.photo ? IMAGE_HOST + story.photo + '.jpg' : null,
    source: { id: src.id, name: src.name, homepage: `https://${src.host}`, country: src.country },
    category: category ?? src.category,
    publishedAt: at(story.min ?? 0),
    language,
    commentCount: comments,
    up,
    down,
    myVote: null,
  };
  return out;
}

const english = STORIES.map((s) => article(s));
const bySlug = Object.fromEntries(STORIES.filter((s) => s.slug).map((s) => [s.slug, english[STORIES.indexOf(s)]]));
const german = GERMAN.map((s) => article(s, { language: 'de' }));
const breaking = BREAKING.map((s) => article({ ...s, min: -135 / 60 })); // "arrive" 2 min 15 s after the capture
const newestFirst = (list) => [...list].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

const battles = BATTLES.map(({ topic, stories }) => {
  const articles = stories.map((s) => {
    if (s.feed) {
      const a = bySlug[s.feed];
      return { ...a, lean: outlet[a.source.id].lean };
    }
    const a = article(s, { category: 'battle' });
    delete a.commentCount; delete a.up; delete a.down; delete a.myVote;
    return { ...a, lean: outlet[s.src].lean };
  });
  const leans = { left: 0, center: 0, right: 0 };
  for (const a of articles) leans[a.lean] += 1;
  return { id: id12(articles.map((a) => a.id).sort().join(',')), topic, leans, articles };
});

const page = (articles) => ({ articles, total: articles.length, page: 1, pageSize: 100, updatedAt: CAPTURED_AT, latestId: articles[0]?.id ?? null });
const blocks = (slug) => BODIES[slug];
const body = (slug, title) => ({
  title,
  byline: null,
  text: plainText(blocks(slug)),
  blocks: blocks(slug),
  excerpt: plainText(blocks(slug)).split('\n\n')[0],
  image: null,
  siteName: new URL(bySlug[slug].url).host,
});
const comment = (c) => ({ id: c.id, name: c.name, avatar: c.avatar, authorKey: c.authorKey, body: c.body, createdAt: c.at, up: c.up, down: c.down, myVote: c.myVote, mine: Boolean(c.mine) });

const storyA = bySlug['story-a'];
const files = {
  'news-all': { request: { method: 'GET', path: '/api/news?pageSize=100' }, status: 200, body: page(newestFirst(english)) },
  'news-all-de': { request: { method: 'GET', path: '/api/news?lang=de,en&pageSize=100' }, status: 200, body: page(newestFirst([...english, ...german])) },
  'news-new-stories': { request: { method: 'GET', path: `/api/news?since=${encodeURIComponent(storyA.publishedAt)}&pageSize=100` }, status: 200, body: page(breaking) },
  sources: { request: { method: 'GET', path: '/api/sources' }, status: 200, body: {
    sources: OUTLETS.map((o) => ({ id: o.id, name: o.name, category: o.category, type: 'rss', homepage: `https://${o.host}`, country: o.country,
      enabled: true, requiresKey: false, ...(o.lean ? { lean: o.lean } : {}), ...(o.category === 'battle' ? { battle: true } : {}) })),
    categories: ['world', 'business', 'technology', 'science', 'sports', 'culture', 'health'],
    languages: ['en', 'de'],
  } },
  battles: { request: { method: 'GET', path: '/api/battles' }, status: 200, body: { battles, updatedAt: CAPTURED_AT } },
  'article-story-a': { request: { method: 'GET', path: `/api/article?url=${encodeURIComponent(storyA.url)}` }, status: 200, body: body('story-a', storyA.title) },
  'article-story-b': { request: { method: 'GET', path: `/api/article?url=${encodeURIComponent(bySlug['story-b'].url)}` }, status: 200, body: body('story-b', bySlug['story-b'].title) },
  'article-story-c-paywall': { request: { method: 'GET', path: `/api/article?url=${encodeURIComponent(bySlug['story-c'].url)}` }, status: 200, body: { ...body('story-c', 'Central bank'), excerpt: 'Subscribe to read this story.' } },
  'comment-created': { request: { method: 'POST', path: '/api/comments', author: 'amber', body: { articleId: storyA.id, body: COMMENTS[3].body } }, status: 201, body: comment(COMMENTS[3]) },
  'comments-me': { request: { method: 'GET', path: `/api/comments?article=${storyA.id}&sort=new`, author: 'amber' }, status: 200, body: {
    comments: COMMENTS.map(comment), total: COMMENTS.length, page: 1, pageSize: 20, me: { name: ME.name, avatar: ME.avatar },
  } },
};

await mkdir(path.join(OUT, 'api'), { recursive: true });
for (const [name, exchange] of Object.entries(files)) {
  await writeFile(path.join(OUT, 'api', `${name}.json`), JSON.stringify(exchange, null, 1) + '\n');
}
await writeFile(path.join(OUT, 'api', '_manifest.json'), JSON.stringify({
  capturedAt: CAPTURED_AT,
  commit: 'newsroom',
  authors: { amber: '1f0e5a2c-6b7d-4e8f-9a0b-1c2d3e4f5a6b' },
  files: Object.keys(files).sort(),
}, null, 1) + '\n');
await writeFile(path.join(OUT, 'ai.json'), JSON.stringify(AI, null, 1) + '\n');

// ── credits ─────────────────────────────────────────────────────────────────
const commonsPage = (title) => 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(title.replaceAll(' ', '_')).replaceAll('%3A', ':');
const usedBy = (key) => [...STORIES, ...GERMAN].filter((s) => s.photo === key).map((s) => s.title);
const credits = [
  '# The App Store newsroom',
  '',
  'Generated by `ios/scripts/newsroom.mjs` — edit the script, not these files. Every outlet, story,',
  'person and comment here is invented; the outlets live on reserved `.example` domains. The',
  'photographs are public domain or CC0 (Wikimedia Commons) and are downloaded on demand into',
  '`images/` (git-ignored) by `node ios/scripts/newsroom.mjs --images`.',
  '',
  `Story ids for the screenshot tests: story-a \`${storyA.id}\`, story-b \`${bySlug['story-b'].id}\`, story-c \`${bySlug['story-c'].id}\`; battles ${battles.map((b) => `\`${b.id}\` (${b.topic[0]})`).join(', ')}.`,
  '',
  '| Image | Photograph | Author | License | Used for |',
  '|---|---|---|---|---|',
  ...Object.entries(PHOTOS).map(([key, p]) => `| \`${key}.jpg\` | [${p.title.replace(/^File:/, '')}](${commonsPage(p.title)}) | ${p.author} | ${p.license} | ${usedBy(key).join('; ')} |`),
  '',
];
await writeFile(path.join(OUT, 'CREDITS.md'), credits.join('\n'));
console.log(`newsroom: ${english.length} stories (+${german.length} German, ${breaking.length} breaking), ${battles.length} battles → ${path.relative(process.cwd(), OUT)}`);
console.log(`  story-a ${storyA.id} · story-b ${bySlug['story-b'].id} · story-c ${bySlug['story-c'].id} · battles ${battles.map((b) => b.id).join(' ')}`);

// ── photographs (on demand) ─────────────────────────────────────────────────
if (process.argv.includes('--images')) {
  const UA = { 'User-Agent': 'MeridianScreenshots/1.0 (https://meridi.info/support)' };
  const dir = path.join(HOME, 'images');
  await mkdir(dir, { recursive: true });
  for (const [key, photo] of Object.entries(PHOTOS)) {
    const target = path.join(dir, `${key}.jpg`);
    if (existsSync(target)) continue;
    const params = new URLSearchParams({ action: 'query', format: 'json', titles: photo.title, prop: 'imageinfo', iiprop: 'url', iiurlwidth: '2560' });
    const info = await (await fetch('https://commons.wikimedia.org/w/api.php?' + params, { headers: UA })).json();
    const url = Object.values(info.query.pages)[0]?.imageinfo?.[0]?.thumburl;
    if (!url) throw new Error(`no such photograph: ${photo.title}`);
    const response = await fetch(url, { headers: UA });
    if (!response.ok) throw new Error(`${response.status} for ${url}`);
    const raw = target + '.download';
    await writeFile(raw, Buffer.from(await response.arrayBuffer()));
    // at most 2400 px on the long side, JPEG q80 — plenty for a 6.9" hero, a fraction of the originals
    const size = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', raw], { encoding: 'utf8' }).match(/\d+/g).map(Number);
    const resize = Math.max(...size.slice(-2)) > 2400 ? ['-Z', '2400'] : [];
    execFileSync('sips', [...resize, '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', raw, '--out', target], { stdio: 'ignore' });
    await unlink(raw);
    console.log(`  ${key}.jpg`);
    await new Promise((resolve) => setTimeout(resolve, 1000)); // gentle on Commons
  }
}
if (OUT !== HOME && !existsSync(path.join(OUT, 'images'))) {
  await symlink(path.join(HOME, 'images'), path.join(OUT, 'images'));
}
