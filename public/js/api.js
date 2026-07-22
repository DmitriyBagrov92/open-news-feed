// Thin client for the Meridian HTTP API (docs/ARCHITECTURE.md).
// Every failure is normalized to ApiError { status, code, message }.

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status; // HTTP status; 0 for network failures
    this.code = code;     // machine code, e.g. 'premium-only', 'network'
  }
}

function qs(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === '') continue;
    search.set(key, String(value));
  }
  const str = search.toString();
  return str ? '?' + str : '';
}

async function request(path, options) {
  let res;
  try {
    res = await fetch(path, options);
  } catch {
    throw new ApiError(0, 'network', 'Network request failed');
  }
  if (!res.ok) {
    let code = 'http-' + res.status;
    let message = res.statusText || 'Request failed';
    try {
      const body = await res.json();
      if (body?.error) {
        code = body.error.code || code;
        message = body.error.message || message;
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, message);
  }
  try {
    return await res.json();
  } catch {
    throw new ApiError(res.status, 'bad-json', 'Invalid JSON response');
  }
}

function post(path, body, headers = {}) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

export const api = {
  // ── anonymous comments (X-Author-Id is the opaque identity token) ──────
  comments(articleId, { page, pageSize, sort, authorId } = {}) {
    return request('/api/comments' + qs({ article: articleId, page, pageSize, sort }), {
      headers: authorId ? { 'X-Author-Id': authorId } : {},
    });
  },

  postComment(articleId, body, authorId) {
    return post('/api/comments', { articleId, body }, { 'X-Author-Id': authorId });
  },

  voteComment(commentId, value, authorId) {
    return post(`/api/comments/${commentId}/vote`, { value }, { 'X-Author-Id': authorId });
  },

  // params: { category, q, sources, exclude, page, pageSize, lang, since }
  // authorId (optional) lights up per-user myVote on the returned articles.
  news(params, authorId) {
    return request('/api/news' + qs(params), {
      headers: authorId ? { 'X-Author-Id': authorId } : {},
    });
  },

  // Batch live counters (comments + likes/dislikes) for visible articles.
  reactions(articleIds, authorId) {
    return request('/api/reactions' + qs({ articles: articleIds.join(',') }), {
      headers: authorId ? { 'X-Author-Id': authorId } : {},
    });
  },

  voteNews(articleId, value, authorId) {
    return post(`/api/news/${articleId}/vote`, { value }, { 'X-Author-Id': authorId });
  },

  sources() {
    return request('/api/sources');
  },

  // Bubble Battle: viewpoint clusters — { battles, updatedAt }
  battles() {
    return request('/api/battles');
  },

  article(url) {
    return request('/api/article' + qs({ url }));
  },

  // body: { mode:'brief', articles, targetLang } | { mode:'article', title, text, targetLang }
  summarize(body) {
    return post('/api/summarize', body);
  },

  // texts: string[] (≤ 20, each ≤ 1000 chars) → { translations, provider }
  translate(texts, target, source = 'en') {
    return post('/api/translate', { texts, target, source });
  },
};
