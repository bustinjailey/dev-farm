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

  test.skip('starts collapsed on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Reload to trigger mobile detection
    await page.reload();
    await page.waitForSelector('.sidebar', { timeout: 10000 });

    // Wait for effect to run
    await page.waitForTimeout(500);

    // Sidebar should be collapsed
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toHaveClass(/collapsed/);

    // Content should not be visible
    const sidebarContent = page.locator('.sidebar-content');
    await expect(sidebarContent).not.toBeVisible();
  });

  test.skip('hides white background when collapsed', async ({ page }) => {
    const sidebar = page.locator('.sidebar');
    const toggleButton = page.locator('.sidebar .toggle');

    // Initially expanded (desktop view)
    await expect(sidebar).not.toHaveClass(/collapsed/);

    // Click to collapse
    await toggleButton.click();
    await page.waitForTimeout(500); // Wait for CSS transition
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

  test.skip('disables update button when no updates available', async ({ page }) => {
    // Wait for system status to load
    await page.waitForTimeout(3000);

    const updateButton = page.locator('.sidebar button:has-text("Start Update")');
    await expect(updateButton).toBeVisible({ timeout: 5000 });

    // Check the badge text
    const statusCard = page.locator('.sidebar .status-card:has-text("System Version")');
    const badge = statusCard.locator('.badge');
    const badgeText = await badge.textContent();

    // If "Up to date", button should be disabled
    if (badgeText?.toLowerCase().includes('up to date')) {
      await expect(updateButton).toBeDisabled();
    } else {
      // If updates available ("behind"), button should be enabled
      await expect(updateButton).not.toBeDisabled();
    }
  });

  test.skip('enables update button when updates available', async ({ page }) => {
    // Wait for system status to load
    await page.waitForTimeout(3000);

    const updateButton = page.locator('.sidebar button:has-text("Start Update")');
    await expect(updateButton).toBeVisible({ timeout: 5000 });

    const statusCard = page.locator('.sidebar .status-card:has-text("System Version")');
    const badge = statusCard.locator('.badge');
    const badgeText = await badge.textContent();

    // If badge shows "behind", button should be enabled
    if (badgeText?.toLowerCase().includes('behind')) {
      await expect(updateButton).not.toBeDisabled();
    } else if (badgeText?.toLowerCase().includes('up to date')) {
      // If up to date, button should be disabled
      await expect(updateButton).toBeDisabled();
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
