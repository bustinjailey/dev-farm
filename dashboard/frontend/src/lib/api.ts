import type { EnvironmentSummary } from '@shared/types';

async function jsonFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return (await response.json()) as T;
}

export async function listEnvironments(): Promise<EnvironmentSummary[]> {
  return jsonFetch<EnvironmentSummary[]>('/api/environments');
}

export interface CreateEnvironmentPayload {
  name: string;
  project: string;
  mode: string;
  git_url?: string;
  ssh_host?: string;
  ssh_user?: string;
  ssh_password?: string;
  ssh_path?: string;
}

export async function createEnvironment(payload: CreateEnvironmentPayload) {
  return jsonFetch('/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteEnvironment(id: string) {
  return jsonFetch(`/delete/${id}`, { method: 'POST' });
}

export async function startEnvironment(id: string) {
  return jsonFetch(`/start/${id}`, { method: 'POST' });
}

export async function stopEnvironment(id: string) {
  return jsonFetch(`/stop/${id}`, { method: 'POST' });
}

export async function fetchTerminal(envId: string) {
  return jsonFetch<{ output: string; timestamp: string }>(`/api/environments/${envId}/terminal-preview`);
}

export async function fetchGitActivity(envId: string) {
  return jsonFetch<{ commits: { sha: string; author: string; time: string; message: string }[] }>(
    `/api/environments/${envId}/git-activity`
  );
}

export async function fetchProcesses(envId: string) {
  return jsonFetch<{ processes: { pid: string; cpu: string; mem: string; time: string; command: string }[] }>(
    `/api/environments/${envId}/processes`
  );
}

export async function sendAiMessage(envId: string, message: string, tool: 'aider' | 'copilot') {
  return jsonFetch<{ success: boolean; session_id: string; message: string }>(
    `/api/environments/${envId}/ai/chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, tool }),
    }
  );
}

export async function fetchAiOutput(envId: string) {
  return jsonFetch<{ output: string; timestamp: string }>(`/api/environments/${envId}/ai/output`);
}

export interface SystemStatus {
  docker_connected: boolean;
  environments: number;
  updates_available: boolean;
  commits_behind: number;
  current_sha: string;
  latest_sha: string;
}

export async function fetchSystemStatus(): Promise<SystemStatus> {
  return jsonFetch<SystemStatus>('/api/system/status');
}

export async function fetchGithubStatus(): Promise<any> {
  return jsonFetch<any>('/api/github/status');
}

export async function fetchGithubConfig(): Promise<any> {
  return jsonFetch<any>('/api/config/github');
}

export async function updateGithubConfig(payload: Record<string, string>): Promise<any> {
  return jsonFetch<any>('/api/config/github', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export type GithubDeviceFlow =
  | { user_code: string; verification_uri: string; expires_in: number; interval: number }
  | { error: string };

export async function startGithubDeviceFlow(): Promise<GithubDeviceFlow> {
  return jsonFetch<GithubDeviceFlow>('/api/github/auth/start', { method: 'POST' });
}

export async function pollGithubDeviceFlow(): Promise<any> {
  return jsonFetch<any>('/api/github/auth/poll', { method: 'POST' });
}

export async function logoutGithub() {
  return jsonFetch('/api/github/auth/logout', { method: 'POST' });
}

export async function listGithubRepos(): Promise<any> {
  return jsonFetch<any>('/api/github/repos');
}

export async function fetchOrphans() {
  return jsonFetch<any>('/api/system/orphans');
}

export async function cleanupOrphansRequest() {
  return jsonFetch<any>('/api/system/cleanup-orphans', { method: 'POST' });
}

export async function recoverRegistryRequest() {
  return jsonFetch<any>('/api/system/recover-registry', { method: 'POST' });
}

export async function startSystemUpdate(): Promise<{ started: boolean; message?: string }> {
  return jsonFetch<{ started: boolean; message?: string }>('/api/system/update/start', {
    method: 'POST',
  });
}

export async function fetchUpdateStatus() {
  return jsonFetch<any>('/api/system/update/status');
}

export async function fetchEnvironmentLogs(envId: string) {
  return jsonFetch<{ logs: string }>(`/api/environments/${envId}/logs`);
}

export async function rebuildImage(imageType: 'code-server' | 'terminal' | 'dashboard') {
  return jsonFetch<any>('/api/images/build', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_type: imageType }),
  });
}

export async function fetchImages() {
  return jsonFetch<any>('/api/images');
}

export async function upgradeSystemRequest() {
  return jsonFetch<any>('/api/system/upgrade', { method: 'POST' });
}
