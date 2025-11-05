<script lang="ts">
  import type { EnvironmentSummary } from '@shared/types';
  import { onDestroy } from 'svelte';
  import { fetchEnvironmentLogs } from '../api';

  interface Props {
    envId: string;
    open: boolean;
    onClose: () => void;
  }

  let { envId, open, onClose }: Props = $props();
  let logs = $state('');
  let loading = $state(false);
  let autoRefreshInterval = $state<ReturnType<typeof setInterval> | null>(null);
  let deviceAuth = $state<{ code: string; url: string } | null>(null);

  async function loadLogs() {
    if (!envId) return;
    loading = true;
    try {
      const result = await fetchEnvironmentLogs(envId);
      logs = result.logs;
      parseDeviceAuth(result.logs);
    } catch (err) {
      console.error('Failed to load logs', err);
    } finally {
      loading = false;
    }
  }

  function parseDeviceAuth(logText: string) {
    // Parse: "log into https://github.com/login/device and use code 27E8-8D59"
    const match = logText.match(/log into (https:\/\/[^\s]+) and use code ([A-Z0-9-]+)/);
    if (match) {
      deviceAuth = { url: match[1], code: match[2] };
    }
  }

  async function copyDeviceCode() {
    if (!deviceAuth) return;
    try {
      await navigator.clipboard.writeText(deviceAuth.code);
    } catch (err) {
      window.prompt('Copy this code to GitHub', deviceAuth.code);
    }
  }

  function startAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(loadLogs, 3000);
  }

  function stopAutoRefresh() {
    if (autoRefreshInterval) {
      clearInterval(autoRefreshInterval);
      autoRefreshInterval = null;
    }
  }

  function handleClose() {
    stopAutoRefresh();
    onClose();
  }

  // Track only open and envId changes, not logs state changes
  let prevOpen = $state(false);
  let prevEnvId = $state('');

  $effect(() => {
    // Only trigger when open/envId changes, not when logs updates
    const currentOpen = open;
    const currentEnvId = envId;
    
    if (currentOpen && currentEnvId && (!prevOpen || prevEnvId !== currentEnvId)) {
      // Modal just opened or envId changed
      loadLogs();
      startAutoRefresh();
    } else if (!currentOpen && prevOpen) {
      // Modal just closed
      stopAutoRefresh();
    }
    
    prevOpen = currentOpen;
    prevEnvId = currentEnvId;
  });

  onDestroy(() => {
    stopAutoRefresh();
  });
</script>

{#if open}
  <div
    class="backdrop"
    role="button"
    tabindex="0"
    onclick={handleClose}
    onkeydown={(e) => e.key === 'Escape' && handleClose()}
  >
    <div
      class="logs-modal"
      role="dialog"
      aria-modal="true"
      tabindex="0"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.key === 'Escape' && handleClose()}
    >
      <header>
        <h2>Logs: {envId}</h2>
        <span class="live-indicator">● Live</span>
      </header>

      {#if deviceAuth}
        <div class="device-auth-banner">
          <p>🔐 GitHub Device Authentication Required</p>
          <div class="device-code">{deviceAuth.code}</div>
          <div class="device-actions">
            <button class="copy-code-btn" onclick={copyDeviceCode}>📋 Copy Code</button>
            <a href={deviceAuth.url} target="_blank" rel="noopener" class="btn primary">
              Open GitHub Auth →
            </a>
          </div>
        </div>
      {/if}

      <pre class="logs-content">{loading && !logs ? 'Loading logs...' : logs || 'No logs available'}</pre>

      <footer>
        <button onclick={handleClose}>Close</button>
        <small>Auto-refreshing every 3 seconds</small>
      </footer>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    backdrop-filter: blur(4px);
  }

  .logs-modal {
    background: white;
    color: #1a202c;
    border-radius: 16px;
    padding: 1.5rem;
    width: min(90vw, 1200px);
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    box-shadow: 0 24px 48px rgba(30, 64, 175, 0.3);
  }

  .logs-modal header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 0.5rem;
    border-bottom: 2px solid #e2e8f0;
  }

  .logs-modal h2 {
    margin: 0;
    font-size: 1.5rem;
    color: #4c51bf;
  }

  .live-indicator {
    color: #48bb78;
    font-size: 0.9rem;
    font-weight: 600;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .device-auth-banner {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 1.25rem;
    border-radius: 12px;
    text-align: center;
  }

  .device-auth-banner p {
    margin: 0 0 0.75rem;
    font-weight: 600;
    font-size: 1.1rem;
  }

  .device-code {
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
    font-size: 1.8rem;
    letter-spacing: 0.3rem;
    margin: 0.75rem 0;
    padding: 0.75rem;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 8px;
    font-weight: 700;
  }

  .device-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
    margin-top: 1rem;
  }

  .copy-code-btn,
  .device-actions .btn {
    border: none;
    border-radius: 999px;
    padding: 0.6rem 1.5rem;
    font-weight: 600;
    cursor: pointer;
    font-size: 0.95rem;
    text-decoration: none;
    display: inline-block;
  }

  .copy-code-btn {
    background: white;
    color: #667eea;
  }

  .device-actions .btn.primary {
    background: #48bb78;
    color: white;
  }

  .copy-code-btn:hover,
  .device-actions .btn:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  .logs-content {
    background: #0f172a;
    color: #e2e8f0;
    padding: 1.25rem;
    border-radius: 12px;
    flex: 1;
    overflow: auto;
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
    font-size: 0.85rem;
    line-height: 1.6;
    margin: 0;
    min-height: 300px;
    max-height: 500px;
  }

  .logs-content::-webkit-scrollbar {
    width: 8px;
  }

  .logs-content::-webkit-scrollbar-track {
    background: #1e293b;
    border-radius: 4px;
  }

  .logs-content::-webkit-scrollbar-thumb {
    background: #475569;
    border-radius: 4px;
  }

  .logs-content::-webkit-scrollbar-thumb:hover {
    background: #64748b;
  }

  footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 0.5rem;
    border-top: 1px solid #e2e8f0;
  }

  footer button {
    border: none;
    border-radius: 999px;
    padding: 0.6rem 1.5rem;
    background: #e2e8f0;
    font-weight: 600;
    cursor: pointer;
  }

  footer button:hover {
    background: #cbd5e0;
  }

  footer small {
    color: #64748b;
    font-size: 0.85rem;
  }

  @media (max-width: 768px) {
    .logs-modal {
      width: 95vw;
      max-height: 90vh;
      padding: 1rem;
    }

    .device-code {
      font-size: 1.4rem;
      letter-spacing: 0.2rem;
    }

    .device-actions {
      flex-direction: column;
    }
  }
</style>
