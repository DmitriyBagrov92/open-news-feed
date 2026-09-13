// End-to-end suite: the real server in fixture mode (deterministic feed,
// no network), driven in Chromium on three profiles — a desktop window, an
// iPhone-class touch viewport and a reduced-motion desktop — so every
// feature is exercised the way a reader meets it.
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 40_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.02 },
  },
  snapshotPathTemplate: '{testDir}/__snapshots__/{testFileName}/{arg}-{projectName}{ext}',
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  webServer: {
    command: 'node --disable-warning=ExperimentalWarning server.js',
    url: `${BASE}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      FEED_FIXTURE: 'test/fixtures/feed.json',
      COMMENTS_DB: ':memory:',
      USAGE_LOG_MINUTES: '0',
      LOG_SILENT: '1',
      RATE_LIMIT_DISABLED: '1',
      NODE_ENV: 'production',
      PUBLIC_URL: BASE,
    },
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /new-stories/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, colorScheme: 'dark' },
    },
    {
      name: 'mobile',
      testIgnore: /new-stories/,
      use: { ...devices['iPhone 13'], browserName: 'chromium', colorScheme: 'dark' },
    },
    {
      name: 'reduced-motion',
      testIgnore: /new-stories/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', colorScheme: 'light' },
    },
    // the one spec that mutates the shared server feed runs by itself, last
    {
      name: 'feed-mutations',
      testMatch: /new-stories/,
      dependencies: ['desktop', 'mobile', 'reduced-motion'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, colorScheme: 'dark' },
    },
  ],
});
