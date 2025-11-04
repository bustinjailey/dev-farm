<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { EnvironmentSummary } from '@shared/types';
  import {
    listEnvironments,
    createEnvironment,
    startEnvironment,
    stopEnvironment,
    deleteEnvironment,
    type CreateEnvironmentPayload,
    fetchSystemStatus,
    fetchGithubStatus,
    fetchGithubConfig,
    startSystemUpdate,
    fetchUpdateStatus,
    cleanupOrphansRequest,
    fetchOrphans,
    recoverRegistryRequest,
    startGithubDeviceFlow,
    pollGithubDeviceFlow,
    logoutGithub,
    updateGithubConfig,
    fetchImages,
    rebuildImage,
    upgradeSystemRequest,
    fetchEnvironmentLogs,
  } from './lib/api';
  import { sseClient } from './lib/sse';
  import CreateEnvironmentModal from './lib/components/CreateEnvironmentModal.svelte';
  import MonitorPanel from './lib/components/MonitorPanel.svelte';
  import AiChatPanel from './lib/components/AiChatPanel.svelte';
  import RepoBrowser from './lib/components/RepoBrowser.svelte';

  let environments: EnvironmentSummary[] = [];
  let loading = true;
  let error: string | null = null;
  let showCreateModal = false;
  let actionBusy: Record<string, boolean> = {};
  let monitorOpen: Record<string, boolean> = {};
  let aiOpen: Record<string, boolean> = {};
  let aiSseMessages: Record<string, string> = {};
  let systemStatus: any = null;
  let githubStatusInfo: any = null;
  let githubConfig: any = null;
  let orphansInfo: any = { orphans: [], tracked: 0 };
  let updateStatus: any = null;
  let showUpdateModal = false;
  let showGithubModal = false;
  let githubPatInput = '';
  let deviceFlow: any = null;
  let devicePollTimer: ReturnType<typeof setInterval> | null = null;
  let updatePollTimer: ReturnType<typeof setInterval> | null = null;
  let repoBrowserOpen = false;
  let pendingGitUrl = '';
  let logsModal = { open: false, envId: '', logs: '' };
  let imagesInfo: any = null;
  let imageBusy: Record<string, boolean> = {};
  let orphansBusy = false;
  let systemActionMessage: string | null = null;
  let desktopCopyState: Record<string, 'copied' | 'failed' | ''> = {};
  const desktopCopyTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async function loadEnvironments() {
    loading = true;
    error = null;
    try {
      environments = await listEnvironments();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  function updateEnvironmentStatus(update: Partial<EnvironmentSummary> & { id: string }) {
    const index = environments.findIndex((env) => env.id === update.id);
    if (index === -1) {
      // fetch full list if unknown env
      loadEnvironments();
      return;
    }
    environments = environments.map((env, idx) => (idx === index ? { ...env, ...update } : env));
  }

  async function handleCreate(payload: CreateEnvironmentPayload) {
    actionBusy['create'] = true;
    try {
      await createEnvironment(payload);
      showCreateModal = false;
      pendingGitUrl = '';
      await loadEnvironments();
      await Promise.all([loadSystemStatus(), loadGithubInfo()]);
    } catch (err) {
      alert(`Failed to create environment: ${(err as Error).message}`);
    } finally {
      delete actionBusy['create'];
    }
  }

  async function perform(id: string, action: 'start' | 'stop' | 'delete') {
    actionBusy[id] = true;
    try {
      if (action === 'start') await startEnvironment(id);
      else if (action === 'stop') await stopEnvironment(id);
      else await deleteEnvironment(id);
      if (action === 'delete') {
        environments = environments.filter((env) => env.id !== id);
      } else {
        await loadEnvironments();
      }
    } catch (err) {
      alert(`Failed to ${action} environment: ${(err as Error).message}`);
    } finally {
      delete actionBusy[id];
    }
  }

  function toggleMonitor(id: string) {
    monitorOpen = { ...monitorOpen, [id]: !monitorOpen[id] };
  }

  function toggleAi(id: string) {
    aiOpen = { ...aiOpen, [id]: !aiOpen[id] };
    if (!aiOpen[id]) {
      delete aiSseMessages[id];
    }
  }

  function scheduleDesktopReset(envId: string) {
    const timer = desktopCopyTimers.get(envId);
    if (timer) {
      clearTimeout(timer);
    }
    const handle = setTimeout(() => {
      desktopCopyTimers.delete(envId);
      desktopCopyState = { ...desktopCopyState, [envId]: '' };
    }, 2500);
    desktopCopyTimers.set(envId, handle);
  }

  async function copyDesktopCommand(env: EnvironmentSummary) {
    if (!env.desktopCommand) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(env.desktopCommand);
      } else {
        throw new Error('Clipboard unavailable');
      }
      desktopCopyState = { ...desktopCopyState, [env.id]: 'copied' };
    } catch (err) {
      desktopCopyState = { ...desktopCopyState, [env.id]: 'failed' };
      // Fallback prompt so the user can copy manually in environments without clipboard API
      window.prompt('Copy this command into VS Code Insiders Desktop', env.desktopCommand);
    } finally {
      scheduleDesktopReset(env.id);
    }
  }

  async function loadSystemStatus() {
    try {
      systemStatus = await fetchSystemStatus();
      orphansInfo = await fetchOrphans();
      imagesInfo = await fetchImages();
    } catch (err) {
      console.error('Failed to load system status', err);
    }
  }

  async function loadGithubInfo() {
    try {
      githubStatusInfo = await fetchGithubStatus();
      githubConfig = await fetchGithubConfig();
      githubPatInput = githubConfig?.has_pat ? '••••••••' : '';
    } catch (err) {
      console.error('Failed to load GitHub info', err);
    }
  }

  async function handleStartUpdate() {
    try {
      const result = await startSystemUpdate();
      if (!result.started) {
        alert(result.message ?? 'Update already running');
        return;
      }
      showUpdateModal = true;
      await refreshUpdateStatus();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  function closeUpdateModal() {
    showUpdateModal = false;
    updateStatus = null;
    if (updatePollTimer) {
      clearInterval(updatePollTimer);
      updatePollTimer = null;
    }
  }

  async function refreshUpdateStatus() {
    try {
      updateStatus = await fetchUpdateStatus();
      if (updateStatus && !updateStatus.running) {
        loadSystemStatus();
      }
    } catch (err) {
      console.error('Failed to fetch update status', err);
    }
  }

  async function handleCleanupOrphans() {
    orphansBusy = true;
    try {
      await cleanupOrphansRequest();
      await loadSystemStatus();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      orphansBusy = false;
    }
  }

  async function handleRecoverRegistry() {
    orphansBusy = true;
    try {
      await recoverRegistryRequest();
      await loadSystemStatus();
      await loadEnvironments();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      orphansBusy = false;
    }
  }

  async function handleUpgradeSystem() {
    systemActionMessage = 'Running upgrade…';
    try {
      const result = await upgradeSystemRequest();
      systemActionMessage = result.success ? 'Upgrade completed' : `Upgrade failed: ${result.error}`;
    } catch (err) {
      systemActionMessage = (err as Error).message;
    }
    await loadSystemStatus();
    setTimeout(() => {
      systemActionMessage = null;
    }, 4000);
  }

  async function handleImageBuild(type: 'code-server' | 'terminal' | 'dashboard') {
    imageBusy = { ...imageBusy, [type]: true };
    try {
      const result = await rebuildImage(type);
      if (!result.success) {
        alert(result.output ?? 'Build failed');
      }
      await loadSystemStatus();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      imageBusy = { ...imageBusy, [type]: false };
    }
  }

  async function openLogs(envId: string) {
    try {
      const { logs } = await fetchEnvironmentLogs(envId);
      logsModal = { open: true, envId, logs };
    } catch (err) {
      alert((err as Error).message);
    }
  }

  function closeLogs() {
    logsModal = { open: false, envId: '', logs: '' };
  }

  async function saveGithubPat() {
    try {
      const payload: Record<string, string> = {};
      if (githubPatInput && githubPatInput !== '••••••••') {
        payload.personal_access_token = githubPatInput;
      } else if (!githubPatInput) {
        payload.personal_access_token = '';
      }
      const result = await updateGithubConfig(payload);
      if (result.error) {
        alert(result.error);
      }
      await loadGithubInfo();
      closeGithubModal();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function disconnectGithubAccount() {
    try {
      await logoutGithub();
      await loadGithubInfo();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function beginDeviceFlow() {
    try {
      deviceFlow = await startGithubDeviceFlow();
      if ('error' in deviceFlow) {
        alert(deviceFlow.error);
        deviceFlow = null;
        return;
      }
      devicePollTimer = setInterval(async () => {
        const result = await pollGithubDeviceFlow();
        if (result.status === 'success') {
          clearDevicePoll();
          await loadGithubInfo();
          deviceFlow = null;
          closeGithubModal();
        } else if (result.status === 'expired' || result.status === 'denied') {
          clearDevicePoll();
          deviceFlow = null;
          alert(`OAuth ${result.status}`);
        } else if (result.status === 'error') {
          clearDevicePoll();
          alert(result.message || 'OAuth error');
        }
      }, (deviceFlow.interval ?? 5) * 1000);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  function clearDevicePoll() {
    if (devicePollTimer) {
      clearInterval(devicePollTimer);
      devicePollTimer = null;
    }
  }

  function closeGithubModal() {
    showGithubModal = false;
    deviceFlow = null;
    clearDevicePoll();
  }

  function openCreateModalDialog() {
    pendingGitUrl = '';
    showCreateModal = true;
  }

  onMount(() => {
    loadEnvironments();
    loadSystemStatus();
    loadGithubInfo();
    sseClient.connect();

    const registryHandler = () => {
      loadEnvironments();
    };
    const statusHandler = (payload: any) => {
      updateEnvironmentStatus({
        id: payload.env_id,
        status: payload.status,
        url: payload.url,
        mode: payload.mode,
        workspacePath: payload.workspacePath,
        ready: payload.status === 'running',
        desktopCommand: payload.desktopCommand,
      });
    };
    const aiHandler = (payload: any) => {
      const { env_id: envId, response } = payload;
      aiSseMessages = {
        ...aiSseMessages,
        [envId]: `${aiSseMessages[envId] ?? ''}\n\n${response}`.trim(),
      };
    };
    const updateHandler = () => {
      showUpdateModal = true;
      refreshUpdateStatus();
    };
    const updateStartedHandler = () => {
      showUpdateModal = true;
      refreshUpdateStatus();
    };

    sseClient.on('registry-update', registryHandler);
    sseClient.on('env-status', statusHandler);
    sseClient.on('ai-response', aiHandler);
    sseClient.on('update-progress', updateHandler);
    sseClient.on('update-started', updateStartedHandler);

    return () => {
      sseClient.off('registry-update', registryHandler);
      sseClient.off('env-status', statusHandler);
      sseClient.off('ai-response', aiHandler);
      sseClient.off('update-progress', updateHandler);
      sseClient.off('update-started', updateStartedHandler);
      sseClient.disconnect();
    };
  });

  onDestroy(() => {
    clearDevicePoll();
    if (updatePollTimer) {
      clearInterval(updatePollTimer);
      updatePollTimer = null;
    }
    desktopCopyTimers.forEach((timer) => clearTimeout(timer));
    desktopCopyTimers.clear();
  });

  $: if (showUpdateModal) {
    if (!updatePollTimer) {
      updatePollTimer = setInterval(refreshUpdateStatus, 3000);
    }
  } else if (updatePollTimer) {
    clearInterval(updatePollTimer);
    updatePollTimer = null;
  }

  /* cleanup happens via closeGithubModal() */
</script>

<main>
  <header class="hero">
    <div>
      <h1>🚜 Dev Farm</h1>
      <p>On-demand development environments powered by VS Code Remote Tunnels.</p>
    </div>
    <button class="create" on:click={openCreateModalDialog}>➕ New Environment</button>
  </header>

  <section class="status-cards">
    <div class="status-card">
      <header>
        <h3>GitHub</h3>
        <span class={`badge ${githubStatusInfo?.authenticated ? 'success' : 'warn'}`}>
          {githubStatusInfo?.authenticated ? githubStatusInfo.username : 'Not Connected'}
        </span>
      </header>
      <p>
        {#if githubStatusInfo?.authenticated}
          Token scopes: {githubStatusInfo.scopes?.join(', ') || 'unknown'}
        {:else}
          {githubStatusInfo?.message || 'Connect your GitHub account.'}
        {/if}
      </p>
      <div class="card-actions">
        <button on:click={() => (showGithubModal = true)}>Manage</button>
        <button class="secondary" on:click={disconnectGithubAccount}>Disconnect</button>
      </div>
    </div>

    <div class="status-card">
      <header>
        <h3>System Version</h3>
        <span class={`badge ${systemStatus?.updates_available ? 'warn' : 'success'}`}>
          {systemStatus?.updates_available ? `${systemStatus.commits_behind} behind` : 'Up to date'}
        </span>
      </header>
      <p>Current: {systemStatus?.current_sha || 'N/A'}</p>
      <p>Latest: {systemStatus?.latest_sha || 'N/A'}</p>
      <div class="card-actions">
        <button on:click={handleStartUpdate}>Start Update</button>
        <button class="secondary" on:click={handleUpgradeSystem}>Run Upgrade</button>
      </div>
      {#if systemActionMessage}
        <small>{systemActionMessage}</small>
      {/if}
    </div>

    <div class="status-card">
      <header>
        <h3>Maintenance</h3>
      </header>
      <p>Tracked: {orphansInfo?.tracked ?? 0}</p>
      <p>Orphans: {orphansInfo?.orphans?.length ?? 0}</p>
      <div class="card-actions">
        <button on:click={handleCleanupOrphans} disabled={orphansBusy}>Clean Up</button>
        <button class="secondary" on:click={handleRecoverRegistry} disabled={orphansBusy}>
          Recover Registry
        </button>
      </div>
      {#if imagesInfo?.images}
        <div class="image-buttons">
          {#each ['code-server', 'terminal', 'dashboard'] as type}
            <button on:click={() => handleImageBuild(type as any)} disabled={imageBusy[type as any]}>
              Rebuild {type}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </section>

  {#if loading}
    <p class="status">Loading environments…</p>
  {:else if error}
    <p class="status error">{error}</p>
  {:else if environments.length === 0}
    <div class="empty">
      <span>🌱</span>
      <p>No environments yet. Create one to get started.</p>
    </div>
  {:else}
    <section class="grid">
      {#each environments as env}
        <article class="card" data-status={env.status}>
          <header>
            <div>
              <h2>{env.name}</h2>
              <small>{env.mode} mode • status {env.status}</small>
            </div>
            <span class={`badge ${env.status}`}>{env.status}</span>
          </header>

          <dl>
            <div>
              <dt>Project</dt>
              <dd>{env.project}</dd>
            </div>
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
              <button class="btn secondary" type="button" on:click={() => copyDesktopCommand(env)}>
                🖥 Copy Desktop Command
              </button>
              <button class="btn" disabled={actionBusy[env.id]} on:click={() => perform(env.id, 'stop')}>
                ⏸ Stop
              </button>
            {:else if env.status === 'starting'}
              <button class="btn" disabled>Starting…</button>
            {:else}
              <button class="btn primary" disabled={actionBusy[env.id]} on:click={() => perform(env.id, 'start')}>
                ▶️ Start
              </button>
            {/if}

            <button class="btn" disabled={actionBusy[env.id]} on:click={() => toggleMonitor(env.id)}>
              👁 {monitorOpen[env.id] ? 'Hide Monitor' : 'Monitor'}
            </button>
            <button class="btn" disabled={actionBusy[env.id]} on:click={() => toggleAi(env.id)}>
              🤖 {aiOpen[env.id] ? 'Hide AI' : 'AI Assist'}
            </button>
            <button class="btn" disabled={actionBusy[env.id]} on:click={() => openLogs(env.id)}>
              📝 Logs
            </button>
            <button class="btn danger" disabled={actionBusy[env.id]} on:click={() => perform(env.id, 'delete')}>
              🗑 Delete
            </button>
          </div>

          {#if desktopCopyState[env.id] === 'copied'}
            <p class="copy-status success">Desktop command copied. Paste into VS Code Insiders.</p>
          {:else if desktopCopyState[env.id] === 'failed'}
            <p class="copy-status warn">Clipboard unavailable. Use the prompt to copy manually.</p>
          {/if}

          <MonitorPanel envId={env.id} open={!!monitorOpen[env.id]} />
          <AiChatPanel envId={env.id} open={!!aiOpen[env.id]} latestSse={aiSseMessages[env.id] ?? null} />
        </article>
      {/each}
    </section>
  {/if}

  <CreateEnvironmentModal
    open={showCreateModal}
    bind:gitUrl={pendingGitUrl}
    on:close={() => {
      showCreateModal = false;
      pendingGitUrl = '';
    }}
    on:submit={({ detail }) => handleCreate(detail)}
    on:browseRepo={() => {
      repoBrowserOpen = true;
    }}
  />

  <RepoBrowser
    open={repoBrowserOpen}
    on:select={(event) => {
      pendingGitUrl = event.detail.url;
      repoBrowserOpen = false;
      showCreateModal = true;
    }}
    on:close={() => (repoBrowserOpen = false)}
  />

  {#if showUpdateModal}
    <div
      class="backdrop modal-layer"
      role="button"
      tabindex="0"
      on:click={closeUpdateModal}
      on:keydown={(e) => e.key === 'Escape' && closeUpdateModal()}
    >
      <div
        class="update-modal"
        role="dialog"
        aria-modal="true"
        tabindex="0"
        on:click|stopPropagation
        on:keydown={(e) => e.key === 'Escape' && closeUpdateModal()}
      >
        <header>
          <h2>System Update</h2>
        </header>
        {#if updateStatus}
          <ul>
            {#each updateStatus.stages as stage}
              <li class={stage.status}>{stage.stage} {stage.message}</li>
            {/each}
          </ul>
          {#if updateStatus.running}
            <p>Update in progress…</p>
          {:else if updateStatus.success}
            <p class="success">Update completed successfully.</p>
          {:else if updateStatus.error}
            <p class="error">{updateStatus.error}</p>
          {/if}
        {:else}
          <p>Loading update status…</p>
        {/if}
        <button on:click={closeUpdateModal}>Close</button>
      </div>
    </div>
  {/if}

  {#if showGithubModal}
    <div
      class="backdrop modal-layer"
      role="button"
      tabindex="0"
      on:click={closeGithubModal}
      on:keydown={(e) => e.key === 'Escape' && closeGithubModal()}
    >
      <div
        class="github-modal"
        role="dialog"
        aria-modal="true"
        tabindex="0"
        on:click|stopPropagation
        on:keydown={(e) => e.key === 'Escape' && closeGithubModal()}
      >
        <header>
          <h2>GitHub Connection</h2>
        </header>
        <label>
          <span>Personal Access Token</span>
          <input type="text" bind:value={githubPatInput} placeholder="ghp_..." />
        </label>
        <div class="modal-actions">
          <button on:click={saveGithubPat}>Save</button>
          <button class="secondary" on:click={disconnectGithubAccount}>Disconnect</button>
          <button class="secondary" on:click={beginDeviceFlow}>Start Device Flow</button>
        </div>
        {#if deviceFlow}
          <div class="device-info">
            <p>Enter this code at <a href={deviceFlow.verification_uri} target="_blank" rel="noreferrer">{deviceFlow.verification_uri}</a></p>
            <div class="device-code">{deviceFlow.user_code}</div>
          </div>
        {/if}
        <button class="close" on:click={closeGithubModal}>Close</button>
      </div>
    </div>
  {/if}

  {#if logsModal.open}
    <div
      class="backdrop modal-layer"
      role="button"
      tabindex="0"
      on:click={closeLogs}
      on:keydown={(e) => e.key === 'Escape' && closeLogs()}
    >
      <div
        class="logs-modal"
        role="dialog"
        aria-modal="true"
        tabindex="0"
        on:click|stopPropagation
        on:keydown={(e) => e.key === 'Escape' && closeLogs()}
      >
        <header>
          <h2>Logs: {logsModal.envId}</h2>
        </header>
        <pre>{logsModal.logs}</pre>
        <button on:click={closeLogs}>Close</button>
      </div>
    </div>
  {/if}
</main>

<style>
  main {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .hero {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 20px;
    padding: 1.75rem;
    color: white;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.25);
  }

  .hero h1 {
    margin: 0 0 0.5rem;
    font-size: 2.5rem;
  }

  .hero p {
    margin: 0;
    font-size: 1rem;
    opacity: 0.9;
  }

  .create {
    border: none;
    border-radius: 999px;
    padding: 0.75rem 1.75rem;
    background: linear-gradient(135deg, #48bb78 0%, #38b2ac 100%);
    color: white;
    font-weight: 700;
    cursor: pointer;
  }

  .status-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1.25rem;
    margin: 1.5rem 0;
  }

  .status-card {
    background: rgba(255, 255, 255, 0.92);
    border-radius: 18px;
    padding: 1.25rem;
    box-shadow: 0 12px 28px rgba(79, 70, 229, 0.15);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .status-card header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .status-card .badge {
    padding: 0.35rem 0.75rem;
    border-radius: 999px;
    font-weight: 600;
    font-size: 0.75rem;
  }

  .status-card .badge.success {
    background: #48bb78;
    color: white;
  }

  .status-card .badge.warn {
    background: #f6ad55;
    color: white;
  }

  .card-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .card-actions button {
    border: none;
    border-radius: 999px;
    padding: 0.5rem 1.1rem;
    background: #edf2f7;
    color: #1a202c;
    font-weight: 600;
    cursor: pointer;
  }

  .card-actions button.secondary {
    background: #e2e8f0;
  }

  .image-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .image-buttons button {
    border: none;
    border-radius: 999px;
    padding: 0.4rem 0.9rem;
    background: #e0e7ff;
    color: #3730a3;
    font-weight: 600;
    cursor: pointer;
  }

  .status {
    text-align: center;
    color: white;
    font-size: 1.1rem;
  }

  .status.error {
    color: #fed7d7;
  }

  .empty {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 20px;
    padding: 3rem;
    text-align: center;
    color: white;
    font-size: 1.2rem;
  }

  .empty span {
    display: block;
    font-size: 3rem;
    margin-bottom: 1rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 1.5rem;
  }

  .card {
    background: rgba(255, 255, 255, 0.95);
    border-radius: 24px;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    box-shadow: 0 16px 32px rgba(79, 70, 229, 0.15);
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
  }

  dd {
    margin: 0;
    font-weight: 600;
    color: #1a202c;
  }

  .badge {
    padding: 0.35rem 0.9rem;
    border-radius: 999px;
    font-weight: 700;
    text-transform: uppercase;
    font-size: 0.75rem;
  }

  .badge.running {
    background: #48bb78;
    color: white;
  }

  .badge.starting {
    background: #ed8936;
    color: white;
  }

  .badge.exited,
  .badge.stopped {
    background: #a0aec0;
    color: white;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .btn {
    border: none;
    border-radius: 999px;
    padding: 0.5rem 1.1rem;
    background: #edf2f7;
    color: #1a202c;
    font-weight: 600;
    cursor: pointer;
  }

  .btn.primary {
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

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .copy-status {
    margin: -0.25rem 0 0;
    font-size: 0.85rem;
    color: #4a5568;
  }

  .copy-status.success {
    color: #2f855a;
  }

  .copy-status.warn {
    color: #b7791f;
  }

  .modal-layer {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }

  .update-modal,
  .github-modal,
  .logs-modal {
    background: white;
    color: #1a202c;
    border-radius: 16px;
    padding: 1.5rem;
    width: min(520px, 90vw);
    max-height: 80vh;
    overflow: auto;
    box-shadow: 0 24px 48px rgba(30, 64, 175, 0.25);
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .update-modal ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .update-modal li {
    padding: 0.5rem 0.75rem;
    border-radius: 8px;
    background: #f1f5f9;
  }

  .update-modal li.success {
    background: #dcfce7;
    color: #166534;
  }

  .update-modal li.error {
    background: #fee2e2;
    color: #b91c1c;
  }

  .update-modal .error {
    color: #c53030;
  }

  .update-modal .success {
    color: #15803d;
  }

  .github-modal label {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .github-modal input {
    padding: 0.6rem 0.8rem;
    border-radius: 8px;
    border: 1px solid #cbd5f5;
    font-size: 1rem;
  }

  .github-modal .modal-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .github-modal button,
  .logs-modal button,
  .update-modal button {
    align-self: flex-start;
    border: none;
    border-radius: 999px;
    padding: 0.5rem 1.25rem;
    background: #e2e8f0;
    font-weight: 600;
    cursor: pointer;
  }

  .github-modal .device-info {
    padding: 1rem;
    background: #f8fafc;
    border-radius: 12px;
  }

  .device-code {
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace;
    font-size: 1.4rem;
    letter-spacing: 0.2rem;
  }

  .logs-modal pre {
    background: #0f172a;
    color: #e2e8f0;
    padding: 1rem;
    border-radius: 12px;
    max-height: 400px;
    overflow: auto;
  }

  @media (max-width: 720px) {
    .hero {
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
    }

    .create {
      align-self: stretch;
      text-align: center;
    }

    dl {
      grid-template-columns: 1fr;
    }
  }
</style>
