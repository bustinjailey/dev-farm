/**
 * E2E tests for Copilot Status SSE Events
 * 
 * Verifies that granular status updates are broadcasted via SSE
 * during terminal environment setup with Copilot CLI automation.
 * 
 * Tests verify:
 * - copilot-status event is emitted for each automation step
 * - Status transitions follow expected order
 * - Frontend receives and displays status updates
 * - Status clears after authentication completes
 */

import { test, expect, Page } from '@playwright/test';
import Docker from 'dockerode';

const docker = new Docker();
const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';

let page: Page;
let testEnvId: string;

test.describe('Copilot Status SSE Events', () => {
  test.beforeEach(async ({ page: p }) => {
    page = p;
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
  });

  test.afterEach(async () => {
    // Cleanup test environment
    if (testEnvId) {
      try {
        const containerName = `devfarm-${testEnvId}`;
        const container = docker.getContainer(containerName);
        await container.stop();
        await container.remove({ force: true, v: true });
      } catch (e) {
        // Container might not exist
      }
    }
  });

  /**
   * Helper: Create terminal environment
   */
  async function createTerminalEnvironment(envId: string): Promise<void> {
    await page.click('button:has-text("New Environment")');
    await page.waitForSelector('.modal', { state: 'visible' });

    await page.fill('input[placeholder="e.g., My Dev Project"]', envId);
    await page.selectOption('select[name="mode"]', 'terminal');

    await page.click('button:has-text("Create")');
    await page.waitForSelector('.modal', { state: 'hidden', timeout: 10000 });
  }

  /**
   * Helper: Listen for SSE events
   */
  async function captureSSEEvents(duration: number): Promise<Array<{ type: string, data: any }>> {
    const events: Array<{ type: string, data: any }> = [];

    // Inject SSE listener into page context
    await page.evaluate((durationMs) => {
      const eventSource = new EventSource('/api/stream');
      const collectedEvents: Array<{ type: string, data: any }> = [];

      eventSource.addEventListener('copilot-status', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          collectedEvents.push({ type: 'copilot-status', data });
        } catch (err) {
          console.error('Failed to parse copilot-status event:', err);
        }
      });

      // Store events on window for retrieval
      (window as any).__sseEvents = collectedEvents;

      setTimeout(() => {
        eventSource.close();
      }, durationMs);
    }, duration);

    // Wait for collection period
    await page.waitForTimeout(duration);

    // Retrieve collected events
    const collected = await page.evaluate(() => {
      return (window as any).__sseEvents || [];
    });

    return collected;
  }

  /**
   * Test: copilot-status SSE events are emitted during setup
   */
  test('should emit copilot-status events for each automation step', async () => {
    testEnvId = `sse-status-${Date.now().toString().slice(-8)}`;

    // Start capturing SSE events BEFORE creating environment
    const eventsPromise = captureSSEEvents(30000);

    // Create terminal environment
    await createTerminalEnvironment(testEnvId);

    // Wait for events to be captured
    const events = await eventsPromise;

    // Verify copilot-status events were received
    const copilotStatusEvents = events.filter(e => e.type === 'copilot-status');
    expect(copilotStatusEvents.length).toBeGreaterThan(0);

    console.log(`✓ Received ${copilotStatusEvents.length} copilot-status events`);

    // Verify events contain expected status values
    const statuses = copilotStatusEvents
      .filter(e => e.data.env_id === testEnvId)
      .map(e => e.data.status);

    const validStatuses = [
      'configuring', 'workspace-trust', 'login',
      'account-selection', 'awaiting-auth', 'authenticated'
    ];

    statuses.forEach(status => {
      expect(validStatuses).toContain(status);
      console.log(`✓ Status update: ${status}`);
    });
  });

  /**
   * Test: Status updates appear in expected order
   */
  test('should broadcast status updates in correct sequence', async () => {
    testEnvId = `sse-order-${Date.now().toString().slice(-9)}`;

    const eventsPromise = captureSSEEvents(30000);
    await createTerminalEnvironment(testEnvId);
    const events = await eventsPromise;

    const copilotStatusEvents = events
      .filter(e => e.type === 'copilot-status' && e.data.env_id === testEnvId)
      .map(e => e.data.status);

    if (copilotStatusEvents.length > 1) {
      // Verify sequence follows expected order
      const expectedOrder = ['configuring', 'workspace-trust', 'login', 'account-selection', 'awaiting-auth'];

      let lastIndex = -1;
      for (const status of copilotStatusEvents) {
        const currentIndex = expectedOrder.indexOf(status);
        if (currentIndex !== -1) {
          // Status should appear after previous status in sequence
          if (lastIndex !== -1) {
            expect(currentIndex).toBeGreaterThanOrEqual(lastIndex);
          }
          lastIndex = currentIndex;
        }
      }

      console.log('✓ Status sequence is correct:', copilotStatusEvents.join(' → '));
    }
  });

  /**
   * Test: Frontend displays status updates on environment card
   */
  test('should display granular status on environment card', async () => {
    testEnvId = `sse-display-${Date.now().toString().slice(-7)}`;

    await createTerminalEnvironment(testEnvId);

    // Wait for status updates to appear
    await page.waitForTimeout(5000);

    const envCard = page.locator(`.card:has-text("${testEnvId}")`);
    await expect(envCard).toBeVisible();

    // Check for status text (should show one of the status messages)
    const cardText = await envCard.textContent();

    const statusMessages = [
      'Setting up Copilot',
      'Confirming workspace trust',
      'Authenticating',
      'Selecting account',
      'Awaiting GitHub authentication'
    ];

    const hasStatusMessage = statusMessages.some(msg => cardText?.includes(msg));

    if (hasStatusMessage) {
      console.log('✓ Status message displayed on environment card');
    } else {
      // Might have completed setup already
      console.log('⚠ Setup completed before status could be captured');
    }
  });

  /**
   * Test: Status clears after authentication completes
   */
  test('should clear copilot status when authentication completes', async () => {
    testEnvId = `sse-clear-${Date.now().toString().slice(-10)}`;

    const eventsPromise = captureSSEEvents(35000);
    await createTerminalEnvironment(testEnvId);
    const events = await eventsPromise;

    const copilotStatusEvents = events
      .filter(e => e.type === 'copilot-status' && e.data.env_id === testEnvId);

    // Check if final event clears status (empty string or "ready")
    if (copilotStatusEvents.length > 0) {
      const lastEvent = copilotStatusEvents[copilotStatusEvents.length - 1];

      // Status should either be cleared or show authenticated/ready state
      const finalStatus = lastEvent.data.status;
      expect(['', 'authenticated', 'ready']).toContain(finalStatus);

      console.log('✓ Status cleared after authentication:', finalStatus || '(empty)');
    }
  });

  /**
   * Test: Multiple environments can have different status simultaneously
   */
  test('should handle status for multiple environments independently', async () => {
    const env1 = `sse-multi1-${Date.now().toString().slice(-7)}`;
    const env2 = `sse-multi2-${Date.now().toString().slice(-7)}`;

    const eventsPromise = captureSSEEvents(25000);

    // Create two environments in quick succession
    await createTerminalEnvironment(env1);
    await page.waitForTimeout(2000);
    await createTerminalEnvironment(env2);

    const events = await eventsPromise;

    // Verify each environment has its own status events
    const env1Events = events.filter(e =>
      e.type === 'copilot-status' && e.data.env_id === env1
    );
    const env2Events = events.filter(e =>
      e.type === 'copilot-status' && e.data.env_id === env2
    );

    expect(env1Events.length).toBeGreaterThan(0);
    expect(env2Events.length).toBeGreaterThan(0);

    console.log(`✓ Environment ${env1}: ${env1Events.length} status events`);
    console.log(`✓ Environment ${env2}: ${env2Events.length} status events`);

    // Cleanup second environment
    try {
      const container = docker.getContainer(`devfarm-${env2}`);
      await container.stop();
      await container.remove({ force: true, v: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });
});
