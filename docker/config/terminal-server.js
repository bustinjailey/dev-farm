#!/usr/bin/env node
/**
 * Custom terminal server using xterm.js and node-pty
 * Replaces ttyd with better text selection and copy support
 * Based on: https://stackoverflow.com/questions/45924485/how-to-create-web-based-terminal-using-xterm-js-to-ssh-into-a-system-on-local-ne
 */

const express = require("express");
const expressWs = require("express-ws");
const pty = require("node-pty");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");

const app = express();
expressWs(app);

// PORT must be provided by environment variable - no fallback
if (!process.env.PORT) {
  console.error("FATAL: PORT environment variable is not set!");
  console.error(
    "The dashboard must provide a unique port for each terminal container."
  );
  console.error("This container cannot start without a port assignment.");
  process.exit(1);
}

const PORT = parseInt(process.env.PORT, 10);
if (isNaN(PORT) || PORT < 1024 || PORT > 65535) {
  console.error(`FATAL: Invalid PORT value: ${process.env.PORT}`);
  console.error("PORT must be a number between 1024 and 65535");
  process.exit(1);
}

const SHELL =
  process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "bash");

// Store active terminal sessions
const terminals = new Map();
const logs = new Map();

// Serve static files (terminal.html)
app.use(express.static(path.join(__dirname)));

