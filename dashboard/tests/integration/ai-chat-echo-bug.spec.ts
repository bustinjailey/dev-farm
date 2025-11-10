import { test, expect } from '@playwright/test';

test.describe('AI Chat Echo Bug', () => {
  test('should receive actual Copilot response, not echo', async ({ page }) => {
    // Navigate to dashboard
    await page.goto('/');

    // Create a terminal environment
    await page.click('button:has-text("Create Environment")');
    await page.fill('input[name="name"]', 'ai-chat-test');
    await page.selectOption('select', 'terminal');
    await page.click('button:has-text("Create")');

    // Wait for environment to be ready
    await page.waitForSelector('[data-status="running"]', { timeout: 60000 });

    // Wait for Copilot authentication (may require manual intervention)
    await page.waitForSelector('[data-auth-status="authenticated"]', { timeout: 120000 });

    // Open AI Chat panel
    await page.click('[data-testid="ai-chat-button"]');

    // Send a simple message
    const testMessage = 'Hello';
    await page.fill('[data-testid="chat-input"]', testMessage);
    await page.click('[data-testid="send-button"]');

    // Wait for response
    await page.waitForSelector('[data-role="assistant"]', { timeout: 30000 });

    // Get the response
    const response = await page.textContent('[data-role="assistant"]:last-of-type');

    // The response should NOT be just the echo of our message
    expect(response).not.toBe(testMessage);
    expect(response).not.toContain('> Hello');  // Should not contain prompt echo

    // The response should be from Copilot (containing actual content)
    expect(response!.length).toBeGreaterThan(testMessage.length);

    console.log('User message:', testMessage);
    console.log('AI response:', response);
  });
});