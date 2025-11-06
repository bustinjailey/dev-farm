import { test, expect } from '@playwright/test';

/**
 * Integration tests for Sidebar component behavior
 * Tests fixes for:
 * - Mobile sidebar auto-collapse
 * - Update button disable state
 * - White background when collapsed
 */

test.describe('Sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for initial data load
    await page.waitForSelector('.sidebar', { timeout: 10000 });
  });

  test('starts collapsed on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Reload to trigger mobile detection
    await page.reload();
    await page.waitForSelector('.sidebar', { timeout: 10000 });

    // Sidebar should be collapsed
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toHaveClass(/collapsed/);

    // Content should not be visible
    const sidebarContent = page.locator('.sidebar-content');
    await expect(sidebarContent).not.toBeVisible();
  });

  test('hides white background when collapsed', async ({ page }) => {
    const sidebar = page.locator('.sidebar');
    const toggleButton = page.locator('.sidebar .toggle');

    // Initially expanded (desktop view)
    await expect(sidebar).not.toHaveClass(/collapsed/);

    // Click to collapse
    await toggleButton.click();
    await expect(sidebar).toHaveClass(/collapsed/);

    // Check computed styles - collapsed sidebar should have transparent background
    const backgroundColor = await sidebar.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });

    // rgba(255, 255, 255, 0) or transparent
    expect(backgroundColor).toMatch(/transparent|rgba\(.*,\s*0\)/);
  });

  test('shows expanded content when toggle clicked', async ({ page }) => {
    const sidebar = page.locator('.sidebar');
    const toggleButton = page.locator('.sidebar .toggle');

    // Collapse first
    if (!(await sidebar.getAttribute('class'))?.includes('collapsed')) {
      await toggleButton.click();
    }

    await expect(sidebar).toHaveClass(/collapsed/);

    // Click to expand
    await toggleButton.click();
    await expect(sidebar).not.toHaveClass(/collapsed/);

    // Content should be visible
    const sidebarContent = page.locator('.sidebar-content');
    await expect(sidebarContent).toBeVisible();
  });

  test('disables update button when no updates available', async ({ page }) => {
    const updateButton = page.locator('.sidebar button:has-text("Start Update")');

    // Wait for system status to load
    await page.waitForTimeout(2000);

    // Check if button exists
    if (await updateButton.count() > 0) {
      const isDisabled = await updateButton.isDisabled();

      // If no updates available, button should be disabled
      const badge = page.locator('.sidebar .badge:has-text("Up to date")');
      if (await badge.count() > 0) {
        expect(isDisabled).toBe(true);
      }
    }
  });

  test('enables update button when updates available', async ({ page }) => {
    // This test requires updates to be available
    // It verifies the button state logic works correctly

    const badge = page.locator('.sidebar .badge');
    const updateButton = page.locator('.sidebar button:has-text("Start Update")');

    await page.waitForTimeout(2000);

    if (await updateButton.count() > 0) {
      const badgeText = await badge.textContent();
      const isDisabled = await updateButton.isDisabled();

      // If badge shows "behind", button should be enabled
      if (badgeText?.includes('behind')) {
        expect(isDisabled).toBe(false);
      }
    }
  });

  test('maintains GitHub status display', async ({ page }) => {
    const githubSection = page.locator('.sidebar .status-card:has-text("GitHub")');
    await expect(githubSection).toBeVisible();

    const badge = githubSection.locator('.badge');
    await expect(badge).toBeVisible();

    // Should show either connected username or "Not Connected"
    const badgeText = await badge.textContent();
    expect(badgeText).toBeTruthy();
  });
});
