import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Terminal Mode Configuration', () => {
  it('should have custom xterm.js terminal HTML with copy button', () => {
    const htmlPath = join(__dirname, '../../docker/config/terminal.html');
    const html = readFileSync(htmlPath, 'utf-8');
    
    // Check for xterm.js integration
    expect(html).toContain('xterm.js');
    expect(html).toContain('new Terminal(');
    
    // Check for copy button
    expect(html).toContain('id="copy-button"');
    expect(html).toContain('Copy selected text');
    
    // Check for selection handling
    expect(html).toContain('onSelectionChange');
    expect(html).toContain('getSelection');
    expect(html).toContain('clipboard');
    
    // Check for mobile-friendly styling
    expect(html).toContain('@media (max-width: 768px)');
    
    // Check for proper text selection CSS
    expect(html).toContain('user-select: text');
  });

  it('should have terminal WebSocket server', () => {
    const serverPath = join(__dirname, '../../docker/config/terminal-server.js');
    const server = readFileSync(serverPath, 'utf-8');
    
    // Check for node-pty usage
    expect(server).toContain('node-pty');
    expect(server).toContain('pty.spawn');
    
    // Check for WebSocket handling
    expect(server).toContain('express-ws');
    expect(server).toContain('/terminal');
    
    // Check for tmux integration
    expect(server).toContain('tmux');
    expect(server).toContain('dev-farm');
  });

  it('should have copilot chat wrapper script', () => {
    const scriptPath = join(__dirname, '../../docker/config/copilot-chat.sh');
    const script = readFileSync(scriptPath, 'utf-8');
    
    // Check for authentication status checking
    expect(script).toContain('.copilot-auth-status');
    expect(script).toContain('AUTH_STATUS_FILE');
    
    // Check for device auth detection
    expect(script).toContain('.copilot-device-auth.json');
    expect(script).toContain('DEVICE_AUTH_FILE');
    
    // Check that it uses session manager
    expect(script).toContain('copilot-session-manager.sh');
    
    // Check for proper error handling
    expect(script).toContain('exit 1');
  });

  it('should start custom terminal server in startup script', () => {
    const scriptPath = join(__dirname, '../../docker/config/startup-terminal.sh');
    const script = readFileSync(scriptPath, 'utf-8');
    
    // Check for terminal server startup
    expect(script).toContain('terminal-server.js');
    expect(script).toContain('/usr/bin/node');
    
    // Check for PORT environment variable
    expect(script).toContain('PORT=8080');
  });

  it('should install new copilot CLI in terminal container', () => {
    const scriptPath = join(__dirname, '../../docker/config/startup-terminal.sh');
    const script = readFileSync(scriptPath, 'utf-8');
    
    // Check for new @github/copilot package
    expect(script).toContain('@github/copilot');
    expect(script).toContain('pnpm add -g');
    
    // Check for PNPM global path setup
    expect(script).toContain('PNPM_HOME');
    expect(script).toContain('/home/coder/.local/share/pnpm');
    
    // Check for device flow initiation
    expect(script).toContain('device flow authentication');
    expect(script).toContain('.copilot-device-auth.json');
  });

  it('should copy custom files in Dockerfile', () => {
    const dockerfilePath = join(__dirname, '../../docker/Dockerfile.terminal');
    const dockerfile = readFileSync(dockerfilePath, 'utf-8');
    
    // Check for terminal server files
    expect(dockerfile).toContain('terminal-server.js');
    expect(dockerfile).toContain('terminal.html');
    
    // Check for copilot chat script copy
    expect(dockerfile).toContain('copilot-chat.sh');
    
    // Check for permissions
    expect(dockerfile).toContain('chmod +x');
    
    // Check for node-pty dependency (npm install command)
    expect(dockerfile).toContain('npm install');
    expect(dockerfile).toContain('node-pty');
    
    // Check for jq (needed for JSON parsing in copilot-chat.sh)
    expect(dockerfile).toContain('jq');
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

  it('should pass dashboard PAT to terminal environments', () => {
    const routesPath = join(__dirname, 'server/routes/environments.ts');
    const routes = readFileSync(routesPath, 'utf-8');
    
    // Check that GitHub token is loaded and passed to environment
    expect(routes).toContain('loadGitHubToken');
    expect(routes).toContain('githubToken');
    expect(routes).toContain('GITHUB_TOKEN');
  });

  it('should use GITHUB_TOKEN in terminal startup', () => {
    const scriptPath = join(__dirname, '../../docker/config/startup-terminal.sh');
    const script = readFileSync(scriptPath, 'utf-8');
    
    // Check that startup script uses GITHUB_TOKEN environment variable
    expect(script).toContain('GITHUB_TOKEN');
    expect(script).toContain('gh auth login --with-token');
    expect(script).toContain('GitHub authentication completed successfully');
  });
});
