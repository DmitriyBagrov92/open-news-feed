// The moderation contract, run against both storage backends (SQLite and the
// in-memory fallback must behave the same), plus the v2 → v4 migration.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  initComments, addComment, listComments, reactionCounts, reportComment, deleteOwnComment, setVote,
  authorKeyFor, personaFor, listReports, hideComment, restoreComment, removeComment,
  banAuthor, unbanAuthor, listBans, CommentError,
} from '../../../lib/comments.js';

const uuid = (n) => `${String(n).padStart(8, '0')}-e89b-12d3-a456-426614174000`;
const [writer, r1, r2, r3, r4] = [1, 2, 3, 4, 5].map(uuid);
// every post gets a fresh author: one author may post only every 10 s
let authorSeq = 100;
const poster = () => uuid((authorSeq += 1));
let articleSeq = 0;
const nextArticle = () => (articleSeq += 1).toString(16).padStart(12, '0');
const code = (expected) => (err) => err instanceof CommentError && err.code === expected;

for (const kind of ['sqlite', 'memory']) {
  describe(`moderation on the ${kind} backend`, () => {
    before(async () => {
      const opened = await initComments({ dbPath: ':memory:', memory: kind === 'memory' });
      assert.equal(opened.kind, kind);
    });

    test('comments carry the public author key and mark the reader’s own', () => {
      const A = nextArticle();
      const author = poster();
      const c = addComment({ articleId: A, authorId: author, body: 'A measured first take' });
      assert.equal(c.authorKey, authorKeyFor(author));
      assert.match(c.authorKey, /^[0-9a-f]{16}$/);
      assert.equal(c.mine, true);
      const asOther = listComments({ articleId: A, authorId: r1 });
      assert.equal(asOther.comments[0].mine, false);
      assert.equal(asOther.comments[0].authorKey, c.authorKey);
      assert.ok(!JSON.stringify(asOther).includes(author), 'the id never leaves the server');
      assert.equal(listComments({ articleId: A }).comments[0].mine, false);
    });

    test('objectionable text is refused before it is stored', () => {
      const A = nextArticle();
      assert.throws(() => addComment({ articleId: A, authorId: poster(), body: 'kys, loser' }), code('objectionable'));
      assert.equal(listComments({ articleId: A }).total, 0);
    });

    test('reports: one per reader, never your own, three readers hide the comment everywhere', () => {
      const A = nextArticle();
      const author = poster();
      const c = addComment({ articleId: A, authorId: author, body: 'Buy cheap watches now' });
      assert.throws(() => reportComment({ commentId: c.id, authorId: author, reason: 'spam' }), code('own-comment'));
      assert.throws(() => reportComment({ commentId: c.id, authorId: r1, reason: 'boring' }), code('bad-reason'));
      assert.equal(reportComment({ commentId: '0'.repeat(16), authorId: r1 }), null);

      const first = reportComment({ commentId: c.id, authorId: r1, reason: 'spam' });
      assert.deepEqual([first.added, first.reports, first.hidden], [true, 1, false]);
      const again = reportComment({ commentId: c.id, authorId: r1, reason: 'spam' });
      assert.deepEqual([again.added, again.reports], [false, 1], 'a repeat is idempotent');
      reportComment({ commentId: c.id, authorId: r2 }); // reason defaults to "other"
      const third = reportComment({ commentId: c.id, authorId: r3, reason: 'abuse' });
      assert.deepEqual([third.reports, third.hidden, third.newlyHidden], [3, true, true]);

      const list = listComments({ articleId: A, authorId: author });
      assert.equal(list.total, 0, 'hidden from everyone, its author included');
      assert.equal(reactionCounts([A]).get(A).comments, 0);
      const [queued] = listReports().filter((r) => r.id === c.id);
      assert.equal(queued.reports, 3);
      assert.deepEqual([...queued.reasons].sort(), ['abuse', 'other', 'spam']);
      assert.equal(queued.hidden, true);
      assert.equal(queued.hiddenReason, 'reports');
      assert.equal(queued.authorKey, authorKeyFor(author));
    });

    test('a moderator restores a comment; only newer reports count towards hiding it again', async () => {
      const A = nextArticle();
      const c = addComment({ articleId: A, authorId: poster(), body: 'Unpopular but fair point' });
      for (const reader of [r1, r2, r4]) reportComment({ commentId: c.id, authorId: reader });
      assert.equal(listComments({ articleId: A }).total, 0);
      await new Promise((resolve) => setTimeout(resolve, 2)); // the decision is later than the reports
      assert.deepEqual(restoreComment({ commentId: c.id }), { id: c.id, hidden: false });
      assert.equal(listComments({ articleId: A }).total, 1);
      const repeat = reportComment({ commentId: c.id, authorId: r1 });
      assert.deepEqual([repeat.added, repeat.hidden], [false, false], 'earlier reporters cannot re-hide it');
      const fresh = reportComment({ commentId: c.id, authorId: writer });
      assert.deepEqual([fresh.reports, fresh.hidden], [1, false]);
      assert.equal(restoreComment({ commentId: '0'.repeat(16) }), null);
    });

    test('moderators hide and delete; authors delete only their own', () => {
      const A = nextArticle();
      const author = poster();
      const mine = addComment({ articleId: A, authorId: author, body: 'Second thoughts on this' });
      assert.throws(() => deleteOwnComment({ commentId: mine.id, authorId: r1 }), code('not-owner'));
      setVote({ commentId: mine.id, authorId: r1, value: 1 });
      assert.equal(deleteOwnComment({ commentId: mine.id, authorId: author }), true);
      assert.equal(deleteOwnComment({ commentId: mine.id, authorId: author }), null, 'gone, with its votes');
      assert.equal(setVote({ commentId: mine.id, authorId: r1, value: 1 }), null);

      const other = addComment({ articleId: A, authorId: poster(), body: 'Something borderline here' });
      assert.deepEqual(hideComment({ commentId: other.id, reason: 'off-topic' }), { id: other.id, hidden: true });
      assert.equal(listComments({ articleId: A }).total, 0);
      assert.deepEqual(removeComment({ commentId: other.id }), { id: other.id, deleted: true });
      assert.equal(removeComment({ commentId: other.id }), null);
      assert.equal(hideComment({ commentId: other.id }), null);
    });

    test('a banned author cannot post and their comments leave every list until unbanned', () => {
      const A = nextArticle();
      const troll = poster();
      const calm = poster();
      addComment({ articleId: A, authorId: troll, body: 'First, the usual noise' });
      addComment({ articleId: A, authorId: calm, body: 'A calm reply' });
      const key = authorKeyFor(troll);
      assert.throws(() => banAuthor({ authorKey: 'not-a-key' }), code('bad-author-key'));
      const ban = banAuthor({ authorKey: key, reason: 'harassment' });
      assert.deepEqual([ban.authorKey, ban.reason], [key, 'harassment']);
      assert.ok(listBans().some((b) => b.authorKey === key));
      assert.throws(() => addComment({ articleId: A, authorId: troll, body: 'Let me back in' }), code('banned'));
      const list = listComments({ articleId: A });
      assert.equal(list.total, 1);
      assert.deepEqual(list.comments.map((c) => c.name), [personaFor(calm).name]);
      assert.equal(reactionCounts([A]).get(A).comments, 1);
      assert.equal(unbanAuthor({ authorKey: key }), true);
      assert.equal(unbanAuthor({ authorKey: key }), false);
      assert.equal(listComments({ articleId: A }).total, 2);
    });

    test('too fast says when to try again', () => {
      const A = nextArticle();
      const hasty = poster();
      addComment({ articleId: A, authorId: hasty, body: 'One thing' });
      assert.throws(
        () => addComment({ articleId: A, authorId: hasty, body: 'Another thing' }),
        (err) => err.code === 'too-fast' && err.retryAfter >= 1 && err.retryAfter <= 10
      );
    });
  });
}

