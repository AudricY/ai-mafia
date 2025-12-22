import type { Role } from '../types.js';
import type {
  InvestigationResult,
  NightActionIntent,
  NightResolutionInput,
  ResolvedInvestigation,
  ResolvedKill,
  ResolvedNightActions,
  ResolvedTracker,
  DeathRevealOverride,
} from './types.js';

function isMafiaRole(role: Role | undefined): boolean {
  return (
    role === 'mafia' ||
    role === 'godfather' ||
    role === 'mafia_roleblocker' ||
    role === 'framer' ||
    role === 'janitor' ||
    role === 'forger'
  );
}

function resolveInvestigationResult(
  targetRole: Role | undefined,
  isFramed: boolean
): InvestigationResult {
  // Framer makes anyone appear MAFIA.
  if (isFramed) return 'MAFIA';
  // Godfather appears INNOCENT.
  if (targetRole === 'godfather') return 'INNOCENT';
  // Other mafia-aligned roles appear MAFIA.
  if (targetRole && isMafiaRole(targetRole)) return 'MAFIA';
  return 'INNOCENT';
}

function getBlockPriority(role: Role | undefined): number {
  // Higher number = higher priority (applied first)
  if (role === 'jailkeeper') return 3;
  if (role === 'roleblocker') return 2;
  if (role === 'mafia_roleblocker') return 1;
  return 0;
}

