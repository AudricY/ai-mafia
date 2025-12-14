import { loadConfig } from './config.js';
import { Game } from './game.js';
import { logger } from './logger.js';
import * as path from 'path';

async function main() {
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
