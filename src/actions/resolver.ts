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

  // 1) Resolve blocks in priority order (highest priority first).
  // Blocks are "blockable": if a blocker is already blocked, their block doesn't apply.
  //
  // IMPORTANT: Jailkeeper has highest priority; jails must apply before other blocks.
  const appliedBlocks = new Set<string>(); // Track which blockers successfully applied their block

  // Apply jails first (priority 3). Jails both block and protect.
  for (const jail of jailActions) {
    if (blockedPlayers.has(jail.actor)) continue;
    blockedPlayers.add(jail.target);
    savedPlayers.add(jail.target);
    jailedPlayers.add(jail.target);
    appliedBlocks.add(jail.actor);
  }

  // Then apply regular blocks, sorted by priority (roleblocker > mafia_roleblocker).
  blockActions.sort((a, b) => b.priority - a.priority);
  for (const block of blockActions) {
    if (blockedPlayers.has(block.actor)) continue;
    blockedPlayers.add(block.target);
    appliedBlocks.add(block.actor);
  }

  // 1b) Effective actions
  // Rule: if the Mafia killer is blocked, the kill fails (no backup shooter).
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
    // (Other sources like vigilante or bomb retaliation are allowed to kill mafia.)
    if (k.source === 'mafia' && isMafiaRole(input.rolesByPlayer[k.target])) continue;
    deaths.add(k.target);
  }

  // 7) Resolve bomb retaliation (if bomb dies, killer also dies)
  for (const d of [...deaths]) {
    const role = input.rolesByPlayer[d];
    if (role === 'bomb') {
      // Find the kill that killed this bomb
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
  // A "visit" is a successful targeted action (investigate, save, kill, block, jail, frame, track)
  // We need to determine what the tracked player successfully did
  for (const track of trackActions) {
    if (blockedPlayers.has(track.actor)) continue; // Blocked trackers don't track

    const trackedPlayer = track.target;
    let visited: string | null = null;

    // Check if tracked player successfully performed any targeted action
    // Priority: first successful action counts
    for (const a of actionsForResolution) {
      if (a.actor !== trackedPlayer) continue;
      if (blockedPlayers.has(trackedPlayer)) break; // If tracked player was blocked, no visit

      // Check if this action was successful
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

      if (wasSuccessful) break; // First successful action counts
    }

    trackerResults.push({ actor: track.actor, target: trackedPlayer, visited });
  }

  // 9) Resolve death reveal overrides (janitor/forger)
  // Only applies to mafia kills that actually killed someone
  const mafiaKills = kills.filter(
    k => k.source === 'mafia' && !k.blocked && !k.saved && deaths.has(k.target)
  );

  for (const kill of mafiaKills) {
    const victim = kill.target;

    // Check for forger first (forger takes precedence)
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

    // Check for janitor
    const cleanAction = cleanActions.find(
      c => !blockedPlayers.has(c.actor) && c.target === victim
    );
    if (cleanAction) {
      deathRevealOverrides.push({
        player: victim,
        revealedRole: null, // null = unknown
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

