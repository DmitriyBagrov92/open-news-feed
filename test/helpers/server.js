// Boots the app in-process against the fixture feed on an ephemeral port.
// The environment must be set before server.js / lib/store.js are first
// imported, so this module owns both steps: import it before anything else.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.env.FEED_FIXTURE ??= path.join(ROOT, 'test/fixtures/feed.json');
process.env.COMMENTS_DB ??= ':memory:';
process.env.USAGE_LOG_MINUTES ??= '0';
process.env.LOG_SILENT ??= '1';
process.env.NODE_ENV ??= 'production';
process.env.PUBLIC_URL ??= 'https://test.meridi.info';
process.env.INDEXNOW_KEY ??= 'testkey0123456789';

const [{ app, boot }, store] = await Promise.all([import('../../server.js'), import('../../lib/store.js')]);

export { app, store };

export async function startServer() {
  await boot({ listen: false });
  for (let i = 0; i < 200 && !store.stats().updatedAt; i += 1) await new Promise((r) => setTimeout(r, 10));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}
