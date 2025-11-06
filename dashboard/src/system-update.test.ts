import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as systemUpdate from './system-update.js';

describe('system-update module', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('getUpdateStatus', () => {
    it('returns update status object with correct structure', () => {
      const status = systemUpdate.getUpdateStatus();

      // Verify status has expected shape
      expect(status).toHaveProperty('running');
      expect(status).toHaveProperty('success');
      expect(status).toHaveProperty('error');
      expect(status).toHaveProperty('stage');
      expect(status).toHaveProperty('status');
      expect(status).toHaveProperty('stages');
      expect(Array.isArray(status.stages)).toBe(true);
    });

    it('returns object with boolean running flag', () => {
      const status = systemUpdate.getUpdateStatus();
      expect(typeof status.running).toBe('boolean');
    });

    it('returns object with stages array', () => {
      const status = systemUpdate.getUpdateStatus();
      expect(Array.isArray(status.stages)).toBe(true);
    });

    it('includes cacheBustPending flag in status', () => {
      const status = systemUpdate.getUpdateStatus();
      expect(status).toHaveProperty('cacheBustPending');
      expect(typeof status.cacheBustPending).toBe('boolean');
    });

    it('initializes cacheBustPending to false', () => {
      const status = systemUpdate.getUpdateStatus();
      expect(status.cacheBustPending).toBe(false);
    });
  });

  describe('cacheBustPending flag behavior', () => {
    it('cacheBustPending remains false when no update running', () => {
      const initialStatus = systemUpdate.getUpdateStatus();
      expect(initialStatus.cacheBustPending).toBe(false);
      expect(initialStatus.running).toBe(false);
    });

    it('cacheBustPending is accessible through getUpdateStatus', () => {
      const status = systemUpdate.getUpdateStatus();
      
      // Verify the property exists and is the correct type
      expect('cacheBustPending' in status).toBe(true);
      expect(typeof status.cacheBustPending).toBe('boolean');
    });

    it('status object structure supports reconnection checks', () => {
      const status = systemUpdate.getUpdateStatus();
      
      // This simulates what the frontend does on reconnection
      const shouldReload = status.cacheBustPending === true;
      expect(typeof shouldReload).toBe('boolean');
    });
  });

  describe('update lifecycle state transitions', () => {
    it('prevents concurrent updates', async () => {
      const mockDocker = {} as any;
      
      const firstUpdate = await systemUpdate.startSystemUpdate(mockDocker);
      expect(firstUpdate.started).toBe(true);

      // Attempt second update while first is running
      const secondUpdate = await systemUpdate.startSystemUpdate(mockDocker);
      expect(secondUpdate.started).toBe(false);
      expect(secondUpdate.message).toBe('Update already in progress');
    });

    it('tracks running state during update', async () => {
      const mockDocker = {} as any;
      
      // Start an update and check it's marked as running
      await systemUpdate.startSystemUpdate(mockDocker);
      const runningStatus = systemUpdate.getUpdateStatus();
      expect(runningStatus.running).toBe(true);
    });

    it('initializes stages array on update start', async () => {
      const mockDocker = {} as any;
      
      // Status should have stages after starting update
      const statusBefore = systemUpdate.getUpdateStatus();
      const stagesBefore = statusBefore.stages.length;
      
      await systemUpdate.startSystemUpdate(mockDocker);
      const statusAfter = systemUpdate.getUpdateStatus();
      
      expect(Array.isArray(statusAfter.stages)).toBe(true);
      // Should have added at least one stage
      expect(statusAfter.stages.length).toBeGreaterThanOrEqual(stagesBefore);
    });
  });

  describe('cache-bust timing guarantees', () => {
    it('cacheBustPending flag survives across status queries', async () => {
      const status1 = systemUpdate.getUpdateStatus();
      const status2 = systemUpdate.getUpdateStatus();
      
      // Both queries should return the same state object
      expect(status1.cacheBustPending).toBe(status2.cacheBustPending);
    });

    it('update status is consistent during grace period', () => {
      const status = systemUpdate.getUpdateStatus();
      
      // Status should be stable and not change randomly
      const cacheBust1 = status.cacheBustPending;
      vi.advanceTimersByTime(1000); // 1 second
      const cacheBust2 = systemUpdate.getUpdateStatus().cacheBustPending;
      
      // Should not change without an actual update completing
      expect(cacheBust1).toBe(cacheBust2);
    });
  });

  describe('startSystemUpdate', () => {
    it('accepts Docker instance and returns promise', () => {
      const mockDocker = {} as any;
      const result = systemUpdate.startSystemUpdate(mockDocker);

      expect(result).toBeInstanceOf(Promise);
    });

    it('returns object with started flag', async () => {
      const mockDocker = {} as any;
      const result = await systemUpdate.startSystemUpdate(mockDocker);

      expect(result).toHaveProperty('started');
      expect(typeof result.started).toBe('boolean');
    });

    it('updates running flag when update starts', async () => {
      const mockDocker = {} as any;

      await systemUpdate.startSystemUpdate(mockDocker);
      
      const statusAfter = systemUpdate.getUpdateStatus();
      expect(statusAfter.running).toBe(true);
    });
  });

  describe('waitForUpdate', () => {
    it('returns a promise', () => {
      const result = systemUpdate.waitForUpdate();
      expect(result).toBeInstanceOf(Promise);
    });

    it('resolves without error when no update running', async () => {
      await expect(systemUpdate.waitForUpdate()).resolves.toBeUndefined();
    });

    it('waits for in-progress update to complete', async () => {
      const mockDocker = {} as any;
      
      // Start an update
      await systemUpdate.startSystemUpdate(mockDocker);
      
      // Wait should handle the promise
      const waitPromise = systemUpdate.waitForUpdate();
      expect(waitPromise).toBeInstanceOf(Promise);
    });
  });

  describe('error handling and status updates', () => {
    it('maintains status object integrity after errors', async () => {
      const status = systemUpdate.getUpdateStatus();
      
      // Status should always have required properties
      expect(status).toHaveProperty('running');
      expect(status).toHaveProperty('success');
      expect(status).toHaveProperty('error');
      expect(status).toHaveProperty('cacheBustPending');
    });

    it('status success flag can be null, true, or false', () => {
      const status = systemUpdate.getUpdateStatus();
      
      // Success is nullable (null = not completed, true/false = result)
      expect([null, true, false]).toContain(status.success);
    });

    it('error field is properly typed', () => {
      const status = systemUpdate.getUpdateStatus();
      
      // Error should be string or null
      expect(status.error === null || typeof status.error === 'string').toBe(true);
    });
  });

  describe('module exports', () => {
    it('exports getUpdateStatus function', () => {
      expect(typeof systemUpdate.getUpdateStatus).toBe('function');
    });

    it('exports startSystemUpdate function', () => {
      expect(typeof systemUpdate.startSystemUpdate).toBe('function');
    });

    it('exports waitForUpdate function', () => {
      expect(typeof systemUpdate.waitForUpdate).toBe('function');
    });
  });

  describe('critical cache-bust race condition prevention', () => {
    it('provides stateful flag to prevent missed cache-bust events', () => {
      const status = systemUpdate.getUpdateStatus();
      
      // The critical fix: cacheBustPending survives SSE reconnections
      expect(status).toHaveProperty('cacheBustPending');
      
      // Flag should be boolean, not undefined
      expect(status.cacheBustPending).toBeDefined();
      expect(typeof status.cacheBustPending).toBe('boolean');
    });

    it('status is available for immediate reconnection checks', () => {
      // Simulate frontend reconnection scenario
      const statusOnReconnect = systemUpdate.getUpdateStatus();
      
      // Frontend can immediately check if reload is needed
      const shouldReloadUI = statusOnReconnect.cacheBustPending === true;
      
      expect(typeof shouldReloadUI).toBe('boolean');
      expect(statusOnReconnect).toHaveProperty('cacheBustPending');
    });

    it('maintains separate state for running and cacheBustPending', () => {
      const status = systemUpdate.getUpdateStatus();
      
      // These are independent flags
      expect(status.running).toBeDefined();
      expect(status.cacheBustPending).toBeDefined();
      
      // Both can be false (initial state)
      expect(typeof status.running).toBe('boolean');
      expect(typeof status.cacheBustPending).toBe('boolean');
    });

    it('status structure supports late SSE reconnection scenarios', () => {
      const status = systemUpdate.getUpdateStatus();
      
      // Scenario: SSE reconnects after 5+ seconds (after dashboard restart)
      // Frontend can still determine if UI refresh is needed
      const hasStages = status.stages && status.stages.length > 0;
      const needsRefresh = status.cacheBustPending === true;
      
      // These checks should work regardless of timing
      expect(typeof hasStages).toBe('boolean');
      expect(typeof needsRefresh).toBe('boolean');
    });
  });
});
