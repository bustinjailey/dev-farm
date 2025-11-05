<script lang="ts">
  interface Props {
    collapsed: boolean;
    onToggle: () => void;
    githubStatusInfo: any;
    githubConfig: any;
    systemStatus: any;
    orphansInfo: any;
    imagesInfo: any;
    imageBusy: Record<string, boolean>;
    orphansBusy: boolean;
    systemActionMessage: string | null;
    onGithubManage: () => void;
    onGithubDisconnect: () => void;
    onStartUpdate: () => void;
    onUpgradeSystem: () => void;
    onCleanupOrphans: () => void;
    onRecoverRegistry: () => void;
    onImageBuild: (type: 'code-server' | 'terminal' | 'dashboard') => void;
  }

  let {
    collapsed = $bindable(),
    onToggle,
    githubStatusInfo,
    githubConfig,
    systemStatus,
    orphansInfo,
    imagesInfo,
    imageBusy,
    orphansBusy,
    systemActionMessage,
    onGithubManage,
    onGithubDisconnect,
    onStartUpdate,
    onUpgradeSystem,
    onCleanupOrphans,
    onRecoverRegistry,
    onImageBuild,
  }: Props = $props();
</script>

<aside class="sidebar" class:collapsed>
  <button class="toggle" onclick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
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
          <span class="badge {systemStatus?.updates_available ? 'warn' : 'success'}">
            {systemStatus?.updates_available ? `${systemStatus.commits_behind} behind` : 'Up to date'}
          </span>
        </header>
        <p>Current: {systemStatus?.current_sha || 'N/A'}</p>
        <p>Latest: {systemStatus?.latest_sha || 'N/A'}</p>
        <div class="card-actions">
          <button onclick={onStartUpdate}>Start Update</button>
          <button class="secondary" onclick={onUpgradeSystem}>Run Upgrade</button>
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
</aside>

<style>
  .sidebar {
    position: sticky;
    top: 0;
    height: fit-content;
    max-height: 100vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    transition: width 0.3s ease, min-width 0.3s ease;
    width: 320px;
    min-width: 320px;
  }

  .sidebar.collapsed {
    width: 48px;
    min-width: 48px;
  }

  .toggle {
    align-self: flex-start;
    border: none;
    border-radius: 12px;
    padding: 0.75rem;
    background: rgba(255, 255, 255, 0.92);
    color: #4c51bf;
    font-weight: 700;
    font-size: 1.2rem;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(79, 70, 229, 0.15);
    transition: transform 0.2s ease;
  }

  .toggle:hover {
    transform: scale(1.05);
  }

  .sidebar-content {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
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

  .badge.success {
    background: #48bb78;
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
    border: none;
    border-radius: 999px;
    padding: 0.5rem 1.1rem;
    background: #edf2f7;
    color: #1a202c;
    font-weight: 600;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .card-actions button.secondary {
    background: #e2e8f0;
  }

  .card-actions button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
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
    font-size: 0.8rem;
    cursor: pointer;
  }

  .image-buttons button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  @media (max-width: 1024px) {
    .sidebar {
      position: relative;
      width: 100%;
      min-width: 100%;
    }

    .sidebar.collapsed {
      width: 100%;
      min-width: 100%;
    }

    .sidebar-content {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    }
  }
</style>
