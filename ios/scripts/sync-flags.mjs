#!/usr/bin/env node
// Copies the web's vendored round flags (public/flags/<cc>.svg — circle-flags, MIT, only the codes
// the source registry uses; see `npm run vendor:flags`) into the DesignSystem asset catalog as
// vector image sets named `flag-<cc>`, so the iOS byline shows the same flags offline.
//
//   node ios/scripts/sync-flags.mjs           write ios/Modules/DesignSystem/Resources/Flags.xcassets
//   node ios/scripts/sync-flags.mjs --check   exit 1 when the catalog is out of date

import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SRC = path.join(ROOT, 'public', 'flags');
const OUT = path.join(ROOT, 'ios', 'Modules', 'DesignSystem', 'Resources', 'Flags.xcassets');
const CHECK = process.argv.includes('--check');

const codes = (await readdir(SRC)).filter((f) => /^[a-z]{2}\.svg$/.test(f)).map((f) => f.slice(0, 2)).sort();
const files = new Map();
files.set('Contents.json', JSON.stringify({ info: { author: 'xcode', version: 1 } }, null, 2) + '\n');
for (const cc of codes) {
  files.set(`flag-${cc}.imageset/${cc}.svg`, await readFile(path.join(SRC, `${cc}.svg`), 'utf8'));
  files.set(
    `flag-${cc}.imageset/Contents.json`,
    JSON.stringify(
      {
        images: [{ filename: `${cc}.svg`, idiom: 'universal' }],
        info: { author: 'xcode', version: 1 },
        properties: { 'preserves-vector-representation': true },
      },
      null,
      2
    ) + '\n'
  );
}

if (CHECK) {
  let stale = 0;
  for (const [rel, content] of files) {
    const current = await readFile(path.join(OUT, rel), 'utf8').catch(() => null);
    if (current !== content) stale += 1;
  }
  const present = (await readdir(OUT).catch(() => [])).filter((d) => d.endsWith('.imageset')).length;
  if (stale || present !== codes.length) {
    console.error('Flags.xcassets is stale — run node ios/scripts/sync-flags.mjs');
    process.exit(1);
  }
  console.log(`flags up to date (${codes.length})`);
} else {
  await rm(OUT, { recursive: true, force: true });
  for (const [rel, content] of files) {
    await mkdir(path.dirname(path.join(OUT, rel)), { recursive: true });
    await writeFile(path.join(OUT, rel), content);
  }
  console.log(`wrote ${codes.length} flags into ${path.relative(ROOT, OUT)}: ${codes.join(' ')}`);
}
