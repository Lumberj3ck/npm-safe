import { Daytona, type Sandbox } from '@daytona/sdk';
import { loadDotEnv } from './env.js';

export async function createWatchSandbox(verbose = false): Promise<Sandbox> {
  loadDotEnv();

  if (!process.env.DAYTONA_API_KEY) {
    throw new Error('Missing DAYTONA_API_KEY. Set it before running daytona-npm-watch.');
  }

  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });

  try {
    if (verbose) {
      console.error('Creating Daytona sandbox...');
    }

    return await daytona.create(
      {
        language: 'javascript',
        labels: { app: 'daytona-npm-watch' },
        autoStopInterval: 5,
      },
      { timeout: 90 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Daytona sandbox creation failure: ${message}`);
  }
}

export async function deleteWatchSandbox(sandbox: Sandbox, verbose = false): Promise<void> {
  if (verbose) {
    console.error(`Deleting Daytona sandbox ${sandbox.id}...`);
  }

  await sandbox.delete(90);
}

export type { Sandbox };
