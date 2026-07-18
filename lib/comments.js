// Anonymous comments: SQLite via the Node built-in node:sqlite (zero deps),
// with an in-memory fallback when the module is unavailable (Node < 22.13)
// so the app always works — comments just don't persist.
//
// Identity model: the client sends an opaque UUID (X-Author-Id). It is a
// capability token — NEVER returned in responses and never logged. The
// public persona (name + avatar) is derived from it deterministically.

import { createHash, randomBytes } from 'node:crypto';

const MAX_BODY = 1000;
const MIN_BODY = 2;
const MIN_INTERVAL_MS = 10_000;      // per author, between posts
const MAX_PER_AUTHOR_PER_ARTICLE = 30;
const MAX_PER_ARTICLE = 500;
const MAX_AGE_MS = 7 * 24 * 3600_000; // comments follow the article horizon

export class CommentError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
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

/* ── storage backends ────────────────────────────────────────────────────── */

let backend = null; // { kind, list, insert, latestOfAuthor, countArticle, countAuthorArticle, getVoteAgg, upsertVote, deleteVote, hasComment, counts, prune }

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
  ];
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      for (let i = version; i < MIGRATIONS.length; i += 1) db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  const listStmt = (order) =>
    db.prepare(
      `SELECT c.id, c.body, c.author_id, c.created_at,
              COALESCE(SUM(v.value = 1), 0)  AS up,
              COALESCE(SUM(v.value = -1), 0) AS down,
              MAX(CASE WHEN v.author_id = :me THEN v.value END) AS my_vote
       FROM comments c
       LEFT JOIN votes v ON v.comment_id = c.id
       WHERE c.article_id = :article
       GROUP BY c.id
       ORDER BY ${order}
       LIMIT :limit OFFSET :offset`
    );
  const stmts = {
    listNew: listStmt('c.created_at DESC'),
    listTop: listStmt('(up - down) DESC, c.created_at DESC'),
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
      'INSERT INTO comments (id, article_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)'
    ),
    hasComment: db.prepare('SELECT 1 AS x FROM comments WHERE id = ?'),
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
    prune: db.prepare('DELETE FROM comments WHERE created_at < ?'),
  };

  return {
    kind: 'sqlite',
    list({ articleId, me, limit, offset, sort }) {
      const stmt = sort === 'top' ? stmts.listTop : stmts.listNew;
      return stmt.all({ article: articleId, me: me || '', limit, offset });
    },
    countArticle: (articleId) => stmts.countArticle.get(articleId).n,
    countAuthorArticle: (articleId, authorId) =>
      stmts.countAuthorArticle.get(articleId, authorId).n,
    latestOfAuthor: (authorId) => stmts.latestOfAuthor.get(authorId) || null,
    latestOfAuthorInArticle: (articleId, authorId) =>
      stmts.latestOfAuthorInArticle.get(articleId, authorId) || null,
    insert: (row) =>
      stmts.insert.run(row.id, row.articleId, row.authorId, row.body, row.createdAt),
    hasComment: (id) => Boolean(stmts.hasComment.get(id)),
    voteAgg: (id, me) => stmts.voteAgg.get({ id, me: me || '' }),
    upsertVote: (commentId, authorId, value) =>
      stmts.upsertVote.run(commentId, authorId, value, Date.now()),
    deleteVote: (commentId, authorId) => stmts.deleteVote.run(commentId, authorId),
    counts(articleIds) {
      if (!articleIds.length) return new Map();
      const placeholders = articleIds.map(() => '?').join(',');
      const rows = db
        .prepare(
          `SELECT article_id, COUNT(*) AS n FROM comments
           WHERE article_id IN (${placeholders}) GROUP BY article_id`
        )
        .all(...articleIds);
      return new Map(rows.map((r) => [r.article_id, r.n]));
    },
    prune: (before) => stmts.prune.run(before),
  };
}

