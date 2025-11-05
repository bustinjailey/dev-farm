<script lang="ts">
  import type { EnvironmentSummary } from '@shared/types';

  interface Props {
    env: EnvironmentSummary;
    actionBusy: boolean;
    desktopCopyState: '' | 'copied' | 'failed';
    onStart: () => void;
    onStop: () => void;
    onDelete: () => void;
    onToggleMonitor: () => void;
    onToggleAi: () => void;
    onOpenLogs: () => void;
    onCopyDesktopCommand: () => void;
    monitorOpen: boolean;
    aiOpen: boolean;
  }

  let {
    env,
    actionBusy,
    desktopCopyState,
    onStart,
    onStop,
    onDelete,
    onToggleMonitor,
    onToggleAi,
    onOpenLogs,
    onCopyDesktopCommand,
    monitorOpen,
    aiOpen,
  }: Props = $props();
</script>

<article class="card" data-status={env.status}>
  <header>
    <div>
      <h2>{env.name}</h2>
      <small>{env.mode} mode • {env.status}</small>
    </div>
    <span class="badge {env.status}">{env.status}</span>
  </header>

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
    {#if env.status === 'running'}
      <a class="btn primary" href={env.url} target="_blank" rel="noopener">Open Tunnel</a>
      <button class="btn secondary" type="button" onclick={onCopyDesktopCommand}>
        🖥 Copy Desktop Command
      </button>
      {#if desktopCopyState}
        <span class="copy-status {desktopCopyState}">
          {desktopCopyState === 'copied' ? '✓ Copied!' : '⚠ Failed'}
        </span>
      {/if}
      <button class="btn" disabled={actionBusy} onclick={onStop}>
        ⏸ Stop
      </button>
    {:else if env.status === 'starting'}
      <button class="btn" disabled>Starting…</button>
    {:else}
      <button class="btn primary" disabled={actionBusy} onclick={onStart}>
        ▶️ Start
      </button>
    {/if}

    <button class="btn" disabled={actionBusy} onclick={onToggleMonitor}>
      👁 {monitorOpen ? 'Hide Monitor' : 'Monitor'}
    </button>
    <button class="btn" disabled={actionBusy} onclick={onToggleAi}>
      🤖 {aiOpen ? 'Hide AI' : 'AI Assist'}
    </button>
    <button class="btn" disabled={actionBusy} onclick={onOpenLogs}>
      📝 Logs
    </button>
    <button class="btn danger" disabled={actionBusy} onclick={onDelete}>
      🗑 Delete
    </button>
  </div>
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
    transition: transform 0.2s ease, box-shadow 0.2s ease;
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
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
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
    border: none;
    border-radius: 999px;
    padding: 0.5rem 1.1rem;
    background: #edf2f7;
    color: #1a202c;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.85rem;
    text-decoration: none;
    display: inline-block;
    transition: all 0.2s ease;
  }

  .btn.primary,
  a.btn.primary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }

  .btn.secondary {
    background: #e2e8f0;
  }

  .btn.danger {
    background: #fee2e2;
    color: #c53030;
  }

  .btn:hover:not(:disabled),
  a.btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
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
    }

    dl {
      grid-template-columns: 1fr;
    }

    .actions {
      flex-direction: column;
      align-items: stretch;
    }

    .btn,
    a.btn {
      width: 100%;
      text-align: center;
    }
  }
</style>
