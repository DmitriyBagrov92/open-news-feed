// /privacy, /terms and /support: plain server-rendered pages. The App Store
// needs a privacy policy and a support URL, and Guideline 1.2 needs terms that
// make clear objectionable content and abusive users are not tolerated — the
// apps link here (the iOS comment rules gate included). SUPPORT_EMAIL is the
// contact address; without it the pages say support is not configured yet.

const UPDATED = 'September 26, 2026';

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function supportEmail() {
  const email = (process.env.SUPPORT_EMAIL || '').trim();
  return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email) ? email : null;
}

function contact() {
  const email = supportEmail();
  return email
    ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`
    : '<em>the support address (not configured yet)</em>';
}

const PAGES = {
  privacy: {
    title: 'Privacy Policy',
    body: () => `
<p>Meridian is a news reader. It has no accounts, no advertising and no third-party analytics or tracking,
and it never sells or shares data for advertising. This policy covers the website and the Meridian apps.</p>

<h2>On your device</h2>
<p>Your preferences (language, categories, saved stories, blocked commenters) stay on your device. When you
first comment or vote, the app creates a random <strong>anonymous ID</strong> and keeps it on your device
(browser storage on the web, the Keychain on iOS). It is not linked to your name, e-mail, device or Apple ID.
Summaries, forecasts and translations use on-device intelligence where your device offers it
(Apple Intelligence and Apple Translation on iOS, the browser's built-in AI on the web) — that text never
leaves your device.</p>

<h2>What our server stores</h2>
<ul>
  <li><strong>Comments</strong> — the text, the time, the story, and the anonymous ID it was posted with.
    Others see only a generated nickname and avatar derived from the ID, never the ID itself.</li>
  <li><strong>Votes</strong> on stories and comments, with the anonymous ID (one vote each).</li>
  <li><strong>Reports</strong> of comments — the reason, the time, and a one-way hash of the reporter's ID.</li>
  <li><strong>Commenting bans</strong> — a one-way key derived from the banned anonymous ID.</li>
</ul>
<p>Comments, votes and reports are deleted automatically after <strong>7 days</strong>, together with the
stories they belong to. You can delete your own comments at any time.</p>

<h2>What our server does not keep</h2>
<p>IP addresses are held in memory for up to a minute to limit abuse and are never written to disk. Usage
statistics count unique visitors from IP addresses hashed with a random value that changes on every
restart; only the counts are logged.</p>

<h2>Services that see some data</h2>
<ul>
  <li><strong>Hosting</strong> — the server runs on Railway, which processes requests to deliver them.</li>
  <li><strong>Translation fallback</strong> — when your device cannot translate a story, its text (never your
    ID) is sent to a translation service (MyMemory by Translated, or a LibreTranslate server).</li>
  <li><strong>Publishers</strong> — story images load directly from the publishers' servers, and "Source"
    opens the publisher's site; their privacy policies apply there. To show a story's full text, our server
    fetches the publisher's page on your behalf.</li>
</ul>

<h2>Children</h2>
<p>Meridian is not directed to children under 13 and does not knowingly collect their data.</p>

<h2>Your choices</h2>
<p>Delete your comments from the comment menu. Reset your anonymous ID in the app's settings (on the web,
clear this site's data) — older comments then stay anonymous and expire within 7 days. For anything else,
write to ${contact()}.</p>`,
  },

  terms: {
    title: 'Terms of Use and Community Rules',
    body: () => `
<p>By using Meridian you agree to these terms. Posting a comment means you accept the community rules below.</p>

<h2>Community rules</h2>
<p>Meridian has <strong>zero tolerance for objectionable content and abusive users</strong>. Do not post:</p>
<ul>
  <li>hate speech, slurs or attacks on people for who they are;</li>
  <li>harassment, threats, or encouragement of violence or self-harm;</li>
  <li>sexual content;</li>
  <li>spam, advertising or repeated posts;</li>
  <li>illegal content, or personal information about anyone;</li>
  <li>impersonation of other people or organisations.</li>
</ul>

<h2>Moderation</h2>
<ul>
  <li>An automatic filter refuses some objectionable comments before they are posted.</li>
  <li>Anyone can report a comment. A comment reported by three readers is hidden until it is reviewed.</li>
  <li>Reports are reviewed within <strong>24 hours</strong>. Comments that break the rules are removed and
    their authors are banned from commenting.</li>
  <li>You can block a commenter: their comments disappear from your device. You can delete your own comments.</li>
</ul>

<h2>Your comments</h2>
<p>You are responsible for what you post. You allow Meridian to show your comments to other readers inside the
service. Comments are deleted automatically after 7 days.</p>

<h2>The news</h2>
<p>Headlines, excerpts and images come from the publishers' public feeds and belong to them; Meridian links to
the original articles. Summaries, forecasts and translations are generated automatically and can be wrong —
forecasts are speculation, not facts or advice.</p>

<h2>No warranty</h2>
<p>Meridian is provided as is, without warranties. To the extent the law allows, its operator is not liable for
damages arising from its use or from content posted by others or published by third parties.</p>

<h2>Changes</h2>
<p>These terms may change; the date above shows the latest version. Questions: ${contact()}.</p>`,
  },

  support: {
    title: 'Support',
    body: () => `
<p>Write to ${contact()}. Reports of comments are reviewed within 24 hours.</p>

<h2>Comments</h2>
<ul>
  <li><strong>Report a comment</strong> — open its menu (⋯, or a long press on iPhone and iPad) and choose
    Report. It disappears for you at once; three reports hide it for everyone until review.</li>
  <li><strong>Block a commenter</strong> — choose Block in the same menu. Unblock them in Settings.</li>
  <li><strong>Delete your comment</strong> — choose Delete in the menu of your own comment.</li>
  <li><strong>Start over</strong> — Settings › Reset anonymous identity gives you a new nickname.</li>
</ul>

<h2>Reading</h2>
<ul>
  <li>Some publishers do not allow their full text to be shown; the story then links to the source.</li>
  <li>Summaries, forecasts and translations run on your device when it supports them, and fall back to
    simpler methods otherwise.</li>
</ul>`,
  },
};

export const LEGAL_PAGES = Object.keys(PAGES);

export function renderLegal(page, origin) {
  const entry = PAGES[page];
  if (!entry) return null;
  const nav = LEGAL_PAGES.map((key) =>
    key === page ? `<span>${PAGES[key].title.split(' ')[0]}</span>` : `<a href="/${key}">${PAGES[key].title.split(' ')[0]}</a>`
  ).join(' · ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${entry.title} — Meridian</title>
<link rel="canonical" href="${escapeHtml(origin)}/${page}">
<meta name="color-scheme" content="light dark">
<style>
  :root { --bg: #fbfbfd; --fg: #1d1d1f; --muted: #6e6e73; --rule: #d2d2d7; --tint: #0066cc; }
  @media (prefers-color-scheme: dark) { :root { --bg: #000; --fg: #f5f5f7; --muted: #a1a1a6; --rule: #38383a; --tint: #2997ff; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 17px/1.55 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif; }
  main { max-width: 680px; margin: 0 auto; padding: 32px 20px 64px; }
  header a { color: var(--fg); font-weight: 800; letter-spacing: -0.02em; text-decoration: none; font-size: 20px; }
  h1 { font-size: 34px; line-height: 1.1; letter-spacing: -0.03em; margin: 28px 0 6px; }
  h2 { font-size: 20px; letter-spacing: -0.01em; margin: 32px 0 8px; }
  .updated { color: var(--muted); font-size: 14px; margin: 0 0 24px; }
  a { color: var(--tint); }
  li { margin: 6px 0; }
  footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--rule); color: var(--muted); font-size: 14px; }
  footer span { color: var(--fg); }
</style>
</head>
<body>
<main>
<header><a href="/">Meridian</a></header>
<h1>${entry.title}</h1>
<p class="updated">Updated ${UPDATED}</p>
${entry.body().trim()}
<footer>${nav}</footer>
</main>
</body>
</html>
`;
}
