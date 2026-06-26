import { basename, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import type { Sandbox } from './daytona.js';
import type { CliOptions, RunnerResult, WatchMode } from './types.js';

const ARTIFACT_DIR = '/tmp/npm-watch';
const INPUT_DIR = '/tmp/daytona-npm-watch-input';
const PROJECT_DIR = `${ARTIFACT_DIR}/project`;
const NPM_LOG = `${ARTIFACT_DIR}/npm.log`;
const NPM_STRACE = `${ARTIFACT_DIR}/npm.strace`;
const STRACE_STATUS = `${ARTIFACT_DIR}/strace.status`;
const BEFORE_SNAPSHOT = `${ARTIFACT_DIR}/files.before`;
const AFTER_SNAPSHOT = `${ARTIFACT_DIR}/files.after`;
const PACKAGE_SCRIPTS = `${ARTIFACT_DIR}/package-scripts.ndjson`;

export async function runInSandbox(
  sandbox: Sandbox,
  mode: WatchMode,
  packageOrTarball: string,
  options: CliOptions,
): Promise<RunnerResult> {
  const installSpec = await prepareInstallSpec(sandbox, packageOrTarball, options.verbose);
  const script = mode === 'observe' ? observeScript(installSpec, options.timeout) : safeScript(installSpec, options.timeout);
  const response = await sandbox.process.executeCommand(`bash -lc ${shellQuote(script)}`, undefined, undefined, options.timeout + 45);

  if (response.exitCode !== 0) {
    throw new Error(`remote ${mode} workflow failed with exit code ${response.exitCode}: ${response.result}`);
  }

  const [installExitCode, npmLog, strace, straceStatus, beforeSnapshot, afterSnapshot, packageScripts] = await Promise.all([
    readRemoteText(sandbox, `${ARTIFACT_DIR}/install.exit`),
    readRemoteText(sandbox, NPM_LOG),
    readRemoteText(sandbox, NPM_STRACE),
    readRemoteText(sandbox, STRACE_STATUS),
    readRemoteText(sandbox, BEFORE_SNAPSHOT),
    readRemoteText(sandbox, AFTER_SNAPSHOT),
    readRemoteText(sandbox, PACKAGE_SCRIPTS),
  ]);

  return {
    installSpec,
    installExitCode: parseInstallExitCode(installExitCode),
    artifacts: {
      npmLog: NPM_LOG,
      strace: NPM_STRACE,
      straceStatus: STRACE_STATUS,
      beforeSnapshot: BEFORE_SNAPSHOT,
      afterSnapshot: AFTER_SNAPSHOT,
      packageScripts: mode === 'safe' ? PACKAGE_SCRIPTS : undefined,
      projectDir: PROJECT_DIR,
    },
    npmLog,
    strace,
    straceStatus,
    beforeSnapshot,
    afterSnapshot,
    packageScripts,
  };
}

async function prepareInstallSpec(sandbox: Sandbox, packageOrTarball: string, verbose: boolean): Promise<string> {
  const localPath = resolve(packageOrTarball);

  try {
    const localStat = await stat(localPath);
    if (!localStat.isFile()) {
      throw new Error(`Local package argument is not a file. Run npm pack and pass the .tgz path: ${packageOrTarball}`);
    }

    const remotePath = `${INPUT_DIR}/${basename(localPath)}`;
    await sandbox.process.executeCommand(`mkdir -p ${shellQuote(INPUT_DIR)}`, undefined, undefined, 30);

    if (verbose) {
      console.error(`Uploading local tarball to sandbox: ${remotePath}`);
    }

    await sandbox.fs.uploadFile(localPath, remotePath, 120);
    return remotePath;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return packageOrTarball;
    }

    throw error;
  }
}

async function readRemoteText(sandbox: Sandbox, remotePath: string): Promise<string> {
  try {
    const content = await sandbox.fs.downloadFile(remotePath);
    if (Buffer.isBuffer(content)) {
      return content.toString('utf8');
    }

    return String(content ?? '');
  } catch {
    return '';
  }
}

