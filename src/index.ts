#!/usr/bin/env node
import { Command } from 'commander';
import { analyzeObserve, analyzeSafe } from './analyze.js';
import { createWatchSandbox, deleteWatchSandbox, type Sandbox } from './daytona.js';
import { runInSandbox } from './runner.js';
import type { CliOptions, WatchMode, WatchReport } from './types.js';

const program = new Command();

program
  .name('daytona-npm-watch')
  .description('Run npm install inside a disposable Daytona sandbox and emit a defensive JSON report.')
  .version('0.1.0');

addObserveCommand();
addSafeCommand();

program.parseAsync(process.argv).catch((error: unknown) => {
  printError(error);
  process.exitCode = 1;
});

function addObserveCommand(): void {
  const command = program.command('observe');
  addCommonOptions(command)
    .argument('[package-or-tarball]')
    .description('Install with lifecycle scripts enabled and observe runtime behavior.')
    .action((packageOrTarball: string | undefined, options: CliOptions) => execute('observe', packageOrTarball, options));
}

function addSafeCommand(): void {
  const command = program.command('safe');
  addCommonOptions(command)
    .argument('[package-or-tarball]')
    .description('Install with lifecycle scripts disabled and inspect installed package manifests.')
    .action((packageOrTarball: string | undefined, options: CliOptions) => execute('safe', packageOrTarball, options));
}

function addCommonOptions(command: Command): Command {
  return command
    .option('--timeout <seconds>', 'install timeout in seconds', parseTimeout, 60)
    .option('--keep-sandbox', 'do not delete the Daytona sandbox after the run', false)
    .option('--json', 'print plain JSON output', true)
    .option('--verbose', 'print progress messages to stderr', false);
}

async function execute(mode: WatchMode, packageOrTarball: string | undefined, options: CliOptions): Promise<void> {
  if (!packageOrTarball) {
    throw new Error(`Missing package argument. Usage: daytona-npm-watch ${mode} <package-or-tarball>`);
  }

  let sandbox: Sandbox | undefined;
  let report: WatchReport | undefined;
  let caughtError: unknown;

  try {
    sandbox = await createWatchSandbox(options.verbose);
    const result = await runInSandbox(sandbox, mode, packageOrTarball, options);
    report = mode === 'observe'
      ? analyzeObserve(packageOrTarball, sandbox.id, result)
      : analyzeSafe(packageOrTarball, sandbox.id, result);
  } catch (error) {
    caughtError = error;
  } finally {
    if (sandbox && !options.keepSandbox) {
      try {
        await deleteWatchSandbox(sandbox, options.verbose);
      } catch (cleanupError) {
        const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        console.error(`Failed to delete Daytona sandbox ${sandbox.id}: ${message}`);
      }
    } else if (sandbox && options.keepSandbox) {
      console.error(`Keeping Daytona sandbox ${sandbox.id}`);
    }
  }

  if (report) {
    console.log(JSON.stringify(report, null, 2));
    if (report.installExitCode !== 0) {
      process.exitCode = 1;
    }
  }

  if (caughtError) {
    printError(caughtError);
    process.exitCode = 1;
  }
}

function parseTimeout(value: string): number {
  const timeout = Number.parseInt(value, 10);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error('--timeout must be a positive integer number of seconds');
  }

  return timeout;
}

function printError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ error: message }, null, 2));
}
