import { describe, expect, it } from 'vitest';
import { buildTunnelUrl, kebabify } from './env-utils.js';

describe('kebabify', () => {
  it('converts mixed characters to kebab-case', () => {
    expect(kebabify('My Cool Project')).toBe('my-cool-project');
    expect(kebabify('Test_Env 123')).toBe('test-env-123');
    expect(kebabify('---Already---')).toBe('already');
  });
});

describe('buildTunnelUrl', () => {
  it('builds base url without workspace path', () => {
    expect(buildTunnelUrl('sample')).toBe('https://insiders.vscode.dev/tunnel/sample');
  });

  it('encodes workspace paths', () => {
    expect(buildTunnelUrl('sample', '/workspace')).toBe(
      'https://insiders.vscode.dev/tunnel/sample?folder=%2Fworkspace'
    );
    expect(buildTunnelUrl('sample', '/workspace/project')).toBe(
      'https://insiders.vscode.dev/tunnel/sample?folder=%2Fworkspace%2Fproject'
    );
  });
});
