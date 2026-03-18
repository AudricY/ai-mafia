import * as fs from 'fs';
import * as path from 'path';
import { GameLogEntry } from '../types.js';

/**
 * Resolves a replay path. If 'latest', it finds the most recent game-* replay log in logs/.
 */
export function resolveReplayPath(arg: string): string {
  const logDir = path.join(process.cwd(), 'logs');
  
  if (arg === 'latest') {
    if (!fs.existsSync(logDir)) {
      throw new Error(`Log directory not found: ${logDir}`);
    }
    const files = fs.readdirSync(logDir)
      .filter(f => f.startsWith('game-') && (f.endsWith('.jsonl') || f.endsWith('.json')))
      .sort()
      .reverse();
    
    if (files.length === 0) {
      throw new Error(`No game logs found in ${logDir}`);
    }
    return path.join(logDir, files[0]!);
  }

  // If it's a relative path that doesn't exist, try looking in logs/
  if (!fs.existsSync(arg)) {
    const inLogs = path.join(logDir, arg);
    if (fs.existsSync(inLogs)) return inLogs;

    // Also try adding the supported replay extensions if missing.
    if (!arg.endsWith('.json') && !arg.endsWith('.jsonl')) {
      const withJsonl = `${arg}.jsonl`;
      if (fs.existsSync(withJsonl)) return withJsonl;
      const inLogsWithJsonl = path.join(logDir, withJsonl);
      if (fs.existsSync(inLogsWithJsonl)) return inLogsWithJsonl;

      const withJson = `${arg}.json`;
      if (fs.existsSync(withJson)) return withJson;
      const inLogsWithJson = path.join(logDir, withJson);
      if (fs.existsSync(inLogsWithJson)) return inLogsWithJson;
    }
  }

  return path.resolve(process.cwd(), arg);
}

/**
 * Loads and parses a replay file.
 */
export function loadReplayEntries(filePath: string): GameLogEntry[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Replay file not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  try {
    const trimmed = content.trim();

    if (trimmed === '') {
      return [];
    }

    if (filePath.endsWith('.jsonl')) {
      return trimmed
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => JSON.parse(line) as GameLogEntry);
    }

    const entries = JSON.parse(trimmed);
    if (Array.isArray(entries)) {
      return entries as GameLogEntry[];
    }

    throw new Error('Replay file is not an array of log entries');
  } catch (err) {
    if (err instanceof Error) {
      throw new Error(`Failed to parse replay file: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Infers player names from log entries.
 */
export function inferPlayers(entries: GameLogEntry[]): string[] {
  const players = new Set<string>();
  for (const entry of entries) {
    if (entry.player) players.add(entry.player);
    
    // Also check metadata if player is mentioned there as an actor
    const metaPlayer = entry.metadata?.player;
    if (typeof metaPlayer === 'string') players.add(metaPlayer);
  }
  return Array.from(players).sort();
}
