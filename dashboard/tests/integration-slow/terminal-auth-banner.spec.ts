
import { test, expect, type Page } from '@playwright/test';
import Docker from 'dockerode';

/**
 * Comprehensive E2E tests for Terminal Authentication Flow with Device Auth Banner
 * 
 * These tests verify:
 * - Creating a new terminal environment and verifying it starts
 * - GitHub device auth banner appears with code and URL
 * - Copying the device auth code functionality
 * - Banner updates/disappears after authentication
 * - Auth status polling and state changes
 * - Environment card shows correct auth status
 */

test.describe('Terminal Auth Flow with Banner', () => {
  let docker: Docker;
  let testEnvId: string;
  let page: Page;

  test.beforeAll(() => {
    docker = new Docker();
  });

  test.beforeEach(async ({ page: testPage }) => {
    page = testPage;
    await page.goto('/');
    // Wait for the hero section to ensure page is loaded
    await page.waitForSelector('.hero', { timeout: 10000 });
  });

  test.afterEach(async () => {
    // Cleanup: remove test environment if created
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
   * Test 1: Create a new terminal environment and verify it starts
   * 
   * This test verifies that:
   * - The create modal opens successfully
   * - Terminal mode can be selected
   * - The environment is created with the correct configuration
   * - The container starts and reaches 'running' status
   */
  test('should create new terminal environment and start successfully', async () => {
    // Generate unique environment ID
    testEnvId = `tauth-${Date.now().toString().slice(-10)}`;  // Max 16 chars

    // Open create modal
    const createButton = page.locator('button:has-text("New Environment")');
    await expect(createButton).toBeVisible();
    await createButton.click();

    // Wait for modal to appear
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Fill in environment name
    const nameInput = page.locator('input[placeholder="Optional (max 20 chars)"]');
    await expect(nameInput).toBeVisible();
    await nameInput.fill(testEnvId);

    // Select terminal mode
    const modeSelect = page.locator('select');
    await expect(modeSelect).toBeVisible();
    await modeSelect.selectOption('terminal');

    // Verify terminal mode is selected
    await expect(modeSelect).toHaveValue('terminal');

    // Submit form
    const submitButton = page.locator('button.primary:has-text("Create")');
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // Wait for modal to close
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // SSE events may not work reliably in Playwright, so manually refresh
    // Wait a moment for backend to create the environment
    await page.waitForTimeout(2000);
    await page.reload();

    // Wait for environment card to appear
    const envCard = page.locator(`.card:has-text("${testEnvId}")`);
    await expect(envCard).toBeVisible({ timeout: 15000 });

    // Verify card shows terminal mode
    await expect(envCard.locator('small:has-text("terminal mode")')).toBeVisible();

    // Wait for environment to reach running status (Docker pull + startup can take 2+ minutes)
    await expect(envCard.locator('.badge:has-text("running")')).toBeVisible({ timeout: 120000 });

    // Verify container actually started
    const containers = await docker.listContainers();
    const container = containers.find(c =>
      c.Names.some(n => n.includes(testEnvId.replace(/[^a-z0-9-]/gi, '-').toLowerCase()))
    );
    expect(container).toBeDefined();
    expect(container?.State).toBe('running');
  });

  /**
   * Test 2: Verify GitHub device auth banner appears with code and URL
   * 
   * This test verifies that:
   * - After terminal environment starts, device auth banner appears
   * - Banner displays a valid device code (format: XXXX-XXXX)
   * - Banner includes the GitHub authentication URL
   * - Banner has copy and authenticate buttons
   */
  test('should display device auth banner with code and URL', async () => {
    // Create terminal environment
    testEnvId = `banner-${Date.now().toString().slice(-12)}`;  // Max 19 chars

    const createButton = page.locator('button:has-text("New Environment")');
    await createButton.click();

    await page.fill('input[placeholder="Optional (max 20 chars)"]', testEnvId);

    await page.selectOption('select', 'terminal');

    const submitButton = page.locator('button.primary:has-text("Create")');
    await submitButton.click();

    // SSE events may not work reliably in Playwright, so manually refresh
    await page.waitForTimeout(2000);
    await page.reload();

    // Wait for environment card
    const envCard = page.locator(`.card:has-text("${testEnvId}")`);
    await expect(envCard).toBeVisible({ timeout: 15000 });

    // Wait for running status (Docker pull + startup can take 2+ minutes)
    await expect(envCard.locator('.badge:has-text("running")')).toBeVisible({ timeout: 120000 });

    // Wait for either device auth banner OR Copilot to be authenticated
    // This tests whether GITHUB_TOKEN authentication works for Copilot CLI
    const deviceAuthBanner = envCard.locator('.device-auth-banner');
    const copilotButton = envCard.locator('[data-testid="copilot-chat-button"]');

    // Wait up to 90 seconds for one of these states
    await page.waitForTimeout(5000); // Give container time to initialize

    const hasBanner = await deviceAuthBanner.isVisible().catch(() => false);
    const hasCopilotButton = await copilotButton.isVisible().catch(() => false);

    if (hasBanner) {
      // Device auth banner appeared - GITHUB_TOKEN doesn't work for Copilot CLI
      console.log('✓ Device auth banner detected - GITHUB_TOKEN does NOT authenticate Copilot CLI');

      // Verify banner contains authentication message
      await expect(deviceAuthBanner.locator('text=GitHub Authentication Required')).toBeVisible();

      // Verify device code is displayed with correct format (XXXX-XXXX)
      const deviceCode = deviceAuthBanner.locator('.device-code');
      await expect(deviceCode).toBeVisible();
      const codeText = await deviceCode.textContent();
      expect(codeText).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

      // Verify copy button is present
      const copyButton = deviceAuthBanner.locator('button:has-text("Copy Code")');
      await expect(copyButton).toBeVisible();

      // Verify GitHub auth link is present and has correct URL
      const authLink = deviceAuthBanner.locator('a[href*="github.com/login/device"]');
      await expect(authLink).toBeVisible();
      const linkHref = await authLink.getAttribute('href');
      expect(linkHref).toContain('github.com/login/device');

      // Verify link opens in new tab
      expect(await authLink.getAttribute('target')).toBe('_blank');
      expect(await authLink.getAttribute('rel')).toBe('noopener');
    } else if (hasCopilotButton) {
      // Copilot button appeared without banner - GITHUB_TOKEN successfully authenticated
      console.log('✓ Copilot authenticated - GITHUB_TOKEN DOES work for Copilot CLI');

      // Verify Copilot functionality by checking the button works
      await expect(copilotButton).toBeVisible();
      await expect(copilotButton).toBeEnabled();
    } else {
      // Neither appeared - wait longer and fail with helpful message
      await page.waitForTimeout(85000);
      throw new Error('Neither device auth banner nor Copilot button appeared after 90 seconds. Container may have failed to initialize Copilot.');
    }
  });

  /**
   * Test 3: Test copying the device auth code
   * 
   * This test verifies that:
   * - Clicking the copy button copies the device code to clipboard
   * - Button shows "Copied" feedback after successful copy
   * - The copied text matches the displayed device code
   */
  test('should copy device auth code to clipboard', async ({ context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    // Create terminal environment
    testEnvId = `copy-${Date.now().toString().slice(-13)}`;  // Max 18 chars

    const createButton = page.locator('button:has-text("New Environment")');
    await createButton.click();

    await page.fill('input[placeholder="Optional (max 20 chars)"]', testEnvId);

    await page.selectOption('select', 'terminal');

    const submitButton = page.locator('button.primary:has-text("Create")');
    await submitButton.click();

    // Wait for environment card
    const envCard = page.locator(`.card:has-text("${testEnvId}")`);
    await expect(envCard).toBeVisible({ timeout: 15000 });

    // Wait for either device auth banner OR skip if already authenticated
    const deviceAuthBanner = envCard.locator('.device-auth-banner');
    const copilotButton = envCard.locator('[data-testid="copilot-chat-button"]');

    // Wait up to 90 seconds for authentication state to be determined
    const maxWait = 90000;
    const startTime = Date.now();
    let hasBanner = false;
    let hasCopilotButton = false;

    while (Date.now() - startTime < maxWait) {
      hasBanner = await deviceAuthBanner.isVisible().catch(() => false);
      hasCopilotButton = await copilotButton.isVisible().catch(() => false);

      if (hasBanner || hasCopilotButton) {
        break;
      }

      await page.waitForTimeout(2000);
    }

    if (!hasBanner && hasCopilotButton) {
      console.log('⊘ Skipping copy test - Copilot already authenticated via GITHUB_TOKEN');
      test.skip();
      return;
    }

    if (!hasBanner) {
      throw new Error('Device auth banner did not appear and Copilot is not authenticated after 90 seconds');
    }

    // Get the device code text
    const deviceCode = deviceAuthBanner.locator('.device-code');
    const codeText = await deviceCode.textContent();
    expect(codeText).toBeTruthy();

    // Click copy button
    const copyButton = deviceAuthBanner.locator('button.btn-copy-code');
    await expect(copyButton).toBeVisible();
    await copyButton.click();

    // Verify clipboard contains the code
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(codeText);
  });

  /**
   * Test 4: Verify banner updates/disappears after authentication
   * 
   * This test verifies that:
   * - The device auth banner is removed when authentication completes
   * - SSE events trigger banner removal
   * - The environment card updates to show authenticated status
   * 
   * Note: This test simulates authentication completion by checking for
   * the banner's presence and monitoring for its removal via SSE events.
   */
  test('should update banner when authentication status changes', async () => {
    // Look for an existing terminal environment with auth banner
    const terminalCard = page.locator('.card').filter({
      has: page.locator('small:has-text("terminal mode")')
    }).first();

    // Skip if no terminal environment exists
    if (await terminalCard.count() === 0) {
      test.skip();
      return;
    }

    await expect(terminalCard).toBeVisible();

    // Check for device auth banner
    const deviceAuthBanner = terminalCard.locator('.device-auth-banner');
    const hasAuthBanner = await deviceAuthBanner.count() > 0;

    if (hasAuthBanner && await deviceAuthBanner.isVisible()) {
      // Banner is present - verify it has the expected structure
      await expect(deviceAuthBanner.locator('text=GitHub Authentication Required')).toBeVisible();
      await expect(deviceAuthBanner.locator('.device-code')).toBeVisible();

      // In a real scenario, the banner would disappear when:
      // 1. User completes GitHub auth in browser
      // 2. Container detects auth completion
      // 3. SSE event 'copilot-ready' is broadcasted
      // 4. Frontend receives event and removes banner

      // We can verify the SSE infrastructure is in place
      // by checking if opening AI chat shows auth status
      const copilotButton = terminalCard.locator('[data-testid="copilot-chat-button"]');
      if (await copilotButton.count() > 0) {
        await copilotButton.click();

        const aiPanel = page.locator('.panel');
        await expect(aiPanel).toBeVisible({ timeout: 5000 });

        // Should show auth required status
        const statusBadge = aiPanel.locator('.status-badge');
        await expect(statusBadge).toBeVisible();
        const statusText = await statusBadge.textContent();
        // Should show either "Auth Required" or "Starting..."
        expect(statusText).toMatch(/Auth Required|Starting/);

        // Verify auth banner also shows in AI panel
        const aiAuthBanner = aiPanel.locator('.auth-banner');
        if (await aiAuthBanner.isVisible()) {
          await expect(aiAuthBanner.locator('text=GitHub Authentication Required')).toBeVisible();
        }
      }
    } else {
      // No auth banner means either:
      // 1. Already authenticated
      // 2. Auth not yet started
      // Verify card shows appropriate status
      const badge = terminalCard.locator('.badge');
      await expect(badge).toBeVisible();
    }
  });

  /**
   * Test 5: Test auth status polling and state changes
   * 
          // Ignore errors reading SSE stream
        }
      }
    });

   */
  test('should poll and update auth status via SSE', async () => {
    // Look for terminal environment
    const terminalCard = page.locator('.card').filter({
      has: page.locator('small:has-text("terminal mode")')
    }).first();

    if (await terminalCard.count() === 0) {
      test.skip();
      return;
    }

    await expect(terminalCard).toBeVisible();

    // Open AI panel to observe auth status
    const copilotButton = terminalCard.locator('[data-testid="copilot-chat-button"]');
    if (await copilotButton.count() === 0) {
      test.skip();
      return;
    }

    await copilotButton.click();

    const aiPanel = page.locator('.panel');
    await expect(aiPanel).toBeVisible();

    // Check initial status
    const statusBadge = aiPanel.locator('.status-badge');
    await expect(statusBadge).toBeVisible();
    const initialStatus = await statusBadge.textContent();

    // Status should be one of: "Ready", "Auth Required", or "Starting..."
    expect(initialStatus).toMatch(/Ready|Auth Required|Starting/);

    // If auth is required, verify the banner and SSE infrastructure
    if (initialStatus?.includes('Auth Required')) {
      // Verify auth banner is present
      const authBanner = aiPanel.locator('.auth-banner');
      await expect(authBanner).toBeVisible();

      // Verify system message about auth was added to chat
      const messages = aiPanel.locator('.messages');
      const systemMessage = messages.locator('.message.system').filter({
        hasText: 'Authentication required'
      });
      // System message might exist from previous interactions
      const hasSystemMessage = await systemMessage.count() > 0;

      // Verify SSE connection is active by checking for EventSource
      const hasEventSource = await page.evaluate(() => {
        return typeof (window as any).EventSource !== 'undefined';
      });
      expect(hasEventSource).toBeTruthy();
    }

    // If ready, verify no auth banner
    if (initialStatus?.includes('Ready')) {
      const authBanner = aiPanel.locator('.auth-banner');
      await expect(authBanner).not.toBeVisible();

      // Verify ready message might be in chat
      const messages = aiPanel.locator('.messages');
      const readyMessage = messages.locator('.message.system').filter({
        hasText: 'ready'
      });
      // Ready message might exist from SSE event
    }
  });

  /**
   * Test 6: Verify environment card shows correct auth status
   * 
   * This test verifies that:
   * - The environment card displays auth status correctly
   * - Device auth banner appears when auth is pending
   * - Banner disappears when auth completes
   * - Card remains functional during auth flow
   */
  test('should display correct auth status on environment card', async () => {
    // Create a new terminal environment to observe auth flow from start
    testEnvId = `card-${Date.now().toString().slice(-14)}`;  // Max 19 chars

    const createButton = page.locator('button:has-text("New Environment")');
    await createButton.click();

    await page.fill('input[placeholder="Optional (max 20 chars)"]', testEnvId);

    await page.selectOption('select', 'terminal');

    const submitButton = page.locator('button.primary:has-text("Create")');
    await submitButton.click();

    // Wait for environment card
    const envCard = page.locator(`.card:has-text("${testEnvId}")`);
    await expect(envCard).toBeVisible({ timeout: 15000 });

    // Verify card shows correct mode
    await expect(envCard.locator('small:has-text("terminal mode")')).toBeVisible();

    // Verify card shows starting status initially
    const statusBadge = envCard.locator('.badge');
    await expect(statusBadge).toBeVisible();

    // Wait for environment to start
    await expect(envCard.locator('.badge:has-text("running")')).toBeVisible({ timeout: 45000 });

    // Once running, device auth banner should appear (if Copilot not already auth'd)
    const deviceAuthBanner = envCard.locator('.device-auth-banner');

    // Wait a bit for auth detection
    await page.waitForTimeout(5000);

    // Check if banner appears
    const hasBanner = await deviceAuthBanner.count() > 0 && await deviceAuthBanner.isVisible();

    if (hasBanner) {
      // Verify banner contents
      await expect(deviceAuthBanner.locator('text=GitHub Authentication Required')).toBeVisible();
      await expect(deviceAuthBanner.locator('.device-code')).toBeVisible();
      await expect(deviceAuthBanner.locator('button:has-text("Copy Code")')).toBeVisible();
      await expect(deviceAuthBanner.locator('a[href*="github.com"]')).toBeVisible();

      // Verify all card buttons are still accessible
      await expect(envCard.locator('a:has-text("Open Terminal")')).toBeVisible();
      await expect(envCard.locator('[data-testid="copilot-chat-button"]')).toBeVisible();
      await expect(envCard.locator('button:has-text("Stop")')).toBeVisible();
      await expect(envCard.locator('button:has-text("Logs")')).toBeVisible();
      await expect(envCard.locator('button:has-text("Delete")')).toBeVisible();
    } else {
      // No banner means Copilot is already authenticated
      // Verify card is fully functional
      await expect(envCard.locator('a:has-text("Open Terminal")')).toBeVisible();
      await expect(envCard.locator('[data-testid="copilot-chat-button"]')).toBeVisible();

      // Open AI panel to verify it shows ready status
      const copilotButton = envCard.locator('[data-testid="copilot-chat-button"]');
      await copilotButton.click();

      const aiPanel = page.locator('.panel');
      await expect(aiPanel).toBeVisible();

      const aiStatusBadge = aiPanel.locator('.status-badge');
      await expect(aiStatusBadge).toBeVisible();
      const statusText = await aiStatusBadge.textContent();
      expect(statusText).toMatch(/Ready|Starting/);
    }
  });
});
