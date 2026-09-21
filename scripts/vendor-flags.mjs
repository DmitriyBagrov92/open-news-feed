// Copies the country flags the source registry needs from the circle-flags
// package (MIT) into public/flags/, plus its licence. Only the codes that
// config/sources.js actually uses are shipped — run this after adding a
// source from a new country:
//
//   npm run vendor:flags
import { copyFile, mkdir, readdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RSS_SOURCES, API_SOURCES } from '../config/sources.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FROM = path.join(ROOT, 'node_modules', 'circle-flags');
const OUT = path.join(ROOT, 'public', 'flags');

const codes = [
  ...new Set(
    [...Object.values(RSS_SOURCES).flat(), ...API_SOURCES]
      .map((s) => s.country)
      .filter(Boolean)
      .map((c) => c.toLowerCase())
  ),
].sort();

await mkdir(OUT, { recursive: true });
for (const file of await readdir(OUT)) {
  if (file.endsWith('.svg') && !codes.includes(file.slice(0, -4))) await rm(path.join(OUT, file));
}
for (const code of codes) {
  await copyFile(path.join(FROM, 'flags', `${code}.svg`), path.join(OUT, `${code}.svg`));
}
const licence = await readFile(path.join(FROM, 'LICENSE.md'), 'utf8');
await writeFile(
  path.join(OUT, 'LICENSE.md'),
  `Flags in this directory come from circle-flags (https://github.com/HatScripts/circle-flags).\n\n${licence}`
);
console.log(`vendored ${codes.length} flags: ${codes.join(' ')}`);
