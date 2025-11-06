import { promisify } from 'util';
import { execFile as execFileCb } from 'child_process';
import Docker from 'dockerode';
import { HOST_REPO_PATH } from './config.js';
import { ensureUpdaterContainer, runCommandInContainer, buildImage } from './system.js';
import type { UpdateProgressState } from './types.js';
import { sseChannel } from './sse.js';

const execFile = promisify(execFileCb);

const UPDATE_PROGRESS: UpdateProgressState = {
  running: false,
  success: null,
  error: null,
  stages: [],
  stage: 'idle',
  status: 'idle',
};

function resetProgress() {
  UPDATE_PROGRESS.running = true;
  UPDATE_PROGRESS.success = null;
  UPDATE_PROGRESS.error = null;
  UPDATE_PROGRESS.stage = 'queued';
  UPDATE_PROGRESS.status = 'info';
  UPDATE_PROGRESS.stages = [];
}

function completeProgress(success: boolean, error?: string) {
  UPDATE_PROGRESS.success = success;
  UPDATE_PROGRESS.error = error ?? null;
  UPDATE_PROGRESS.running = false;
}

function appendStage(stage: string, status: string, message?: string) {
  UPDATE_PROGRESS.stage = stage;
  UPDATE_PROGRESS.status = status;
  UPDATE_PROGRESS.stages.push({ stage, status, message });
  sseChannel.broadcast('update-progress', {
    stage,
    status,
    message,
    total_stages: UPDATE_PROGRESS.stages.length,
  });
}

export function getUpdateStatus(): UpdateProgressState {
  return UPDATE_PROGRESS;
}

let updatePromise: Promise<void> | null = null;

export async function startSystemUpdate(docker: Docker): Promise<{ started: boolean; message?: string }> {
  if (UPDATE_PROGRESS.running) {
    return { started: false, message: 'Update already in progress' };
  }

  resetProgress();
  appendStage('queued', 'info', 'Update request accepted');
  sseChannel.broadcast('update-started', { timestamp: Date.now() });

  updatePromise = runUpdate(docker)
    .then(() => completeProgress(true))
    .catch((error) => {
      completeProgress(false, (error as Error).message);
      appendStage('error', 'error', (error as Error).message);
    })
    .finally(() => {
      updatePromise = null;
    });

  return { started: true };
}

async function runUpdate(docker: Docker) {
  appendStage('git_fetch', 'starting', 'Fetching latest changes');
  await execFile('git', ['fetch', 'origin', 'main'], { cwd: HOST_REPO_PATH });
  appendStage('git_fetch', 'success', 'Fetched origin/main');

  appendStage('git_pull', 'starting', 'Pulling latest code');
  await execFile('git', ['pull', '--rebase', 'origin', 'main'], { cwd: HOST_REPO_PATH });
  appendStage('git_pull', 'success', 'Repository updated');

  appendStage('rebuild_codeserver', 'starting', 'Rebuilding code-server image');
  const codeServerResult = await buildImage(docker, 'code-server');
  if (!codeServerResult.success) {
    throw new Error(`code-server build failed (exit ${codeServerResult.exitCode}): ${codeServerResult.output.slice(-400)}`);
  }
  appendStage('rebuild_codeserver', 'success', 'code-server image rebuilt');

  appendStage('rebuild_dashboard', 'starting', 'Rebuilding dashboard image');
  const dashboardResult = await buildImage(docker, 'dashboard');
  if (!dashboardResult.success) {
    throw new Error(`dashboard build failed (exit ${dashboardResult.exitCode}): ${dashboardResult.output.slice(-400)}`);
  }
  appendStage('rebuild_dashboard', 'success', 'Dashboard image rebuilt');

  appendStage('restart_dashboard', 'starting', 'Restarting dashboard service');
  const updater = await ensureUpdaterContainer(docker);
  const restartCommand = `cd ${HOST_REPO_PATH} && docker compose stop dashboard && docker compose rm -f dashboard && docker compose up -d dashboard`;
  const restartResult = await runCommandInContainer(updater, restartCommand);
  if (!restartResult.success) {
    throw new Error(`Failed to restart services: ${restartResult.output}`);
  }
  appendStage('restart_dashboard', 'success', 'Dashboard service restarted');

  appendStage('complete', 'success', 'System update completed successfully');
}

export async function waitForUpdate(): Promise<void> {
  if (updatePromise) {
    await updatePromise;
  }
}
