#!/usr/bin/env node
// Command-line client of the moderation API (docs/ARCHITECTURE.md › Moderation).
//
//   ADMIN_TOKEN=… node scripts/moderate.mjs <command> [args]
//
//   reports [limit]            reported comments, most recently reported first
//   hide <commentId> [reason]  hide a comment from everyone
//   restore <commentId>        show it again (only newer reports count towards hiding it again)
//   delete <commentId>         delete a comment for good
//   bans                       banned author keys
//   ban <authorKey> [reason]   stop an author from commenting; their comments leave every list
//   unban <authorKey>
//
// MERIDIAN_URL picks the server (default http://localhost:3000; e.g. https://meridi.info).

const BASE = (process.env.MERIDIAN_URL || 'http://localhost:3000').replace(/\/+$/, '');
const TOKEN = process.env.ADMIN_TOKEN || '';
const [command, ...args] = process.argv.slice(2);

function usage(message) {
  if (message) console.error(message + '\n');
  console.error('usage: ADMIN_TOKEN=… node scripts/moderate.mjs reports [limit] | hide <id> [reason] | restore <id>');
  console.error('                                             | delete <id> | bans | ban <authorKey> [reason] | unban <authorKey>');
  process.exit(2);
}

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // "fetch failed" alone says nothing: the cause names the refused connection, bad port, TLS…
    throw new Error(`${method} ${BASE}${path}: ${err.cause?.message || err.message}`);
  }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = payload?.error?.code || res.status;
    const hint = res.status === 404 && code === 'not-found' ? ' — is ADMIN_TOKEN set on the server?' : '';
    throw new Error(`${method} ${path}: ${code} ${payload?.error?.message || ''}${hint}`.trim());
  }
  return payload;
}

function printReports(reports) {
  if (!reports.length) {
    console.log('No reported comments.');
    return;
  }
  for (const r of reports) {
    const state = [r.hidden ? `HIDDEN (${r.hiddenReason})` : 'visible', r.banned ? 'author BANNED' : null].filter(Boolean).join(', ');
    console.log(`${r.id}  ${r.reports} report(s): ${r.reasons.join(', ')}  last ${r.lastReportAt}  ${state}`);
    console.log(`  story ${r.articleId} · author ${r.authorKey} · posted ${r.createdAt}`);
    console.log('  ' + r.body.replace(/\n/g, '\n  '));
    console.log();
  }
}

const needs = (value, what) => value || usage(`missing ${what}`);

try {
  if (!TOKEN) usage('ADMIN_TOKEN is not set');
  switch (command) {
    case 'reports':
      printReports((await call('GET', `/api/admin/reports?limit=${Number(args[0]) || 50}`)).reports);
      break;
    case 'hide':
      console.log(await call('POST', `/api/admin/comments/${needs(args[0], 'comment id')}/hide`, { reason: args.slice(1).join(' ') || 'moderator' }));
      break;
    case 'restore':
      console.log(await call('POST', `/api/admin/comments/${needs(args[0], 'comment id')}/restore`, {}));
      break;
    case 'delete':
      console.log(await call('DELETE', `/api/admin/comments/${needs(args[0], 'comment id')}`));
      break;
    case 'bans': {
      const { bans } = await call('GET', '/api/admin/bans');
      if (!bans.length) console.log('No bans.');
      for (const b of bans) console.log(`${b.authorKey}  since ${b.createdAt}  ${b.reason || ''}`);
      break;
    }
    case 'ban':
      console.log(await call('POST', '/api/admin/bans', { authorKey: needs(args[0], 'author key'), reason: args.slice(1).join(' ') || null }));
      break;
    case 'unban':
      console.log(await call('DELETE', `/api/admin/bans/${needs(args[0], 'author key')}`));
      break;
    default:
      usage(command ? `unknown command "${command}"` : undefined);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
