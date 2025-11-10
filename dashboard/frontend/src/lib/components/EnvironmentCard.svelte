<script lang="ts">
  import type { EnvironmentSummary } from "@shared/types";
  import type { Snippet } from "svelte";

  interface Props {
    env: EnvironmentSummary;
    actionBusy: boolean;
    desktopCopyState: "" | "copied" | "failed";
    deviceAuth: { code: string; url: string } | null;
    onStart: () => void;
    onStop: () => void;
    onDelete: () => void;
    onToggleMonitor: () => void;
    onToggleAi: () => void;
    onOpenLogs: () => void;
    onCopyDesktopCommand: () => void;
    onCopyDeviceCode: () => void;
    monitorOpen: boolean;
    aiOpen: boolean;
    children?: Snippet;
  }

  let {
    env,
    actionBusy,
    desktopCopyState,
    deviceAuth,
    onStart,
    onStop,
    onDelete,
    onToggleMonitor,
    onToggleAi,
    onOpenLogs,
    onCopyDesktopCommand,
    onCopyDeviceCode,
    monitorOpen,
    aiOpen,
    children,
  }: Props = $props();

  // Derived values for button text (workaround for Svelte 5 compiler issue)
  let copilotButtonText = $derived(aiOpen ? "Hide Copilot" : "Copilot Chat");
  let aiAssistButtonText = $derived(aiOpen ? "Hide AI" : "AI Assist");
  let monitorButtonText = $derived(monitorOpen ? "Hide Monitor" : "Monitor");
</script>

