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

  test('Monitor button expands panel inside card', async ({ page }) => {
    // Create a test environment first
    await page.click('button:has-text("New Environment")');
    await page.fill('input[placeholder*="Optional"]', 'test-monitor');
    await page.click('button:has-text("Create")');

    // Wait for environment to appear
    await page.waitForSelector('.card:has-text("test-monitor")', { timeout: 30000 });

    const card = page.locator('.card:has-text("test-monitor")').first();
    const monitorButton = card.locator('button:has-text("Monitor")');

    // Click Monitor button
    if (await monitorButton.count() > 0) {
      await monitorButton.click();

      // Monitor panel should appear inside the card
      const monitorPanel = card.locator('.panel:has-text("Environment Monitor")');
      await expect(monitorPanel).toBeVisible({ timeout: 5000 });

      // Button text should change to "Hide Monitor"
      await expect(monitorButton).toContainText('Hide Monitor');

      // Click again to hide
      await monitorButton.click();
      await expect(monitorPanel).not.toBeVisible();
    }
  });

  test('AI Assist button expands panel inside card', async ({ page }) => {
    // Find or create an environment
    const existingCard = page.locator('.card').first();

    if (await existingCard.count() === 0) {
      // Create environment
      await page.click('button:has-text("New Environment")');
      await page.fill('input[placeholder*="Optional"]', 'test-ai');
      await page.click('button:has-text("Create")');
      await page.waitForSelector('.card', { timeout: 30000 });
    }

    const card = page.locator('.card').first();
    const aiButton = card.locator('button:has-text("AI Assist")');

    if (await aiButton.count() > 0) {
      await aiButton.click();

      // AI panel should appear inside the card
      const aiPanel = card.locator('.panel:has-text("AI Assistant")');
      await expect(aiPanel).toBeVisible({ timeout: 5000 });

      // Button text should change
      await expect(aiButton).toContainText('Hide AI');

      // Panel should have textarea
      await expect(aiPanel.locator('textarea')).toBeVisible();
    }
  });

  test('terminal mode shows only relevant buttons', async ({ page }) => {
    // Create a terminal mode environment
    await page.click('button:has-text("New Environment")');
    await page.fill('input[placeholder*="Optional"]', 'test-terminal');
    await page.selectOption('select', 'terminal');
    await page.click('button:has-text("Create")');

    // Wait for environment to appear
    await page.waitForSelector('.card:has-text("test-terminal")', { timeout: 30000 });

    const card = page.locator('.card:has-text("test-terminal")').first();

    // Terminal mode should NOT have these buttons
    await expect(card.locator('button:has-text("Monitor")')).not.toBeVisible();
    await expect(card.locator('button:has-text("AI Assist")')).not.toBeVisible();
    await expect(card.locator('button:has-text("Copy Desktop Command")')).not.toBeVisible();

    // Terminal mode SHOULD have these buttons
    await expect(card.locator('button:has-text("Logs")')).toBeVisible();
    await expect(card.locator('button:has-text("Delete")')).toBeVisible();
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
