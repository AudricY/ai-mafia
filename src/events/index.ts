import type { GameLogEntry } from '../types.js';
import { EventBus } from './eventBus.js';

/**
 * Global event stream for game log entries.
 *
 * The engine should emit to this bus; logger/UI subscribe.
 */
export const eventBus = new EventBus<GameLogEntry>();


