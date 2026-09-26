// Moderation notifications: when MODERATION_WEBHOOK_URL is set, every report
// of a comment is POSTed there as JSON — Slack- and Discord-compatible
// (`text` / `content`) plus the structured `event`. Fire-and-forget: a slow
// or failing webhook never delays or fails the reader's request; failures
// are logged, never retried.

import * as log from './log.js';

const TIMEOUT_MS = 5000;
const EXCERPT = 280;

export function describeReport(event) {
  const excerpt = event.body.length > EXCERPT ? event.body.slice(0, EXCERPT - 1) + '…' : event.body;
  const state = event.newlyHidden ? ' — now hidden' : event.hidden ? ' (already hidden)' : '';
  return (
    `Meridian: comment ${event.commentId} on story ${event.articleId} reported as ${event.reason} ` +
    `(${event.reports} report${event.reports === 1 ? '' : 's'})${state}. Author key ${event.authorKey}.\n` +
    `> ${excerpt.replace(/\n/g, '\n> ')}`
  );
}

export function notifyModeration(event, { fetchImpl = globalThis.fetch } = {}) {
  const url = process.env.MODERATION_WEBHOOK_URL;
  if (!url) return null;
  const text = describeReport(event);
  return fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, content: text, event: { type: 'comment.reported', ...event } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
    .then((res) => {
      if (!res.ok) log.warn('moderation webhook refused', { status: res.status });
    })
    .catch((err) => log.warn('moderation webhook failed', log.errorFields(err)));
}
