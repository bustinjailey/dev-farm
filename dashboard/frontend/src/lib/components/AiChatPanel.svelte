<script lang="ts">
  import { sendAiMessage, fetchAiOutput } from '../api';

  let { envId, open = false, latestSse = null }: { envId: string; open?: boolean; latestSse?: string | null } = $props();

  let input = $state('');
  let output = $state('');
  let loading = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    if (open && latestSse) {
      output = `${output}\n\n${latestSse}`.trim();
    }
  });

  $effect(() => {
    if (open) {
      refreshOutput();
    }
  });

  async function refreshOutput() {
    try {
      const res = await fetchAiOutput(envId);
      if (res.output) {
        output = res.output;
      }
    } catch (err) {
      error = (err as Error).message;
    }
  }

  async function submit() {
    if (!input.trim()) return;
    loading = true;
    error = null;
    const message = input.trim();
    output = `${output}\n\n> ${message}`.trim();
    input = '';
    try {
      await sendAiMessage(envId, message);
      await refreshOutput();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }
</script>

{#if open}
  <section class="panel">
    <header>
      <h3>AI Assistant (GitHub Copilot CLI)</h3>
    </header>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <pre>{output || 'No conversation yet.'}</pre>

    <div class="input-row">
      <textarea bind:value={input} rows="3" placeholder="Ask the assistant..."></textarea>
      <button on:click={submit} disabled={loading}>Send</button>
    </div>
    <small>Use Ctrl+Enter to send.</small>
  </section>
{/if}

<svelte:window on:keydown={(event) => {
  if (!open) return;
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    submit();
  }
}} />

<style>
  .panel {
    margin-top: 1rem;
    background: rgba(255, 255, 255, 0.92);
    border-radius: 16px;
    padding: 1.25rem;
    box-shadow: 0 12px 24px rgba(15, 23, 42, 0.15);
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  pre {
    background: #0f172a;
    color: #e2e8f0;
    padding: 1rem;
    border-radius: 12px;
    max-height: 260px;
    overflow: auto;
    white-space: pre-wrap;
  }

  .input-row {
    display: flex;
    gap: 0.75rem;
  }

  textarea {
    flex: 1;
    border-radius: 12px;
    border: 1px solid #cbd5f5;
    padding: 0.75rem;
    font-size: 1rem;
  }

  button {
    padding: 0.75rem 1.5rem;
    border-radius: 999px;
    border: none;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    font-weight: 600;
    cursor: pointer;
  }

  .error {
    color: #e53e3e;
    margin: 0;
  }

  small {
    color: #64748b;
  }
</style>
