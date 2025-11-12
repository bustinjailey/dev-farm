/**
 * E2E test verifying AI Chat Echo Bug fix
 * 
 * BUG: copilot-session-manager.sh line 199 had substring filter that
 * skipped Copilot responses containing words from user's query
 * 
 * FIX: Removed substring filter, now uses prompt-marker-only parsing
 * - Captures everything after '> ' prompt
 * - Stops at next '>' prompt
 * - No longer filters responses based on input text
 * 
 * This test verifies:
 * - AI chat receives actual Copilot responses
 * - Responses are NOT echoed user input
 * - Responses contain substantive content from Copilot
 * - Echo bug (substring filter) does not occur
 */

import { test, expect } from '@playwright/test';

test.describe('AI Chat Echo Bug Fix', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.hero', { timeout: 10000 });
  });

  test('should receive actual Copilot response, not echo (bug fixed)', async ({ page }) => {

    // Open create modal
    const createButton = page.locator('button:has-text("New Environment")');
    await createButton.click();

    // Wait for modal
    const modal = page.locator('.modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Fill in form (terminal is default mode)
    await page.fill('input[placeholder="Optional (max 20 chars)"]', 'echo-fix-test');

    // Submit form
    const submitButton = page.locator('button.primary:has-text("Create")');
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // Wait for modal to close
    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // SSE events may not work reliably in Playwright, so manually refresh
    await page.waitForTimeout(2000);
    await page.reload();

    // Wait for environment card to appear
    const envCard = page.locator('.card:has-text("echo-fix-test")');
    await expect(envCard).toBeVisible({ timeout: 15000 });

    // Wait for environment to start running
    await expect(envCard.locator('.badge:has-text("running")')).toBeVisible({ timeout: 120000 });

    // Wait for Copilot authentication (may require manual intervention)
    await page.waitForSelector('[data-auth-status="authenticated"]', { timeout: 120000 });

    // Open AI Chat panel
    await page.click('[data-testid="ai-chat-button"]');

    // CRITICAL TEST: Send message with common words that Copilot might use in response
    // OLD BUG: Substring filter would skip response if it contained "python" or "code"
    const testMessage = 'Write a simple python function';
    await page.fill('[data-testid="chat-input"]', testMessage);
    await page.click('[data-testid="send-button"]');

    // Wait for response
    await page.waitForSelector('[data-role="assistant"]', { timeout: 30000 });

    // Get the response
    const response = await page.textContent('[data-role="assistant"]:last-of-type');

    // VERIFICATION: Response should NOT be echo
    expect(response).not.toBe(testMessage);
    expect(response).not.toContain('> Write a simple python function');  // No prompt echo

    // VERIFICATION: Response should be substantive content from Copilot
    expect(response!.length).toBeGreaterThan(testMessage.length);

    // VERIFICATION: Response likely contains keywords from query (now works!)
    // OLD BUG: Would skip response if it contained "python" or "function"
    // NEW: Response should include code/explanation with these terms
    const hasKeywords =
      response!.toLowerCase().includes('python') ||
      response!.toLowerCase().includes('function') ||
      response!.toLowerCase().includes('def');

    expect(hasKeywords).toBe(true);

    console.log('✓ Echo bug fixed - User message:', testMessage);
    console.log('✓ Echo bug fixed - AI response:', response);
    console.log('✓ Response contains relevant keywords (not filtered out)');
  });

  test('should handle multiple messages without echo bug', async ({ page }) => {
    const testId = `multi-msg-${Date.now().toString().slice(-7)}`;

    // Create environment
    await page.click('button:has-text("New Environment")');
    await page.fill('input[placeholder="Optional (max 20 chars)"]', testId);
    await page.click('button.primary:has-text("Create")');

    await page.waitForTimeout(2000);
    await page.reload();

    const envCard = page.locator(`.card:has-text("${testId}")`);
    await expect(envCard.locator('.badge:has-text("running")')).toBeVisible({ timeout: 120000 });
    await page.waitForSelector('[data-auth-status="authenticated"]', { timeout: 120000 });

    // Open AI Chat
    await page.click('[data-testid="ai-chat-button"]');

    // Send multiple messages with overlapping keywords
    const messages = [
      'What is Python?',
      'Show me Python code',
      'Explain Python functions'
    ];

    for (const msg of messages) {
      await page.fill('[data-testid="chat-input"]', msg);
      await page.click('[data-testid="send-button"]');

      // Wait for response
      await page.waitForTimeout(5000);

      const responses = await page.locator('[data-role="assistant"]').allTextContents();
      const lastResponse = responses[responses.length - 1];

      // Verify NOT echo
      expect(lastResponse).not.toBe(msg);
      expect(lastResponse.length).toBeGreaterThan(msg.length);

      console.log(`✓ Message ${messages.indexOf(msg) + 1}: No echo detected`);
    }

    console.log('✓ Multiple messages handled correctly without echo bug');
  });
});