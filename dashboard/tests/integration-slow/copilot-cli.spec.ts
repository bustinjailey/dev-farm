import { test, expect } from '@playwright/test';
import Docker from 'dockerode';

test.describe('Copilot CLI Installation', () => {
  let docker: Docker;
  let testEnvId: string;
  let page: any;

  test.beforeAll(() => {
    docker = new Docker();
  });

  test.beforeEach(async ({ page: testPage }) => {
    page = testPage;
    await page.goto('/');
    await page.waitForSelector('.hero', { timeout: 10000 });
  });

  test('creates terminal environment and verifies copilot CLI is installed', async () => {

    // Open create modal
    const createButton = page.locator('button:has-text("New Environment")');
    await createButton.click();

    // Wait for modal
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Fill in the form (terminal is default mode)
    testEnvId = `cop-${Date.now().toString().slice(-10)}`; // Max 20 chars
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

    // Wait for container to be running (up to 2 minutes)
    let containerRunning = false;
    let container;

    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(5000);

      // Check container status
      const containers = await docker.listContainers({ all: true });
      container = containers.find(c => c.Names.some(n => n.includes(testEnvId.replace(/[^a-z0-9-]/gi, '-').toLowerCase())));

      if (container && container.State === 'running') {
        containerRunning = true;
        break;
      }
    }

    expect(containerRunning).toBeTruthy();

    if (!container) {
      throw new Error('Container not found');
    }

    // Get the actual container name
    const containerName = container.Names[0].replace(/^\//, '');
    console.log('Container name:', containerName);

    // Exec into container and check copilot installation
    const containerInstance = docker.getContainer(container.Id);

    // Wait a bit for startup script to complete (pnpm install takes time)
    await page.waitForTimeout(30000);

    // Check startup log to see if copilot was installed
    const execLog = await containerInstance.exec({
      Cmd: ['bash', '-c', 'tail -200 /home/coder/workspace/.terminal.log 2>&1 || cat /home/coder/workspace/.terminal.log 2>&1 || echo "No log file"'],
      AttachStdout: true,
      AttachStderr: true,
    });

    const streamLog = await execLog.start({ Detach: false });
    let logOutput = '';

    streamLog.on('data', (chunk: Buffer) => {
      logOutput += chunk.toString();
    });

    await new Promise((resolve) => streamLog.on('end', resolve));

    console.log('Startup log:\n', logOutput);

    // The startup script uses pnpm, so check the pnpm global path
    // PNPM_HOME=/home/coder/.local/share/pnpm
    const execCopilotCheck = await containerInstance.exec({
      Cmd: ['bash', '-c', 'export PNPM_HOME=/home/coder/.local/share/pnpm && export PATH="$PNPM_HOME:$PATH" && which copilot 2>&1'],
      AttachStdout: true,
      AttachStderr: true,
    });

    const streamCopilotCheck = await execCopilotCheck.start({ Detach: false });
    let copilotCheckOutput = '';

    streamCopilotCheck.on('data', (chunk: Buffer) => {
      copilotCheckOutput += chunk.toString();
    });

    await new Promise((resolve) => streamCopilotCheck.on('end', resolve));

    console.log('which copilot:', copilotCheckOutput);

    // Check if copilot binary exists in pnpm global directory
    const execLs = await containerInstance.exec({
      Cmd: ['bash', '-c', 'ls -la /home/coder/.local/share/pnpm/copilot* 2>&1 || echo "No copilot found"'],
      AttachStdout: true,
      AttachStderr: true,
    });

    const streamLs = await execLs.start({ Detach: false });
    let lsOutput = '';

    streamLs.on('data', (chunk: Buffer) => {
      lsOutput += chunk.toString();
    });

    await new Promise((resolve) => streamLs.on('end', resolve));

    console.log('ls copilot:', lsOutput);

    // Try running copilot --version with correct PATH
    const execVersion = await containerInstance.exec({
      Cmd: ['bash', '-c', 'export PNPM_HOME=/home/coder/.local/share/pnpm && export PATH="$PNPM_HOME:$PATH" && copilot --version 2>&1'],
      AttachStdout: true,
      AttachStderr: true,
    });

    const streamVersion = await execVersion.start({ Detach: false });
    let versionOutput = '';

    streamVersion.on('data', (chunk: Buffer) => {
      versionOutput += chunk.toString();
    });

    await new Promise((resolve) => streamVersion.on('end', resolve));

    console.log('copilot --version:', versionOutput);

    // Verify copilot is accessible (version format is like 0.0.x or 1.0.x)
    expect(versionOutput).toMatch(/\d+\.\d+\.\d+/);
  });

  test.afterAll(async () => {
    // Cleanup: remove test container
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
});