function parseInstallExitCode(text: string): number | null {
  const parsed = Number.parseInt(text.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function observeScript(installSpec: string, timeoutSeconds: number): string {
  return `
set -euo pipefail
ARTIFACT_DIR=${shellQuote(ARTIFACT_DIR)}
PROJECT_DIR=${shellQuote(PROJECT_DIR)}
INSTALL_SPEC=${shellQuote(installSpec)}
TIMEOUT_SECONDS=${Math.max(1, timeoutSeconds)}
rm -rf "$ARTIFACT_DIR"
mkdir -p "$ARTIFACT_DIR" "$PROJECT_DIR"
: > ${shellQuote(PACKAGE_SCRIPTS)}
snapshot() {
  find "$PROJECT_DIR" "$HOME" /tmp -xdev -print 2>/dev/null | sort
}
snapshot > ${shellQuote(BEFORE_SNAPSHOT)}
cd "$PROJECT_DIR"
npm init -y > "$ARTIFACT_DIR/npm-init.log" 2>&1
set +e
if command -v strace >/dev/null 2>&1; then
  echo available > ${shellQuote(STRACE_STATUS)}
  timeout "$TIMEOUT_SECONDS" strace -f -o ${shellQuote(NPM_STRACE)} -e trace=process,network,file npm install "$INSTALL_SPEC" --foreground-scripts --loglevel=silly > ${shellQuote(NPM_LOG)} 2>&1
else
  echo unavailable > ${shellQuote(STRACE_STATUS)}
  : > ${shellQuote(NPM_STRACE)}
  timeout "$TIMEOUT_SECONDS" npm install "$INSTALL_SPEC" --foreground-scripts --loglevel=silly > ${shellQuote(NPM_LOG)} 2>&1
fi
INSTALL_EXIT=$?
set -e
echo "$INSTALL_EXIT" > "$ARTIFACT_DIR/install.exit"
snapshot > ${shellQuote(AFTER_SNAPSHOT)}
exit 0
`;
}

function safeScript(installSpec: string, timeoutSeconds: number): string {
  return `
set -euo pipefail
ARTIFACT_DIR=${shellQuote(ARTIFACT_DIR)}
PROJECT_DIR=${shellQuote(PROJECT_DIR)}
INSTALL_SPEC=${shellQuote(installSpec)}
TIMEOUT_SECONDS=${Math.max(1, timeoutSeconds)}
rm -rf "$ARTIFACT_DIR"
mkdir -p "$ARTIFACT_DIR" "$PROJECT_DIR"
: > ${shellQuote(NPM_STRACE)}
echo not-used > ${shellQuote(STRACE_STATUS)}
snapshot() {
  find "$PROJECT_DIR" "$HOME" /tmp -xdev -print 2>/dev/null | sort
}
snapshot > ${shellQuote(BEFORE_SNAPSHOT)}
cd "$PROJECT_DIR"
npm init -y > "$ARTIFACT_DIR/npm-init.log" 2>&1
set +e
timeout "$TIMEOUT_SECONDS" npm install "$INSTALL_SPEC" --ignore-scripts --no-audit --no-fund > ${shellQuote(NPM_LOG)} 2>&1
INSTALL_EXIT=$?
set -e
echo "$INSTALL_EXIT" > "$ARTIFACT_DIR/install.exit"
node <<'NODE' > ${shellQuote(PACKAGE_SCRIPTS)}
const fs = require('fs');
const path = require('path');
const root = path.join(process.cwd(), 'node_modules');

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (entry.isFile() && entry.name === 'package.json') {
      try {
        const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        if (parsed.scripts && typeof parsed.scripts === 'object') {
          console.log(JSON.stringify({
            name: parsed.name,
            version: parsed.version,
            path: fullPath,
            scripts: parsed.scripts,
          }));
        }
      } catch {}
    }
  }
}

walk(root);
NODE
snapshot > ${shellQuote(AFTER_SNAPSHOT)}
exit 0
`;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
