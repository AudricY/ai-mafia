import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { GameLogEntry, LogType, Role } from './types.js';

const ROLE_COLORS: Record<string, (text: string) => string> = {
  mafia: chalk.red,
  godfather: chalk.red.bold,
  villager: chalk.green,
  cop: chalk.blue,
  doctor: chalk.cyan,
  vigilante: chalk.magenta,
  roleblocker: chalk.yellow,
  god: chalk.white.bold,
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

  constructor() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir);
    }
    this.logFile = path.join(logDir, `game-${timestamp}.json`);
  }

  setKnownPlayers(names: string[]) {
    this.knownPlayers = new Set(names);
  }

  log(entry: Omit<GameLogEntry, 'id' | 'timestamp'>) {
    const fullEntry: GameLogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    this.logs.push(fullEntry);
    this.flush();
    
    // Console output for visibility
    const timeStr = fullEntry.timestamp.split('T')[1].split('.')[0];
    const prefix = chalk.gray(`[${timeStr}]`);
    
    const typeColor = TYPE_COLORS[fullEntry.type] || chalk.white;
    const typeStr = typeColor(`[${fullEntry.type}]`);
    
    let playerInfo = '';
    if (fullEntry.player) {
      // Use a distinct color for player names, or maybe generate one based on hash?
      // For now, let's use a nice bright color.
      playerInfo = ` <${chalk.hex('#FFA500')(fullEntry.player)}>`;
    }

    // Highlight roles in content
    let content = fullEntry.content;
    const rolePattern = /\b(villager|mafia|cop|doctor|god|vigilante|roleblocker|godfather)s?\b/gi;
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
