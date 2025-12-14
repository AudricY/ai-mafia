import type { Role } from '../types.js';
import type {
  InvestigationResult,
  NightActionIntent,
  NightResolutionInput,
  ResolvedInvestigation,
  ResolvedKill,
  ResolvedNightActions,
} from './types.js';

function isMafiaRole(role: Role | undefined): boolean {
  return role === 'mafia' || role === 'godfather';
}

function resolveInvestigationResult(targetRole: Role | undefined): InvestigationResult {
  // Godfather appears INNOCENT.
  if (targetRole === 'mafia') return 'MAFIA';
  return 'INNOCENT';
}

export function resolveNightActions(input: NightResolutionInput): ResolvedNightActions {
  const blockedPlayers = new Set<string>();
  const savedPlayers = new Set<string>();

  const kills: ResolvedKill[] = [];
  const investigations: ResolvedInvestigation[] = [];

  // 1) Apply blocks (blocks are not themselves blockable; matches old ordering).
  for (const a of input.actions) {
    if (a.kind !== 'block') continue;
    blockedPlayers.add(a.target);
  }

  // 2) Apply saves (blocked doctors don't save).
  for (const a of input.actions) {
    if (a.kind !== 'save') continue;
    if (blockedPlayers.has(a.actor)) continue;
    savedPlayers.add(a.target);
  }

  // 3) Resolve investigations (blocked cops don't investigate).
  for (const a of input.actions) {
    if (a.kind !== 'investigate') continue;
    if (blockedPlayers.has(a.actor)) continue;
    const targetRole = input.rolesByPlayer[a.target];
    const result = resolveInvestigationResult(targetRole);
    investigations.push({ actor: a.actor, target: a.target, result });
  }

  // 4) Resolve kills (blocked shooters don't kill; saved targets don't die).
  for (const a of input.actions) {
    if (a.kind !== 'kill') continue;
    const blocked = blockedPlayers.has(a.actor);
    const saved = !blocked && savedPlayers.has(a.target);
    kills.push({ actor: a.actor, target: a.target, source: a.source, blocked, saved });
  }

  const deaths = new Set<string>();
  for (const k of kills) {
    if (k.blocked) continue;
    if (k.saved) continue;
    deaths.add(k.target);
  }

  // Defensive: never allow mafia-on-mafia deaths via resolver if the mafia module mistakenly targets one.
  // (We keep this here so invariants stay centralized.)
  for (const d of [...deaths]) {
    if (isMafiaRole(input.rolesByPlayer[d])) {
      deaths.delete(d);
    }
  }

  return { blockedPlayers, savedPlayers, kills, deaths, investigations };
}

