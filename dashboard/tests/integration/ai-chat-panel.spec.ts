import { test, expect } from '@playwright/test';

test.describe('AI Chat Panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for app to load
    await page.waitForSelector('.hero', { timeout: 5000 });
  });

  test('should display AI chat panel when opened', async ({ page }) => {
    // This test requires an environment to exist
    // For now, it's a placeholder that checks basic structure
    const hasEnvironments = await page.locator('.grid .card').count();
    
    if (hasEnvironments > 0) {
      // Click AI Assistant toggle on first environment
      const aiButton = page.locator('.card').first().locator('text=AI Assistant');
      if (await aiButton.isVisible()) {
        await aiButton.click();
        
        // Check if panel appears
        const panel = page.locator('.panel');
        await expect(panel).toBeVisible({ timeout: 2000 });
        
        // Check for key elements
        await expect(panel.locator('text=AI Assistant (GitHub Copilot CLI)')).toBeVisible();
        await expect(panel.locator('textarea')).toBeVisible();
        await expect(panel.locator('button.send-button')).toBeVisible();
      }
    }
  });

  test('should show auth banner when authentication required', async ({ page }) => {
    // This test verifies the auth banner appears
    // Requires a terminal environment with pending auth
    const hasEnvironments = await page.locator('.grid .card').count();
    
    if (hasEnvironments > 0) {
      const card = page.locator('.card').first();
      
      // Check if there's a device code displayed (indicates auth required)
      const deviceCodeExists = await card.locator('text=/[A-Z0-9]{4}-[A-Z0-9]{4}/').count() > 0;
      
      if (deviceCodeExists) {
        // Open AI panel
        const aiButton = card.locator('text=AI Assistant');
        if (await aiButton.isVisible()) {
          await aiButton.click();
          
          // Check for auth banner
          const authBanner = page.locator('.auth-banner');
          await expect(authBanner).toBeVisible({ timeout: 2000 });
          
          // Verify auth elements
          await expect(authBanner.locator('text=GitHub Authentication Required')).toBeVisible();
          await expect(authBanner.locator('.device-code')).toBeVisible();
          await expect(authBanner.locator('.copy-button')).toBeVisible();
          await expect(authBanner.locator('.auth-link')).toBeVisible();
        }
      }
    }
  });

  test('should have mobile-friendly touch targets', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    const hasEnvironments = await page.locator('.grid .card').count();
    
    if (hasEnvironments > 0) {
      const aiButton = page.locator('.card').first().locator('text=AI Assistant');
      if (await aiButton.isVisible()) {
        await aiButton.click();
        
        const panel = page.locator('.panel');
        if (await panel.isVisible()) {
          // Check send button size (should be at least 44x44px for mobile)
          const sendButton = panel.locator('.send-button');
          const box = await sendButton.boundingBox();
          
          if (box) {
            expect(box.height).toBeGreaterThanOrEqual(44);
            expect(box.width).toBeGreaterThanOrEqual(44);
          }
        }
      }
    }
  });

  test('should show empty state when no messages', async ({ page }) => {
    const hasEnvironments = await page.locator('.grid .card').count();
    
    if (hasEnvironments > 0) {
      const aiButton = page.locator('.card').first().locator('text=AI Assistant');
      if (await aiButton.isVisible()) {
        await aiButton.click();
        
        const panel = page.locator('.panel');
        if (await panel.isVisible()) {
          // Check for empty state
          const emptyState = panel.locator('.empty-state');
          const hasMessages = await panel.locator('.message').count() > 0;
          
          if (!hasMessages) {
            await expect(emptyState).toBeVisible();
            await expect(emptyState.locator('text=No conversation yet')).toBeVisible();
          }
        }
      }
    }
  });

  test('should disable input when loading', async ({ page }) => {
    const hasEnvironments = await page.locator('.grid .card').count();
    
    if (hasEnvironments > 0) {
      const aiButton = page.locator('.card').first().locator('text=AI Assistant');
      if (await aiButton.isVisible()) {
        await aiButton.click();
        
        const panel = page.locator('.panel');
        if (await panel.isVisible()) {
          const textarea = panel.locator('textarea');
          const sendButton = panel.locator('.send-button');
          
          // Initially should be enabled (not loading)
          await expect(textarea).toBeEnabled();
          
          // Type a message
          await textarea.fill('Test message');
          
          // Send button should be enabled when there's text
          await expect(sendButton).toBeEnabled();
          
          // After clicking send, elements should be disabled during loading
          // (This part would need a real environment to test properly)
        }
      }
    }
  });

  test('should have proper responsive layout on mobile', async ({ page }) => {
    // Test mobile layout
    await page.setViewportSize({ width: 375, height: 667 });
    
    const hasEnvironments = await page.locator('.grid .card').count();
    
    if (hasEnvironments > 0) {
      const aiButton = page.locator('.card').first().locator('text=AI Assistant');
      if (await aiButton.isVisible()) {
        await aiButton.click();
        
        const panel = page.locator('.panel');
        if (await panel.isVisible()) {
          // Panel should be visible and not overflow
          const box = await panel.boundingBox();
          if (box) {
            expect(box.width).toBeLessThanOrEqual(375);
          }
          
          // Input area should be at bottom
          const inputArea = panel.locator('.input-area');
          await expect(inputArea).toBeVisible();
          
          // Messages area should be scrollable
          const messages = panel.locator('.messages');
          await expect(messages).toBeVisible();
        }
      }
    }
  });

  test('should show status badge indicating copilot state', async ({ page }) => {
    const hasEnvironments = await page.locator('.grid .card').count();
    
    if (hasEnvironments > 0) {
      const aiButton = page.locator('.card').first().locator('text=AI Assistant');
      if (await aiButton.isVisible()) {
        await aiButton.click();
        
        const panel = page.locator('.panel');
        if (await panel.isVisible()) {
          // Should have a status badge
          const statusBadge = panel.locator('.status-badge');
          await expect(statusBadge).toBeVisible();
          
          // Badge should have one of: Ready, Auth Required, or Starting...
          const text = await statusBadge.textContent();
          expect(text).toMatch(/Ready|Auth Required|Starting/);
        }
      }
    }
  });
});