// Redirect root to terminal.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "terminal.html"));
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// WebSocket endpoint for terminal
app.ws("/terminal", (ws, req) => {
  console.log("New WebSocket connection established");

  // Create a unique session ID using cryptographically secure random
  const sessionId = crypto.randomBytes(8).toString("hex");

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
    const { execSync } = require("child_process");
    execSync("tmux has-session -t dev-farm 2>/dev/null");
    // Session exists, attach to it
    termShell = "tmux";
    termArgs = ["-2", "attach-session", "-t", "dev-farm"];
    console.log("Attaching to existing tmux session: dev-farm");
  } catch (error) {
    // Session doesn't exist, create new one
    try {
      execSync("tmux new-session -d -s dev-farm -c /root/workspace /bin/zsh");
      termShell = "tmux";
      termArgs = ["-2", "attach-session", "-t", "dev-farm"];
      console.log("Created and attaching to new tmux session: dev-farm");
    } catch (tmuxError) {
      console.log("Tmux not available:", tmuxError.message);
    }
  }

  const term = pty.spawn(termShell, termArgs, {
    name: "xterm-256color",
    cols: cols,
    rows: rows,
    cwd: process.env.HOME || "/root/workspace",
    env: {
      ...process.env,
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      LANGUAGE: "en_US:en",
    },
    encoding: "utf8",
  });

  terminals.set(sessionId, term);
  logs.set(sessionId, "");

  console.log(`Terminal ${sessionId} spawned with PID: ${term.pid}`);

  // Check for device auth file and display banner if authentication is pending
  const deviceAuthPath = path.join(
    process.env.HOME || "/root",
    "workspace",
    ".copilot-device-auth.json"
  );

  // Watch for device auth file changes
  let authFileWatcher = null;
  const checkAndDisplayAuthBanner = () => {
    try {
      if (fs.existsSync(deviceAuthPath)) {
        const authData = JSON.parse(fs.readFileSync(deviceAuthPath, "utf8"));
        if (authData.code && authData.url) {
          // Send banner as terminal output
          const banner =
            `\r\n\x1b[1;36m╔═══════════════════════════════════════════════════════════════╗\x1b[0m\r\n` +
            `\x1b[1;36m║\x1b[0m \x1b[1;33m🔐 GitHub Copilot Authentication Required\x1b[0m                   \x1b[1;36m║\x1b[0m\r\n` +
            `\x1b[1;36m╠═══════════════════════════════════════════════════════════════╣\x1b[0m\r\n` +
            `\x1b[1;36m║\x1b[0m                                                               \x1b[1;36m║\x1b[0m\r\n` +
            `\x1b[1;36m║\x1b[0m  \x1b[1mPlease visit:\x1b[0m \x1b[4;34m${authData.url}\x1b[0m               \x1b[1;36m║\x1b[0m\r\n` +
            `\x1b[1;36m║\x1b[0m                                                               \x1b[1;36m║\x1b[0m\r\n` +
            `\x1b[1;36m║\x1b[0m  \x1b[1mEnter code:\x1b[0m \x1b[1;32m${authData.code}\x1b[0m                                   \x1b[1;36m║\x1b[0m\r\n` +
            `\x1b[1;36m║\x1b[0m                                                               \x1b[1;36m║\x1b[0m\r\n` +
            `\x1b[1;36m╚═══════════════════════════════════════════════════════════════╝\x1b[0m\r\n\r\n`;

          try {
            ws.send(JSON.stringify({ type: "output", data: banner }));
            console.log("Sent device auth banner to client");
          } catch (err) {
            console.error("Error sending banner:", err.message);
          }
        }
      }
    } catch (error) {
      // Ignore errors reading auth file
    }
  };

  // Display banner immediately if file exists
  checkAndDisplayAuthBanner();

  // Watch for auth file changes (creation or updates)
  try {
    const watchDir = path.dirname(deviceAuthPath);
    if (fs.existsSync(watchDir)) {
      authFileWatcher = fs.watch(watchDir, (eventType, filename) => {
        if (filename === ".copilot-device-auth.json") {
          checkAndDisplayAuthBanner();
        }
      });
    }
  } catch (error) {
    console.log("Could not watch auth file:", error.message);
  }

  // Send data from pty to WebSocket client
  term.onData((data) => {
    try {
      ws.send(JSON.stringify({ type: "output", data }));
    } catch (error) {
      console.error("Error sending data to client:", error.message);
    }
  });

  // Handle pty exit
  term.onExit(({ exitCode, signal }) => {
    console.log(
      `Terminal ${sessionId} exited with code ${exitCode}, signal ${signal}`
    );
    terminals.delete(sessionId);
    logs.delete(sessionId);
    try {
      ws.close();
    } catch (error) {
      // Ignore error if already closed
    }
  });

  // Handle messages from WebSocket client
  ws.on("message", (msg) => {
    try {
      const message = JSON.parse(msg);

      switch (message.type) {
        case "input":
          // Send input to pty - this is safe as term.write() sends data to the PTY stdin
          // The data is processed by the shell/program running in the PTY, not executed by Node.js
          // This is the expected behavior for a terminal emulator
          // CodeQL false positive: term.write() writes to PTY stdin, not eval/exec
          if (term && !term.killed && typeof message.data === "string") {
            term.write(message.data);
          }
          break;

        case "resize":
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
          console.warn("Unknown message type:", message.type);
      }
    } catch (error) {
      console.error("Error processing message:", error.message);
    }
  });

  // Handle WebSocket close
  ws.on("close", () => {
    console.log(`WebSocket closed for terminal ${sessionId}`);
    if (authFileWatcher) {
      authFileWatcher.close();
    }
    if (term && !term.killed) {
      term.kill();
    }
    terminals.delete(sessionId);
    logs.delete(sessionId);
  });

  // Handle WebSocket error
  ws.on("error", (error) => {
    console.error(`WebSocket error for terminal ${sessionId}:`, error.message);
    if (authFileWatcher) {
      authFileWatcher.close();
    }
    if (term && !term.killed) {
      term.kill();
    }
    terminals.delete(sessionId);
    logs.delete(sessionId);
  });
});

// Start server with error handling
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Terminal server listening on http://0.0.0.0:${PORT}`);
  console.log(`Shell: ${SHELL}`);
  console.log(`Platform: ${os.platform()}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`FATAL: Port ${PORT} is already in use!`);
    console.error(`Another process or container is using port ${PORT}.`);
    console.error(`This usually means:`);
    console.error(`  1. Another application on your system is using this port`);
    console.error(`  2. A previous container wasn't cleaned up properly`);
    console.error(`  3. The dashboard assigned a port that's already taken`);
    console.error(`\nTo fix this:`);
    console.error(
      `  - Check what's using the port: lsof -i :${PORT} or netstat -nlp | grep ${PORT}`
    );
    console.error(`  - Stop the conflicting process`);
    console.error(
      `  - Or delete and recreate this environment to get a new port`
    );
    process.exit(1);
  } else {
    console.error(`Server error:`, err);
    process.exit(1);
  }
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, cleaning up...");
  terminals.forEach((term, sessionId) => {
    console.log(`Killing terminal ${sessionId}`);
    term.kill();
  });
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received, cleaning up...");
  terminals.forEach((term, sessionId) => {
    console.log(`Killing terminal ${sessionId}`);
    term.kill();
  });
  process.exit(0);
});
