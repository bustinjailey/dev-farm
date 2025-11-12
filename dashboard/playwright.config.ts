import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Dev Farm integration tests
 * 
 * These tests verify end-to-end flows including:
 * - UI interactions (sidebar, modals, cards)
 * - SSE real-time updates
 * - GitHub authentication
 * - System updates
 * - Environment lifecycle
 */
export default defineConfig({
  fullyParallel: false, // Sequential execution for integration tests
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker to avoid conflicts
  reporter: 'html',

  use: {
    // Test against production build on port 5000 (more stable than dev server)
    baseURL: process.env.BASE_URL || 'http://localhost:5000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'fast',
      testDir: './tests/integration',
      timeout: 60000, // 60s for fast UI tests (no Docker)
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'slow',
      testDir: './tests/integration-slow',
      timeout: 180000, // 3 minutes for Docker container creation and startup
      use: { ...devices['Desktop Chrome'] },
      // Only run slow tests when explicitly requested
      grep: process.env.RUN_SLOW_TESTS ? undefined : /$.^/,
    },
  ],

  // Build and start production server for E2E tests (more stable than dev mode)
  webServer: process.env.SKIP_WEBSERVER ? undefined : {
    command: 'npm run build && npm run start',
    url: 'http://localhost:5000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
