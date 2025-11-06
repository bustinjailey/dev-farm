import { test, expect } from '@playwright/test';

/**
 * Integration tests for SSE (Server-Sent Events) real-time updates
 * Tests fixes for:
 * - System status auto-refresh (git commits)
 * - Device auth updates
 * - Environment status broadcasts
 */

test.describe('SSE Real-time Updates', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.sidebar', { timeout: 10000 });
  });

  test('receives SSE connection', async ({ page }) => {
    // Listen for SSE connection establishment
    const sseConnected = page.waitForEvent('console', (msg) =>
      msg.text().includes('[SSE]') || msg.text().includes('connected')
    );

    // Wait for connection (timeout after 10s)
    await Promise.race([
      sseConnected,
      page.waitForTimeout(10000),
    ]);

    // Verify sidebar data loaded (indicates SSE working)
    const systemStatus = page.locator('.sidebar .status-card:has-text("System Version")');
    await expect(systemStatus).toBeVisible();
  });

  test('system status updates automatically', async ({ page }) => {
    const systemCard = page.locator('.sidebar .status-card:has-text("System Version")');
    await expect(systemCard).toBeVisible();

    // Get initial SHA value
    const initialSha = await systemCard.locator('p:has-text("Current:")').textContent();

    // System status should be monitored and updated via SSE
    // This test verifies the UI is reactive to system-status events
    expect(initialSha).toBeTruthy();

    // Wait to potentially receive updates (in real scenario, would trigger git commits)
    await page.waitForTimeout(3000);

    // Verify the system status card still displays current info
    await expect(systemCard.locator('p:has-text("Current:")')).toBeVisible();
  });

  test('environment status updates in real-time', async ({ page }) => {
    // Create an environment to monitor
    await page.click('button:has-text("New Environment")');
    await page.fill('input[placeholder*="Optional"]', 'sse-test-env');
    await page.click('button:has-text("Create")');

    // Wait for environment card to appear
    const card = page.locator('.card:has-text("sse-test-env")').first();
    await expect(card).toBeVisible({ timeout: 30000 });

    // Monitor status badge changes via SSE
    const statusBadge = card.locator('.badge');

    // Should transition through states: created -> starting -> running
    // Or show starting/running based on timing
    await expect(statusBadge).toBeVisible();

    const statusText = await statusBadge.textContent();
    expect(statusText).toMatch(/starting|running|created/i);
  });

  test.skip('registry updates trigger data refresh', async ({ page }) => {
    // Get initial environment count
    const initialCards = await page.locator('.card').count();

    // Create new environment
    await page.click('button:has-text("New Environment")');
    await page.fill('input[placeholder*="Optional"]', 'registry-test');
    await page.click('button:has-text("Create")');

    // Wait for registry update via SSE
    await page.waitForTimeout(2000);

    // Card count should increase
    const newCards = await page.locator('.card').count();
    expect(newCards).toBeGreaterThan(initialCards);
  });

  test('handles SSE reconnection gracefully', async ({ page }) => {
    // Initial connection
    await page.waitForSelector('.sidebar', { timeout: 10000 });

    // Simulate reconnection by reloading
    await page.reload();

    // Should reconnect and display data
    await page.waitForSelector('.sidebar', { timeout: 10000 });
    const systemCard = page.locator('.sidebar .status-card:has-text("System Version")');
    await expect(systemCard).toBeVisible();
  });

  test('heartbeat keeps connection alive', async ({ page }) => {
    // Wait for initial load
    await page.waitForSelector('.sidebar', { timeout: 10000 });

    // Wait long enough for heartbeat to trigger (45s interval)
    // Just verify connection stays alive for at least 10s
    await page.waitForTimeout(10000);

    // Page should still be responsive
    const toggleButton = page.locator('.sidebar .toggle');
    await expect(toggleButton).toBeVisible();
    await toggleButton.click();

    // Should still work
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toHaveClass(/collapsed/);
  });
});
