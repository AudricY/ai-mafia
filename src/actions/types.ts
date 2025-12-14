import type { Role } from '../types.js';

export type NightKillSource = 'mafia' | 'vigilante';

export type NightActionIntent =
  | { kind: 'block'; actor: string; target: string }
  | { kind: 'kill'; actor: string; target: string; source: 'mafia' }
  | { kind: 'kill'; actor: string; target: string; source: 'vigilante' }
  | { kind: 'investigate'; actor: string; target: string }
  | { kind: 'save'; actor: string; target: string }
  | { kind: 'track'; actor: string; target: string }
  | { kind: 'jail'; actor: string; target: string }
  | { kind: 'frame'; actor: string; target: string }
  | { kind: 'clean'; actor: string; target: string }
  | { kind: 'forge'; actor: string; target: string; fakeRole: string };

export type InvestigationResult = 'MAFIA' | 'INNOCENT';

export interface ResolvedInvestigation {
  actor: string;
  target: string;
  result: InvestigationResult;
}

export interface ResolvedKill {
  actor: string;
  target: string;
  source: NightKillSource;
  blocked: boolean;
  saved: boolean;
}

export interface ResolvedTracker {
  actor: string;
  target: string;
  visited: string | null; // null means no successful visit
}

export interface DeathRevealOverride {
  player: string;
  revealedRole: string | null; // null means "unknown", string means fake role
}

export interface ResolvedNightActions {
  blockedPlayers: Set<string>;
  savedPlayers: Set<string>;
  kills: ResolvedKill[];
  deaths: Set<string>;
  investigations: ResolvedInvestigation[];
  trackerResults: ResolvedTracker[];
  bombRetaliations: Set<string>; // players who died from bomb retaliation
  deathRevealOverrides: DeathRevealOverride[];
}

export interface NightResolutionInput {
  actions: NightActionIntent[];
  rolesByPlayer: Record<string, Role>;
  alivePlayers: string[];
}

