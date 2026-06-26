import type { RunnerResult, WatchMode, WatchReport } from './types.js';

const LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'];
const SAFE_LIFECYCLE_SCRIPTS = [...LIFECYCLE_SCRIPTS, 'prepublish'];
const SUSPICIOUS_SCRIPT_TERMS = [
  'curl',
  'wget',
  'bash',
  'sh -c',
  'powershell',
  'Invoke-WebRequest',
  'node -e',
  'python -c',
  'chmod',
  'base64',
  'eval',
  'child_process',
];

function addSignal(signals: Set<string>, signal: string): void {
  signals.add(signal);
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function parsePathSnapshot(text: string): Set<string> {
  return new Set(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function createdPaths(beforeText: string, afterText: string): string[] {
  const before = parsePathSnapshot(beforeText);
  return [...parsePathSnapshot(afterText)].filter((path) => !before.has(path));
}

export function analyzeObserve(packageName: string, sandboxId: string, result: RunnerResult): WatchReport {
  const signals = new Set<string>();
  const combined = `${result.npmLog}\n${result.strace}`;

  if (hasAny(combined, LIFECYCLE_SCRIPTS.map((name) => new RegExp(`\\b${name}\\b`, 'i')))) {
    addSignal(signals, 'npm lifecycle script mentioned');
  }

  if (hasAny(combined, [/execve\("[^"]*\/(?:sh|bash|zsh)"/i, /\b(?:sh|bash|zsh)\b/i])) {
    addSignal(signals, 'shell spawned');
  }

  if (hasAny(combined, [/\bnode\s+-e\b/i, /\bpython(?:3)?\s+-c\b/i, /\bperl\s+-e\b/i])) {
    addSignal(signals, 'inline execution observed');
  }

  if (/connect\(/i.test(result.strace)) {
    addSignal(signals, 'network connect syscall');
  }

  if (hasAny(combined, [/\bcurl\b/i, /\bwget\b/i, /Invoke-WebRequest/i])) {
    addSignal(signals, 'curl or wget observed');
  }

  if (hasAny(combined, [/\bchmod\b/i, /\bfchmod\b/i, /\bfchmodat\b/i])) {
    addSignal(signals, 'file permission change observed');
  }

  if (hasAny(combined, [/\bbase64\b/i, /\beval\b/i, /child_process/i])) {
    addSignal(signals, 'suspicious string observed');
  }

  const newPaths = createdPaths(result.beforeSnapshot, result.afterSnapshot);
  if (newPaths.some((path) => path.includes('/.ssh/') || path.endsWith('/.ssh'))) {
    addSignal(signals, 'file created under .ssh');
  }

  if (newPaths.some((path) => path.endsWith('/.npmrc') || path.includes('/.npmrc/'))) {
    addSignal(signals, 'file created under .npmrc');
  }

  if (newPaths.some((path) => !isInside(path, result.artifacts.projectDir) && !isInside(path, '/tmp/npm-watch'))) {
    addSignal(signals, 'file created outside project directory');
  }

  return buildReport(packageName, 'observe', sandboxId, result, [...signals]);
}

type PackageScriptRecord = {
  name?: string;
  version?: string;
  path?: string;
  scripts?: Record<string, string>;
};

export function analyzeSafe(packageName: string, sandboxId: string, result: RunnerResult): WatchReport {
  const signals = new Set<string>();

  for (const line of result.packageScripts.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    let record: PackageScriptRecord;
    try {
      record = JSON.parse(line) as PackageScriptRecord;
    } catch {
      continue;
    }

    const scripts = record.scripts ?? {};
    const packageLabel = `${record.name ?? 'unknown'}${record.version ? `@${record.version}` : ''}`;
    const lifecycleNames = SAFE_LIFECYCLE_SCRIPTS.filter((name) => scripts[name]);

    if (lifecycleNames.length > 0) {
      addSignal(signals, `lifecycle script declared in ${packageLabel}: ${lifecycleNames.join(', ')}`);
    }

    const scriptText = Object.values(scripts).join('\n');
    const matchedTerms = SUSPICIOUS_SCRIPT_TERMS.filter((term) =>
      scriptText.toLowerCase().includes(term.toLowerCase()),
    );

    if (matchedTerms.length > 0) {
      addSignal(signals, `suspicious script content in ${packageLabel}: ${matchedTerms.join(', ')}`);
    }
  }

  return buildReport(packageName, 'safe', sandboxId, result, [...signals]);
}

function buildReport(
  packageName: string,
  mode: WatchMode,
  sandboxId: string,
  result: RunnerResult,
  signals: string[],
): WatchReport {
  return {
    package: packageName,
    mode,
    suspicious: signals.length > 0,
    signalCount: signals.length,
    signals,
    sandboxId,
    installExitCode: result.installExitCode,
    artifacts: result.artifacts,
  };
}
