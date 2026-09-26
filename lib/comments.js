// Anonymous comments: SQLite via the Node built-in node:sqlite (zero deps),
// with an in-memory fallback when the module is unavailable (Node < 22.13)
// so the app always works — comments just don't persist.
//
// Identity model: the client sends an opaque UUID (X-Author-Id). It is a
// capability token — NEVER returned in responses and never logged. The
// public persona (name + avatar) is derived from it deterministically, and
// so is the public `authorKey` that blocking and bans refer to.
//
// Moderation (App Store Guideline 1.2): a server-side screen refuses
// objectionable text (lib/moderation.js), readers report comments (three
// distinct reporters hide one until a moderator looks), authors delete their
// own, moderators hide/restore/delete and ban author keys through the admin
// API. Hidden comments and banned authors' comments are out of every list and
// count.

import { createHash, randomBytes } from 'node:crypto';
import * as log from './log.js';
import { screenComment } from './moderation.js';

const MAX_BODY = 1000;
const MIN_BODY = 2;
const MIN_INTERVAL_MS = 10_000;      // per author, between posts
const MAX_PER_AUTHOR_PER_ARTICLE = 30;
const MAX_PER_ARTICLE = 500;
const MAX_AGE_MS = 7 * 24 * 3600_000; // comments follow the article horizon
const REPORTS_TO_HIDE = 3;           // distinct reporters since the last moderator decision

export const REPORT_REASONS = ['spam', 'abuse', 'hate', 'sexual', 'violence', 'other'];
const AUTHOR_KEY_RE = /^[0-9a-f]{16}$/;

