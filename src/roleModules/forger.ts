import type { GameEngine } from '../engine/gameEngine.js';
import type { NightActionIntent } from '../actions/types.js';
import { logger } from '../logger.js';
import type { Role } from '../types.js';

export async function collectForgerActions(
  engine: GameEngine
): Promise<Array<Extract<NightActionIntent, { kind: 'forge' }>>> {
  const alivePlayers = engine.getAlivePlayers();
  const aliveNames = alivePlayers.map(p => p.config.name);

  const forgers = alivePlayers.filter(p => p.role === 'forger');
  if (forgers.length === 0) return [];
  const actions: Array<Extract<NightActionIntent, { kind: 'forge' }>> = [];

  // Note: Mafia discussion is now handled by collectMafiaCouncilIntents.
  // This function is kept for backwards compatibility but skips discussion.

  // Get list of valid roles for forging (all roles except mafia roles)
  const validRoles: Role[] = [
    'villager',
    'cop',
    'doctor',
    'vigilante',
    'roleblocker',
    'tracker',
    'jailkeeper',
    'mason',
    'bomb',
  ];

  for (const forger of forgers) {
    const validTargets = aliveNames.filter(n => {
      const role = engine.state.players[n]?.role;
      return role !== 'mafia' && role !== 'godfather' && role !== 'mafia_roleblocker';
    });
    if (validTargets.length === 0) continue;

    const target = await engine.agentIO.decide(
      forger.config.name,
      `Night ${engine.state.round}. You are the Forger.
Alive players: ${aliveNames.join(', ')}.

Choose ONE player to forge if they are killed by Mafia tonight.
Guidance (soft):
- Forging replaces the victim's role reveal with a fake role.
- Use on kills where a fake role would confuse town (e.g., forge a cop kill as "villager" to hide that cop died).
- Coordinate with your mafia team on who to forge and what role to use.`,
      validTargets
    );

    // Choose fake role
    const fakeRole = await engine.agentIO.decide(
      forger.config.name,
      `Choose what fake role to reveal if ${target} is killed:
Valid roles: ${validRoles.join(', ')}.`,
      validRoles
    );

    actions.push({ kind: 'forge', actor: forger.config.name, target, fakeRole });

    // Notify mafia team
    const mafiaTeam = alivePlayers.filter(
      p =>
        p.role === 'mafia' ||
        p.role === 'godfather' ||
        p.role === 'mafia_roleblocker' ||
        p.role === 'framer' ||
        p.role === 'janitor' ||
        p.role === 'forger'
    );
    mafiaTeam.forEach(m => {
      engine.agents[m.config.name]?.observeFactionEvent(
        `Our forger (${forger.config.name}) chose to forge ${target} as ${fakeRole} if killed.`
      );
    });

    logger.log({
      type: 'ACTION',
      player: forger.config.name,
      content: `chose to forge ${target} as ${fakeRole} if killed`,
      metadata: { target, fakeRole, role: 'forger', faction: 'mafia', visibility: 'faction' },
    });
  }

  return actions;
}