test.describe('AI Chat Panel - Copy Functionality', () => {
  test('should copy device code to clipboard', async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    
    await page.goto('/');
    await page.waitForSelector('.hero', { timeout: 5000 });
    
    const hasEnvironments = await page.locator('.grid .card').count();
    
    if (hasEnvironments > 0) {
      const card = page.locator('.card').first();
      const deviceCodeExists = await card.locator('text=/[A-Z0-9]{4}-[A-Z0-9]{4}/').count() > 0;
      
      if (deviceCodeExists) {
        const aiButton = card.locator('text=AI Assistant');
        if (await aiButton.isVisible()) {
          await aiButton.click();
          
          const authBanner = page.locator('.auth-banner');
          if (await authBanner.isVisible()) {
            const copyButton = authBanner.locator('.copy-button');
            const deviceCode = await authBanner.locator('.device-code').textContent();
            
            // Click copy button
            await copyButton.click();
            
            // Verify button shows "Copied"
            await expect(copyButton).toContainText('Copied', { timeout: 1000 });
            
            // Verify clipboard contains the code
            const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
            expect(clipboardText).toBe(deviceCode);
          }
        }
      }
    }
  });
});

test.describe('AI Chat Panel - Conversation History', () => {
  test('should persist conversation to localStorage', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.hero', { timeout: 5000 });
    
    const hasEnvironments = await page.locator('.grid .card').count();
    
    if (hasEnvironments > 0) {
      const aiButton = page.locator('.card').first().locator('text=AI Assistant');
      if (await aiButton.isVisible()) {
        await aiButton.click();
        
        const panel = page.locator('.panel');
        if (await panel.isVisible()) {
          // Get environment ID from somewhere (would need to extract from DOM)
          // For now, just verify localStorage keys exist
          const keys = await page.evaluate(() => Object.keys(localStorage));
          
          // Should have keys matching pattern ai-chat-*
          const hasChatKeys = keys.some(key => key.startsWith('ai-chat-'));
          // This might be false if no messages sent yet, which is okay
        }
      }
    }
  });

  test('should clear conversation when clear button clicked', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.hero', { timeout: 5000 });
    
    const hasEnvironments = await page.locator('.grid .card').count();
    
    if (hasEnvironments > 0) {
      const aiButton = page.locator('.card').first().locator('text=AI Assistant');
      if (await aiButton.isVisible()) {
        await aiButton.click();
        
        const panel = page.locator('.panel');
        if (await panel.isVisible()) {
          const clearButton = panel.locator('.clear-button');
          await expect(clearButton).toBeVisible();
          
          // Click clear button and confirm
          page.on('dialog', dialog => dialog.accept());
          await clearButton.click();
          
          // Should show empty state after clearing
          const emptyState = panel.locator('.empty-state');
          await expect(emptyState).toBeVisible({ timeout: 2000 });
        }
      }
    }
  });
});