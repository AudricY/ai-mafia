import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { GameLogEntry, LogType, Role } from './types.js';
import { eventBus } from './events/index.js';

const ROLE_COLORS: Record<string, (text: string) => string> = {
  mafia: chalk.red,
  godfather: chalk.red.bold,
  villager: chalk.green,
  cop: chalk.blue,
  doctor: chalk.cyan,
  vigilante: chalk.magenta,
  roleblocker: chalk.yellow,
};

const TYPE_COLORS: Record<LogType, (text: string) => string> = {
  SYSTEM: chalk.gray,
  CHAT: chalk.white,
  ACTION: chalk.yellow,
  VOTE: chalk.blue,
  DEATH: chalk.bgRed.white,
  WIN: chalk.green.bold,
  THOUGHT: chalk.gray.italic,
  FACTION_CHAT: chalk.red,
};

export class GameLogger {
  private logFile: string;
  private logs: GameLogEntry[] = [];
  private knownPlayers: Set<string> = new Set();
  private consoleOutputEnabled = true;
  private subscribers: Set<(entry: GameLogEntry) => void> = new Set();
  private playerRoles: Map<string, Role> = new Map();

  constructor() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir);
    }
    this.logFile = path.join(logDir, `game-${timestamp}.json`);

    // The logger subscribes to the global event bus and persists/prints entries.
    eventBus.subscribe((entry) => {
      this.handleEntry(entry);
    });
  }

  setKnownPlayers(names: string[]) {
    this.knownPlayers = new Set(names);
  }

  setConsoleOutputEnabled(enabled: boolean) {
    this.consoleOutputEnabled = enabled;
  }

  subscribe(cb: (entry: GameLogEntry) => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  setPlayerRoles(roles: Record<string, Role>) {
    this.playerRoles = new Map(Object.entries(roles));
  }

  setPlayerRole(player: string, role: Role) {
    this.playerRoles.set(player, role);
  }

  getLogs(): GameLogEntry[] {
    // Return a shallow copy so callers can't mutate logger state.
    return this.logs.slice();
  }

  /**
   * Emit a log entry to the global event bus, returning the fully materialized entry.
   *
   * This is the preferred way for the engine to log; the logger itself listens on the bus
   * and persists/prints entries. Callers should not mutate the returned object.
   */
  log(entry: Omit<GameLogEntry, 'id' | 'timestamp'>): GameLogEntry {
    const fullEntry: GameLogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };
    const enriched = this.enrichEntry(fullEntry);
    eventBus.emit(enriched);
    return enriched;
  }

  /**
   * Emit an already-constructed log entry (e.g., if an engine wants to set its own id/timestamp).
   */
  emit(entry: GameLogEntry): void {
    eventBus.emit(this.enrichEntry(entry));
  }

  private enrichEntry(entry: GameLogEntry): GameLogEntry {
    const inferredRole: Role | undefined =
      entry.player && !entry.metadata?.role ? this.playerRoles.get(entry.player) : undefined;
    if (inferredRole === undefined) return entry;
    return {
      ...entry,
      metadata: { ...(entry.metadata ?? {}), role: inferredRole },
    };
  }

  private handleEntry(entry: GameLogEntry) {
    this.logs.push(entry);
    this.flush();

    for (const sub of this.subscribers) {
      try {
        sub(entry);
      } catch {
        // Never let UI/log subscribers crash the game loop.
      }
    }

    // Console output for visibility
    if (!this.consoleOutputEnabled) return;

    const timeStr = entry.timestamp.split('T')[1]?.split('.')[0] ?? entry.timestamp;
    const prefix = chalk.gray(`[${timeStr}]`);

    const typeColor = TYPE_COLORS[entry.type] || chalk.white;
    const typeStr = typeColor(`[${entry.type}]`);

    let playerInfo = '';
    if (entry.player) {
      // Use a distinct color for player names, or maybe generate one based on hash?
      // For now, let's use a nice bright color.
      const role = (entry.metadata?.role ?? this.playerRoles.get(entry.player)) as Role | undefined;
      const roleStr = role ? ` ${ROLE_COLORS[role]?.(role) ?? role}` : '';
      playerInfo = ` <${chalk.hex('#FFA500')(entry.player)}${roleStr}>`;
    }

    // Highlight roles in content
    let content = entry.content;
    const rolePattern = /\b(villager|mafia|cop|doctor|vigilante|roleblocker|godfather)s?\b/gi;
    content = content.replace(rolePattern, (match) => {
      const lower = match.toLowerCase().replace(/s$/, '') as string; // simple singularization
      const colorFn = ROLE_COLORS[lower];
      if (colorFn) {
        return colorFn(match);
      }
      return match;
    });

    // Highlight known players in content
    if (this.knownPlayers.size > 0) {
      // Create a pattern for all known players
      // Escape regex special characters in names just in case
      const invalidChars = /[.*+?^${}()|[\]\\]/g;
      const names = Array.from(this.knownPlayers).map(n => n.replace(invalidChars, '\\$&'));
      if (names.length > 0) {
        const playerPattern = new RegExp(`\\b(${names.join('|')})\\b`, 'g');
        content = content.replace(playerPattern, (match) => {
          // Use the same color as the player prefix
          return chalk.hex('#FFA500')(match);
        });
      }
    }

    console.log(`${prefix} ${typeStr}${playerInfo}: ${content}`);
  }

  private flush() {
    fs.writeFileSync(this.logFile, JSON.stringify(this.logs, null, 2));
  }
}

export const logger = new GameLogger();
