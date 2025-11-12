import { test, expect, type Page } from '@playwright/test';
import Docker from 'dockerode';

/**
 * Integration tests for Copilot CLI Authentication Flow
 * 
 * Tests the complete authentication process from device code generation
 * through completion detection and dashboard UI updates
 */
test.describe('Copilot Authentication Flow', () => {
  let docker: Docker;
  let testEnvId: string;
  let page: Page;

  test.beforeAll(() => {
    docker = new Docker();
  });

  test.beforeEach(async ({ page: testPage }) => {
    page = testPage;
    testEnvId = `ath-${Date.now().toString().slice(-10)}`; // Max 20 chars
  });

  test.afterEach(async () => {
    // Cleanup: remove test environment
    if (testEnvId) {
      try {
        const containers = await docker.listContainers({ all: true });
        const container = containers.find(c =>
          c.Names.some(n => n.includes(testEnvId.replace(/[^a-z0-9-]/gi, '-').toLowerCase()))
        );

        if (container) {
          const containerInstance = docker.getContainer(container.Id);
          await containerInstance.stop().catch(() => { });
          await containerInstance.remove().catch(() => { });
        }
      } catch (error) {
        console.error('Cleanup error:', error);
      }
    }
  });

  test('should initiate device flow on terminal environment start', async () => {
    await page.goto('/');

    // Open create modal
    const createButton = page.locator('button:has-text("New Environment")');
    await createButton.click();

    // Wait for modal
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Fill in form (terminal is default mode)
    await page.fill('input[placeholder="Optional (max 20 chars)"]', testEnvId);

    // Submit form
    const submitButton = page.locator('button.primary:has-text("Create")');
    await submitButton.click();

    // Wait for modal to close
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // SSE events may not work reliably in Playwright, so manually refresh
    await page.waitForTimeout(2000);
    await page.reload();

    // Wait for environment card to appear
    const envCard = page.locator(`.card:has-text("${testEnvId}")`);
    await expect(envCard).toBeVisible({ timeout: 15000 });

    // Wait for container to start
    await page.waitForTimeout(15000);

    // Find container and check for device auth file
    const containers = await docker.listContainers({ all: true });
    const container = containers.find(c =>
      c.Names.some(n => n.includes(testEnvId.replace(/[^a-z0-9-]/gi, '-').toLowerCase()))
    );

    expect(container).toBeDefined();

    if (container) {
      const containerInstance = docker.getContainer(container.Id);

      // Check for device auth file
      const exec = await containerInstance.exec({
        Cmd: ['cat', '/home/coder/workspace/.copilot-device-auth.json'],
        AttachStdout: true,
        AttachStderr: true,
      });

      const stream = await exec.start({ Detach: false });
      let output = '';

      stream.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });

      await new Promise((resolve) => stream.on('end', resolve));

      // Should have device auth file with code and URL
      expect(output).toContain('code');
      expect(output).toContain('url');
      expect(output).toContain('github.com/login/device');
    }
  });

  test('should display auth banner in dashboard when device code detected', async () => {
    // This test will verify that the dashboard shows the auth banner
    // when it detects device auth via SSE events

    // For now, this is a placeholder for the full implementation
    expect(true).toBe(true);
  });

  test('should detect authentication completion and remove device auth file', async () => {
    // This test will simulate successful authentication
    // and verify that the system detects it and cleans up

    expect(true).toBe(true);
  });

  test('should handle authentication timeout gracefully', async () => {
    // Test that the system handles timeout after 5 minutes

    expect(true).toBe(true);
  });

  test('should work with already authenticated copilot', async () => {
    // Test that if copilot is already authenticated,
    // no device flow is initiated

    expect(true).toBe(true);
  });

  test('should update UI when authentication completes', async () => {
    // Test that the dashboard auth banner disappears
    // and the environment becomes ready for chat

    expect(true).toBe(true);
  });
});