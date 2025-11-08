import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Terminal Mode Configuration', () => {
  it('should have custom ttyd HTML with copy button', () => {
    const htmlPath = join(__dirname, '../../docker/config/ttyd-index.html');
    const html = readFileSync(htmlPath, 'utf-8');
    
    // Check for copy button
    expect(html).toContain('id="copy-button"');
    expect(html).toContain('Copy selected text');
    
    // Check for selection handling JavaScript
    expect(html).toContain('selectionchange');
    expect(html).toContain('clipboard');
    
    // Check for mobile-friendly styling
    expect(html).toContain('@media (max-width: 768px)');
  });

  it('should have copilot chat wrapper script', () => {
    const scriptPath = join(__dirname, '../../docker/config/copilot-chat.sh');
    const script = readFileSync(scriptPath, 'utf-8');
    
    // Check for copilot command
    expect(script).toContain('copilot');
    expect(script).toContain('tmux');
    
    // Check for message handling
    expect(script).toContain('copilot_chat');
    
    // Check for proper error handling
    expect(script).toContain('exit 1');
  });

  it('should configure ttyd with custom HTML in startup script', () => {
    const scriptPath = join(__dirname, '../../docker/config/startup-terminal.sh');
    const script = readFileSync(scriptPath, 'utf-8');
    
    // Check for custom HTML flag
    expect(script).toContain('-I /tmp/ttyd-custom/index.html');
    
    // Check for mobile-friendly options
    expect(script).toContain('-t fontSize=16');
    expect(script).toContain('fontFamily');
    expect(script).toContain('cursorBlink');
    expect(script).toContain('bellStyle=visual');
  });

  it('should install new copilot CLI in terminal container', () => {
    const scriptPath = join(__dirname, '../../docker/config/startup-terminal.sh');
    const script = readFileSync(scriptPath, 'utf-8');
    
    // Check for new @github/copilot package
    expect(script).toContain('@github/copilot');
    expect(script).toContain('npm install -g');
    
    // Check for NPM global path setup
    expect(script).toContain('NPM_CONFIG_PREFIX');
    expect(script).toContain('.npm-global');
  });

  it('should copy custom files in Dockerfile', () => {
    const dockerfilePath = join(__dirname, '../../docker/Dockerfile.terminal');
    const dockerfile = readFileSync(dockerfilePath, 'utf-8');
    
    // Check for custom HTML copy
    expect(dockerfile).toContain('ttyd-index.html');
    
    // Check for copilot chat script copy
    expect(dockerfile).toContain('copilot-chat.sh');
    
    // Check for permissions
    expect(dockerfile).toContain('chmod +x');
  });
});

describe('Terminal Mode Backend Integration', () => {
  it('should detect terminal mode and use copilot CLI', () => {
    const routesPath = join(__dirname, 'server/routes/environments.ts');
    const routes = readFileSync(routesPath, 'utf-8');
    
    // Check for terminal mode detection
    expect(routes).toContain("record.mode === 'terminal'");
    
    // Check for copilot-chat.sh usage
    expect(routes).toContain('/home/coder/copilot-chat.sh');
    
    // Check for fallback to gh copilot
    expect(routes).toContain('gh copilot');
  });
});
