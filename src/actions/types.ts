import type { Role } from '../types.js';

export type NightKillSource = 'mafia' | 'vigilante';

export type NightActionIntent =
  | { kind: 'block'; actor: string; target: string }
  | { kind: 'kill'; actor: string; target: string; source: 'mafia' }
  | { kind: 'kill'; actor: string; target: string; source: 'vigilante' }
  | { kind: 'investigate'; actor: string; target: string }
  | { kind: 'save'; actor: string; target: string };

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

export interface ResolvedNightActions {
  blockedPlayers: Set<string>;
  savedPlayers: Set<string>;
  kills: ResolvedKill[];
  deaths: Set<string>;
  investigations: ResolvedInvestigation[];
}

export interface NightResolutionInput {
  actions: NightActionIntent[];
  rolesByPlayer: Record<string, Role>;
}