describe('migrating a v2 database', () => {
  test('author keys are backfilled and the old comments stay readable', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const dir = mkdtempSync(path.join(tmpdir(), 'meridian-comments-'));
    const file = path.join(dir, 'comments.db');
    try {
      const old = new DatabaseSync(file);
      old.exec(`CREATE TABLE comments (id TEXT PRIMARY KEY, article_id TEXT NOT NULL, author_id TEXT NOT NULL,
                  body TEXT NOT NULL, created_at INTEGER NOT NULL);
                CREATE TABLE votes (comment_id TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
                  author_id TEXT NOT NULL, value INTEGER NOT NULL, created_at INTEGER NOT NULL,
                  PRIMARY KEY (comment_id, author_id)) WITHOUT ROWID;
                CREATE TABLE article_votes (article_id TEXT NOT NULL, author_id TEXT NOT NULL, value INTEGER NOT NULL,
                  created_at INTEGER NOT NULL, PRIMARY KEY (article_id, author_id)) WITHOUT ROWID;
                PRAGMA user_version = 2;`);
      old.prepare('INSERT INTO comments VALUES (?, ?, ?, ?, ?)').run('ab'.repeat(8), 'c'.repeat(12), writer, 'From before v3', Date.now());
      old.close();

      await initComments({ dbPath: file });
      const list = listComments({ articleId: 'c'.repeat(12), authorId: writer });
      assert.equal(list.total, 1);
      assert.equal(list.comments[0].authorKey, authorKeyFor(writer));
      assert.equal(list.comments[0].mine, true);
      const check = new DatabaseSync(file);
      assert.equal(check.prepare('PRAGMA user_version').get().user_version, 4);
      assert.equal(check.prepare('SELECT author_key FROM comments').get().author_key, authorKeyFor(writer));
      check.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