export function resolveNightActions(input: NightResolutionInput): ResolvedNightActions {
  const blockedPlayers = new Set<string>();
  const savedPlayers = new Set<string>();
  const jailedPlayers = new Set<string>(); // Jailed = blocked + protected

  const kills: ResolvedKill[] = [];
  const investigations: ResolvedInvestigation[] = [];
  const trackerResults: ResolvedTracker[] = [];
  const bombRetaliations = new Set<string>();
  const deathRevealOverrides: DeathRevealOverride[] = [];

  // Collect all block-like actions
  const jailActions: Array<{ actor: string; target: string }> = [];
  const blockActions: Array<{ actor: string; target: string; priority: number }> = [];
  const frameActions: Array<{ actor: string; target: string }> = [];
  const trackActions: Array<{ actor: string; target: string }> = [];
  const cleanActions: Array<{ actor: string; target: string }> = [];
  const forgeActions: Array<{ actor: string; target: string; fakeRole: Role }> = [];

  for (const a of input.actions) {
    if (a.kind === 'jail') {
      jailActions.push({ actor: a.actor, target: a.target });
    } else if (a.kind === 'block') {
      const priority = getBlockPriority(input.rolesByPlayer[a.actor]);
      blockActions.push({ actor: a.actor, target: a.target, priority });
    } else if (a.kind === 'frame') {
      frameActions.push({ actor: a.actor, target: a.target });
    } else if (a.kind === 'track') {
      trackActions.push({ actor: a.actor, target: a.target });
    } else if (a.kind === 'clean') {
      cleanActions.push({ actor: a.actor, target: a.target });
    } else if (a.kind === 'forge') {
      forgeActions.push({ actor: a.actor, target: a.target, fakeRole: a.fakeRole });
    }
  }

  // 1. Resolve blocks and jails.
  const allBlockActions = [
    ...jailActions.map(j => ({ actor: j.actor, target: j.target, priority: 3, isJail: true })),
    ...blockActions.map(b => ({ actor: b.actor, target: b.target, priority: b.priority, isJail: false }))
  ];

  // We use a chain-and-cycle resolution.
  const blockedBlockerNames = new Set<string>();
  const unblockedBlockerNames = new Set<string>();
  const remainingBlockerNames = new Set(allBlockActions.map(a => a.actor));

  let changed = true;
  while (changed) {
    changed = false;
    for (const actor of [...remainingBlockerNames]) {
      const blockersOfActor = allBlockActions.filter(a => a.target === actor);
      
      // If ANY person blocking this actor is confirmed UNBLOCKED, then this actor is BLOCKED
      if (blockersOfActor.some(b => unblockedBlockerNames.has(b.actor))) {
        blockedBlockerNames.add(actor);
        blockedPlayers.add(actor); // Actor is successfully blocked
        remainingBlockerNames.delete(actor);
        changed = true;
      }
      // If ALL people blocking this actor are confirmed BLOCKED, then this actor is UNBLOCKED
      else if (blockersOfActor.every(b => blockedBlockerNames.has(b.actor))) {
        unblockedBlockerNames.add(actor);
        remainingBlockerNames.delete(actor);
        changed = true;
      }
    }

    // If no changes but still have remaining, we have a cycle or mutual block.
    if (!changed && remainingBlockerNames.size > 0) {
      for (const actor of remainingBlockerNames) {
        blockedBlockerNames.add(actor);
        blockedPlayers.add(actor);
      }
      remainingBlockerNames.clear();
      changed = true;
    }
  }

  // Apply the effects of unblocked blocks and jails to their targets.
  const appliedBlocks = new Set<string>();
  for (const action of allBlockActions) {
    if (blockedBlockerNames.has(action.actor)) continue;
    
    blockedPlayers.add(action.target);
    appliedBlocks.add(action.actor);
    
    if (action.isJail) {
      savedPlayers.add(action.target);
      jailedPlayers.add(action.target);
    }
  }

  // 1b) Effective actions
  const actionsForResolution: NightActionIntent[] = input.actions;

  // 2) Apply saves (blocked doctors don't save)
  for (const a of actionsForResolution) {
    if (a.kind !== 'save') continue;
    if (blockedPlayers.has(a.actor)) continue;
    savedPlayers.add(a.target);
  }

  // 3) Resolve frames (blocked framers don't frame)
  const framedPlayers = new Set<string>();
  for (const frame of frameActions) {
    if (blockedPlayers.has(frame.actor)) continue;
    framedPlayers.add(frame.target);
  }

  // 4) Resolve investigations (blocked cops don't investigate)
  for (const a of actionsForResolution) {
    if (a.kind !== 'investigate') continue;
    if (blockedPlayers.has(a.actor)) continue;
    const targetRole = input.rolesByPlayer[a.target];
    const isFramed = framedPlayers.has(a.target);
    const result = resolveInvestigationResult(targetRole, isFramed);
    investigations.push({ actor: a.actor, target: a.target, result });
  }

  // 5) Resolve kills (blocked shooters don't kill; saved targets don't die)
  for (const a of actionsForResolution) {
    if (a.kind !== 'kill') continue;
    const blocked = blockedPlayers.has(a.actor);
    const saved = !blocked && savedPlayers.has(a.target);
    kills.push({ actor: a.actor, target: a.target, source: a.source, blocked, saved });
  }

  // 6) Compute deaths
  const deaths = new Set<string>();
  for (const k of kills) {
    if (k.blocked) continue;
    if (k.saved) continue;
    // Defensive: never allow mafia kill to kill a mafia-aligned player.
    if (k.source === 'mafia' && isMafiaRole(input.rolesByPlayer[k.target])) continue;
    deaths.add(k.target);
  }

  // 7) Resolve bomb retaliation (if bomb dies, killer also dies)
  for (const d of [...deaths]) {
    const role = input.rolesByPlayer[d];
    if (role === 'bomb') {
      const killingAction = kills.find(
        k => !k.blocked && !k.saved && k.target === d
      );
      if (killingAction) {
        bombRetaliations.add(killingAction.actor);
        deaths.add(killingAction.actor);
      }
    }
  }

  // 8) Resolve tracker results (only successful visits)
  for (const track of trackActions) {
    if (blockedPlayers.has(track.actor)) continue;

    const trackedPlayer = track.target;
    let visited: string | null = null;

    for (const a of actionsForResolution) {
      if (a.actor !== trackedPlayer) continue;
      if (blockedPlayers.has(trackedPlayer)) break;

      let wasSuccessful = false;
      if (a.kind === 'investigate' && !blockedPlayers.has(a.actor)) {
        wasSuccessful = true;
        visited = a.target;
      } else if (a.kind === 'save' && !blockedPlayers.has(a.actor)) {
        wasSuccessful = true;
        visited = a.target;
      } else if (a.kind === 'kill' && !blockedPlayers.has(a.actor)) {
        wasSuccessful = true;
        visited = a.target;
      } else if (a.kind === 'block' && appliedBlocks.has(a.actor)) {
        wasSuccessful = true;
        visited = a.target;
      } else if (a.kind === 'jail' && !blockedPlayers.has(a.actor)) {
        wasSuccessful = true;
        visited = a.target;
      } else if (a.kind === 'frame' && !blockedPlayers.has(a.actor)) {
        wasSuccessful = true;
        visited = a.target;
      } else if (a.kind === 'track' && !blockedPlayers.has(a.actor)) {
        wasSuccessful = true;
        visited = a.target;
      }

      if (wasSuccessful) break;
    }

    trackerResults.push({ actor: track.actor, target: trackedPlayer, visited });
  }

  // 9) Resolve death reveal overrides (janitor/forger)
  const mafiaKills = kills.filter(
    k => k.source === 'mafia' && !k.blocked && !k.saved && deaths.has(k.target)
  );

  for (const kill of mafiaKills) {
    const victim = kill.target;

    const forgeAction = forgeActions.find(
      f => !blockedPlayers.has(f.actor) && f.target === victim
    );
    if (forgeAction) {
      deathRevealOverrides.push({
        player: victim,
        revealedRole: forgeAction.fakeRole,
      });
      continue;
    }

    const cleanAction = cleanActions.find(
      c => !blockedPlayers.has(c.actor) && c.target === victim
    );
    if (cleanAction) {
      deathRevealOverrides.push({
        player: victim,
        revealedRole: null,
      });
    }
  }

  return {
    blockedPlayers,
    savedPlayers,
    kills,
    deaths,
    investigations,
    trackerResults,
    bombRetaliations,
    deathRevealOverrides,
  };
}
