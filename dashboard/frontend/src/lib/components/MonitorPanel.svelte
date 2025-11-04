<script lang="ts">
  import { onMount } from 'svelte';
  import { fetchTerminal, fetchGitActivity, fetchProcesses } from '../api';

  export let envId: string;
  export let open = false;

  let loading = false;
  let terminal = '';
  let gitCommits: { sha: string; author: string; time: string; message: string }[] = [];
  let processes: { pid: string; cpu: string; mem: string; time: string; command: string }[] = [];
  let error: string | null = null;

  async function refreshAll() {
    loading = true;
    error = null;
    try {
      const [t, g, p] = await Promise.all([
        fetchTerminal(envId),
        fetchGitActivity(envId),
        fetchProcesses(envId),
      ]);
      terminal = t.output;
      gitCommits = g.commits;
      processes = p.processes;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  let interval: ReturnType<typeof setInterval> | null = null;

  $: if (open) {
    refreshAll();
    if (!interval) {
      interval = setInterval(refreshAll, 5000);
    }
  } else if (interval) {
    clearInterval(interval);
    interval = null;
  }

  onMount(() => () => {
    if (interval) {
      clearInterval(interval);
    }
  });
</script>

{#if open}
  <section class="panel">
    <header>
      <h3>Environment Monitor</h3>
      <button class="refresh" on:click={refreshAll} disabled={loading}>⟳ Refresh</button>
    </header>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    <div class="grid">
      <div class="card">
        <h4>Terminal</h4>
        <pre>{terminal || 'No activity'}</pre>
      </div>
      <div class="card">
        <h4>Git Activity</h4>
        {#if gitCommits.length === 0}
          <p>No recent commits</p>
        {:else}
          <ul>
            {#each gitCommits as commit}
              <li>
                <span class="sha">{commit.sha}</span>
                <span>{commit.message}</span>
                <small>{commit.author} • {commit.time}</small>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      <div class="card">
        <h4>Processes</h4>
        {#if processes.length === 0}
          <p>No tracked processes</p>
        {:else}
          <ul>
            {#each processes as proc}
              <li>
                <strong>{proc.command}</strong>
                <small>PID {proc.pid} • CPU {proc.cpu}% • {proc.time}</small>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </section>
{/if}

<style>
  .panel {
    margin-top: 1rem;
    background: rgba(255, 255, 255, 0.92);
    border-radius: 16px;
    padding: 1.25rem;
    box-shadow: 0 12px 24px rgba(15, 23, 42, 0.15);
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .refresh {
    border: none;
    border-radius: 999px;
    padding: 0.4rem 1rem;
    background: #667eea;
    color: white;
    cursor: pointer;
  }

  .error {
    color: #e53e3e;
    margin: 0 0 1rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 1rem;
  }

  .card {
    background: #f8fafc;
    border-radius: 12px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  pre {
    background: #1f2937;
    color: #e2e8f0;
    padding: 0.75rem;
    border-radius: 8px;
    max-height: 200px;
    overflow: auto;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .sha {
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
    font-weight: 600;
  }

  small {
    color: #64748b;
  }
</style>
