<script lang="ts">
  interface Props {
    collapsed: boolean;
    githubStatusInfo: any;
    githubConfig: any;
    systemStatus: any;
    orphansInfo: any;
    imagesInfo: any;
    imageBusy: Record<string, boolean>;
    orphansBusy: boolean;
    systemActionMessage: string | null;
    updateInProgress: boolean;
    onGithubManage: () => void;
    onGithubDisconnect: () => void;
    onStartUpdate: () => void;
    onViewUpdateProgress: () => void;
    onCleanupOrphans: () => void;
    onRecoverRegistry: () => void;
    onImageBuild: (type: 'code-server' | 'terminal' | 'dashboard') => void;
  }

  let {
    collapsed = $bindable(),
    githubStatusInfo,
    githubConfig,
    systemStatus,
    orphansInfo,
    imagesInfo,
    imageBusy,
    orphansBusy,
    systemActionMessage,
    updateInProgress,
    onGithubManage,
    onGithubDisconnect,
    onStartUpdate,
    onViewUpdateProgress,
    onCleanupOrphans,
    onRecoverRegistry,
    onImageBuild,
  }: Props = $props();

  function toggleCollapsed() {
    collapsed = !collapsed;
  }
</script>

<aside class="sidebar" class:collapsed={collapsed}>
  <div class="sidebar-inner">
    <button class="toggle" onclick={toggleCollapsed} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
      {collapsed ? '▶' : '◀'}
    </button>

    {#if !collapsed}
      <div class="sidebar-content">
      <!-- GitHub Status -->
      <div class="status-card">
        <header>
          <h3>GitHub</h3>
          <span class="badge {githubStatusInfo?.authenticated ? 'success' : 'warn'}">
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
          <button onclick={onGithubManage}>Manage</button>
          <button class="secondary" onclick={onGithubDisconnect}>Disconnect</button>
        </div>
      </div>

      <!-- System Version -->
      <div class="status-card">
        <header>
          <h3>System Version</h3>
          <span 
            class="badge {updateInProgress ? 'warn' : systemStatus?.updates_available ? 'warn' : 'success'}" 
            class:clickable={updateInProgress}
            onclick={updateInProgress ? onViewUpdateProgress : undefined}
            role={updateInProgress ? 'button' : undefined}
            tabindex={updateInProgress ? 0 : undefined}
            title={updateInProgress ? 'Click to view update progress' : undefined}
          >
            {updateInProgress ? 'Updating...' : systemStatus?.updates_available ? `${systemStatus.commits_behind} behind` : 'Up to date'}
          </span>
        </header>
        <p>Current: {systemStatus?.current_sha || 'N/A'}</p>
        <p>Latest: {systemStatus?.latest_sha || 'N/A'}</p>
        <div class="card-actions">
          <button onclick={onStartUpdate} disabled={updateInProgress || !systemStatus?.updates_available}>
            {updateInProgress ? 'Update Running...' : 'Start Update'}
          </button>
        </div>
        {#if systemActionMessage}
          <small>{systemActionMessage}</small>
        {/if}
      </div>

      <!-- Maintenance -->
      <div class="status-card">
        <header>
          <h3>Maintenance</h3>
        </header>
        <p>Tracked: {orphansInfo?.tracked ?? 0}</p>
        <p>Orphans: {orphansInfo?.orphans?.length ?? 0}</p>
        <div class="card-actions">
          <button onclick={onCleanupOrphans} disabled={orphansBusy}>Clean Up</button>
          <button class="secondary" onclick={onRecoverRegistry} disabled={orphansBusy}>
            Recover Registry
          </button>
        </div>
        {#if imagesInfo?.images}
          <div class="image-buttons">
            {#each ['code-server', 'terminal', 'dashboard'] as type}
              <button onclick={() => onImageBuild(type as any)} disabled={imageBusy[type as any]}>
                Rebuild {type}
              </button>
            {/each}
          </div>
        {/if}
      </div>
        </div>
      {/if}
  </div>
</aside><style>
  .sidebar {
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: hidden;
    background: rgba(255, 255, 255, 0.92);
    backdrop-filter: blur(10px);
    border-right: 1px solid rgba(79, 70, 229, 0.1);
    box-shadow: 4px 0 24px rgba(79, 70, 229, 0.08);
    transition: width 0.3s ease, min-width 0.3s ease;
    width: 320px;
    min-width: 320px;
  }

  .sidebar.collapsed {
    width: 60px;
    min-width: 60px;
    background: transparent;
    backdrop-filter: none;
    border-right: none;
    box-shadow: none;
  }

  .sidebar-inner {
    padding: 1.5rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    height: 100%;
  }

  .toggle {
    align-self: flex-start;
    border: none;
    border-radius: 12px;
    padding: 0.75rem;
    background: var(--bg-primary-gradient);
    color: white;
    font-weight: 700;
    font-size: 1rem;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    line-height: 1;
  }

  .toggle:hover {
    transform: scale(1.05);
    box-shadow: 0 6px 16px rgba(79, 70, 229, 0.35);
  }

  .toggle:active {
    transform: scale(0.98);
  }

  .sidebar-content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .status-card {
    background: rgba(255, 255, 255, 0.6);
    border: 1px solid rgba(79, 70, 229, 0.1);
    border-radius: 16px;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .status-card header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .status-card h3 {
    margin: 0;
    font-size: 1.1rem;
    color: #4c51bf;
  }

  .status-card p {
    margin: 0;
    font-size: 0.9rem;
    color: #1a202c;
  }

  .status-card small {
    font-size: 0.85rem;
    color: #64748b;
  }

  .badge {
    padding: 0.35rem 0.75rem;
    border-radius: 999px;
    font-weight: 600;
    font-size: 0.75rem;
  }

  .badge.clickable {
    cursor: pointer;
    transition: opacity 0.2s;
  }

  .badge.clickable:hover {
    opacity: 0.8;
  }

  .badge.success {
    background: var(--color-success);
    color: white;
  }

  .badge.warn {
    background: #f6ad55;
    color: white;
  }

  .card-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .card-actions button {
    border: 2px solid var(--button-border-secondary);
    border-radius: 999px;
    padding: 0.5rem 1.1rem;
    background: var(--button-bg-secondary);
    color: var(--button-text-secondary);
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
    line-height: 1.4;
    transition: all 0.2s ease;
  }

  .card-actions button:hover:not(:disabled) {
    background: var(--button-bg-secondary-hover);
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .card-actions button:active:not(:disabled) {
    transform: scale(0.98);
  }

  .card-actions button.secondary {
    background: var(--button-bg-secondary);
    border-color: var(--button-border-secondary);
  }

  .card-actions button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    pointer-events: none;
  }

  .image-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .image-buttons button {
    border: 2px solid #5b21b6;
    border-radius: 999px;
    padding: 0.4rem 0.9rem;
    background: #ede9fe;
    color: #5b21b6;
    font-weight: 600;
    font-size: 0.8rem;
    cursor: pointer;
    line-height: 1.4;
    transition: all 0.2s ease;
  }

  .image-buttons button:hover:not(:disabled) {
    background: #ddd6fe;
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(91, 33, 182, 0.15);
  }

  .image-buttons button:active:not(:disabled) {
    transform: scale(0.98);
  }

  .image-buttons button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    pointer-events: none;
  }

  @media (max-width: 1024px) {
    .sidebar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      width: 100%;
      min-width: 100%;
      height: auto;
      max-height: 100vh;
      overflow-y: auto;
      z-index: 100;
    }

    .sidebar.collapsed {
      width: auto;
      min-width: auto;
      height: auto;
    }

    .sidebar-content {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    }
  }
</style>
