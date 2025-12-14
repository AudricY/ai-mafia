import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from './gameEngine.js';
import { logger } from '../logger.js';
import type { GameConfig } from '../types.js';

test('dry-run harness: game runs to completion without abort', async () => {
  process.env.AI_MAFIA_DRY_RUN = '1';
  process.env.AI_MAFIA_DRY_RUN_SEED = '1';
  logger.setConsoleOutputEnabled(false);

  const config: GameConfig = {
    rounds: 3,
    system_prompt: 'You are playing a game of Mafia.',
    players: [
      { name: 'Alice', model: 'openai/gpt-4o', temperature: 0.7 },
      { name: 'Bob', model: 'openai/gpt-4o', temperature: 0.7 },
      { name: 'Charlie', model: 'openai/gpt-4o', temperature: 0.7 },
      { name: 'Dave', model: 'openai/gpt-4o', temperature: 0.7 },
    ],
    roles: {
      Alice: 'mafia',
      Bob: 'villager',
      Charlie: 'villager',
      Dave: 'villager',
    },
    role_seed: 1,
    memory_window_size: 10,
    memory_summary_max_chars: 800,
    enable_faction_memory: true,
    log_thoughts: false,
  };

  const engine = new GameEngine(config);
  await engine.start();

  assert.ok(engine.state.history.length > 0);
  assert.equal(engine.state.abortReason, undefined);
  assert.ok(engine.state.winners === 'mafia' || engine.state.winners === 'villagers');
});

