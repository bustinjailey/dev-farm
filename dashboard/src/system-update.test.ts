import { describe, expect, it } from 'vitest';
import * as systemUpdate from './system-update.js';

describe('system-update module', () => {
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
  });

  describe('startSystemUpdate', () => {
    it('accepts Docker instance and returns promise', () => {
      const mockDocker = {} as any;
      const result = systemUpdate.startSystemUpdate(mockDocker);

      expect(result).toBeInstanceOf(Promise);
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
});
