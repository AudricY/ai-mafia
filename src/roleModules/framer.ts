import type { GameEngine } from '../engine/gameEngine.js';
import type { NightActionIntent } from '../actions/types.js';
import { logger } from '../logger.js';

export async function collectFramerActions(
  engine: GameEngine
): Promise<Array<Extract<NightActionIntent, { kind: 'frame' }>>> {
  const alivePlayers = engine.getAlivePlayers();
  const aliveNames = alivePlayers.map(p => p.config.name);

  const framers = alivePlayers.filter(p => p.role === 'framer');
  if (framers.length === 0) return [];
  const actions: Array<Extract<NightActionIntent, { kind: 'frame' }>> = [];

  // Note: Mafia discussion is now handled by collectMafiaCouncilIntents.
  // This function is kept for backwards compatibility but skips discussion.

  for (const framer of framers) {
    const validTargets = aliveNames.filter(n => n !== framer.config.name);
    if (validTargets.length === 0) continue;

    const target = await engine.agentIO.decide(
      framer.config.name,
      `Night ${engine.state.round}. You are the Framer.
Alive players: ${aliveNames.join(', ')}.

Choose ONE player to frame tonight.
Guidance (soft):
- Frame players likely to be investigated by the Cop (suspected town power roles, or yourself/teammates to confuse).
- Framed players will appear MAFIA to Cop investigations this night only.
- Coordinate with your mafia team.`,
      validTargets
    );

    actions.push({ kind: 'frame', actor: framer.config.name, target });

    // Notify mafia team
    const mafiaTeam = alivePlayers.filter(
      p =>
        p.role === 'mafia' ||
        p.role === 'godfather' ||
        p.role === 'mafia_roleblocker' ||
        p.role === 'framer'
    );
    mafiaTeam.forEach(m => {
      engine.agents[m.config.name]?.observeFactionEvent(
        `Our framer (${framer.config.name}) chose to frame ${target}.`
      );
    });

    logger.log({
      type: 'ACTION',
      player: framer.config.name,
      content: `chose to frame ${target}`,
      metadata: { target, role: 'framer', faction: 'mafia', visibility: 'faction' },
    });
  }

  return actions;
}
