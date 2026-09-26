#!/usr/bin/env node
// Generates the iOS String Catalog from the web's English table, so both clients
// speak the same copy under the same keys (public/js/i18n.js `t(key)` ⇄ Swift `L10n.t(key)`).
//
//   node ios/scripts/sync-strings.mjs           write ios/Modules/CoreModels/Resources/Localizable.xcstrings
//   node ios/scripts/sync-strings.mjs --check   exit 1 when the catalog is stale
//
// iOS-only strings (moderation, Settings explainers, …) live in
// ios/Modules/CoreModels/Strings/strings-ios.json and must not reuse a web key.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CATALOG = path.join(ROOT, 'ios/Modules/CoreModels/Resources/Localizable.xcstrings');
const IOS_ONLY = path.join(ROOT, 'ios/Modules/CoreModels/Strings/strings-ios.json');
const CHECK = process.argv.includes('--check');

const { installClientShims } = await import(pathToFileURL(path.join(ROOT, 'test/helpers/client-shims.js')).href);
installClientShims();
const { STRINGS_EN } = await import(pathToFileURL(path.join(ROOT, 'public/js/i18n.js')).href);
const iosOnly = JSON.parse(await readFile(IOS_ONLY, 'utf8').catch(() => '{}'));

const clash = Object.keys(iosOnly).filter((k) => k in STRINGS_EN);
if (clash.length) {
  console.error(`strings-ios.json redefines web keys: ${clash.join(', ')}`);
  process.exit(1);
}

const all = { ...STRINGS_EN, ...iosOnly };
const strings = {};
for (const key of Object.keys(all).sort()) {
  strings[key] = {
    extractionState: 'manual',
    localizations: { en: { stringUnit: { state: 'translated', value: all[key] } } },
  };
}

// Xcode's own layout (2 spaces, " : ", sorted keys) so opening the catalog in Xcode is not a diff.
function xcode(value, indent = '') {
  const inner = indent + '  ';
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return '[\n' + value.map((v) => inner + xcode(v, inner)).join(',\n') + '\n' + indent + ']';
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    if (!keys.length) return '{\n\n' + indent + '}';
    return '{\n' + keys.map((k) => `${inner}${JSON.stringify(k)} : ${xcode(value[k], inner)}`).join(',\n') + '\n' + indent + '}';
  }
  return JSON.stringify(value);
}

const next = xcode({ sourceLanguage: 'en', strings, version: '1.0' }) + '\n';
if (CHECK) {
  const current = await readFile(CATALOG, 'utf8').catch(() => null);
  if (current !== next) {
    console.error('Localizable.xcstrings is stale — run node ios/scripts/sync-strings.mjs');
    process.exit(1);
  }
  console.log(`string catalog up to date (${Object.keys(strings).length} keys)`);
} else {
  await mkdir(path.dirname(CATALOG), { recursive: true });
  await writeFile(CATALOG, next);
  console.log(`wrote ${path.relative(ROOT, CATALOG)} (${Object.keys(STRINGS_EN).length} web + ${Object.keys(iosOnly).length} iOS keys)`);
}
