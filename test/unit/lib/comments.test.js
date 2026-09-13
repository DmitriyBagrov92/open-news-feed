import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  initComments, personaFor, normalizeBody, addComment, listComments, setVote, setArticleVote, reactionCounts, CommentError,
} from '../../../lib/comments.js';

const me = '123e4567-e89b-12d3-a456-426614174000';
const other = '223e4567-e89b-12d3-a456-426614174000';
const third = '323e4567-e89b-12d3-a456-426614174000';

before(async () => {
  const { kind } = await initComments({ dbPath: ':memory:' });
  assert.equal(kind, 'sqlite');
});

test('personaFor is deterministic and never leaks the id', () => {
  const p = personaFor(me);
  assert.deepEqual(p, personaFor(me));
  assert.match(p.name, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
  assert.ok(p.avatar.hue >= 0 && p.avatar.hue < 360 && p.avatar.glyph < 24);
  assert.ok(!JSON.stringify(p).includes(me));
});

test('normalizeBody strips control characters and collapses blank runs', () => {
  const raw = '  hi  there' + '\n'.repeat(4) + 'yo  ';
  assert.equal(normalizeBody(raw), 'hi  there\n\nyo');
});

test('comments: post, list, vote, limits and reaction counts', () => {
  const A = 'aaaaaaaaaaaa';
  const c1 = addComment({ articleId: A, authorId: me, body: 'first comment' });
  const c2 = addComment({ articleId: A, authorId: other, body: 'second comment' });
  assert.throws(() => addComment({ articleId: A, authorId: me, body: 'too fast' }), (e) => e instanceof CommentError && e.code === 'too-fast');
  assert.throws(() => addComment({ articleId: A, authorId: third, body: 'x' }), (e) => e.code === 'bad-body');
  assert.deepEqual(setVote({ commentId: c1.id, authorId: other, value: 1 }), { up: 1, down: 0, myVote: 1 });
  assert.equal(setVote({ commentId: '0000000000000000', authorId: other, value: 1 }), null);
  const top = listComments({ articleId: A, authorId: me, sort: 'top' });
  assert.equal(top.total, 2);
  assert.equal(top.comments[0].id, c1.id);
  assert.equal(top.me.name, personaFor(me).name);
  assert.ok(!('author_id' in top.comments[0]) && !JSON.stringify(top).includes(other));
  assert.deepEqual(setArticleVote({ articleId: A, authorId: me, value: -1 }), { up: 0, down: 1, myVote: -1 });
  const counts = reactionCounts([A, 'bbbbbbbbbbbb'], me);
  assert.deepEqual(counts.get(A), { comments: 2, up: 0, down: 1, myVote: -1 });
  assert.deepEqual(counts.get('bbbbbbbbbbbb'), { comments: 0, up: 0, down: 0, myVote: null });
  assert.equal(c2.name, personaFor(other).name);
});
