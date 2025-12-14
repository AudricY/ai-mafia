import * as fs from 'fs';
import * as path from 'path';
import { GameLogEntry, LogType } from './types.js';

export class GameLogger {
  private logFile: string;
  private logs: GameLogEntry[] = [];

  constructor() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir);
    }
    this.logFile = path.join(logDir, `game-${timestamp}.json`);
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
    const prefix = `[${fullEntry.timestamp.split('T')[1].split('.')[0]}] [${fullEntry.type}]`;
    const playerInfo = fullEntry.player ? ` <${fullEntry.player}>` : '';
    console.log(`${prefix}${playerInfo}: ${fullEntry.content}`);
  }

  private flush() {
    fs.writeFileSync(this.logFile, JSON.stringify(this.logs, null, 2));
  }
}

export const logger = new GameLogger();
