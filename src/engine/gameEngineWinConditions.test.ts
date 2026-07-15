import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine } from './gameEngine.js';
import { logger } from '../logger.js';
import type { GameConfig, Role } from '../types.js';

function createConfig(roles: Record<string, Role>): GameConfig {
  const players = Object.keys(roles).map(name => ({
    name,
    model: 'openai/gpt-4o',
    temperature: 0.7,
  }));

  return {
    discussion_open_floor: 1,
    discussion_open_cap: 5,
    discussion_open_per_player_base: 0.5,
    discussion_open_per_player_round_bonus: 0.5,
    rounds: 1,
    system_prompt: 'You are playing a game of Mafia.',
    players,
    roles,
    role_seed: 1,
    memory_window_size: 10,
    enable_faction_memory: true,
    log_thoughts: false,
    role_setup_visibility: 'exact',
  };
}

test('checkWin: 2 mafia, 2 town, 1 jester is mafia parity', () => {
  logger.setConsoleOutputEnabled(false);
  logger.setPersistenceEnabled(false);

  try {
    const engine = new GameEngine(
      createConfig({
        Alice: 'godfather',
        Bob: 'janitor',
        Charlie: 'villager',
        Dave: 'cop',
        Eve: 'jester',
      })
    );

    assert.equal(engine.checkWin(), true);
    assert.equal(engine.state.winners, 'mafia');
  } finally {
    logger.setConsoleOutputEnabled(true);
    logger.setPersistenceEnabled(true);
  }
});

test('checkWin: 1 mafia, 1 town, 1 jester is mafia parity', () => {
  logger.setConsoleOutputEnabled(false);
  logger.setPersistenceEnabled(false);

  try {
    const engine = new GameEngine(
      createConfig({
        Alice: 'mafia',
        Bob: 'villager',
        Charlie: 'jester',
      })
    );

    assert.equal(engine.checkWin(), true);
    assert.equal(engine.state.winners, 'mafia');
  } finally {
    logger.setConsoleOutputEnabled(true);
    logger.setPersistenceEnabled(true);
  }
});

test('checkWin: 1 mafia, 2 neutrals, 0 town is mafia parity', () => {
  logger.setConsoleOutputEnabled(false);
  logger.setPersistenceEnabled(false);

  try {
    const engine = new GameEngine(
      createConfig({
        Alice: 'mafia',
        Bob: 'jester',
        Charlie: 'executioner',
      })
    );

    assert.equal(engine.checkWin(), true);
    assert.equal(engine.state.winners, 'mafia');
  } finally {
    logger.setConsoleOutputEnabled(true);
    logger.setPersistenceEnabled(true);
  }
});

test('checkWin: 1 mafia, 2 town, 1 jester is not mafia parity', () => {
  logger.setConsoleOutputEnabled(false);
  logger.setPersistenceEnabled(false);

  try {
    const engine = new GameEngine(
      createConfig({
        Alice: 'mafia',
        Bob: 'villager',
        Charlie: 'cop',
        Dave: 'jester',
      })
    );

    assert.equal(engine.checkWin(), false);
    assert.equal(engine.state.winners, undefined);
  } finally {
    logger.setConsoleOutputEnabled(true);
    logger.setPersistenceEnabled(true);
  }
});
