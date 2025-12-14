import type { GameConfig } from './types.js';
import { GameEngine } from './engine/gameEngine.js';

/**
 * Backwards-compatible facade.
 *
 * The project historically constructed `new Game(config)` from `src/index.ts`.
 * The actual implementation now lives in `GameEngine`.
 */
export class Game {
  private engine: GameEngine;

  constructor(config: GameConfig) {
    this.engine = new GameEngine(config);
  }

  async start() {
    return this.engine.start();
  }
}
