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
    enable_faction_memory: true,
    log_thoughts: false,
    role_setup_visibility: 'exact',
  };

  const engine = new GameEngine(config);
  await engine.start();

  assert.ok(engine.state.history.length > 0);
  assert.equal(engine.state.abortReason, undefined);
  assert.ok(engine.state.winners === 'mafia' || engine.state.winners === 'villagers');

  // Verify final role reveal entries exist
  const finalRevealEntries = engine.state.history.filter(
    e => e.metadata?.kind === 'final_reveal'
  );
  assert.ok(finalRevealEntries.length > 0, 'Should have at least one final role reveal entry');
  assert.equal(finalRevealEntries.length, config.players.length, 'Should have one final reveal per player');

  // Verify post-game reflection entries exist
  const reflectionEntries = engine.state.history.filter(
    e => e.metadata?.kind === 'post_game_reflection'
  );
  assert.ok(reflectionEntries.length > 0, 'Should have at least one post-game reflection entry');
  assert.equal(reflectionEntries.length, config.players.length, 'Should have one reflection per player');
});



