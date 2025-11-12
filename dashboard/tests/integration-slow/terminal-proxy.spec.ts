import { test, expect } from '@playwright/test';
import Docker from 'dockerode';

test.describe('Terminal Proxy with Host Networking', () => {
  let docker: Docker;
  let testEnvId: string;
  let testPort: number;

  test.beforeAll(() => {
    docker = new Docker();
  });

  test('creates terminal environment and verifies proxy works with host networking', async ({ page }) => {
    // Create a terminal environment
    await page.goto('/');
    await page.waitForSelector('.hero', { timeout: 10000 });

    const createButton = page.locator('button:has-text("New Environment")');
    await createButton.click();

    const modal = page.locator('.modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Generate unique name
    testEnvId = `term-proxy-${Date.now().toString().slice(-8)}`;
    await page.fill('input[placeholder="Optional (max 20 chars)"]', testEnvId);

    // Terminal mode should be default, but verify
    const terminalModeRadio = page.locator('input[value="terminal"]');
    await terminalModeRadio.check();

    const submitButton = page.locator('button.primary:has-text("Create")');
    await submitButton.click();

    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Wait for container to be running
    let containerRunning = false;
    let container;
    let attempts = 0;
    const maxAttempts = 24; // 2 minutes

    while (attempts < maxAttempts && !containerRunning) {
      await page.waitForTimeout(5000);
      attempts++;

      const containers = await docker.listContainers({ all: true });
      container = containers.find(c => c.Names.some(n => n.includes(testEnvId)));

      if (container && container.State === 'running') {
        containerRunning = true;
        break;
      }
    }

    expect(containerRunning).toBeTruthy();
    expect(container).toBeDefined();

    if (!container) {
      throw new Error('Container not found');
    }

    // Get container details
    const containerInstance = docker.getContainer(container.Id);
    const inspect = await containerInstance.inspect();

    // Verify host networking
    expect(inspect.HostConfig.NetworkMode).toBe('host');

    // Get the port from environment variables
    const portEnv = inspect.Config.Env?.find(e => e.startsWith('PORT='));
    expect(portEnv).toBeDefined();
    testPort = parseInt(portEnv!.split('=')[1]);
    expect(testPort).toBeGreaterThan(8100);

    // Wait for terminal server to be ready
    await page.waitForTimeout(10000);

    // Test the terminal proxy endpoint
    const terminalUrl = `/terminal/${testEnvId}`;
    const response = await page.request.get(terminalUrl);
    
    // Should return 200 and HTML content (terminal UI)
    expect(response.status()).toBe(200);
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('text/html');

    // Verify terminal page loads
    await page.goto(terminalUrl);
    await page.waitForTimeout(2000);

    // Check for terminal UI elements
    const terminalContent = await page.content();
    expect(terminalContent).toContain('xterm'); // xterm.js terminal
  });

  test.afterAll(async () => {
    // Cleanup: remove test container
    if (testEnvId) {
      try {
        const containers = await docker.listContainers({ all: true });
        const container = containers.find(c =>
          c.Names.some(n => n.includes(testEnvId))
        );

        if (container) {
          const containerInstance = docker.getContainer(container.Id);
          await containerInstance.stop().catch(() => { });
          await containerInstance.remove().catch(() => { });
        }

        // Remove volumes
        const volumes = await docker.listVolumes();
        const volumesToRemove = volumes.Volumes?.filter(v =>
          v.Name.includes(testEnvId)
        ) || [];

        for (const vol of volumesToRemove) {
          try {
            const volume = docker.getVolume(vol.Name);
            await volume.remove();
          } catch (error) {
            console.error(`Failed to remove volume ${vol.Name}:`, error);
          }
        }
      } catch (error) {
        console.error('Cleanup error:', error);
      }
    }
  });
});
