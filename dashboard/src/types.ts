export type EnvironmentMode = 'workspace' | 'git' | 'ssh' | 'terminal';

export interface EnvironmentRecord {
  name: string;
  displayName: string;
  envId: string;
  containerId: string;
  port: number;
  created: string;
  mode: EnvironmentMode;
  sshHost?: string | null;
  sshUser?: string | null;
  sshPath?: string | null;
  sshPassword?: string | null;
  sshAlias?: string | null;
  gitUrl?: string | null;
  parentEnvId?: string | null;
  creatorType?: 'user' | 'ai';
  creatorName?: string;
  creatorEnvId?: string | null;
  creationSource?: string;
  children: string[];
}

export interface RegistryMap {
  [envId: string]: EnvironmentRecord;
}

export interface UpdateProgressStage {
  stage: string;
  status: string;
  message?: string;
}

export interface UpdateProgressState {
  running: boolean;
  success: boolean | null;
  error: string | null;
  stages: UpdateProgressStage[];
  stage: string;
  status: string;
}

export interface SSEPayload<T = unknown> {
  event: string;
  data: T;
}

export interface EnvironmentSummary {
  name: string;
  id: string;
  port: number;
  status: string;
  ready: boolean;
  url: string;
  desktopCommand: string;
  workspacePath: string;
  mode: EnvironmentMode;
  requiresAuth?: boolean;
  deviceAuth?: { code: string; url: string } | null;
}

export interface ContainerStats {
  cpu: number;
  memory: number;
  memoryMb: number;
}
