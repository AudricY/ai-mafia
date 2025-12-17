import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { GameLogEntry, LogType, Role } from './types.js';
import { eventBus } from './events/index.js';

const ROLE_COLORS: Record<string, (text: string) => string> = {
  mafia: chalk.red,
  godfather: chalk.redBright,
  mafia_roleblocker: chalk.redBright,
  villager: chalk.green,
  cop: chalk.blue,
  doctor: chalk.cyan,
  vigilante: chalk.magenta,
  roleblocker: chalk.yellow,
  tracker: chalk.blueBright,
  jailkeeper: chalk.cyanBright,
  mason: chalk.greenBright,
  bomb: chalk.redBright,
  framer: chalk.yellowBright,
  janitor: chalk.gray,
  forger: chalk.magentaBright,
  jester: chalk.magentaBright,
  executioner: chalk.white,
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
  private transcriptFile: string;
  private logs: GameLogEntry[] = [];
  private knownPlayers: Set<string> = new Set();
  private consoleOutputEnabled = true;
  private persistenceEnabled = true;
  private subscribers: Set<(entry: GameLogEntry) => void> = new Set();
  private playerRoles: Map<string, Role> = new Map();

  constructor() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir);
    }
    this.logFile = path.join(logDir, `game-${timestamp}.json`);
    this.transcriptFile = path.join(logDir, `transcript-${timestamp}.txt`);

    // The logger subscribes to the global event bus and persists/prints entries.
    eventBus.subscribe((entry) => {
      this.handleEntry(entry);
    });
  }

  /**
   * Enable or disable writing structured logs / transcripts to disk.
   *
   * This is primarily used for dry-run mode so that development runs don't
   * accumulate `logs/game-*.json` and `logs/transcript-*.txt` files.
   *
   * Console output and in-memory logs remain unaffected.
   */
  setPersistenceEnabled(enabled: boolean) {
    this.persistenceEnabled = enabled;
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
    // Only infer role if it's not explicitly set in metadata
    // Check property existence: if 'role' is in metadata (even if undefined), don't infer
    const hasRoleProperty = entry.metadata && 'role' in entry.metadata;
    const inferredRole: Role | undefined =
      entry.player && !hasRoleProperty ? this.playerRoles.get(entry.player) : undefined;
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

    // Skip THOUGHT entries unless explicitly enabled via env var
    if (entry.type === 'THOUGHT') {
      const printThoughts = (process.env.AI_MAFIA_PRINT_THOUGHTS ?? '').toLowerCase().trim();
      if (printThoughts !== '1' && printThoughts !== 'true' && printThoughts !== 'yes' && printThoughts !== 'on') {
        return;
      }
    }

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
    const rolePattern =
      /\b(villager|mafia|cop|doctor|vigilante|roleblocker|godfather|tracker|jailkeeper|mason|bomb|mafia_roleblocker|framer|janitor|forger|jester|executioner)s?\b/gi;
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
    if (!this.persistenceEnabled) return;
    fs.writeFileSync(this.logFile, JSON.stringify(this.logs, null, 2));
    fs.writeFileSync(this.transcriptFile, this.buildTranscriptText(this.logs));
  }

  private buildTranscriptText(entries: readonly GameLogEntry[]): string {
    const lines: string[] = [];

    for (const entry of entries) {
      // Prefer explicit visibility if present. If absent, fall back to a conservative
      // include-list so we don't leak private events (THOUGHT, FACTION_CHAT, etc).
      const visibility = entry.metadata?.visibility;
      const isExplicitlyPublic = visibility === 'public';
      const isAllowedType =
        entry.type === 'SYSTEM' ||
        entry.type === 'CHAT' ||
        entry.type === 'VOTE' ||
        entry.type === 'DEATH' ||
        entry.type === 'WIN';

      if (!isExplicitlyPublic && !isAllowedType) continue;
      if (entry.type === 'THOUGHT' || entry.type === 'FACTION_CHAT') continue;

      if (entry.type === 'SYSTEM') {
        lines.push(`[SYSTEM] ${entry.content}`);
        continue;
      }

      if (entry.type === 'CHAT') {
        if (entry.player) lines.push(`${entry.player}: ${entry.content}`);
        else lines.push(`[CHAT] ${entry.content}`);
        continue;
      }

      if (entry.type === 'VOTE') {
        lines.push(`[VOTE] ${entry.player ? `${entry.player} ` : ''}${entry.content}`.trimEnd());
        continue;
      }

      if (entry.type === 'DEATH') {
        lines.push(`[DEATH] ${entry.player ? `${entry.player} ` : ''}${entry.content}`.trimEnd());
        continue;
      }

      if (entry.type === 'WIN') {
        lines.push(`[WIN] ${entry.content}`);
        continue;
      }

      // Fallback formatting (should be rare with current filters)
      lines.push(`[${entry.type}] ${entry.player ? `${entry.player}: ` : ''}${entry.content}`);
    }

    return `${lines.join('\n')}\n`;
  }
}

export const logger = new GameLogger();
