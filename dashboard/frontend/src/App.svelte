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
  import Sidebar from './lib/components/Sidebar.svelte';
  import EnvironmentCard from './lib/components/EnvironmentCard.svelte';
  import LogsModal from './lib/components/LogsModal.svelte';

  let environments = $state<EnvironmentSummary[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let showCreateModal = $state(false);
  let actionBusy = $state<Record<string, boolean>>({});
  let monitorOpen = $state<Record<string, boolean>>({});
  let aiOpen = $state<Record<string, boolean>>({});
  let aiSseMessages = $state<Record<string, string>>({});
  let systemStatus = $state<any>(null);
  let githubStatusInfo = $state<any>(null);
  let githubConfig = $state<any>(null);
  let orphansInfo = $state<any>({ orphans: [], tracked: 0 });
  let updateStatus = $state<any>(null);
  let showUpdateModal = $state(false);
  let showGithubModal = $state(false);
  let githubPatInput = $state('');
  let deviceFlow = $state<any>(null);
  let devicePollTimer = $state<ReturnType<typeof setInterval> | null>(null);
  let updatePollTimer = $state<ReturnType<typeof setInterval> | null>(null);
  let updateInitiatedLocally = $state(false);
  let repoBrowserOpen = $state(false);
  let pendingGitUrl = $state('');
  let imagesInfo = $state<any>(null);
  let imageBusy = $state<Record<string, boolean>>({});
  let orphansBusy = $state(false);
  let systemActionMessage = $state<string | null>(null);
  let desktopCopyState = $state<Record<string, 'copied' | 'failed' | ''>>({});
  const desktopCopyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let systemActionResetTimer = $state<ReturnType<typeof setTimeout> | null>(null);
  let deviceCodeCopyState = $state<'copied' | 'failed' | ''>('');
  let deviceCodeCopyTimer = $state<ReturnType<typeof setTimeout> | null>(null);
  // Start with sidebar collapsed on mobile devices
  let sidebarCollapsed = $state(typeof window !== 'undefined' && window.innerWidth <= 768);
  let logsModalEnvId = $state('');
  let logsModalOpen = $state(false);
  let envDeviceAuth = $state<Record<string, { code: string; url: string } | null>>({});

  function reconcileDeviceAuth(list: EnvironmentSummary[]) {
    const next: Record<string, { code: string; url: string } | null> = {};
    for (const env of list) {
      if (env.deviceAuth) {
        next[env.id] = env.deviceAuth;
      } else if (env.requiresAuth && envDeviceAuth[env.id]) {
        next[env.id] = envDeviceAuth[env.id];
      }
    }
    envDeviceAuth = next;
  }

  async function loadEnvironments() {
    loading = true;
    error = null;
    try {
      const list = await listEnvironments();
      environments = list;
      reconcileDeviceAuth(list);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  function updateEnvironmentStatus(update: Partial<EnvironmentSummary> & { id: string }) {
    const index = environments.findIndex((env) => env.id === update.id);
    if (index === -1) {
      loadEnvironments();
      return;
    }
    // Create new array to ensure Svelte detects the change
    environments = environments.map((env, idx) =>
      idx === index ? { ...env, ...update } : env
    );
  }

  async function handleCreate(payload: CreateEnvironmentPayload) {
    actionBusy['create'] = true;
    try {
      await createEnvironment(payload);
      showCreateModal = false;
      pendingGitUrl = '';
      // Don't manually refresh - SSE registry-update event will handle it
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
      // Don't manually update state - rely on SSE events (registry-update, env-status)
      // to refresh the UI automatically
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
    const nextOpen = !aiOpen[id];
    aiOpen = { ...aiOpen, [id]: nextOpen };
    if (!nextOpen) {
      const { [id]: _ignored, ...rest } = aiSseMessages;
      aiSseMessages = rest;
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

  async function copyDeviceCode(envId: string) {
    const auth = envDeviceAuth[envId];
    if (!auth) return;
    try {
      await navigator.clipboard.writeText(auth.code);
    } catch (err) {
      window.prompt('Copy this code to GitHub', auth.code);
    }
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

  async function copyModalDeviceCode() {
    if (!deviceFlow?.user_code) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(deviceFlow.user_code);
      } else {
        throw new Error('Clipboard unavailable');
      }
      deviceCodeCopyState = 'copied';
    } catch (err) {
      deviceCodeCopyState = 'failed';
      // Fallback prompt so the user can copy manually in environments without clipboard API
      window.prompt('Copy this code to GitHub', deviceFlow.user_code);
    } finally {
      if (deviceCodeCopyTimer) clearTimeout(deviceCodeCopyTimer);
      deviceCodeCopyTimer = setTimeout(() => {
        deviceCodeCopyState = '';
      }, 2500);
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

  async function loadOrphans() {
    try {
      orphansInfo = await fetchOrphans();
    } catch (err) {
      console.error('Failed to load orphans', err);
    }
  }

  async function loadImages() {
    try {
      imagesInfo = await fetchImages();
    } catch (err) {
      console.error('Failed to load images', err);
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
      updateInitiatedLocally = true;
      openUpdateModal();
      await refreshUpdateStatus();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  function closeUpdateModal() {
    showUpdateModal = false;
    // Don't clear updateStatus - keep polling if update is still running
    if (!updateStatus?.running) {
      updateStatus = null;
      updateInitiatedLocally = false;
      if (updatePollTimer) {
        clearInterval(updatePollTimer);
        updatePollTimer = null;
      }
    }
    // If update is still running, keep polling in background
  }

  function openUpdateModal() {
    if (!showUpdateModal) {
      showUpdateModal = true;
    }
    if (!updatePollTimer) {
      updatePollTimer = setInterval(refreshUpdateStatus, 3000);
    }
  }

  function handleViewUpdateProgress() {
    openUpdateModal();
    refreshUpdateStatus();
  }

  async function refreshUpdateStatus() {
    try {
      updateStatus = await fetchUpdateStatus();
      if (updateStatus && !updateStatus.running) {
        loadSystemStatus();
        // Update completed - stop polling
        if (updatePollTimer) {
          clearInterval(updatePollTimer);
          updatePollTimer = null;
        }
      }
      return updateStatus;
    } catch (err) {
      console.error('Failed to fetch update status', err);
      return null;
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
      // Don't manually refresh - SSE registry-update event will handle it
    } catch (err) {
      alert((err as Error).message);
    } finally {
      orphansBusy = false;
    }
  }

  function isUpdateInProgress(): boolean {
    return updateStatus?.running ?? false;
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

  function openLogs(envId: string) {
    logsModalEnvId = envId;
    logsModalOpen = true;
  }

  function closeLogs() {
    logsModalOpen = false;
    logsModalEnvId = '';
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
    if (deviceCodeCopyTimer) {
      clearTimeout(deviceCodeCopyTimer);
      deviceCodeCopyTimer = null;
    }
    deviceCodeCopyState = '';
  }

  function openCreateModalDialog() {
    if (isUpdateInProgress()) {
      alert('Cannot create new environments while system update is in progress');
      return;
    }
    pendingGitUrl = '';
    showCreateModal = true;
  }

  async function setupRealtimeStreams() {
    try {
      await Promise.all([loadEnvironments(), loadSystemStatus(), loadGithubInfo()]);

      const status = await refreshUpdateStatus();
      if (status?.cacheBustPending) {
        setTimeout(() => window.location.reload(), 1000);
        return;
      }

      sseClient.connect();

      const registryHandler = () => {
        loadEnvironments();
        loadSystemStatus();
        loadOrphans();
        loadImages();
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
          requiresAuth: payload.requiresAuth,
          deviceAuth: payload.deviceAuth,
        });

        if (payload.deviceAuth) {
          envDeviceAuth = {
            ...envDeviceAuth,
            [payload.env_id]: payload.deviceAuth,
          };
        } else if (envDeviceAuth[payload.env_id]) {
          const { [payload.env_id]: _ignored, ...rest } = envDeviceAuth;
          envDeviceAuth = rest;
        }
      };

      const aiHandler = (payload: any) => {
        const { env_id: envId, response } = payload;
        aiSseMessages = {
          ...aiSseMessages,
          [envId]: `${aiSseMessages[envId] ?? ''}\n\n${response}`.trim(),
        };
      };

      const updateHandler = () => {
        // Only auto-open modal on the device that initiated the update
        if (updateInitiatedLocally) {
          openUpdateModal();
        }
        // Always refresh status to keep UI updated
        refreshUpdateStatus();
      };

      const deviceAuthHandler = (payload: any) => {
        envDeviceAuth = {
          ...envDeviceAuth,
          [payload.env_id]: { url: payload.url, code: payload.code },
        };
      };

      const systemStatusHandler = (payload: any) => {
        systemStatus = systemStatus
          ? {
              ...systemStatus,
              updates_available: payload.updates_available,
              commits_behind: payload.commits_behind,
              current_sha: payload.current_sha,
              latest_sha: payload.latest_sha,
            }
          : payload;
      };

      const cacheBustHandler = () => {
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      };

      sseClient.on('registry-update', registryHandler);
      sseClient.on('env-status', statusHandler);
      sseClient.on('ai-response', aiHandler);
      sseClient.on('update-progress', updateHandler);
      sseClient.on('update-started', updateHandler);
      sseClient.on('device-auth', deviceAuthHandler);
      sseClient.on('system-status', systemStatusHandler);
      sseClient.on('cache-bust', cacheBustHandler);

      return () => {
        sseClient.off('registry-update', registryHandler);
        sseClient.off('env-status', statusHandler);
        sseClient.off('ai-response', aiHandler);
        sseClient.off('update-progress', updateHandler);
        sseClient.off('update-started', updateHandler);
        sseClient.off('device-auth', deviceAuthHandler);
        sseClient.off('system-status', systemStatusHandler);
        sseClient.off('cache-bust', cacheBustHandler);
        sseClient.disconnect();
      };
    } catch (err) {
      console.error('Failed to initialize realtime streams', err);
      return;
    }
  }

  onMount(() => {
    let cleanup: (() => void) | void;
    let disposed = false;

    (async () => {
      const result = await setupRealtimeStreams();
      if (disposed && typeof result === 'function') {
        result();
        return;
      }
      cleanup = result;
    })().catch((err) => {
      console.error('Realtime initialization failed', err);
    });

    return () => {
      disposed = true;
      if (typeof cleanup === 'function') {
        cleanup();
        cleanup = undefined;
      }
    };
  });

  onDestroy(() => {
    if (updatePollTimer) {
      clearInterval(updatePollTimer);
      updatePollTimer = null;
    }
    clearDevicePoll();
    for (const timer of desktopCopyTimers.values()) {
      clearTimeout(timer);
    }
    desktopCopyTimers.clear();
    if (systemActionResetTimer) {
      clearTimeout(systemActionResetTimer);
      systemActionResetTimer = null;
    }
  });
</script>

<main>
  <Sidebar
    bind:collapsed={sidebarCollapsed}
    githubStatusInfo={githubStatusInfo}
    githubConfig={githubConfig}
    systemStatus={systemStatus}
    systemActionMessage={systemActionMessage}
    orphansInfo={orphansInfo}
    imagesInfo={imagesInfo}
    orphansBusy={orphansBusy}
    imageBusy={imageBusy}
    updateInProgress={isUpdateInProgress()}
    onGithubManage={() => (showGithubModal = true)}
    onGithubDisconnect={disconnectGithubAccount}
    onStartUpdate={handleStartUpdate}
    onViewUpdateProgress={handleViewUpdateProgress}
    onCleanupOrphans={handleCleanupOrphans}
    onRecoverRegistry={handleRecoverRegistry}
    onImageBuild={handleImageBuild}
  />

  <div class="main-content">
    <header class="hero">
      <div>
        <h1>🚜 Dev Farm</h1>
      </div>
      <button class="create" on:click={openCreateModalDialog}>➕ New Environment</button>
    </header>

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
        <EnvironmentCard
          env={env}
          actionBusy={actionBusy[env.id] || false}
          desktopCopyState={desktopCopyState[env.id] || ''}
          deviceAuth={envDeviceAuth[env.id] ?? env.deviceAuth ?? null}
          monitorOpen={monitorOpen[env.id] || false}
          aiOpen={aiOpen[env.id] || false}
          onStart={() => perform(env.id, 'start')}
          onStop={() => perform(env.id, 'stop')}
          onDelete={() => perform(env.id, 'delete')}
          onCopyDesktopCommand={() => copyDesktopCommand(env)}
          onCopyDeviceCode={() => copyDeviceCode(env.id)}
          onToggleMonitor={() => toggleMonitor(env.id)}
          onToggleAi={() => toggleAi(env.id)}
          onOpenLogs={() => openLogs(env.id)}
        >
          <MonitorPanel envId={env.id} open={monitorOpen[env.id] || false} />
          <AiChatPanel envId={env.id} open={aiOpen[env.id] || false} latestSse={aiSseMessages[env.id] || null} />
        </EnvironmentCard>
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
        
        <div class="auth-method-section">
          <h3>💡 Recommended: Personal Access Token</h3>
          <p class="hint">
            Easier for terminal environments - no device flow needed!<br>
            Requires: repo, workflow, read:org, gist scopes
          </p>
          <label>
            <span>Personal Access Token</span>
            <input type="text" bind:value={githubPatInput} placeholder="ghp_..." />
          </label>
          <button class="primary-action" on:click={saveGithubPat} disabled={!githubPatInput.trim()}>
            Save Token
          </button>
        </div>

        <div class="divider">
          <span>OR</span>
        </div>

        <div class="auth-method-section">
          <h3>OAuth Device Flow</h3>
          <p class="hint">Browser-based authentication (requires opening links)</p>
          <button class="secondary" on:click={beginDeviceFlow}>Start Device Flow</button>
        </div>

        <div class="modal-actions">
          <button class="secondary danger-text" on:click={disconnectGithubAccount}>Disconnect</button>
        </div>
        {#if deviceFlow}
          <div class="device-info">
            <p>Enter this code at <a href={deviceFlow.verification_uri} target="_blank" rel="noreferrer">{deviceFlow.verification_uri}</a></p>
            <div class="device-code">{deviceFlow.user_code}</div>
            <button class="copy-code-btn" on:click={copyModalDeviceCode}>📋 Copy Code</button>
            {#if deviceCodeCopyState === 'copied'}
              <p class="copy-status success">Code copied to clipboard!</p>
            {:else if deviceCodeCopyState === 'failed'}
              <p class="copy-status warn">Clipboard unavailable. Use the prompt to copy manually.</p>
            {/if}
          </div>
        {/if}
        <button class="close" on:click={closeGithubModal}>Close</button>
      </div>
    </div>
  {/if}

  </div>

  <LogsModal
    envId={logsModalEnvId}
    open={logsModalOpen}
    deviceAuth={envDeviceAuth[logsModalEnvId] || null}
    onClose={closeLogs}
  />
</main>

<style>
  main {
    display: flex;
    flex-direction: row;
    gap: 0;
    width: 100%;
    max-width: none;
    min-height: 100vh;
    margin: 0;
    padding: 0;
  }

  @media (max-width: 1024px) {
    main {
      flex-direction: column;
      gap: 0;
      padding-top: 80px; /* Space for fixed sidebar when collapsed */
    }
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

  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2rem;
    min-width: 0;
    padding: 2rem 1.5rem 4rem 1.5rem;
  }

  @media (max-width: 1024px) {
    .main-content {
      padding: 1rem 1.5rem 4rem 1.5rem;
    }
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
    border: 2px solid var(--button-border-secondary);
    border-radius: 999px;
    padding: 0.5rem 1.1rem;
    background: var(--button-bg-secondary);
    color: var(--button-text-secondary);
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn.primary {
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

  .btn:hover:not(:disabled) {
    background: var(--button-bg-secondary-hover);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .btn.primary:hover:not(:disabled) {
    background: var(--bg-primary-gradient);
    opacity: 0.95;
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
  }

  .btn:active:not(:disabled) {
    transform: scale(0.98);
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    pointer-events: none;
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
  .github-modal {
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

  .github-modal .auth-method-section {
    padding: 1.25rem;
    background: #f8fafc;
    border-radius: 12px;
    border: 2px solid #e2e8f0;
  }

  .github-modal .auth-method-section h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.1rem;
    color: #1e293b;
  }

  .github-modal .auth-method-section .hint {
    margin: 0 0 1rem 0;
    font-size: 0.9rem;
    color: #64748b;
    line-height: 1.5;
  }

  .github-modal .auth-method-section .hint a {
    color: #667eea;
    text-decoration: none;
    font-weight: 600;
  }

  .github-modal .auth-method-section .hint a:hover {
    text-decoration: underline;
  }

  .github-modal .divider {
    display: flex;
    align-items: center;
    text-align: center;
    margin: 0.5rem 0;
  }

  .github-modal .divider::before,
  .github-modal .divider::after {
    content: '';
    flex: 1;
    border-bottom: 1px solid #cbd5e1;
  }

  .github-modal .divider span {
    padding: 0 1rem;
    color: #94a3b8;
    font-size: 0.85rem;
    font-weight: 600;
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

  .github-modal .primary-action {
    width: 100%;
    margin-top: 0.5rem;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
    color: white !important;
    border: none !important;
    font-size: 1rem;
    padding: 0.75rem 1.5rem !important;
  }

  .github-modal .danger-text {
    color: #dc2626 !important;
  }

  .github-modal .modal-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.5rem;
    padding-top: 1rem;
    border-top: 1px solid #e2e8f0;
  }

  .github-modal button,
  .update-modal button {
    align-self: flex-start;
    border: 2px solid var(--button-border-secondary);
    border-radius: 999px;
    padding: 0.5rem 1.25rem;
    background: var(--button-bg-secondary);
    color: var(--button-text-secondary);
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .github-modal button:hover:not(:disabled),
  .update-modal button:hover:not(:disabled) {
    background: var(--button-bg-secondary-hover);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .github-modal button:active:not(:disabled),
  .update-modal button:active:not(:disabled) {
    transform: scale(0.98);
  }

  .github-modal button:disabled,
  .update-modal button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    pointer-events: none;
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
    margin-bottom: 0.75rem;
  }

  .copy-code-btn {
    border: none;
    border-radius: 8px;
    padding: 0.5rem 1rem;
    background: var(--bg-primary-gradient);
    color: white;
    font-weight: 600;
    cursor: pointer;
    margin-top: 0.5rem;
    transition: all 0.15s ease;
  }

  .copy-code-btn:hover {
    opacity: 0.95;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
  }

  .copy-code-btn:active {
    transform: scale(0.98);
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
