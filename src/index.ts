import { loadConfig } from './config.js';
import { Game } from './game.js';
import { logger } from './logger.js';
import * as path from 'path';
import * as dotenv from 'dotenv';

function parseArgs(argv: string[]): {
  configFile: string;
  dryRun: boolean;
  dryRunSeed?: number;
  ui: boolean;
} {
  let configFile: string | undefined;
  let dryRun = false;
  let dryRunSeed: number | undefined;
  let ui = true;

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

    if (arg === '--no-ui' || arg === '--no-tui') {
      ui = false;
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

  return { configFile: configFile ?? 'game-config.yaml', dryRun, dryRunSeed, ui };
}

async function main() {
  // Load local environment variables from .env (Node.js quickstart style)
  dotenv.config();

  const args = parseArgs(process.argv.slice(2));
  if (args.ui) {
    // We'll render through the Ink TUI instead of printing raw lines.
    // Note: we still write structured JSON logs to disk regardless.
    logger.setConsoleOutputEnabled(false);
  }

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
    const ui = args.ui ? (await import('./ui/runUi.js')).runUi({ players: config.players.map(p => p.name) }) : null;
    const game = new Game(config);
    const gamePromise = game.start();

    if (!ui) {
      await gamePromise;
      return;
    }

    const uiPromise = ui.waitUntilExit().then(() => {
      // If the user exits the UI early, fall back to normal console output
      // so the game doesn't continue silently.
      logger.setConsoleOutputEnabled(true);
    });

    try {
      await Promise.all([gamePromise, uiPromise]);
    } finally {
      ui.unmount();
    }
  } catch (error) {
    console.error('Fatal Error:', error);
    process.exit(1);
  }
}

main();
