<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { CreateEnvironmentPayload } from '../api';

  export let open = false;

  const dispatch = createEventDispatcher<{
    submit: CreateEnvironmentPayload;
    close: void;
    browseRepo: void;
  }>();

  let name = '';
  let project = 'general';
  let mode: CreateEnvironmentPayload['mode'] = 'workspace';
  export let gitUrl = '';
  let sshHost = '';
  let sshUser = 'root';
  let sshPassword = '';
  let sshPath = '/home';

  function resetForm() {
    name = '';
    project = 'general';
    mode = 'workspace';
    gitUrl = '';
    sshHost = '';
    sshUser = 'root';
    sshPassword = '';
    sshPath = '/home';
  }

  function close() {
    resetForm();
    dispatch('close');
  }

  function submitForm() {
    const payload: CreateEnvironmentPayload = {
      name,
      project,
      mode,
    };

    if (mode === 'git') {
      payload.git_url = gitUrl.trim();
    } else if (mode === 'ssh') {
      payload.ssh_host = sshHost.trim();
      payload.ssh_user = sshUser.trim() || 'root';
      payload.ssh_password = sshPassword;
      payload.ssh_path = sshPath.trim() || '/home';
    }

    dispatch('submit', payload);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      close();
    }
  }
</script>

{#if open}
  <div class="backdrop" role="presentation" on:click={() => close()}>
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      tabindex="0"
      on:click|stopPropagation
      on:keydown={handleKeydown}
    >
      <header>
        <h2>Create Environment</h2>
      </header>
      <section>
        <label>
          <span>Name</span>
          <input bind:value={name} placeholder="Optional" />
        </label>

        <label>
          <span>Project</span>
          <input bind:value={project} />
        </label>

        <label>
          <span>Mode</span>
          <select bind:value={mode}>
            <option value="workspace">Workspace</option>
            <option value="git">Git Repository</option>
            <option value="ssh">Remote SSH</option>
            <option value="terminal">Terminal</option>
          </select>
        </label>

        {#if mode === 'git'}
          <label>
            <span>Git URL</span>
            <div class="repo-row">
              <input bind:value={gitUrl} placeholder="https://github.com/user/repo" />
              <button type="button" class="browse" on:click={() => dispatch('browseRepo')}>
                📚 Browse
              </button>
            </div>
          </label>
        {:else if mode === 'ssh'}
          <div class="grid">
            <label>
              <span>SSH Host</span>
              <input bind:value={sshHost} placeholder="server.example.com" />
            </label>
            <label>
              <span>User</span>
              <input bind:value={sshUser} />
            </label>
          </div>
          <label>
            <span>Password (optional)</span>
            <input type="password" bind:value={sshPassword} />
          </label>
          <label>
            <span>Remote Path</span>
            <input bind:value={sshPath} />
          </label>
        {/if}
      </section>
      <footer>
        <button class="secondary" on:click={close}>Cancel</button>
        <button class="primary" on:click={submitForm}>Create</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(13, 13, 13, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal {
    background: white;
    color: #1a202c;
    border-radius: 16px;
    padding: 1.5rem;
    width: min(480px, 90vw);
    box-shadow: 0 20px 40px rgba(15, 23, 42, 0.2);
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  header h2 {
    margin: 0;
    font-size: 1.25rem;
  }

  section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    font-size: 0.9rem;
  }

  input,
  select {
    padding: 0.55rem 0.75rem;
    border-radius: 8px;
    border: 1px solid #cbd5f5;
    font-size: 1rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .repo-row {
    display: flex;
    gap: 0.5rem;
  }

  .repo-row input {
    flex: 1;
  }

  .browse {
    border: none;
    border-radius: 8px;
    background: #667eea;
    color: white;
    padding: 0.6rem 1rem;
    font-weight: 600;
    cursor: pointer;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
  }

  button {
    border: none;
    border-radius: 999px;
    padding: 0.6rem 1.4rem;
    font-weight: 600;
    cursor: pointer;
  }

  .primary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }

  .secondary {
    background: #e2e8f0;
    color: #1a202c;
  }

  @media (max-width: 600px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
