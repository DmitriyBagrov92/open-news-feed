import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../../../lib/store.js';
import { escapeHtml, headlinesHtml, renderIndex, robotsTxt, sitemapXml, configuredOrigin, publicOrigin } from '../../../lib/page.js';

before(async () => { await store.seedFixture(new URL('../../fixtures/feed.json', import.meta.url).pathname); });

test('escapeHtml neutralises markup', () => {
  assert.equal(escapeHtml(`<a href="x">Tom & Jerry's</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
});

test('renderIndex fills every placeholder and renders 30 escaped headlines', () => {
  const html = renderIndex('https://example.org');
  assert.ok(!/__PUBLIC_URL__|__SSR_HEADLINES__|__SITE_VERIFICATION__/.test(html));
  assert.ok(html.includes('<link rel="canonical" href="https://example.org/">'));
  assert.equal((html.match(/<li>/g) || []).length, 30);
  const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(ld)['@graph'].length, 3);
});

test('verification tags come from env and reject junk', () => {
  process.env.GOOGLE_SITE_VERIFICATION = 'AbC123_xyz-QWERTY';
  process.env.BING_SITE_VERIFICATION = '"><script>';
  const html = renderIndex('https://example.org');
  assert.ok(html.includes('<meta name="google-site-verification" content="AbC123_xyz-QWERTY">'));
  assert.ok(!html.includes('msvalidate'));
  delete process.env.GOOGLE_SITE_VERIFICATION;
  delete process.env.BING_SITE_VERIFICATION;
});

test('origins: PUBLIC_URL wins, then Railway, then the request', () => {
  const req = { protocol: 'https', get: () => 'req.example' };
  delete process.env.PUBLIC_URL;
  delete process.env.RAILWAY_PUBLIC_DOMAIN;
  assert.equal(configuredOrigin(), null);
  assert.equal(publicOrigin(req), 'https://req.example');
  process.env.RAILWAY_PUBLIC_DOMAIN = 'app.up.railway.app';
  assert.equal(publicOrigin(req), 'https://app.up.railway.app');
  process.env.PUBLIC_URL = 'https://meridi.info/';
  assert.equal(publicOrigin(req), 'https://meridi.info');
  delete process.env.PUBLIC_URL;
  delete process.env.RAILWAY_PUBLIC_DOMAIN;
});

test('robots and sitemap carry the origin and last refresh', () => {
  assert.ok(robotsTxt('https://x.org').includes('Sitemap: https://x.org/sitemap.xml'));
  assert.ok(robotsTxt('https://x.org').includes('User-agent: GPTBot'));
  const xml = sitemapXml('https://x.org');
  assert.ok(xml.includes('<loc>https://x.org/</loc>'));
  assert.ok(xml.includes(`<lastmod>${store.stats().updatedAt}</lastmod>`));
  assert.ok(headlinesHtml().includes('ssr-list'));
});