<article class="card" data-status={env.status}>
  <header>
    <div>
      <h2>{env.name}</h2>
      <small>{env.mode} mode • {env.status}</small>
    </div>
    <span class="badge {env.status}">{env.status}</span>
  </header>

  {#if deviceAuth && (env.status === "starting" || env.status === "running")}
    <div class="device-auth-banner">
      <p>🔐 GitHub Authentication Required</p>
      <div class="device-code">{deviceAuth.code}</div>
      <div class="device-actions">
        <button class="btn-copy-code" onclick={onCopyDeviceCode}
          >📋 Copy Code</button
        >
        <a href={deviceAuth.url} target="_blank" rel="noopener" class="btn-auth"
          >Open GitHub Auth →</a
        >
      </div>
    </div>
  {/if}

  <dl>
    <div>
      <dt>Tunnel</dt>
      <dd>{env.id}</dd>
    </div>
    <div>
      <dt>Workspace Path</dt>
      <dd>{env.workspacePath}</dd>
    </div>
  </dl>

  <div class="actions">
    {#if env.mode === "terminal"}
      <!-- Terminal mode: show terminal controls with AI chat -->
      {#if env.status === "running"}
        <a class="btn primary" href={env.url} target="_blank" rel="noopener">
          <span class="btn-text-full">Open Terminal</span>
          <span class="btn-text-short">Terminal</span>
        </a>
        <button
          class="btn"
          disabled={actionBusy}
          onclick={onToggleAi}
          data-testid="copilot-chat-button"
        >
          🤖 Copilot Chat
        </button>
        <button class="btn" disabled={actionBusy} onclick={onStop}>
          ⏸ Stop
        </button>
      {:else if env.status === "starting"}
        <button class="btn" disabled>Starting…</button>
      {:else}
        <button class="btn primary" disabled={actionBusy} onclick={onStart}>
          ▶️ Start
        </button>
      {/if}
      <button class="btn" disabled={actionBusy} onclick={onOpenLogs}>
        📝 Logs
      </button>
      <button class="btn danger" disabled={actionBusy} onclick={onDelete}>
        🗑 Delete
      </button>
    {:else}
      <!-- Non-terminal modes: show all buttons -->
      {#if env.status === "running"}
        {#if env.requiresAuth || deviceAuth}
          <button
            class="btn primary"
            disabled
            title="Complete GitHub authentication first"
          >
            🔒 Open Tunnel (Auth Required)
          </button>
        {:else}
          <a class="btn primary" href={env.url} target="_blank" rel="noopener"
            >Open Tunnel</a
          >
        {/if}
        <button
          class="btn secondary"
          type="button"
          onclick={onCopyDesktopCommand}
        >
          🖥 Copy Desktop Command
        </button>
        {#if desktopCopyState}
          <span class="copy-status {desktopCopyState}">
            {desktopCopyState === "copied" ? "✓ Copied!" : "⚠ Failed"}
          </span>
        {/if}
        <button class="btn" disabled={actionBusy} onclick={onStop}>
          ⏸ Stop
        </button>
      {:else if env.status === "starting"}
        <button class="btn" disabled>Starting…</button>
      {:else}
        <button class="btn primary" disabled={actionBusy} onclick={onStart}>
          ▶️ Start
        </button>
      {/if}

      <button class="btn" disabled={actionBusy} onclick={onToggleMonitor}>
        {monitorButtonText}
      </button>
      <button class="btn" disabled={actionBusy} onclick={onToggleAi}>
        {aiAssistButtonText}
      </button>
      <button class="btn" disabled={actionBusy} onclick={onOpenLogs}>
        📝 Logs
      </button>
      <button class="btn danger" disabled={actionBusy} onclick={onDelete}>
        🗑 Delete
      </button>
    {/if}
  </div>

  {#if children}
    {@render children()}
  {/if}
</article>

<style>
  .card {
    background: rgba(255, 255, 255, 0.95);
    border-radius: 24px;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    box-shadow: 0 16px 32px rgba(79, 70, 229, 0.15);
    transition:
      transform 0.2s ease,
      box-shadow 0.2s ease;
  }

  .device-auth-banner {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 1rem;
    border-radius: 12px;
    text-align: center;
  }

  .device-auth-banner p {
    margin: 0 0 0.5rem;
    font-weight: 600;
    font-size: 0.95rem;
  }

  .device-code {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 1.4rem;
    letter-spacing: 0.2rem;
    margin: 0.5rem 0;
    padding: 0.5rem;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    font-weight: 700;
  }

  .device-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    margin-top: 0.75rem;
    flex-wrap: wrap;
  }

  .btn-copy-code,
  .btn-auth {
    border: none;
    border-radius: 999px;
    padding: 0.5rem 1rem;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.85rem;
    text-decoration: none;
    display: inline-block;
    line-height: 1.4;
  }

  .btn-copy-code {
    background: white;
    color: #667eea;
  }

  .btn-auth {
    background: #48bb78;
    color: white;
  }

  .btn-copy-code:hover,
  .btn-auth:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  .card:hover {
    transform: translateY(-2px);
    box-shadow: 0 20px 40px rgba(79, 70, 229, 0.2);
  }

  .card header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
  }

  .card h2 {
    margin: 0;
    font-size: 1.4rem;
    color: #4c51bf;
  }

  .card small {
    color: #64748b;
    font-size: 0.85rem;
  }

  dl {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
    margin: 0;
  }

  dt {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #718096;
    font-weight: 600;
  }

  dd {
    margin: 0;
    font-weight: 600;
    color: #1a202c;
    word-break: break-all;
  }

  .badge {
    padding: 0.35rem 0.9rem;
    border-radius: 999px;
    font-weight: 700;
    text-transform: uppercase;
    font-size: 0.75rem;
    white-space: nowrap;
  }

  .badge.running {
    background: #48bb78;
    color: white;
  }

  .badge.starting {
    background: #ed8936;
    color: white;
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.6;
    }
  }

  .badge.exited,
  .badge.stopped,
  .badge.created,
  .badge.paused,
  .badge.restarting {
    background: #a0aec0;
    color: white;
  }

  .badge.removing,
  .badge.dead {
    background: #fc8181;
    color: white;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }

  .btn,
  a.btn {
    border: 2px solid var(--button-border-secondary);
    border-radius: 999px;
    padding: 0.5rem 1.1rem;
    background: var(--button-bg-secondary);
    color: var(--button-text-secondary);
    font-weight: 600;
    cursor: pointer;
    font-size: 0.85rem;
    line-height: 1.4;
    text-decoration: none;
    display: inline-block;
    transition: all 0.2s ease;
  }

  .btn.primary,
  a.btn.primary {
    background: var(--bg-primary-gradient);
    color: white;
    border-color: transparent;
  }

  .btn.secondary {
    background: var(--button-bg-secondary);
    border-color: var(--button-border-secondary);
  }

  .btn.danger {
    background: var(--color-danger-light);
    color: var(--color-danger);
    border-color: var(--color-danger);
  }

  .btn:hover:not(:disabled),
  a.btn:hover {
    background: var(--button-bg-secondary-hover);
    transform: translateY(-1px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
  }

  .btn.primary:hover:not(:disabled),
  a.btn.primary:hover {
    background: var(--bg-primary-gradient);
    opacity: 0.95;
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
  }

  .btn:active:not(:disabled),
  a.btn:active {
    transform: scale(0.98);
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    pointer-events: none;
  }

  .copy-status {
    font-size: 0.85rem;
    font-weight: 600;
    padding: 0.25rem 0.75rem;
    border-radius: 999px;
  }

  .copy-status.copied {
    color: #2f855a;
    background: #c6f6d5;
  }

  .copy-status.failed {
    color: #c53030;
    background: #fed7d7;
  }

  @media (max-width: 600px) {
    .card {
      padding: 1rem;
      max-width: 100%;
      box-sizing: border-box;
    }

    dl {
      grid-template-columns: 1fr;
    }

    .actions {
      flex-direction: column;
      align-items: stretch;
      width: 100%;
    }

    .btn,
    a.btn {
      width: 100%;
      max-width: 100%;
      text-align: center;
      padding: 0.5rem 0.75rem;
      font-size: 0.8rem;
      box-sizing: border-box;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .btn-text-full {
      display: none;
    }

    .btn-text-short {
      display: inline;
    }
  }

  /* Show full text on larger screens, short text on mobile */
  .btn-text-full {
    display: inline;
  }

  .btn-text-short {
    display: none;
  }
</style>
