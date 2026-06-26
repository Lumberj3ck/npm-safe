export type WatchMode = 'observe' | 'safe';

export type CliOptions = {
  timeout: number;
  keepSandbox: boolean;
  json: boolean;
  verbose: boolean;
};

export type ArtifactPaths = {
  npmLog: string;
  strace?: string;
  straceStatus?: string;
  beforeSnapshot?: string;
  afterSnapshot?: string;
  packageScripts?: string;
  projectDir: string;
};

export type WatchReport = {
  package: string;
  mode: WatchMode;
  suspicious: boolean;
  signalCount: number;
  signals: string[];
  sandboxId: string;
  installExitCode: number | null;
  artifacts: ArtifactPaths;
};

export type RunnerResult = {
  installSpec: string;
  installExitCode: number | null;
  artifacts: ArtifactPaths;
  npmLog: string;
  strace: string;
  straceStatus: string;
  beforeSnapshot: string;
  afterSnapshot: string;
  packageScripts: string;
};
