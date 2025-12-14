import { loadConfig } from './config.js';
import { Game } from './game.js';
import { logger } from './logger.js';
import * as path from 'path';
import * as dotenv from 'dotenv';

function parseArgs(argv: string[]): {
  configFile: string;
  dryRun: boolean;
  dryRunSeed?: number;
} {
  let configFile: string | undefined;
  let dryRun = false;
  let dryRunSeed: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    // Conventional end-of-args marker (e.g. `pnpm start -- --dry-run`).
    if (arg === '--') {
      // In practice, package managers often forward a literal `--` token.
      // We just ignore it and keep parsing.
      continue;
    }

    if (arg === '--dry-run' || arg === '--dryrun') {
      dryRun = true;
      continue;
    }

    if (arg === '--seed' || arg === '--dry-run-seed') {
      const next = argv[i + 1];
      if (!next) throw new Error(`Missing value for ${arg}`);
      const n = Number(next);
      if (!Number.isFinite(n)) throw new Error(`Invalid seed "${next}" for ${arg}`);
      dryRunSeed = n;
      i++;
      continue;
    }

    if (arg === '--config') {
      const next = argv[i + 1];
      if (!next) throw new Error('Missing value for --config');
      configFile = next;
      i++;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    // First positional arg is the config file.
    if (!configFile) configFile = arg;
  }

  return { configFile: configFile ?? 'game-config.yaml', dryRun, dryRunSeed };
}

async function main() {
  // Load local environment variables from .env (Node.js quickstart style)
  dotenv.config();

  const args = parseArgs(process.argv.slice(2));
  if (args.dryRun) {
    process.env.AI_MAFIA_DRY_RUN = '1';
    if (args.dryRunSeed !== undefined) process.env.AI_MAFIA_DRY_RUN_SEED = String(args.dryRunSeed);
    logger.log({
      type: 'SYSTEM',
      content: `Dry-run mode enabled (seed: ${process.env.AI_MAFIA_DRY_RUN_SEED ?? 'default'})`,
    });
  }

  // Fail fast on missing auth for the default provider (Vercel AI Gateway),
  // except in dry-run mode.
  if (!args.dryRun && !process.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      'Missing AI_GATEWAY_API_KEY. Add it to your .env file to authenticate with Vercel AI Gateway, or run with --dry-run.'
    );
  }

  const configPath = path.resolve(process.cwd(), args.configFile);

  try {
    const config = loadConfig(configPath);
    const game = new Game(config);
    await game.start();
  } catch (error) {
    console.error('Fatal Error:', error);
    process.exit(1);
  }
}

main();
