import type { GameEngine } from '../engine/gameEngine.js';
import type { NightActionIntent } from '../actions/types.js';
import { logger } from '../logger.js';

export async function collectJanitorActions(
  engine: GameEngine
): Promise<Array<Extract<NightActionIntent, { kind: 'clean' }>>> {
  const alivePlayers = engine.getAlivePlayers();
  const aliveNames = alivePlayers.map(p => p.config.name);

  const janitors = alivePlayers.filter(p => p.role === 'janitor');
  const actions: Array<Extract<NightActionIntent, { kind: 'clean' }>> = [];

  // Janitors coordinate with the mafia team
  const mafiaTeam = alivePlayers.filter(
    p =>
      p.role === 'mafia' ||
      p.role === 'godfather' ||
      p.role === 'mafia_roleblocker' ||
      p.role === 'framer' ||
      p.role === 'janitor'
  );

  if (mafiaTeam.length > 1) {
    logger.log({
      type: 'SYSTEM',
      content: `Mafia team (including janitor) is discussing cleaning strategy...`,
      metadata: { faction: 'mafia', visibility: 'faction' },
    });
    const discussionRounds = 1;
    for (let r = 0; r < discussionRounds; r++) {
      for (const member of mafiaTeam) {
        const others = mafiaTeam.filter(m => m !== member).map(m => m.config.name).join(', ');
        const context = `Night ${engine.state.round} Mafia Discussion (Round ${r + 1}/${discussionRounds}).
Teammates: ${others}.
Goal: Discuss who to clean (hide role reveal) if we kill them tonight. Coordinate with your team.
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

  for (const janitor of janitors) {
    // Janitor can only clean mafia kills, so we need to know who mafia plans to kill
    // For now, we'll let janitor choose a target (they'll clean it if mafia kills that target)
    const validTargets = aliveNames.filter(n => {
      const role = engine.state.players[n]?.role;
      return role !== 'mafia' && role !== 'godfather' && role !== 'mafia_roleblocker';
    });
    if (validTargets.length === 0) continue;

    const target = await engine.agentIO.decide(
      janitor.config.name,
      `Night ${engine.state.round}. You are the Janitor.
Alive players: ${aliveNames.join(', ')}.

Choose ONE player to clean if they are killed by Mafia tonight.
Guidance (soft):
- Cleaning hides the victim's role reveal (shows as "unknown").
- Use on kills where hiding the role would confuse town (power roles, suspected mafia, etc.).
- Coordinate with your mafia team on who to clean.`,
      validTargets
    );

    actions.push({ kind: 'clean', actor: janitor.config.name, target });

    mafiaTeam.forEach(m => {
      engine.agents[m.config.name]?.observeFactionEvent(
        `Our janitor (${janitor.config.name}) chose to clean ${target} if killed.`
      );
    });

    logger.log({
      type: 'ACTION',
      player: janitor.config.name,
      content: `chose to clean ${target} if killed`,
      metadata: { target, role: 'janitor', faction: 'mafia', visibility: 'faction' },
    });
  }

  return actions;
}
