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
  const actions: Array<Extract<NightActionIntent, { kind: 'forge' }>> = [];

  // Forgers coordinate with the mafia team
  const mafiaTeam = alivePlayers.filter(
    p =>
      p.role === 'mafia' ||
      p.role === 'godfather' ||
      p.role === 'mafia_roleblocker' ||
      p.role === 'framer' ||
      p.role === 'janitor' ||
      p.role === 'forger'
  );

  if (mafiaTeam.length > 1) {
    logger.log({
      type: 'SYSTEM',
      content: `Mafia team (including forger) is discussing forging strategy...`,
      metadata: { faction: 'mafia', visibility: 'faction' },
    });
    const discussionRounds = 1;
    for (let r = 0; r < discussionRounds; r++) {
      for (const member of mafiaTeam) {
        const others = mafiaTeam.filter(m => m !== member).map(m => m.config.name).join(', ');
        const context = `Night ${engine.state.round} Mafia Discussion (Round ${r + 1}/${discussionRounds}).
Teammates: ${others}.
Goal: Discuss who to forge (fake role reveal) if we kill them tonight. Coordinate with your team.
Alive players: ${aliveNames.join(', ')}.`;

        const message = await engine.agentIO.respond(member.config.name, context, []);

        const formattedMsg = `${member.config.name}: ${message}`;
        mafiaTeam.forEach(m => {
          engine.agents[m.config.name]?.observeFactionEvent(formattedMsg);
        });

        logger.log({
          type: 'FACTION_CHAT',
          player: member.config.name,
          content: message,
          metadata: { role: member.role, faction: 'mafia', visibility: 'faction' },
        });
      }
    }
  }

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
