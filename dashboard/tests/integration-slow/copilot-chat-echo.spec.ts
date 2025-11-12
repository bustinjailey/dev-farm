import { test, expect } from '@playwright/test';
import Docker from 'dockerode';

test.describe('Copilot Chat Echo Bug Prevention', () => {
  let docker: Docker;
  let testEnvId: string;

  test.beforeAll(() => {
    docker = new Docker();
  });

  test('AI chat should return Copilot response, not echo user message', async ({ page }) => {
    // Create a terminal environment
    await page.goto('/');
    await page.waitForSelector('.hero', { timeout: 10000 });

    const createButton = page.locator('button:has-text("New Environment")');
    await createButton.click();

    const modal = page.locator('.modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    testEnvId = `chat-test-${Date.now().toString().slice(-8)}`;
    await page.fill('input[placeholder*="Optional"]', testEnvId);

    // Terminal mode is the default, verify it's selected
    const modeSelect = modal.locator('select');
    await expect(modeSelect).toHaveValue('terminal');

    const submitButton = page.locator('button.primary:has-text("Create")');
    await submitButton.click();

    await expect(modal).not.toBeVisible({ timeout: 5000 });

    // Wait for container to be running
    let containerRunning = false;
    let container;

    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(5000);

      const containers = await docker.listContainers({ all: true });
      container = containers.find(c => c.Names.some(n => n.includes(testEnvId)));

      if (container && container.State === 'running') {
        containerRunning = true;
        break;
      }
    }

    expect(containerRunning).toBeTruthy();

    if (!container) {
      throw new Error('Container not found');
    }

    // Wait for Copilot CLI to be installed
    await page.waitForTimeout(15000);

    // Reload page to see the environment
    await page.reload();
    await page.waitForTimeout(2000);

    // Find the environment card
    const envCard = page.locator(`.card:has-text("${testEnvId}")`);
    await expect(envCard).toBeVisible({ timeout: 10000 });

    // Click Copilot Chat button
    const copilotButton = envCard.locator('[data-testid="copilot-chat-button"]');
    await copilotButton.click();

    // Wait for AI chat panel to appear
    const chatPanel = page.locator('.ai-chat-panel');
    await expect(chatPanel).toBeVisible({ timeout: 5000 });

    // Send a simple test message
    const testMessage = 'hello';
    const chatInput = chatPanel.locator('input[placeholder="Ask Copilot..."]');
    await chatInput.fill(testMessage);
    await chatInput.press('Enter');

    // Wait for response (Copilot takes time)
    await page.waitForTimeout(10000);

    // Get the chat messages
    const messages = page.locator('.message');
    const messageCount = await messages.count();

    expect(messageCount).toBeGreaterThanOrEqual(2); // User message + Copilot response

    // Get the last message (Copilot's response)
    const lastMessage = messages.nth(messageCount - 1);
    const lastMessageText = await lastMessage.textContent();

    console.log('User message:', testMessage);
    console.log('Copilot response:', lastMessageText);

    // Verify the response is NOT just an echo of the user message
    expect(lastMessageText).toBeDefined();
    expect(lastMessageText).not.toBe(testMessage);
    expect(lastMessageText).not.toBe(`> ${testMessage}`);

    // Copilot should respond with more than just echoing the input
    // A real Copilot response would be longer or at least different content
    const isEcho = lastMessageText?.toLowerCase().trim() === testMessage.toLowerCase().trim();
    expect(isEcho).toBe(false);

    // Verify it contains actual Copilot response indicators
    // Copilot usually responds with helpful text, not just echoes
    if (lastMessageText) {
      const hasSubstance = lastMessageText.length > testMessage.length * 2;
      expect(hasSubstance).toBe(true);
    }
  });

  test.afterAll(async () => {
    // Cleanup
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
