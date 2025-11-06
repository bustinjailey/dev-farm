import { test, expect } from '@playwright/test';

/**
 * Integration tests for CreateEnvironmentModal
 * Tests fix for:
 * - Form reset when modal opens
 */

test.describe('CreateEnvironmentModal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.hero', { timeout: 10000 });
  });

  test('opens with empty form', async ({ page }) => {
    await page.click('button:has-text("New Environment")');

    // Modal should be visible
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();

    // Form fields should be empty
    const nameInput = modal.locator('input[placeholder*="Optional"]');
    await expect(nameInput).toHaveValue('');

    const modeSelect = modal.locator('select');
    await expect(modeSelect).toHaveValue('workspace');
  });

  test('clears previous values when reopened', async ({ page }) => {
    // Open modal and fill form
    await page.click('button:has-text("New Environment")');
    let modal = page.locator('.modal');

    await page.fill('input[placeholder*="Optional"]', 'previous-name');
    await page.selectOption('select', 'git');

    // Close modal without creating
    await page.click('button:has-text("Cancel")');
    await expect(modal).not.toBeVisible();

    // Open modal again
    await page.click('button:has-text("New Environment")');
    modal = page.locator('.modal');
    await expect(modal).toBeVisible();

    // Form should be empty/reset
    const nameInput = modal.locator('input[placeholder*="Optional"]');
    await expect(nameInput).toHaveValue('');

    const modeSelect = modal.locator('select');
    await expect(modeSelect).toHaveValue('workspace');
  });

  test('resets form after successful creation', async ({ page }) => {
    // Create an environment
    await page.click('button:has-text("New Environment")');

    await page.fill('input[placeholder*="Optional"]', 'test-env-1');
    await page.click('button:has-text("Create")');

    // Modal should close
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 10000 });

    // Open modal again
    await page.click('button:has-text("New Environment")');
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible();

    // Name should not be "test-env-1"
    const nameInput = modal.locator('input[placeholder*="Optional"]');
    const nameValue = await nameInput.inputValue();
    expect(nameValue).not.toBe('test-env-1');
  });

  test('git mode fields are hidden in workspace mode', async ({ page }) => {
    await page.click('button:has-text("New Environment")');
    const modal = page.locator('.modal');

    // Workspace mode selected by default
    await expect(modal.locator('input[placeholder*="github.com"]')).not.toBeVisible();
  });

  test('git mode shows URL field', async ({ page }) => {
    await page.click('button:has-text("New Environment")');
    const modal = page.locator('.modal');

    // Select git mode
    await page.selectOption('select', 'git');

    // Git URL field should appear
    await expect(modal.locator('input[placeholder*="github.com"]')).toBeVisible();
    await expect(modal.locator('button:has-text("Browse")')).toBeVisible();
  });

  test('ssh mode shows SSH fields', async ({ page }) => {
    await page.click('button:has-text("New Environment")');
    const modal = page.locator('.modal');

    // Select SSH mode
    await page.selectOption('select', 'ssh');

    // SSH fields should appear
    await expect(modal.locator('input[placeholder*="server.example.com"]')).toBeVisible();
    await expect(modal.locator('input[value="root"]')).toBeVisible();
  });

  test('validates name length (max 20 chars)', async ({ page }) => {
    await page.click('button:has-text("New Environment")');
    const modal = page.locator('.modal');

    // Enter name longer than 20 characters
    const longName = 'a'.repeat(25);
    await page.fill('input[placeholder*="Optional"]', longName);

    // Error message should appear
    await expect(modal.locator('.error-message')).toBeVisible();

    // Create button should be disabled
    const createButton = modal.locator('button:has-text("Create")');
    await expect(createButton).toBeDisabled();
  });

  test('allows creation with valid name length', async ({ page }) => {
    await page.click('button:has-text("New Environment")');
    const modal = page.locator('.modal');

    // Enter valid name (20 chars or less)
    await page.fill('input[placeholder*="Optional"]', 'valid-short-name');

    // No error message
    await expect(modal.locator('.error-message')).not.toBeVisible();

    // Create button should be enabled
    const createButton = modal.locator('button:has-text("Create")');
    await expect(createButton).not.toBeDisabled();
  });
});
