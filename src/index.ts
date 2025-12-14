import { loadConfig } from './config.js';
import { Game } from './game.js';
import { logger } from './logger.js';
import * as path from 'path';
import * as dotenv from 'dotenv';

async function main() {
  // Load local environment variables from .env (Node.js quickstart style)
  dotenv.config();

  // Fail fast on missing auth for the default provider (Vercel AI Gateway)
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error(
      'Missing AI_GATEWAY_API_KEY. Add it to your .env file to authenticate with Vercel AI Gateway.'
    );
  }

  const configFile = process.argv[2] || 'game-config.yaml';
  const configPath = path.resolve(process.cwd(), configFile);

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
