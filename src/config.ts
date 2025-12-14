import * as fs from 'fs';
import * as yaml from 'yaml';
import { GameConfig, GameConfigSchema } from './types.js';
import { logger } from './logger.js';

export function loadConfig(configPath: string): GameConfig {
  logger.log({ type: 'SYSTEM', content: `Loading configuration from ${configPath}` });

  try {
    const fileContents = fs.readFileSync(configPath, 'utf-8');
    const parsedYaml = yaml.parse(fileContents);
    
    // Validate with Zod
    const config = GameConfigSchema.parse(parsedYaml);
    
    logger.log({ type: 'SYSTEM', content: 'Configuration loaded and validated successfully.' });
    return config;
  } catch (error) {
    logger.log({ 
      type: 'SYSTEM', 
      content: `Failed to load config: ${(error as Error).message}`,
      metadata: { error }
    });
    throw error;
  }
}
