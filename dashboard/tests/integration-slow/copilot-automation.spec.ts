import { test, expect, type Page } from '@playwright/test';
import Docker from 'dockerode';

/**
 * Comprehensive E2E tests for Copilot CLI Device Auth Automation
 * 
 * These tests verify the automated authentication flow implemented in:
 * - docker/config/startup-terminal.sh (automation logic)
 * - Workspace trust confirmation (sends "1")
 * - Login command execution (sends "/login")
 * - Account selection (sends "1" for GitHub.com)
 * - Device code extraction (4 regex patterns)
 * 
 * Related documentation: docs/COPILOT_DEVICE_AUTH_AUTOMATION.md
 */

test.describe('Copilot CLI Automation', () => {
  let docker: Docker;
  let testEnvId: string;
  let page: Page;

  test.beforeAll(() => {
    docker = new Docker();
  });

  test.beforeEach(async ({ page: testPage }) => {
    page = testPage;
    await page.goto('/');
    await page.waitForSelector('.hero', { timeout: 10000 });
  });

  test.afterEach(async () => {
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
      testEnvId = '';
    }
  });

  /**
   * Helper function to create a terminal environment
   */
  async function createTerminalEnvironment(envName: string): Promise<void> {
    const createButton = page.locator('button:has-text("New Environment")');
    await createButton.click();

    const modal = page.locator('.modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    await page.fill('input[placeholder="Optional (max 20 chars)"]', envName);
    await page.selectOption('select', 'terminal');

    const submitButton = page.locator('button.primary:has-text("Create")');
    await submitButton.click();

    await expect(modal).not.toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2000);
    await page.reload();

    const envCard = page.locator(`.card:has-text("${envName}")`);
    await expect(envCard).toBeVisible({ timeout: 15000 });
    await expect(envCard.locator('.badge:has-text("running")')).toBeVisible({ timeout: 120000 });
  }

  /**
   * Helper function to get container instance
   */
  async function getContainer(envName: string): Promise<Docker.Container | null> {
    const containers = await docker.listContainers({ all: true });
    const container = containers.find(c =>
      c.Names.some(n => n.includes(envName.replace(/[^a-z0-9-]/gi, '-').toLowerCase()))
    );

    return container ? docker.getContainer(container.Id) : null;
  }

  /**
   * Helper function to get container logs
   */
  async function getContainerLogs(container: Docker.Container, tailLines: number = 300): Promise<string> {
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail: tailLines
    });
    return logs.toString();
  }

  /**
   * Test: Workspace trust prompt is automatically confirmed
   */
  test('should automatically confirm workspace trust on first run', async () => {
    testEnvId = `auto-trust-${Date.now().toString().slice(-8)}`;
    await createTerminalEnvironment(testEnvId);

    const container = await getContainer(testEnvId);
    expect(container).toBeTruthy();
    if (!container) return;

    // Wait for startup to complete
    await page.waitForTimeout(20000);

    const logs = await getContainerLogs(container);

    // Verify workspace trust automation occurred
    expect(logs).toContain('✓ Workspace trust prompt detected');

    // Verify the automation log appears BEFORE device code
    const trustIndex = logs.indexOf('✓ Workspace trust prompt detected');
    const deviceIndex = logs.indexOf('✓ Device code obtained');

    if (deviceIndex > -1) {
      expect(trustIndex).toBeLessThan(deviceIndex);
    }

    console.log('✓ Workspace trust was automatically confirmed');
  });

  /**
   * Test: /login command is automatically sent
   */
  test('should automatically send /login command', async () => {
    testEnvId = `auto-login-${Date.now().toString().slice(-9)}`;
    await createTerminalEnvironment(testEnvId);

    const container = await getContainer(testEnvId);
    expect(container).toBeTruthy();
    if (!container) return;

    await page.waitForTimeout(20000);

    const logs = await getContainerLogs(container);

    // Verify login automation occurred
    expect(logs).toContain('✓ Login prompt detected');

    // Verify the automation happens after workspace trust (if trust appeared)
    const trustIndex = logs.indexOf('✓ Workspace trust prompt detected');
    const loginIndex = logs.indexOf('✓ Login prompt detected');

    if (trustIndex > -1 && loginIndex > -1) {
      expect(loginIndex).toBeGreaterThan(trustIndex);
    }

    console.log('✓ /login command was automatically sent');
  });

  /**
   * Test: GitHub.com account is automatically selected
   */
  test('should automatically select GitHub.com account', async () => {
    testEnvId = `auto-acct-${Date.now().toString().slice(-10)}`;
    await createTerminalEnvironment(testEnvId);

    const container = await getContainer(testEnvId);
    expect(container).toBeTruthy();
    if (!container) return;

    await page.waitForTimeout(20000);

    const logs = await getContainerLogs(container);

    // Verify account selection automation occurred
    expect(logs).toContain('✓ Account selection prompt detected');

    // Verify the automation happens after login prompt
    const loginIndex = logs.indexOf('✓ Login prompt detected');
    const accountIndex = logs.indexOf('✓ Account selection prompt detected');

    if (loginIndex > -1 && accountIndex > -1) {
      expect(accountIndex).toBeGreaterThan(loginIndex);
    }

    console.log('✓ GitHub.com account was automatically selected');
  });

  /**
   * Test: Device code is automatically extracted
   */
  test('should automatically extract device code', async () => {
    testEnvId = `auto-code-${Date.now().toString().slice(-10)}`;
    await createTerminalEnvironment(testEnvId);

    const container = await getContainer(testEnvId);
    expect(container).toBeTruthy();
    if (!container) return;

    await page.waitForTimeout(20000);

    const logs = await getContainerLogs(container);

    // Verify device code extraction occurred
    expect(logs).toContain('✓ Device code obtained');

    // Verify device code format (XXXX-XXXX)
    const codeMatch = logs.match(/✓ Device code obtained: ([A-Z0-9]{4}-[A-Z0-9]{4})/);
    expect(codeMatch).toBeTruthy();

    if (codeMatch) {
      const deviceCode = codeMatch[1];
      expect(deviceCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      console.log(`✓ Device code extracted: ${deviceCode}`);
    }

    // Verify auth URL was extracted
    expect(logs).toContain('✓ Auth URL: https://github.com/login/device');

    // Verify device auth file was created
    expect(logs).toContain('✓ Device auth info saved');
  });

  /**
   * Test: Full automation flow executes in correct order
   */
  test('should execute full automation flow in correct sequence', async () => {
    testEnvId = `auto-flow-${Date.now().toString().slice(-9)}`;
    await createTerminalEnvironment(testEnvId);

    const container = await getContainer(testEnvId);
    expect(container).toBeTruthy();
    if (!container) return;

    await page.waitForTimeout(25000);

    const logs = await getContainerLogs(container);

    // Check which automation steps occurred
    const hasWorkspaceTrust = logs.includes('✓ Workspace trust prompt detected');
    const hasLoginPrompt = logs.includes('✓ Login prompt detected');
    const hasAccountSelection = logs.includes('✓ Account selection prompt detected');
    const hasDeviceCode = logs.includes('✓ Device code obtained');

    console.log('Automation steps detected:', {
      workspaceTrust: hasWorkspaceTrust,
      loginPrompt: hasLoginPrompt,
      accountSelection: hasAccountSelection,
      deviceCode: hasDeviceCode
    });

    // Device code extraction is the critical step - must always succeed
    expect(hasDeviceCode).toBe(true);

    // If other steps occurred, verify they're in the correct order
    if (hasWorkspaceTrust && hasLoginPrompt) {
      const trustIndex = logs.indexOf('✓ Workspace trust prompt detected');
      const loginIndex = logs.indexOf('✓ Login prompt detected');
      expect(loginIndex).toBeGreaterThan(trustIndex);
    }

    if (hasLoginPrompt && hasAccountSelection) {
      const loginIndex = logs.indexOf('✓ Login prompt detected');
      const accountIndex = logs.indexOf('✓ Account selection prompt detected');
      expect(accountIndex).toBeGreaterThan(loginIndex);
    }

    if (hasAccountSelection && hasDeviceCode) {
      const accountIndex = logs.indexOf('✓ Account selection prompt detected');
      const codeIndex = logs.indexOf('✓ Device code obtained');
      expect(codeIndex).toBeGreaterThan(accountIndex);
    }

    console.log('✓ Automation flow executed in correct sequence');
  });

  /**
   * Test: Workspace trust is remembered across container restarts
   */
  test('should remember workspace trust across restarts', async () => {
    testEnvId = `persist-${Date.now().toString().slice(-11)}`;
    await createTerminalEnvironment(testEnvId);

    const container = await getContainer(testEnvId);
    expect(container).toBeTruthy();
    if (!container) return;

    // Wait for initial auth flow
    await page.waitForTimeout(20000);

    const logsFirst = await getContainerLogs(container);
    const hadWorkspaceTrust = logsFirst.includes('✓ Workspace trust prompt detected');

    console.log(`First run: workspace trust ${hadWorkspaceTrust ? 'detected' : 'not detected'}`);

    // Restart container
    console.log('Restarting container...');
    await container.restart();
    await page.waitForTimeout(20000);

    // Get logs from after restart
    const logsSecond = await container.logs({
      stdout: true,
      stderr: true,
      since: Math.floor(Date.now() / 1000) - 25,
      tail: 200
    });
    const logsSecondText = logsSecond.toString();

    // Verify workspace trust prompt did NOT appear again
    const hasWorkspaceTrustAfterRestart = logsSecondText.includes('✓ Workspace trust prompt detected');
    expect(hasWorkspaceTrustAfterRestart).toBe(false);

    console.log('✓ Workspace trust is persisted across restarts');
  });

  /**
   * Test: Device auth file is created with correct structure
   */
  test('should create device auth file with correct JSON structure', async () => {
    testEnvId = `auth-file-${Date.now().toString().slice(-8)}`;
    await createTerminalEnvironment(testEnvId);

    const container = await getContainer(testEnvId);
    expect(container).toBeTruthy();
    if (!container) return;

    await page.waitForTimeout(20000);

    // Check if device auth file was created
    const exec = await container.exec({
      Cmd: ['cat', '/home/coder/workspace/.copilot-device-auth.json'],
      AttachStdout: true,
      AttachStderr: true
    });

    const stream = await exec.start({ Detach: false });
    let output = '';

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    // Parse JSON
    const deviceAuthData = JSON.parse(output);

    // Verify structure
    expect(deviceAuthData).toHaveProperty('code');
    expect(deviceAuthData).toHaveProperty('url');
    expect(deviceAuthData).toHaveProperty('timestamp');

    // Verify device code format
    expect(deviceAuthData.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    // Verify URL
    expect(deviceAuthData.url).toContain('github.com/login/device');

    // Verify timestamp is ISO 8601 format
    expect(deviceAuthData.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    console.log('✓ Device auth file has correct structure:', deviceAuthData);
  });

  /**
   * Test: Dashboard displays device code from file
   */
  test('should display device code on dashboard from auth file', async () => {
    testEnvId = `dash-code-${Date.now().toString().slice(-9)}`;
    await createTerminalEnvironment(testEnvId);

    // Wait for device auth detection
    await page.waitForTimeout(25000);

    const envCard = page.locator(`.card:has-text("${testEnvId}")`);
    await expect(envCard).toBeVisible();

    // Check for device auth banner
    const deviceAuthBanner = envCard.locator('.device-auth-banner');

    // Banner might not appear if Copilot is already authenticated
    const hasBanner = await deviceAuthBanner.isVisible().catch(() => false);

    if (!hasBanner) {
      console.log('⊘ Skipping - Copilot already authenticated');
      test.skip();
      return;
    }

    // Verify banner displays code
    const deviceCode = deviceAuthBanner.locator('.device-code');
    await expect(deviceCode).toBeVisible();

    const codeText = await deviceCode.textContent();
    expect(codeText).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    // Verify the code matches what's in container logs
    const container = await getContainer(testEnvId);
    if (container) {
      const logs = await getContainerLogs(container);
      const codeMatch = logs.match(/✓ Device code obtained: ([A-Z0-9]{4}-[A-Z0-9]{4})/);

      if (codeMatch) {
        const loggedCode = codeMatch[1];
        expect(codeText).toBe(loggedCode);
        console.log(`✓ Dashboard displays correct device code: ${codeText}`);
      }
    }
  });

  /**
   * Test: Automation timing and delays are appropriate
   */
  test('should complete automation within reasonable time', async () => {
    testEnvId = `timing-${Date.now().toString().slice(-11)}`;

    const startTime = Date.now();
    await createTerminalEnvironment(testEnvId);

    const container = await getContainer(testEnvId);
    expect(container).toBeTruthy();
    if (!container) return;

    // Wait for automation to complete
    await page.waitForTimeout(25000);

    const logs = await getContainerLogs(container);

    // Check if device code was obtained
    const hasDeviceCode = logs.includes('✓ Device code obtained');
    expect(hasDeviceCode).toBe(true);

    const endTime = Date.now();
    const totalTime = (endTime - startTime) / 1000;

    // Automation should complete within 45 seconds of container start
    // (5s initial wait + 3s * 3 prompts + buffer for Copilot startup)
    expect(totalTime).toBeLessThan(45);

    console.log(`✓ Automation completed in ${totalTime.toFixed(1)} seconds`);
  });
});