export class CommentError extends Error {
  constructor(status, code, message, { retryAfter } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

/* ── persona derivation ──────────────────────────────────────────────────── */

const ADJECTIVES = [
  'Amber', 'Quiet', 'Solar', 'Lunar', 'Swift', 'Bright', 'Bold', 'Calm',
  'Cosmic', 'Crimson', 'Golden', 'Hidden', 'Iron', 'Jade', 'Keen', 'Late',
  'Misty', 'Noble', 'Ochre', 'Pale', 'Rapid', 'Silent', 'Teal', 'Umber',
  'Vivid', 'Wandering', 'Zesty', 'Arctic', 'Blazing', 'Coral', 'Dusty',
  'Early', 'Frosty', 'Gentle', 'Hasty', 'Indigo', 'Jolly', 'Kindred',
  'Lively', 'Mellow', 'Nimble', 'Opal', 'Patient', 'Quartz', 'Restless',
  'Sable', 'Tidal', 'Upbeat', 'Velvet', 'Wistful', 'Young', 'Zephyr',
  'Auroral', 'Boreal', 'Candid', 'Daring', 'Eager', 'Fabled', 'Grounded',
  'Humble', 'Ivory', 'Jaunty', 'Kinetic', 'Luminous',
];
const NOUNS = [
  'Falcon', 'Meridian', 'Comet', 'Harbor', 'Cedar', 'Delta', 'Ember',
  'Fjord', 'Glacier', 'Heron', 'Isle', 'Jetty', 'Kestrel', 'Lantern',
  'Mesa', 'Nebula', 'Otter', 'Prairie', 'Quill', 'River', 'Summit',
  'Tundra', 'Umbra', 'Vale', 'Willow', 'Zenith', 'Atlas', 'Beacon',
  'Cinder', 'Dune', 'Echo', 'Flint', 'Grove', 'Horizon', 'Inlet',
  'Juniper', 'Knoll', 'Lagoon', 'Marsh', 'North', 'Orbit', 'Pine',
  'Quarry', 'Reef', 'Sparrow', 'Thicket', 'Upland', 'Voyage', 'Wharf',
  'Yonder', 'Anchor', 'Bluff', 'Crest', 'Drift', 'Eddy', 'Fathom',
  'Gale', 'Haven', 'Ibis', 'Jade', 'Karst', 'Ledge', 'Mistral', 'Nadir',
];
const GLYPH_COUNT = 24; // client renders a glyph from its own fixed set

export function personaFor(authorId) {
  const h = createHash('sha1').update(String(authorId)).digest();
  return {
    name: `${ADJECTIVES[h[0] % ADJECTIVES.length]} ${NOUNS[h[1] % NOUNS.length]}`,
    avatar: {
      hue: (h[2] * 256 + h[3]) % 360,
      glyph: h[4] % GLYPH_COUNT,
    },
  };
}

// The author's public key: 16 hex, stable, one-way. Clients block by it,
// moderators ban by it. The id behind it is a random UUID (122 bits), so the
// key can be neither reversed nor enumerated.
export function authorKeyFor(authorId) {
  return createHash('sha256').update('meridian:author-key:' + String(authorId).toLowerCase()).digest('hex').slice(0, 16);
}

/* ── storage backends ────────────────────────────────────────────────────── */

let backend = null; // see openSqlite() for the interface; openMemory() mirrors it

async function openSqlite(dbPath) {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  // Strings are SQL; functions run with the database (data migrations).
  const MIGRATIONS = [
    `CREATE TABLE comments (
       id         TEXT PRIMARY KEY,
       article_id TEXT NOT NULL,
       author_id  TEXT NOT NULL,
       body       TEXT NOT NULL,
       created_at INTEGER NOT NULL
     );
     CREATE INDEX idx_comments_article ON comments(article_id, created_at DESC);
     CREATE INDEX idx_comments_author  ON comments(author_id, created_at DESC);
     CREATE TABLE votes (
       comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
       author_id  TEXT NOT NULL,
       value      INTEGER NOT NULL CHECK (value IN (1, -1)),
       created_at INTEGER NOT NULL,
       PRIMARY KEY (comment_id, author_id)
     ) WITHOUT ROWID;`,
    `CREATE TABLE article_votes (
       article_id TEXT NOT NULL,
       author_id  TEXT NOT NULL,
       value      INTEGER NOT NULL CHECK (value IN (1, -1)),
       created_at INTEGER NOT NULL,
       PRIMARY KEY (article_id, author_id)
     ) WITHOUT ROWID;`,
    // v3 — moderation: the public author key, soft hiding, reports, bans
    `ALTER TABLE comments ADD COLUMN author_key TEXT NOT NULL DEFAULT '';
     ALTER TABLE comments ADD COLUMN hidden_at INTEGER;
     ALTER TABLE comments ADD COLUMN hidden_reason TEXT;
     ALTER TABLE comments ADD COLUMN moderated_at INTEGER;
     CREATE INDEX idx_comments_author_key ON comments(author_key);
     CREATE TABLE comment_reports (
       comment_id   TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
       reporter_key TEXT NOT NULL,
       reason       TEXT NOT NULL,
       created_at   INTEGER NOT NULL,
       PRIMARY KEY (comment_id, reporter_key)
     ) WITHOUT ROWID;
     CREATE INDEX idx_reports_created ON comment_reports(created_at DESC);
     CREATE TABLE banned_authors (
       author_key TEXT PRIMARY KEY,
       reason     TEXT,
       created_at INTEGER NOT NULL
     ) WITHOUT ROWID;`,
    // v4 — author keys for the comments written before v3
    (conn) => {
      const pending = conn.prepare(`SELECT DISTINCT author_id FROM comments WHERE author_key = ''`).all();
      const update = conn.prepare('UPDATE comments SET author_key = ? WHERE author_id = ?');
      for (const { author_id: id } of pending) update.run(authorKeyFor(id), id);
    },
  ];
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      for (let i = version; i < MIGRATIONS.length; i += 1) {
        const step = MIGRATIONS[i];
        if (typeof step === 'function') step(db);
        else db.exec(step);
      }
      db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // what readers see: not hidden, not by a banned author
  const VISIBLE = `c.hidden_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM banned_authors b WHERE b.author_key = c.author_key)`;

  const listStmt = (order) =>
    db.prepare(
      `SELECT c.id, c.body, c.author_id, c.author_key, c.created_at,
              COALESCE(SUM(v.value = 1), 0)  AS up,
              COALESCE(SUM(v.value = -1), 0) AS down,
              MAX(CASE WHEN v.author_id = :me THEN v.value END) AS my_vote
       FROM comments c
       LEFT JOIN votes v ON v.comment_id = c.id
       WHERE c.article_id = :article AND ${VISIBLE}
       GROUP BY c.id
       ORDER BY ${order}
       LIMIT :limit OFFSET :offset`
    );
  const stmts = {
    listNew: listStmt('c.created_at DESC'),
    listTop: listStmt('(up - down) DESC, c.created_at DESC'),
    countVisible: db.prepare(`SELECT COUNT(*) AS n FROM comments c WHERE c.article_id = ? AND ${VISIBLE}`),
    countArticle: db.prepare('SELECT COUNT(*) AS n FROM comments WHERE article_id = ?'),
    countAuthorArticle: db.prepare(
      'SELECT COUNT(*) AS n FROM comments WHERE article_id = ? AND author_id = ?'
    ),
    latestOfAuthor: db.prepare(
      'SELECT body, created_at FROM comments WHERE author_id = ? ORDER BY created_at DESC LIMIT 1'
    ),
    latestOfAuthorInArticle: db.prepare(
      'SELECT body FROM comments WHERE article_id = ? AND author_id = ? ORDER BY created_at DESC LIMIT 1'
    ),
    insert: db.prepare(
      'INSERT INTO comments (id, article_id, author_id, author_key, body, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ),
    hasComment: db.prepare('SELECT 1 AS x FROM comments WHERE id = ?'),
    getComment: db.prepare(
      `SELECT id, article_id, author_id, author_key, body, created_at, hidden_at, hidden_reason, moderated_at
       FROM comments WHERE id = ?`
    ),
    voteAgg: db.prepare(
      `SELECT COALESCE(SUM(value = 1), 0) AS up,
              COALESCE(SUM(value = -1), 0) AS down,
              MAX(CASE WHEN author_id = :me THEN value END) AS my_vote
       FROM votes WHERE comment_id = :id`
    ),
    upsertVote: db.prepare(
      `INSERT INTO votes (comment_id, author_id, value, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(comment_id, author_id) DO UPDATE SET value = excluded.value`
    ),
    deleteVote: db.prepare('DELETE FROM votes WHERE comment_id = ? AND author_id = ?'),
    articleVoteAgg: db.prepare(
      `SELECT COALESCE(SUM(value = 1), 0) AS up,
              COALESCE(SUM(value = -1), 0) AS down,
              MAX(CASE WHEN author_id = :me THEN value END) AS my_vote
       FROM article_votes WHERE article_id = :id`
    ),
    upsertArticleVote: db.prepare(
      `INSERT INTO article_votes (article_id, author_id, value, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(article_id, author_id) DO UPDATE
         SET value = excluded.value, created_at = excluded.created_at`
    ),
    deleteArticleVote: db.prepare(
      'DELETE FROM article_votes WHERE article_id = ? AND author_id = ?'
    ),
    addReport: db.prepare(
      `INSERT OR IGNORE INTO comment_reports (comment_id, reporter_key, reason, created_at)
       VALUES (?, ?, ?, ?)`
    ),
    countReportsSince: db.prepare(
      'SELECT COUNT(*) AS n FROM comment_reports WHERE comment_id = ? AND created_at >= ?'
    ),
    hide: db.prepare(
      'UPDATE comments SET hidden_at = ?, hidden_reason = ?, moderated_at = COALESCE(?, moderated_at) WHERE id = ?'
    ),
    restore: db.prepare(
      'UPDATE comments SET hidden_at = NULL, hidden_reason = NULL, moderated_at = ? WHERE id = ?'
    ),
    deleteComment: db.prepare('DELETE FROM comments WHERE id = ?'),
    reports: db.prepare(
      `SELECT c.id, c.article_id, c.author_key, c.body, c.created_at, c.hidden_at, c.hidden_reason,
              c.moderated_at, COUNT(r.reporter_key) AS reports, GROUP_CONCAT(DISTINCT r.reason) AS reasons,
              MAX(r.created_at) AS last_report,
              EXISTS (SELECT 1 FROM banned_authors b WHERE b.author_key = c.author_key) AS banned
       FROM comments c
       JOIN comment_reports r ON r.comment_id = c.id
       GROUP BY c.id
       ORDER BY last_report DESC
       LIMIT ?`
    ),
    isBanned: db.prepare('SELECT 1 AS x FROM banned_authors WHERE author_key = ?'),
    ban: db.prepare(
      `INSERT INTO banned_authors (author_key, reason, created_at) VALUES (?, ?, ?)
       ON CONFLICT(author_key) DO UPDATE SET reason = excluded.reason`
    ),
    getBan: db.prepare('SELECT author_key, reason, created_at FROM banned_authors WHERE author_key = ?'),
    unban: db.prepare('DELETE FROM banned_authors WHERE author_key = ?'),
    bans: db.prepare('SELECT author_key, reason, created_at FROM banned_authors ORDER BY created_at DESC'),
    prune: db.prepare('DELETE FROM comments WHERE created_at < ?'),
    pruneArticleVotes: db.prepare('DELETE FROM article_votes WHERE created_at < ?'),
  };

  // `IN (?, ?, …)` reads are keyed by list length so the batch queries
  // behind every /api/news and /api/reactions response reuse a prepared
  // statement instead of compiling a fresh one — and its native memory —
  // per request. Callers cap the list at 150 ids, so the cache stays small.
  const inListStmts = new Map();
  const inList = (name, n, sql) => {
    const key = `${name}:${n}`;
    let stmt = inListStmts.get(key);
    if (!stmt) {
      stmt = db.prepare(sql(Array.from({ length: n }, () => '?').join(',')));
      inListStmts.set(key, stmt);
    }
    return stmt;
  };

  return {
    kind: 'sqlite',
    list({ articleId, me, limit, offset, sort }) {
      const stmt = sort === 'top' ? stmts.listTop : stmts.listNew;
      return stmt.all({ article: articleId, me: me || '', limit, offset });
    },
    countVisible: (articleId) => stmts.countVisible.get(articleId).n,
    countArticle: (articleId) => stmts.countArticle.get(articleId).n,
    countAuthorArticle: (articleId, authorId) =>
      stmts.countAuthorArticle.get(articleId, authorId).n,
    latestOfAuthor: (authorId) => stmts.latestOfAuthor.get(authorId) || null,
    latestOfAuthorInArticle: (articleId, authorId) =>
      stmts.latestOfAuthorInArticle.get(articleId, authorId) || null,
    insert: (row) =>
      stmts.insert.run(row.id, row.articleId, row.authorId, row.authorKey, row.body, row.createdAt),
    hasComment: (id) => Boolean(stmts.hasComment.get(id)),
    getComment: (id) => stmts.getComment.get(id) || null,
    voteAgg: (id, me) => stmts.voteAgg.get({ id, me: me || '' }),
    upsertVote: (commentId, authorId, value) =>
      stmts.upsertVote.run(commentId, authorId, value, Date.now()),
    deleteVote: (commentId, authorId) => stmts.deleteVote.run(commentId, authorId),
    counts(articleIds) {
      if (!articleIds.length) return new Map();
      const rows = inList('counts', articleIds.length, (placeholders) =>
        `SELECT c.article_id, COUNT(*) AS n FROM comments c
         WHERE c.article_id IN (${placeholders}) AND ${VISIBLE} GROUP BY c.article_id`
      ).all(...articleIds);
      return new Map(rows.map((r) => [r.article_id, r.n]));
    },
    articleVoteCounts(articleIds, me) {
      if (!articleIds.length) return new Map();
      const rows = inList('articleVotes', articleIds.length, (placeholders) =>
        `SELECT article_id,
                COALESCE(SUM(value = 1), 0)  AS up,
                COALESCE(SUM(value = -1), 0) AS down,
                MAX(CASE WHEN author_id = ? THEN value END) AS my_vote
         FROM article_votes
         WHERE article_id IN (${placeholders}) GROUP BY article_id`
      ).all(me || '', ...articleIds);
      return new Map(rows.map((r) => [r.article_id, r]));
    },
    articleVoteAgg: (id, me) => stmts.articleVoteAgg.get({ id, me: me || '' }),
    upsertArticleVote: (articleId, authorId, value) =>
      stmts.upsertArticleVote.run(articleId, authorId, value, Date.now()),
    deleteArticleVote: (articleId, authorId) =>
      stmts.deleteArticleVote.run(articleId, authorId),
    addReport: (commentId, reporterKey, reason, at) =>
      Number(stmts.addReport.run(commentId, reporterKey, reason, at).changes) > 0,
    countReportsSince: (commentId, since) => stmts.countReportsSince.get(commentId, since).n,
    hide: (commentId, reason, at, moderatedAt = null) => stmts.hide.run(at, reason, moderatedAt, commentId),
    restore: (commentId, at) => stmts.restore.run(at, commentId),
    deleteComment: (commentId) => stmts.deleteComment.run(commentId),
    reports: (limit) => stmts.reports.all(limit),
    isBanned: (authorKey) => Boolean(stmts.isBanned.get(authorKey)),
    ban: (authorKey, reason, at) => {
      stmts.ban.run(authorKey, reason, at);
      return stmts.getBan.get(authorKey);
    },
    unban: (authorKey) => Number(stmts.unban.run(authorKey).changes) > 0,
    bans: () => stmts.bans.all(),
    prune(before) {
      stmts.prune.run(before);
      stmts.pruneArticleVotes.run(before);
    },
  };
}

// Same interface on plain Maps — non-persistent, used when node:sqlite is
// unavailable. Keeps the feature alive on older Node versions.
function openMemory() {
  const comments = new Map();     // id → row
  const votes = new Map();        // commentId → Map(authorId → value)
  const articleVotes = new Map(); // articleId → Map(authorId → { value, at })
  const reports = new Map();      // commentId → Map(reporterKey → { reason, at })
  const banned = new Map();       // authorKey → { reason, at }
  const visible = (c) => c.hiddenAt == null && !banned.has(c.authorKey);
  const agg = (id, me) => {
    const vs = votes.get(id) || new Map();
    let up = 0;
    let down = 0;
    for (const v of vs.values()) (v === 1 ? (up += 1) : (down += 1));
    return { up, down, my_vote: vs.has(me) ? vs.get(me) : null };
  };
  const removeComment = (id) => {
    comments.delete(id);
    votes.delete(id);
    reports.delete(id);
  };
  const banRow = (key) => ({ author_key: key, reason: banned.get(key).reason, created_at: banned.get(key).at });
  return {
    kind: 'memory',
    list({ articleId, me, limit, offset, sort }) {
      let rows = [...comments.values()].filter((c) => c.articleId === articleId && visible(c));
      rows = rows.map((c) => ({
        id: c.id, body: c.body, author_id: c.authorId, author_key: c.authorKey, created_at: c.createdAt,
        ...agg(c.id, me),
      }));
      rows.sort(
        sort === 'top'
          ? (a, b) => b.up - b.down - (a.up - a.down) || b.created_at - a.created_at
          : (a, b) => b.created_at - a.created_at
      );
      return rows.slice(offset, offset + limit);
    },
    countVisible: (articleId) =>
      [...comments.values()].filter((c) => c.articleId === articleId && visible(c)).length,
    countArticle: (articleId) =>
      [...comments.values()].filter((c) => c.articleId === articleId).length,
    countAuthorArticle: (articleId, authorId) =>
      [...comments.values()].filter(
        (c) => c.articleId === articleId && c.authorId === authorId
      ).length,
    latestOfAuthor(authorId) {
      let latest = null;
      for (const c of comments.values()) {
        if (c.authorId === authorId && (!latest || c.createdAt > latest.created_at)) {
          latest = { body: c.body, created_at: c.createdAt };
        }
      }
      return latest;
    },
    latestOfAuthorInArticle(articleId, authorId) {
      let latest = null;
      let latestAt = -1;
      for (const c of comments.values()) {
        if (c.articleId === articleId && c.authorId === authorId && c.createdAt > latestAt) {
          latest = { body: c.body };
          latestAt = c.createdAt;
        }
      }
      return latest;
    },
    insert: (row) => comments.set(row.id, { ...row, hiddenAt: null, hiddenReason: null, moderatedAt: null }),
    hasComment: (id) => comments.has(id),
    getComment(id) {
      const c = comments.get(id);
      return c
        ? {
            id: c.id, article_id: c.articleId, author_id: c.authorId, author_key: c.authorKey, body: c.body,
            created_at: c.createdAt, hidden_at: c.hiddenAt, hidden_reason: c.hiddenReason, moderated_at: c.moderatedAt,
          }
        : null;
    },
    voteAgg: (id, me) => agg(id, me),
    upsertVote(commentId, authorId, value) {
      if (!votes.has(commentId)) votes.set(commentId, new Map());
      votes.get(commentId).set(authorId, value);
    },
    deleteVote: (commentId, authorId) => votes.get(commentId)?.delete(authorId),
    counts(articleIds) {
      const out = new Map(articleIds.map((id) => [id, 0]));
      for (const c of comments.values()) {
        if (out.has(c.articleId) && visible(c)) out.set(c.articleId, out.get(c.articleId) + 1);
      }
      return out;
    },
    articleVoteCounts(articleIds, me) {
      const out = new Map();
      for (const id of articleIds) {
        const vs = articleVotes.get(id);
        if (!vs || !vs.size) continue;
        let up = 0;
        let down = 0;
        for (const v of vs.values()) (v.value === 1 ? (up += 1) : (down += 1));
        out.set(id, { up, down, my_vote: vs.get(me)?.value ?? null });
      }
      return out;
    },
    articleVoteAgg(id, me) {
      return this.articleVoteCounts([id], me).get(id) || { up: 0, down: 0, my_vote: null };
    },
    upsertArticleVote(articleId, authorId, value) {
      if (!articleVotes.has(articleId)) articleVotes.set(articleId, new Map());
      articleVotes.get(articleId).set(authorId, { value, at: Date.now() });
    },
    deleteArticleVote: (articleId, authorId) => articleVotes.get(articleId)?.delete(authorId),
    addReport(commentId, reporterKey, reason, at) {
      if (!reports.has(commentId)) reports.set(commentId, new Map());
      const byReporter = reports.get(commentId);
      if (byReporter.has(reporterKey)) return false;
      byReporter.set(reporterKey, { reason, at });
      return true;
    },
    countReportsSince(commentId, since) {
      let n = 0;
      for (const r of (reports.get(commentId) || new Map()).values()) if (r.at >= since) n += 1;
      return n;
    },
    hide(commentId, reason, at, moderatedAt = null) {
      const c = comments.get(commentId);
      if (!c) return;
      c.hiddenAt = at;
      c.hiddenReason = reason;
      if (moderatedAt != null) c.moderatedAt = moderatedAt;
    },
    restore(commentId, at) {
      const c = comments.get(commentId);
      if (!c) return;
      c.hiddenAt = null;
      c.hiddenReason = null;
      c.moderatedAt = at;
    },
    deleteComment: (commentId) => removeComment(commentId),
    reports(limit) {
      const rows = [];
      for (const [commentId, byReporter] of reports) {
        const c = comments.get(commentId);
        if (!c || !byReporter.size) continue;
        const entries = [...byReporter.values()];
        rows.push({
          id: c.id, article_id: c.articleId, author_key: c.authorKey, body: c.body, created_at: c.createdAt,
          hidden_at: c.hiddenAt, hidden_reason: c.hiddenReason, moderated_at: c.moderatedAt,
          reports: entries.length,
          reasons: [...new Set(entries.map((e) => e.reason))].join(','),
          last_report: Math.max(...entries.map((e) => e.at)),
          banned: banned.has(c.authorKey) ? 1 : 0,
        });
      }
      return rows.sort((a, b) => b.last_report - a.last_report).slice(0, limit);
    },
    isBanned: (authorKey) => banned.has(authorKey),
    ban(authorKey, reason, at) {
      const existing = banned.get(authorKey);
      banned.set(authorKey, { reason, at: existing?.at ?? at });
      return banRow(authorKey);
    },
    unban: (authorKey) => banned.delete(authorKey),
    bans: () => [...banned.keys()].map(banRow).sort((a, b) => b.created_at - a.created_at),
    prune(before) {
      for (const [id, c] of comments) {
        if (c.createdAt < before) removeComment(id);
      }
      for (const [articleId, vs] of articleVotes) {
        for (const [author, v] of vs) if (v.at < before) vs.delete(author);
        if (!vs.size) articleVotes.delete(articleId);
      }
    },
  };
}

/* ── public API ──────────────────────────────────────────────────────────── */

// `memory: true` forces the in-memory backend (tests of both backends).
export async function initComments({ dbPath = './data/comments.db', memory = false } = {}) {
  try {
    if (memory) throw new Error('in-memory backend requested');
    backend = await openSqlite(dbPath);
    const persistent = dbPath.startsWith('/');
    log.info('comments storage ready', {
      backend: 'sqlite',
      path: dbPath,
      durability: persistent ? 'persistent volume' : 'container disk — mount a volume for durability',
    });
  } catch (err) {
    backend = openMemory();
    if (!memory) {
      log.warn('node:sqlite unavailable, comments will NOT persist', {
        backend: 'memory', ...log.errorFields(err),
      });
    }
  }

  const sweep = setInterval(() => {
    try {
      backend.prune(Date.now() - MAX_AGE_MS);
    } catch (err) {
      log.warn('comments prune failed', log.errorFields(err));
    }
  }, 3600_000);
  sweep.unref();

  return { kind: backend.kind };
}

// `me` marks the requester's own comments (`mine`: the client offers Delete).
function toPublic(row, me = null) {
  const persona = personaFor(row.author_id);
  return {
    id: row.id,
    name: persona.name,
    avatar: persona.avatar,
    authorKey: row.author_key || authorKeyFor(row.author_id),
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
    up: row.up,
    down: row.down,
    myVote: row.my_vote === 1 || row.my_vote === -1 ? row.my_vote : null,
    mine: Boolean(me) && row.author_id === me,
  };
}

function requireBackend() {
  if (!backend) throw new CommentError(503, 'comments-unavailable', 'Comments are starting up, try again');
}

export function listComments({ articleId, page = 1, pageSize = 20, sort = 'new', authorId = null }) {
  requireBackend();
  const size = Math.min(Math.max(1, Math.trunc(Number(pageSize)) || 20), 50);
  const p = Math.max(1, Math.trunc(Number(page)) || 1);
  const rows = backend.list({
    articleId,
    me: authorId,
    limit: size,
    offset: (p - 1) * size,
    sort: sort === 'top' ? 'top' : 'new',
  });
  return {
    comments: rows.map((row) => toPublic(row, authorId)),
    total: backend.countVisible(articleId),
    page: p,
    pageSize: size,
    me: authorId ? personaFor(authorId) : null,
  };
}

// Normalize untrusted comment text: strip control chars (keep \n), collapse
// blank-line runs, trim.
export function normalizeBody(raw) {
  return String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function addComment({ articleId, authorId, body }) {
  requireBackend();
  const authorKey = authorKeyFor(authorId);
  if (backend.isBanned(authorKey)) {
    throw new CommentError(403, 'banned', 'You can no longer comment on Meridian');
  }
  const clean = normalizeBody(body);
  if (clean.length < MIN_BODY || clean.length > MAX_BODY) {
    throw new CommentError(400, 'bad-body', `Comment must be ${MIN_BODY}-${MAX_BODY} characters`);
  }
  if (!screenComment(clean).ok) {
    throw new CommentError(422, 'objectionable', 'This comment breaks the community rules');
  }
  const latest = backend.latestOfAuthor(authorId);
  const sinceLatest = latest ? Date.now() - latest.created_at : Infinity;
  if (sinceLatest < MIN_INTERVAL_MS) {
    throw new CommentError(429, 'too-fast', 'Please wait a few seconds between comments', {
      retryAfter: Math.ceil((MIN_INTERVAL_MS - sinceLatest) / 1000),
    });
  }
  if (backend.countArticle(articleId) >= MAX_PER_ARTICLE) {
    throw new CommentError(409, 'comments-full', 'This story has reached its comment limit');
  }
  if (backend.countAuthorArticle(articleId, authorId) >= MAX_PER_AUTHOR_PER_ARTICLE) {
    throw new CommentError(429, 'article-limit', 'You have reached the comment limit for this story', {
      retryAfter: 3600,
    });
  }
  const dup = backend.latestOfAuthorInArticle(articleId, authorId);
  if (dup && dup.body === clean) {
    throw new CommentError(409, 'duplicate', 'You already posted exactly this');
  }

  const row = {
    id: randomBytes(8).toString('hex'),
    articleId,
    authorId,
    authorKey,
    body: clean,
    createdAt: Date.now(),
  };
  backend.insert(row);
  return toPublic({
    id: row.id,
    author_id: authorId,
    author_key: authorKey,
    body: clean,
    created_at: row.createdAt,
    up: 0,
    down: 0,
    my_vote: null,
  }, authorId);
}

export function setVote({ commentId, authorId, value }) {
  requireBackend();
  if (!backend.hasComment(commentId)) return null;
  if (value === 0) backend.deleteVote(commentId, authorId);
  else backend.upsertVote(commentId, authorId, value);
  const agg = backend.voteAgg(commentId, authorId);
  return {
    up: agg.up,
    down: agg.down,
    myVote: agg.my_vote === 1 || agg.my_vote === -1 ? agg.my_vote : null,
  };
}

// A reader flags a comment. One report per reader per comment (repeats are
// idempotent); the third distinct reporter since the last moderator decision
// hides it. → null for an unknown comment, else { reports, hidden,
// newlyHidden, added, comment } for the route and the moderation webhook.
export function reportComment({ commentId, authorId, reason }) {
  requireBackend();
  const why = reason === undefined || reason === null || reason === '' ? 'other' : reason;
  if (!REPORT_REASONS.includes(why)) {
    throw new CommentError(400, 'bad-reason', `"reason" must be one of: ${REPORT_REASONS.join(', ')}`);
  }
  const comment = backend.getComment(commentId);
  if (!comment) return null;
  if (comment.author_id === authorId) {
    throw new CommentError(400, 'own-comment', 'You cannot report your own comment');
  }
  const now = Date.now();
  const added = backend.addReport(commentId, authorKeyFor(authorId), why, now);
  const reports = backend.countReportsSince(commentId, comment.moderated_at ?? 0);
  let hidden = comment.hidden_at != null;
  let newlyHidden = false;
  if (!hidden && reports >= REPORTS_TO_HIDE) {
    backend.hide(commentId, 'reports', now);
    hidden = true;
    newlyHidden = true;
  }
  return {
    reports,
    hidden,
    newlyHidden,
    added,
    reason: why,
    comment: {
      id: comment.id,
      articleId: comment.article_id,
      authorKey: comment.author_key || authorKeyFor(comment.author_id),
      body: comment.body,
    },
  };
}

// The author removes their own comment (votes and reports go with it).
// → null for an unknown comment, true once deleted.
export function deleteOwnComment({ commentId, authorId }) {
  requireBackend();
  const comment = backend.getComment(commentId);
  if (!comment) return null;
  if (comment.author_id !== authorId) {
    throw new CommentError(403, 'not-owner', 'Only its author can delete a comment');
  }
  backend.deleteComment(commentId);
  return true;
}

export function commentCounts(articleIds) {
  if (!backend) return new Map();
  return backend.counts(articleIds);
}

export function setArticleVote({ articleId, authorId, value }) {
  requireBackend();
  if (value === 0) backend.deleteArticleVote(articleId, authorId);
  else backend.upsertArticleVote(articleId, authorId, value);
  const agg = backend.articleVoteAgg(articleId, authorId);
  return {
    up: agg.up,
    down: agg.down,
    myVote: agg.my_vote === 1 || agg.my_vote === -1 ? agg.my_vote : null,
  };
}

// Batch reactions for a set of articles: comment count + article votes.
// myVote is present only when the caller identified itself.
export function reactionCounts(articleIds, authorId = null) {
  if (!backend) return new Map();
  const comments = backend.counts(articleIds);
  const votes = backend.articleVoteCounts(articleIds, authorId);
  const out = new Map();
  for (const id of articleIds) {
    const v = votes.get(id);
    out.set(id, {
      comments: comments.get(id) || 0,
      up: v?.up || 0,
      down: v?.down || 0,
      myVote: authorId && (v?.my_vote === 1 || v?.my_vote === -1) ? v.my_vote : null,
    });
  }
  return out;
}

/* ── moderation (admin API) ──────────────────────────────────────────────── */

const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

// Reported comments, most recently reported first.
export function listReports({ limit = 50 } = {}) {
  requireBackend();
  const n = Math.min(Math.max(1, Math.trunc(Number(limit)) || 50), 200);
  return backend.reports(n).map((r) => ({
    id: r.id,
    articleId: r.article_id,
    authorKey: r.author_key,
    body: r.body,
    createdAt: iso(r.created_at),
    reports: r.reports,
    reasons: String(r.reasons || '').split(',').filter(Boolean),
    lastReportAt: iso(r.last_report),
    hidden: r.hidden_at != null,
    hiddenReason: r.hidden_reason ?? null,
    moderatedAt: iso(r.moderated_at),
    banned: Boolean(r.banned),
  }));
}

// → null for an unknown comment.
export function hideComment({ commentId, reason = 'moderator' }) {
  requireBackend();
  if (!backend.getComment(commentId)) return null;
  const now = Date.now();
  backend.hide(commentId, String(reason).slice(0, 100) || 'moderator', now, now);
  return { id: commentId, hidden: true };
}

// A moderator keeps the comment: visible again, and only reports made after
// this decision count towards hiding it again.
export function restoreComment({ commentId }) {
  requireBackend();
  if (!backend.getComment(commentId)) return null;
  backend.restore(commentId, Date.now());
  return { id: commentId, hidden: false };
}

export function removeComment({ commentId }) {
  requireBackend();
  if (!backend.getComment(commentId)) return null;
  backend.deleteComment(commentId);
  return { id: commentId, deleted: true };
}

function requireAuthorKey(authorKey) {
  if (typeof authorKey !== 'string' || !AUTHOR_KEY_RE.test(authorKey)) {
    throw new CommentError(400, 'bad-author-key', '"authorKey" must be 16 hex characters');
  }
}

const publicBan = (row) => ({ authorKey: row.author_key, reason: row.reason ?? null, createdAt: iso(row.created_at) });

// A banned author can no longer post, and their comments leave every list.
export function banAuthor({ authorKey, reason = null }) {
  requireBackend();
  requireAuthorKey(authorKey);
  return publicBan(backend.ban(authorKey, reason == null ? null : String(reason).slice(0, 200), Date.now()));
}

export function unbanAuthor({ authorKey }) {
  requireBackend();
  requireAuthorKey(authorKey);
  return backend.unban(authorKey);
}

export function listBans() {
  requireBackend();
  return backend.bans().map(publicBan);
}
