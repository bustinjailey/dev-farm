<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { listGithubRepos } from '../api';

  const dispatch = createEventDispatcher();

  let { open = false }: { open?: boolean } = $props();

  let repos = $state<{ name: string; https_url: string; private: boolean; description: string | null; updated: string }[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  async function loadRepos() {
    loading = true;
    error = null;
    try {
      const result: any = await listGithubRepos();
      if (Array.isArray(result)) {
        // Sort by updated date, most recent first
        repos = result.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
      } else {
        repos = [];
        error = result?.error ?? 'Failed to load repositories';
      }
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (open) {
      loadRepos();
    }
  });
</script>

{#if open}
  <div
    class="backdrop"
    role="button"
    tabindex="0"
    on:click={() => dispatch('close')}
    on:keydown={(e) => e.key === 'Escape' && dispatch('close')}
  >
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      tabindex="0"
      on:click|stopPropagation
      on:keydown={(e) => e.key === 'Escape' && dispatch('close')}
    >
      <header>
        <h2>Select Repository</h2>
      </header>
      {#if loading}
        <p>Loading repositories…</p>
      {:else if error}
        <p class="error">{error}</p>
      {:else}
        <ul>
          {#each repos as repo}
            <li>
              <button
                type="button"
                on:click={() => {
                  dispatch('select', { url: repo.https_url });
                  dispatch('close');
                }}
              >
                <strong>{repo.name}</strong>
                {#if repo.private}
                  <span class="badge">Private</span>
                {/if}
                {#if repo.description}
                  <small>{repo.description}</small>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      <button class="close" on:click={() => dispatch('close')}>Close</button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.4);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 120;
  }

  .modal {
    background: white;
    color: #1a202c;
    width: min(480px, 90vw);
    max-height: 80vh;
    overflow: auto;
    border-radius: 16px;
    padding: 1.5rem;
    box-shadow: 0 20px 40px rgba(15, 23, 42, 0.25);
  }

  header {
    margin-bottom: 1rem;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  li button {
    width: 100%;
    text-align: left;
    border: 1px solid #cbd5f5;
    border-radius: 12px;
    padding: 0.75rem 1rem;
    background: #f8fafc;
    color: #1a202c;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  li button:hover {
    background: #e0e7ff;
    color: #1a202c;
  }

  .badge {
    display: inline-block;
    background: #ed8936;
    color: white;
    padding: 0.2rem 0.5rem;
    border-radius: 6px;
    font-size: 0.75rem;
  }

  li button small {
    color: #64748b;
  }

  .error {
    color: #e53e3e;
  }

  .close {
    margin-top: 1rem;
    background: var(--button-bg-secondary);
    border: 2px solid var(--button-border-secondary);
    border-radius: 999px;
    padding: 0.5rem 1.5rem;
    color: var(--button-text-secondary);
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .close:hover {
    background: var(--button-bg-secondary-hover);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .close:active {
    transform: scale(0.98);
  }
</style>
