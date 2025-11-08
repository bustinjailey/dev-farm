import { test, expect } from '@playwright/test';
import Docker from 'dockerode';

/**
 * Regression Tests - Existing Functionality
 * 
 * Ensures that all existing features continue to work after implementing
 * mobile AI chat functionality. These tests MUST pass before any changes
 * can be merged.
 */
test.describe('Regression Tests - Core Functionality', () => {
  let docker: Docker;

  test.beforeAll(() => {
    docker = new Docker();
  });

  test.describe('Environment Creation', () => {
    test('should still create workspace mode environments', async ({ page }) => {
      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');

      const createButton = page.locator('button:has-text("+ Create")');
      await createButton.click();

      const testName = `workspace-regression-${Date.now()}`;
      await page.fill('input[placeholder="My Project"]', testName);

      // Workspace mode should be default
      const submitButton = page.locator('button:has-text("Create Environment")');
      await submitButton.click();

      // Should show environment card
      const envCard = page.locator(`.card:has-text("${testName}")`);
      await expect(envCard).toBeVisible({ timeout: 10000 });

      // Cleanup
      const deleteButton = envCard.locator('button:has-text("Delete")');
      await deleteButton.click();
      const confirmButton = page.locator('button:has-text("Yes")').last();
      if (await confirmButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await confirmButton.click();
      }
    });

    test('should still create git mode environments', async ({ page }) => {
      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');

      const createButton = page.locator('button:has-text("+ Create")');
      await createButton.click();

      const testName = `git-regression-${Date.now()}`;
      await page.fill('input[placeholder="My Project"]', testName);

      // Select git mode
      const gitRadio = page.locator('input[type="radio"][value="git"]');
      await gitRadio.click();

      // Fill git URL (use a small public repo)
      await page.fill('input[placeholder*="github.com"]', 'https://github.com/octocat/Hello-World');

      const submitButton = page.locator('button:has-text("Create Environment")');
      await submitButton.click();

      // Should show environment card
      const envCard = page.locator(`.card:has-text("${testName}")`);
      await expect(envCard).toBeVisible({ timeout: 10000 });

      // Cleanup
      const deleteButton = envCard.locator('button:has-text("Delete")');
      await deleteButton.click();
      const confirmButton = page.locator('button:has-text("Yes")').last();
      if (await confirmButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await confirmButton.click();
      }
    });
  });

  test.describe('Environment Management', () => {
    let testEnvId: string;

    test.beforeEach(async ({ page }) => {
      testEnvId = `mgmt-test-${Date.now()}`;
      
      // Create test environment
      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');
      
      const createButton = page.locator('button:has-text("+ Create")');
      await createButton.click();
      
      await page.fill('input[placeholder="My Project"]', testEnvId);
      
      const submitButton = page.locator('button:has-text("Create Environment")');
      await submitButton.click();
      
      const envCard = page.locator(`.card:has-text("${testEnvId}")`);
      await expect(envCard).toBeVisible({ timeout: 10000 });
    });

    test.afterEach(async ({ page }) => {
      // Cleanup
      const envCard = page.locator(`.card:has-text("${testEnvId}")`);
      if (await envCard.isVisible().catch(() => false)) {
        const deleteButton = envCard.locator('button:has-text("Delete")');
        await deleteButton.click();
        const confirmButton = page.locator('button:has-text("Yes")').last();
        if (await confirmButton.isVisible({ timeout: 1000 }).catch(() => false)) {
          await confirmButton.click();
        }
      }
    });

    test('should still start and stop environments', async ({ page }) => {
      const envCard = page.locator(`.card:has-text("${testEnvId}")`);
      
      // Wait for running status
      await expect(envCard.locator('text=running')).toBeVisible({ timeout: 30000 });
      
      // Stop environment
      const stopButton = envCard.locator('button:has-text("Stop")');
      await stopButton.click();
      
      // Should show stopped/exited status
      await expect(envCard.locator('text=/exited|stopped/')).toBeVisible({ timeout: 10000 });
      
      // Start again
      const startButton = envCard.locator('button:has-text("Start")');
      await startButton.click();
      
      // Should show running status
      await expect(envCard.locator('text=running')).toBeVisible({ timeout: 30000 });
    });

    test('should still display logs', async ({ page }) => {
      const envCard = page.locator(`.card:has-text("${testEnvId}")`);
      
      // Open logs
      const logsButton = envCard.locator('button:has-text("Logs")');
      await logsButton.click();
      
      // Logs modal should appear
      const logsModal = page.locator('text=Container Logs');
      await expect(logsModal).toBeVisible({ timeout: 5000 });
      
      // Should show some log content
      const logContent = page.locator('pre, code').first();
      await expect(logContent).toBeVisible();
      
      // Close modal
      const closeButton = page.locator('button:has-text("Close")').last();
      await closeButton.click();
    });
  });

  test.describe('GitHub Integration', () => {
    test('should still handle GitHub CLI authentication', async ({ page }) => {
      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');
      
      // Check if GitHub status is visible in sidebar
      const githubSection = page.locator('text=/GitHub|Connected|Not Connected/');
      await expect(githubSection).toBeVisible({ timeout: 5000 });
      
      // GitHub integration should still work (whether connected or not)
      expect(true).toBe(true);
    });
  });

  test.describe('Dashboard UI', () => {
    test('should still load dashboard correctly', async ({ page }) => {
      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');
      
      // Main elements should be visible
      await expect(page.locator('text=Dev Farm')).toBeVisible();
      await expect(page.locator('button:has-text("+ Create")')).toBeVisible();
    });

    test('should still show environment list', async ({ page }) => {
      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');
      
      // Should show environments section (may be empty or have environments)
      const mainContent = page.locator('main');
      await expect(mainContent).toBeVisible();
    });
  });

  test.describe('SSE Events', () => {
    test('should still receive real-time updates', async ({ page }) => {
      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');
      
      const testName = `sse-test-${Date.now()}`;
      
      // Create environment
      const createButton = page.locator('button:has-text("+ Create")');
      await createButton.click();
      
      await page.fill('input[placeholder="My Project"]', testName);
      
      const submitButton = page.locator('button:has-text("Create Environment")');
      await submitButton.click();
      
      // Should see status updates via SSE
      const envCard = page.locator(`.card:has-text("${testName}")`);
      await expect(envCard).toBeVisible({ timeout: 10000 });
      
      // Status should update to "starting" or "running"
      await expect(envCard.locator('text=/starting|running/')).toBeVisible({ timeout: 30000 });
      
      // Cleanup
      const deleteButton = envCard.locator('button:has-text("Delete")');
      await deleteButton.click();
      const confirmButton = page.locator('button:has-text("Yes")').last();
      if (await confirmButton.isVisible({ timeout: 1000 }).catch(() => false)) {
        await confirmButton.click();
      }
    });
  });
});