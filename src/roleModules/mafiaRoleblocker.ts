import type { GameEngine } from '../engine/gameEngine.js';
import type { NightActionIntent } from '../actions/types.js';
import { logger } from '../logger.js';
import { runMafiaDiscussion } from './mafia.ts';

export async function collectMafiaRoleblockerActions(
  engine: GameEngine
): Promise<Array<Extract<NightActionIntent, { kind: 'block' }>>> {
  const alivePlayers = engine.getAlivePlayers();
  const aliveNames = alivePlayers.map(p => p.config.name);

  const mafiaRoleblockers = alivePlayers.filter(p => p.role === 'mafia_roleblocker');
  if (mafiaRoleblockers.length === 0) return [];
  const actions: Array<Extract<NightActionIntent, { kind: 'block' }>> = [];

  // Mafia roleblockers coordinate with the mafia team
  const mafiaTeam = alivePlayers.filter(
    p => p.role === 'mafia' || p.role === 'godfather' || p.role === 'mafia_roleblocker'
  );

  await runMafiaDiscussion(engine, mafiaTeam, aliveNames, {
    systemLogContent: 'Mafia team (including roleblocker) is discussing blocking strategy...',
    goal: 'Discuss who to block tonight. Coordinate with your team.',
    rounds: 1,
  });

  for (const mrb of mafiaRoleblockers) {
    const validTargets = aliveNames.filter(n => {
      const role = engine.state.players[n]?.role;
      return role !== 'mafia' && role !== 'godfather' && role !== 'mafia_roleblocker';
    });
    if (validTargets.length === 0) continue;

    const target = await engine.agentIO.decide(
      mrb.config.name,
      `Night ${engine.state.round}. You are the Mafia Roleblocker.
Alive players: ${aliveNames.join(', ')}.

Choose ONE player to block tonight.
Guidance (soft):
- Block suspected power roles (cop, doctor, vigilante, tracker, roleblocker).
- Blocking the Mafia's chosen killer will cause the Mafia kill to fail.
- Coordinate with your mafia team on who to block.`,
      validTargets
    );

    actions.push({ kind: 'block', actor: mrb.config.name, target });

    mafiaTeam.forEach(m => {
      engine.agents[m.config.name]?.observeFactionEvent(
        `Our roleblocker (${mrb.config.name}) chose to block ${target}.`
      );
    });

    logger.log({
      type: 'ACTION',
      player: mrb.config.name,
      content: `chose to block ${target}`,
      metadata: { target, role: 'mafia_roleblocker', faction: 'mafia', visibility: 'faction' },
    });
  }

  return actions;
}