// Same interface on plain Maps — non-persistent, used when node:sqlite is
// unavailable. Keeps the feature alive on older Node versions.
function openMemory() {
  const comments = new Map(); // id → row
  const votes = new Map();    // commentId → Map(authorId → value)
  const byArticle = () => {
    const m = new Map();
    for (const c of comments.values()) {
      if (!m.has(c.articleId)) m.set(c.articleId, []);
      m.get(c.articleId).push(c);
    }
    return m;
  };
  const agg = (id, me) => {
    const vs = votes.get(id) || new Map();
    let up = 0;
    let down = 0;
    for (const v of vs.values()) (v === 1 ? (up += 1) : (down += 1));
    return { up, down, my_vote: vs.has(me) ? vs.get(me) : null };
  };
  return {
    kind: 'memory',
    list({ articleId, me, limit, offset, sort }) {
      let rows = [...comments.values()].filter((c) => c.articleId === articleId);
      rows = rows.map((c) => ({
        id: c.id, body: c.body, author_id: c.authorId, created_at: c.createdAt,
        ...agg(c.id, me),
      }));
      rows.sort(
        sort === 'top'
          ? (a, b) => b.up - b.down - (a.up - a.down) || b.created_at - a.created_at
          : (a, b) => b.created_at - a.created_at
      );
      return rows.slice(offset, offset + limit);
    },
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
    insert: (row) => comments.set(row.id, row),
    hasComment: (id) => comments.has(id),
    voteAgg: (id, me) => agg(id, me),
    upsertVote(commentId, authorId, value) {
      if (!votes.has(commentId)) votes.set(commentId, new Map());
      votes.get(commentId).set(authorId, value);
    },
    deleteVote: (commentId, authorId) => votes.get(commentId)?.delete(authorId),
    counts(articleIds) {
      const per = byArticle();
      return new Map(articleIds.map((id) => [id, (per.get(id) || []).length]));
    },
    prune(before) {
      for (const [id, c] of comments) {
        if (c.createdAt < before) {
          comments.delete(id);
          votes.delete(id);
        }
      }
    },
  };
}

/* ── public API ──────────────────────────────────────────────────────────── */

export async function initComments({ dbPath = './data/comments.db' } = {}) {
  try {
    backend = await openSqlite(dbPath);
    const persistent = dbPath.startsWith('/');
    console.log(
      `[comments] sqlite at ${dbPath} ${persistent ? '(persistent)' : '(container disk — mount a volume for durability)'}`
    );
  } catch (err) {
    backend = openMemory();
    console.warn(
      `[comments] node:sqlite unavailable (${err.message}); using in-memory fallback — comments will NOT persist`
    );
  }

  const sweep = setInterval(() => {
    try {
      backend.prune(Date.now() - MAX_AGE_MS);
    } catch (err) {
      console.warn(`[comments] prune failed: ${err.message}`);
    }
  }, 3600_000);
  sweep.unref();

  return { kind: backend.kind };
}

function toPublic(row) {
  const persona = personaFor(row.author_id);
  return {
    id: row.id,
    name: persona.name,
    avatar: persona.avatar,
    body: row.body,
    createdAt: new Date(row.created_at).toISOString(),
    up: row.up,
    down: row.down,
    myVote: row.my_vote === 1 || row.my_vote === -1 ? row.my_vote : null,
  };
}

export function listComments({ articleId, page = 1, pageSize = 20, sort = 'new', authorId = null }) {
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
    comments: rows.map(toPublic),
    total: backend.countArticle(articleId),
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
  const clean = normalizeBody(body);
  if (clean.length < MIN_BODY || clean.length > MAX_BODY) {
    throw new CommentError(400, 'bad-body', `Comment must be ${MIN_BODY}-${MAX_BODY} characters`);
  }
  const latest = backend.latestOfAuthor(authorId);
  if (latest && Date.now() - latest.created_at < MIN_INTERVAL_MS) {
    throw new CommentError(429, 'too-fast', 'Please wait a few seconds between comments');
  }
  if (backend.countArticle(articleId) >= MAX_PER_ARTICLE) {
    throw new CommentError(409, 'comments-full', 'This story has reached its comment limit');
  }
  if (backend.countAuthorArticle(articleId, authorId) >= MAX_PER_AUTHOR_PER_ARTICLE) {
    throw new CommentError(429, 'article-limit', 'You have reached the comment limit for this story');
  }
  const dup = backend.latestOfAuthorInArticle(articleId, authorId);
  if (dup && dup.body === clean) {
    throw new CommentError(409, 'duplicate', 'You already posted exactly this');
  }

  const row = {
    id: randomBytes(8).toString('hex'),
    articleId,
    authorId,
    body: clean,
    createdAt: Date.now(),
  };
  backend.insert(row);
  return toPublic({
    id: row.id,
    author_id: authorId,
    body: clean,
    created_at: row.createdAt,
    up: 0,
    down: 0,
    my_vote: null,
  });
}

export function setVote({ commentId, authorId, value }) {
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

export function commentCounts(articleIds) {
  if (!backend) return new Map();
  return backend.counts(articleIds);
}
