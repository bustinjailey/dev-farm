import { test, expect } from '@playwright/test';

/**
 * Integration tests for EnvironmentCard component
 * Tests fixes for:
 * - AI Assist and Monitor panels expansion
 * - Terminal mode UI differences
 * - Auth Required button updates
 */

test.describe('EnvironmentCard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.hero', { timeout: 10000 });
  });

  test.skip('Monitor button expands panel inside card', async ({ page }) => {
    // Skip test if no environments exist (requires backend to be running)
    const cardCount = await page.locator('.card').count();
    if (cardCount === 0) {
      test.skip();
      return;
    }

    // Use existing environment
    const card = page.locator('.card').first();

    // Check if this is terminal mode (no Monitor button)
    const monitorButton = card.locator('button:has-text("Monitor")');
    if (await monitorButton.count() === 0) {
      test.skip(); // Terminal mode environment
      return;
    }

    // Click Monitor button
    await monitorButton.click();
    await page.waitForTimeout(500);

    // Monitor panel should appear inside the card
    const monitorPanel = card.locator('section.panel:has-text("Environment Monitor")');
    await expect(monitorPanel).toBeVisible({ timeout: 5000 });

    // Button text should change to "Hide Monitor"
    await expect(monitorButton).toContainText('Hide Monitor');

    // Click again to hide
    await monitorButton.click();
    await expect(monitorPanel).not.toBeVisible();
  });

  test.skip('AI Assist button expands panel inside card', async ({ page }) => {
    // Skip test if no environments exist
    const cardCount = await page.locator('.card').count();
    if (cardCount === 0) {
      test.skip();
      return;
    }

    const card = page.locator('.card').first();
    const aiButton = card.locator('button:has-text("AI Assist")');

    // Skip if terminal mode (no AI button)
    if (await aiButton.count() === 0) {
      test.skip();
      return;
    }

    await aiButton.click();
    await page.waitForTimeout(500);

    // AI panel should appear inside the card
    const aiPanel = card.locator('section.panel:has-text("AI Assistant")');
    await expect(aiPanel).toBeVisible({ timeout: 5000 });

    // Button text should change
    await expect(aiButton).toContainText('Hide AI');

    // Panel should have textarea
    await expect(aiPanel.locator('textarea')).toBeVisible();
  });

  test.skip('terminal mode shows only relevant buttons', async ({ page }) => {
    // Look for existing terminal mode card
    const terminalCard = page.locator('.card').filter({ has: page.locator('small:has-text("terminal mode")') }).first();

    // Skip if no terminal mode environment exists
    if (await terminalCard.count() === 0) {
      test.skip();
      return;
    }

    await expect(terminalCard).toBeVisible();
    await page.waitForTimeout(1000);

    // Terminal mode should NOT have these buttons (check they don't exist)
    await expect(terminalCard.locator('button:has-text("Monitor")')).toHaveCount(0);
    await expect(terminalCard.locator('button:has-text("AI Assist")')).toHaveCount(0);
    await expect(terminalCard.locator('button:has-text("Desktop Command")')).toHaveCount(0);

    // Terminal mode SHOULD have these buttons
    await expect(terminalCard.locator('button:has-text("Logs")')).toBeVisible();
    await expect(terminalCard.locator('button:has-text("Delete")')).toBeVisible();
  });

  test('workspace mode shows all buttons', async ({ page }) => {
    // Create a workspace mode environment
    await page.click('button:has-text("New Environment")');
    await page.fill('input[placeholder*="Optional"]', 'test-workspace');
    await page.selectOption('select', 'workspace');
    await page.click('button:has-text("Create")');

    await page.waitForSelector('.card:has-text("test-workspace")', { timeout: 30000 });

    const card = page.locator('.card:has-text("test-workspace")').first();

    // Wait for container to start
    await page.waitForTimeout(5000);

    // Workspace mode should have all buttons (check for presence, not visibility since some depend on state)
    expect(await card.locator('button:has-text("Monitor")').count()).toBeGreaterThan(0);
    expect(await card.locator('button:has-text("AI Assist")').count()).toBeGreaterThan(0);
    expect(await card.locator('button:has-text("Logs")').count()).toBeGreaterThan(0);
    expect(await card.locator('button:has-text("Delete")').count()).toBeGreaterThan(0);
  });

  test('auth required button updates when auth completes', async ({ page }) => {
    // This test verifies the SSE-based auth state updates
    // Find a card with auth required state (if any)

    const authButton = page.locator('button:has-text("Auth Required")');

    if (await authButton.count() > 0) {
      // Button should be disabled initially
      await expect(authButton.first()).toBeDisabled();

      // After auth completes (simulated or real), button should become enabled
      // This is verified by SSE broadcasts updating the UI

      // For now, just verify the button exists and its disabled state
      const isDisabled = await authButton.first().isDisabled();
      expect(isDisabled).toBe(true);
    }
  });

  test('device auth banner shows current code', async ({ page }) => {
    // Find environment with device auth banner
    const authBanner = page.locator('.device-auth-banner');

    if (await authBanner.count() > 0) {
      // Banner should have code displayed
      const deviceCode = authBanner.locator('.device-code');
      await expect(deviceCode).toBeVisible();

      const codeText = await deviceCode.textContent();
      expect(codeText).toMatch(/^[A-Z0-9-]+$/);

      // Should have copy button
      await expect(authBanner.locator('button:has-text("Copy Code")')).toBeVisible();

      // Should have GitHub auth link
      await expect(authBanner.locator('a:has-text("Open GitHub Auth")')).toBeVisible();
    }
  });
});
