// Server-rendered entry page and crawler files. Search engines and AI
// assistants (GPTBot, ClaudeBot, PerplexityBot …) do not run the app's
// JavaScript, so the raw HTML must already say what Meridian is and carry
// real content: the latest headlines are rendered into the page, and the
// origin-dependent tags (canonical, Open Graph, JSON-LD, sitemap) are filled
// from PUBLIC_URL / the Railway domain / the request host.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, '../public/index.html');
// Production reads the template once; development re-reads it per render
// so `npm run dev` picks up index.html edits (--watch only tracks modules).
const DEV = process.env.NODE_ENV !== 'production';
const TEMPLATE = readFileSync(TEMPLATE_PATH, 'utf8');
const template = () => (DEV ? readFileSync(TEMPLATE_PATH, 'utf8') : TEMPLATE);
const SSR_HEADLINES = 30;
const ORIGIN_RE = /^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/;

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

// The origin the deployment knows itself by, without a request to look at:
// PUBLIC_URL wins, Railway's domain variable next, else null.
export function configuredOrigin() {
  const configured = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  if (ORIGIN_RE.test(configured)) return configured;
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN;
  if (railway && ORIGIN_RE.test(`https://${railway}`)) return `https://${railway}`;
  return null;
}

// Where the site is reachable, for absolute URLs in tags crawlers read:
// the configured origin, else what the client used (behind Railway's proxy
// req.protocol honours X-Forwarded-Proto).
export function publicOrigin(req) {
  const configured = configuredOrigin();
  if (configured) return configured;
  const fromRequest = `${req.protocol}://${req.get('host')}`;
  return ORIGIN_RE.test(fromRequest) ? fromRequest : 'http://localhost';
}

const stamp = (iso) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

// Search-engine ownership proofs, from env so a deployment verifies itself
// without an HTML edit: Google Search Console → google-site-verification,
// Bing Webmaster Tools → msvalidate.01. Tokens are opaque base64/hex.
const VERIFICATION_TAGS = [
  ['GOOGLE_SITE_VERIFICATION', 'google-site-verification'],
  ['BING_SITE_VERIFICATION', 'msvalidate.01'],
];
const TOKEN_RE = /^[A-Za-z0-9_=-]{8,128}$/;

function verificationHtml() {
  const tags = [];
  for (const [envKey, name] of VERIFICATION_TAGS) {
    const token = (process.env[envKey] || '').trim();
    if (TOKEN_RE.test(token)) tags.push(`<meta name="${name}" content="${token}">`);
  }
  return tags.join('\n  ');
}

function headlinesHtml() {
  const { articles, updatedAt } = store.query({ pageSize: SSR_HEADLINES });
  if (!articles.length) return '';
  const items = articles.map((a) => `
        <li>
          <a href="${escapeHtml(a.url)}" rel="noopener">${escapeHtml(a.title)}</a>
          <span class="ssr-meta">${escapeHtml(a.source.name)} · <time datetime="${a.publishedAt}">${stamp(a.publishedAt)}</time></span>${
            a.description ? `\n          <p>${escapeHtml(a.description)}</p>` : ''}
        </li>`);
  return `
      <h2 class="ssr-title">Latest headlines</h2>
      <p class="ssr-meta">Updated <time datetime="${updatedAt}">${stamp(updatedAt)}</time> · freshest first · links open the original article</p>
      <ol class="ssr-list">${items.join('')}
      </ol>`;
}

// Rendered once per (origin, store refresh); every request in between is a
// string send. Replacement callbacks keep `$` in content literal.
let cache = { key: null, html: '' };

export function renderIndex(origin) {
  const key = `${origin}|${store.stats().updatedAt}`;
  if (DEV || cache.key !== key) {
    const headlines = headlinesHtml();
    cache = {
      key,
      html: template()
        .replaceAll('__PUBLIC_URL__', () => origin)
        .replaceAll('__SITE_VERIFICATION__', verificationHtml)
        .replace('__SSR_HEADLINES__', () => headlines),
    };
  }
  return cache.html;
}

export function robotsTxt(origin) {
  return `# Meridian — open-source world news feed. The page is for everyone;
# the JSON API exists for the app itself and for AI assistants (see /llms.txt).
User-agent: *
Allow: /
Disallow: /api/

# AI assistants and answer engines are welcome, including the feed JSON.
User-agent: GPTBot
User-agent: ChatGPT-User
User-agent: OAI-SearchBot
User-agent: ClaudeBot
User-agent: Claude-User
User-agent: Claude-SearchBot
User-agent: anthropic-ai
User-agent: PerplexityBot
User-agent: Perplexity-User
User-agent: Google-Extended
User-agent: Applebot
User-agent: Applebot-Extended
User-agent: Bingbot
User-agent: DuckAssistBot
User-agent: Amazonbot
User-agent: meta-externalagent
User-agent: CCBot
Allow: /
Allow: /api/news
Allow: /api/sources
Allow: /api/battles
Disallow: /api/

Sitemap: ${origin}/sitemap.xml
`;
}

export function sitemapXml(origin) {
  const lastmod = store.stats().updatedAt || new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${origin}/</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
}
