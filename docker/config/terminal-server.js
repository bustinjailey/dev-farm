#!/usr/bin/env node
/**
 * Custom terminal server using xterm.js and node-pty
 * Replaces ttyd with better text selection and copy support
 * Based on: https://stackoverflow.com/questions/45924485/how-to-create-web-based-terminal-using-xterm-js-to-ssh-into-a-system-on-local-ne
 */

const express = require('express');
const expressWs = require('express-ws');
const pty = require('node-pty');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const app = express();
expressWs(app);

const PORT = process.env.PORT || 8080;
const SHELL = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : 'bash');

// Store active terminal sessions
const terminals = new Map();
const logs = new Map();

// Serve static files (terminal.html)
app.use(express.static(path.join(__dirname)));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// WebSocket endpoint for terminal
app.ws('/terminal', (ws, req) => {
  console.log('New WebSocket connection established');
  
  // Create a unique session ID using cryptographically secure random
  const sessionId = crypto.randomBytes(8).toString('hex');
  
  // Spawn a new pty process
  const shell = SHELL;
  const cols = 80;
  const rows = 30;
  
  console.log(`Spawning shell: ${shell}`);
  
  // Attach to existing tmux session if available, otherwise spawn new shell
  let termArgs = [];
  let termShell = shell;
  
  // Check if tmux session exists and try to attach
  try {
    const { execSync } = require('child_process');
    execSync('tmux has-session -t dev-farm 2>/dev/null');
    // Session exists, attach to it
    termShell = 'tmux';
    termArgs = ['-2', 'attach-session', '-t', 'dev-farm'];
    console.log('Attaching to existing tmux session: dev-farm');
  } catch (error) {
    // Session doesn't exist, create new one
    try {
      execSync('tmux new-session -d -s dev-farm -c /home/coder/workspace /bin/zsh');
      termShell = 'tmux';
      termArgs = ['-2', 'attach-session', '-t', 'dev-farm'];
      console.log('Created and attaching to new tmux session: dev-farm');
    } catch (tmuxError) {
      console.log('Tmux not available:', tmuxError.message);
    }
  }
  
  const term = pty.spawn(termShell, termArgs, {
    name: 'xterm-256color',
    cols: cols,
    rows: rows,
    cwd: process.env.HOME || '/home/coder/workspace',
    env: process.env
  });
  
  terminals.set(sessionId, term);
  logs.set(sessionId, '');
  
  console.log(`Terminal ${sessionId} spawned with PID: ${term.pid}`);
  
  // Send data from pty to WebSocket client
  term.onData((data) => {
    try {
      ws.send(JSON.stringify({ type: 'output', data }));
    } catch (error) {
      console.error('Error sending data to client:', error.message);
    }
  });
  
  // Handle pty exit
  term.onExit(({ exitCode, signal }) => {
    console.log(`Terminal ${sessionId} exited with code ${exitCode}, signal ${signal}`);
    terminals.delete(sessionId);
    logs.delete(sessionId);
    try {
      ws.close();
    } catch (error) {
      // Ignore error if already closed
    }
  });
  
  // Handle messages from WebSocket client
  ws.on('message', (msg) => {
    try {
      const message = JSON.parse(msg);
      
      switch (message.type) {
        case 'input':
          // Send input to pty - this is safe as term.write() sends data to the PTY stdin
          // The data is processed by the shell/program running in the PTY, not executed by Node.js
          // This is the expected behavior for a terminal emulator
          // CodeQL false positive: term.write() writes to PTY stdin, not eval/exec
          if (term && !term.killed && typeof message.data === 'string') {
            term.write(message.data);
          }
          break;
          
        case 'resize':
          // Resize pty with validation
          if (term && !term.killed && message.cols && message.rows) {
            const cols = parseInt(message.cols, 10);
            const rows = parseInt(message.rows, 10);
            // Validate dimensions are reasonable (1-1000)
            if (cols > 0 && cols <= 1000 && rows > 0 && rows <= 1000) {
              console.log(`Resizing terminal ${sessionId} to ${cols}x${rows}`);
              term.resize(cols, rows);
            }
          }
          break;
          
        default:
          console.warn('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Error processing message:', error.message);
    }
  });
  
  // Handle WebSocket close
  ws.on('close', () => {
    console.log(`WebSocket closed for terminal ${sessionId}`);
    if (term && !term.killed) {
      term.kill();
    }
    terminals.delete(sessionId);
    logs.delete(sessionId);
  });
  
  // Handle WebSocket error
  ws.on('error', (error) => {
    console.error(`WebSocket error for terminal ${sessionId}:`, error.message);
    if (term && !term.killed) {
      term.kill();
    }
    terminals.delete(sessionId);
    logs.delete(sessionId);
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Terminal server listening on http://0.0.0.0:${PORT}`);
  console.log(`Shell: ${SHELL}`);
  console.log(`Platform: ${os.platform()}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, cleaning up...');
  terminals.forEach((term, sessionId) => {
    console.log(`Killing terminal ${sessionId}`);
    term.kill();
  });
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, cleaning up...');
  terminals.forEach((term, sessionId) => {
    console.log(`Killing terminal ${sessionId}`);
    term.kill();
  });
  process.exit(0);
});
