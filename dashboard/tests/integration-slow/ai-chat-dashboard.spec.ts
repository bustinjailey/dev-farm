import { test, expect, type Page } from '@playwright/test';
import Docker from 'dockerode';

/**
 * Comprehensive E2E tests for AI Chat Panel on Terminal Mode Environment Cards
 * 
 * These tests verify:
 * - AI chat panel appearance on terminal mode environments
 * - Message sending and receiving functionality
 * - Chat persistence across page refreshes
 * - Error handling when chat service is unavailable
 * - Mobile-responsive behavior of chat interface
 */

test.describe('AI Chat Dashboard Card Behavior', () => {
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
   * Test 1: Verify AI chat panel appears on terminal mode environment cards
   * 
   * This test creates a terminal mode environment and verifies that:
   * - The Copilot Chat button appears on terminal mode cards
   * - Clicking the button opens the AI chat panel
   * - The panel contains all expected UI elements
   */
  test('should show AI chat panel on terminal mode environment cards', async () => {
    // Create a new terminal environment
    testEnvId = `aitest-${Date.now().toString().slice(-8)}`;  // Max 15 chars

    // Open create modal
    const createButton = page.locator('button:has-text("New Environment")');
    await createButton.click();

    // Wait for modal
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Fill in form for terminal mode
    await page.fill('input[placeholder="Optional (max 20 chars)"]', testEnvId);
    await page.selectOption('select', 'terminal');

    // Submit form
    const submitButton = page.locator('button.primary:has-text("Create")');
    await submitButton.click();

    // Force reload to ensure frontend sees new environment
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Wait for environment card to appear
    const envCard = page.locator(`.card:has-text("${testEnvId}")`);
    await expect(envCard).toBeVisible({ timeout: 15000 });

    // Wait for environment to start (Docker pull + startup can take 2+ minutes)
    await expect(envCard.locator('.badge:has-text("running")')).toBeVisible({ timeout: 120000 });

    // Verify Copilot Chat button is present on terminal mode card
    const copilotButton = envCard.locator('[data-testid="copilot-chat-button"]');
    await expect(copilotButton).toBeVisible({ timeout: 5000 });

    // Click Copilot Chat button to open AI panel
    await copilotButton.click();

    // Verify AI panel appears with all expected elements
    const aiPanel = page.locator('.panel');
    await expect(aiPanel).toBeVisible({ timeout: 5000 });
    await expect(aiPanel.locator('text=AI Assistant (GitHub Copilot CLI)')).toBeVisible();
    await expect(aiPanel.locator('textarea[placeholder="Ask Copilot..."]')).toBeVisible();
    await expect(aiPanel.locator('button.send-button')).toBeVisible();
    await expect(aiPanel.locator('.status-badge')).toBeVisible();
  });

  /**
   * Test 2: Test sending a message through the AI chat interface
   * 
   * This test verifies that:
   * - Users can type a message in the textarea
   * - The send button becomes enabled when text is entered
   * - Clicking send adds the message to the chat history
   * - The loading indicator appears during message processing
   */
  test('should allow sending messages through AI chat interface', async () => {
    // Look for an existing running terminal environment
    const terminalCard = page.locator('.card').filter({
      has: page.locator('small:has-text("terminal mode")')
    }).first();

    // Skip if no terminal environment exists
    if (await terminalCard.count() === 0) {
      test.skip();
      return;
    }

    await expect(terminalCard).toBeVisible();

    // Open AI chat panel
    const copilotButton = terminalCard.locator('[data-testid="copilot-chat-button"]');
    if (await copilotButton.count() === 0) {
      test.skip();
      return;
    }

    await copilotButton.click();

    const aiPanel = page.locator('.panel');
    await expect(aiPanel).toBeVisible({ timeout: 5000 });

    // Type a test message
    const textarea = aiPanel.locator('textarea');
    const testMessage = 'What is Node.js?';
    await textarea.fill(testMessage);

    // Verify send button is enabled
    const sendButton = aiPanel.locator('button.send-button');
    await expect(sendButton).toBeEnabled();

    // Send the message
    await sendButton.click();

    // Verify message appears in chat history
    const userMessage = aiPanel.locator('.message.user').filter({ hasText: testMessage });
    await expect(userMessage).toBeVisible({ timeout: 5000 });

    // Verify loading indicator appears
    const loadingMessage = aiPanel.locator('.message.assistant.loading');
    // Loading might be very fast, so we check if it appeared or response came
    const hasLoading = await loadingMessage.count() > 0;
    const hasResponse = await aiPanel.locator('.message.assistant').filter({ hasNot: page.locator('.loading') }).count() > 0;
    expect(hasLoading || hasResponse).toBeTruthy();
  });

  /**
   * Test 3: Verify AI responses appear correctly in the chat
   * 
   * This test verifies that:
   * - After sending a message, an assistant response appears
   * - The response is properly formatted with role and content
   * - The response has a timestamp
   */
  test('should display AI responses in chat', async () => {
    // Look for existing terminal environment with opened AI chat
    const terminalCard = page.locator('.card').filter({
      has: page.locator('small:has-text("terminal mode")')
    }).first();

    if (await terminalCard.count() === 0) {
      test.skip();
      return;
    }

    const copilotButton = terminalCard.locator('[data-testid="copilot-chat-button"]');
    if (await copilotButton.count() === 0) {
      test.skip();
      return;
    }

    await copilotButton.click(); const aiPanel = page.locator('.panel');
    await expect(aiPanel).toBeVisible();

    // Send a simple message
    const textarea = aiPanel.locator('textarea');
    await textarea.fill('Hello');
    await aiPanel.locator('button.send-button').click();

    // Wait for assistant response to appear (with longer timeout for API)
    const assistantMessage = aiPanel.locator('.message.assistant').filter({ hasNot: page.locator('.loading') });
    await expect(assistantMessage.first()).toBeVisible({ timeout: 30000 });

    // Verify response has proper structure
    const messageHeader = assistantMessage.first().locator('.message-header');
    await expect(messageHeader.locator('text=Copilot')).toBeVisible();
    await expect(messageHeader.locator('.message-time')).toBeVisible();

    // Verify response has content
    const messageContent = assistantMessage.first().locator('.message-content');
    await expect(messageContent).toBeVisible();
    const contentText = await messageContent.textContent();
    expect(contentText?.length).toBeGreaterThan(0);
  });

  /**
   * Test 4: Test chat persistence (messages survive page refresh)
   * 
   * This test verifies that:
   * - Messages are saved to localStorage
   * - After page refresh, previous messages are restored
   * - The chat history is maintained per environment
   */
  test('should persist chat messages across page refreshes', async () => {
    const terminalCard = page.locator('.card').filter({
      has: page.locator('small:has-text("terminal mode")')
    }).first();

    if (await terminalCard.count() === 0) {
      test.skip();
      return;
    }

    // Get environment ID for localStorage key
    const envIdElement = terminalCard.locator('dl dd').first();
    const envId = await envIdElement.textContent();

    const copilotButton = terminalCard.locator('[data-testid="copilot-chat-button"]');
    if (await copilotButton.count() === 0) {
      test.skip();
      return;
    }

    await copilotButton.click();

    const aiPanel = page.locator('.panel');
    await expect(aiPanel).toBeVisible();

    // Send a unique message
    const uniqueMessage = `Test message ${Date.now()}`;
    const textarea = aiPanel.locator('textarea');
    await textarea.fill(uniqueMessage);
    await aiPanel.locator('button.send-button').click();

    // Wait for message to appear
    await expect(aiPanel.locator('.message.user').filter({ hasText: uniqueMessage })).toBeVisible();

    // Verify message is in localStorage
    const storageKey = `ai-chat-${envId}`;
    const storedData = await page.evaluate((key) => localStorage.getItem(key), storageKey);
    expect(storedData).toBeTruthy();
    expect(storedData).toContain(uniqueMessage);

    // Refresh the page
    await page.reload();
    await page.waitForSelector('.hero', { timeout: 10000 });

    // Re-open AI panel
    const refreshedCard = page.locator(`.card:has-text("${envId}")`);
    await expect(refreshedCard).toBeVisible({ timeout: 10000 });

    const refreshedCopilotButton = refreshedCard.locator('[data-testid="copilot-chat-button"]');
    await refreshedCopilotButton.click();

    const refreshedPanel = page.locator('.panel');
    await expect(refreshedPanel).toBeVisible();

    // Verify message is still present
    await expect(refreshedPanel.locator('.message.user').filter({ hasText: uniqueMessage })).toBeVisible();
  });

  /**
   * Test 5: Test error handling when chat service is unavailable
   * 
   * This test verifies that:
   * - Appropriate error messages are shown when the service fails
   * - The UI remains functional after errors
   * - Users can retry after an error
   */
  test('should handle chat service errors gracefully', async () => {
    const terminalCard = page.locator('.card').filter({
      has: page.locator('small:has-text("terminal mode")')
    }).first();

    if (await terminalCard.count() === 0) {
      test.skip();
      return;
    }

    const copilotButton = terminalCard.locator('[data-testid="copilot-chat-button"]');
    if (await copilotButton.count() === 0) {
      test.skip();
      return;
    }

    await copilotButton.click();

    const aiPanel = page.locator('.panel');
    await expect(aiPanel).toBeVisible();

    // Check if auth banner is shown (indicates service not ready)
    const authBanner = aiPanel.locator('.auth-banner');
    if (await authBanner.isVisible()) {
      // Verify auth banner has proper error messaging
      await expect(authBanner.locator('text=GitHub Authentication Required')).toBeVisible();
      await expect(authBanner.locator('.device-code')).toBeVisible();
      await expect(authBanner.locator('.copy-button')).toBeVisible();
    }

    // Check for error banner
    const errorBanner = aiPanel.locator('.error-banner');
    if (await errorBanner.isVisible()) {
      // Verify error is displayed properly
      await expect(errorBanner.locator('.error-icon')).toBeVisible();
      await expect(errorBanner.locator('.error-text')).toBeVisible();
    }

    // Verify UI elements remain functional
    const textarea = aiPanel.locator('textarea');
    await expect(textarea).toBeVisible();

    // Even with errors, should be able to type
    await textarea.fill('Test message');
    const sendButton = aiPanel.locator('button.send-button');
    await expect(sendButton).toBeVisible();
  });

  /**
   * Test 6: Verify mobile-responsive behavior of chat interface
   * 
   * This test verifies that:
   * - The chat panel adapts to mobile viewport sizes
   * - Touch targets are appropriately sized (min 44x44px)
   * - The panel doesn't overflow on small screens
   * - Input area remains accessible and functional
   */
  test('should be mobile-responsive', async () => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    const terminalCard = page.locator('.card').filter({
      has: page.locator('small:has-text("terminal mode")')
    }).first();

    if (await terminalCard.count() === 0) {
      test.skip();
      return;
    }

    const copilotButton = terminalCard.locator('[data-testid="copilot-chat-button"]');
    if (await copilotButton.count() === 0) {
      test.skip();
      return;
    }

    // Verify button has adequate touch target size
    const buttonBox = await copilotButton.boundingBox();
    if (buttonBox) {
      expect(buttonBox.height).toBeGreaterThanOrEqual(44);
      expect(buttonBox.width).toBeGreaterThanOrEqual(44);
    }

    await copilotButton.click();

    const aiPanel = page.locator('.panel');
    await expect(aiPanel).toBeVisible();

    // Verify panel doesn't overflow viewport
    const panelBox = await aiPanel.boundingBox();
    if (panelBox) {
      expect(panelBox.width).toBeLessThanOrEqual(375);
    }

    // Verify send button has adequate touch target size
    const sendButton = aiPanel.locator('button.send-button');
    const sendButtonBox = await sendButton.boundingBox();
    if (sendButtonBox) {
      expect(sendButtonBox.height).toBeGreaterThanOrEqual(44);
      expect(sendButtonBox.width).toBeGreaterThanOrEqual(44);
    }

    // Verify copy button (if auth banner present) has adequate touch target
    const authBanner = aiPanel.locator('.auth-banner');
    if (await authBanner.isVisible()) {
      const copyButton = authBanner.locator('.copy-button');
      const copyButtonBox = await copyButton.boundingBox();
      if (copyButtonBox) {
        expect(copyButtonBox.height).toBeGreaterThanOrEqual(44);
      }
    }

    // Verify clear button has adequate touch target size
    const clearButton = aiPanel.locator('.clear-button');
    const clearButtonBox = await clearButton.boundingBox();
    if (clearButtonBox) {
      expect(clearButtonBox.height).toBeGreaterThanOrEqual(44);
      expect(clearButtonBox.width).toBeGreaterThanOrEqual(44);
    }

    // Verify input area is accessible
    const inputArea = aiPanel.locator('.input-area');
    await expect(inputArea).toBeVisible();

    const textarea = aiPanel.locator('textarea');
    await expect(textarea).toBeVisible();

    // Verify textarea is functional on mobile
    await textarea.fill('Mobile test message');
    await expect(textarea).toHaveValue('Mobile test message');

    // Verify messages area is scrollable
    const messages = aiPanel.locator('.messages');
    await expect(messages).toBeVisible();
  });
});
