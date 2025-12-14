import type { GameEngine } from '../engine/gameEngine.js';
import type { NightActionIntent } from '../actions/types.js';
import { logger } from '../logger.js';

export async function collectMafiaActions(
  engine: GameEngine
): Promise<Array<Extract<NightActionIntent, { kind: 'kill'; source: 'mafia' }>>> {
  const alivePlayers = engine.getAlivePlayers();
  const aliveNames = alivePlayers.map(p => p.config.name);

  const mafiaTeam = alivePlayers.filter(
    p =>
      p.role === 'mafia' ||
      p.role === 'godfather' ||
      p.role === 'mafia_roleblocker' ||
      p.role === 'framer' ||
      p.role === 'janitor' ||
      p.role === 'forger'
  );
  if (mafiaTeam.length === 0) return [];

  // --- Mafia Discussion ---
  if (mafiaTeam.length > 1) {
    logger.log({
      type: 'SYSTEM',
      content: `Mafia team is discussing targeting strategy...`,
      metadata: { faction: 'mafia', visibility: 'faction' },
    });
    const discussionRounds = 2;
    for (let r = 0; r < discussionRounds; r++) {
      for (const member of mafiaTeam) {
        const others = mafiaTeam
          .filter(m => m !== member)
          .map(m => m.config.name)
          .join(', ');
        const context = `Night ${engine.state.round} Mafia Discussion (Round ${r + 1}/${discussionRounds}).
Teammates: ${others}.
Goal: Discuss who to kill tonight. Coordinate with your team.
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

  // Find shooter (Godfather priority, then mafia, then other mafia roles)
  // Backup shooter logic: if default shooter is blocked, another mafia member can perform the kill
  // For now, we'll select the shooter and let the resolver handle blocking
  // The resolver will need to check if the shooter is blocked and potentially use a backup
  // But actually, we can't know who's blocked until resolution, so we'll just pick the primary shooter
  // The backup shooter behavior will be handled in the resolver or night phase
  const shooter = mafiaTeam.find(p => p.role === 'godfather') ||
    mafiaTeam.find(p => p.role === 'mafia') ||
    mafiaTeam[0]!;

  const validTargets = aliveNames.filter(n => {
    const role = engine.state.players[n]?.role;
    return (
      role !== 'mafia' &&
      role !== 'godfather' &&
      role !== 'mafia_roleblocker' &&
      role !== 'framer' &&
      role !== 'janitor' &&
      role !== 'forger'
    );
  });
  if (validTargets.length === 0) return [];

  const target = await engine.agentIO.decide(
    shooter.config.name,
    `Night ${engine.state.round}. You are leading the Mafia kill. Choose a target.
Note: If you are blocked, another mafia member may perform the kill instead.`,
    validTargets
  );

  // Notify the whole faction (simplified)
  mafiaTeam.forEach(m => {
    engine.agents[m.config.name]?.observeFactionEvent(
      `Our team (via ${shooter.config.name}) chose to kill ${target}.`
    );
  });

  logger.log({
    type: 'ACTION',
    player: shooter.config.name,
    content: `chose to kill ${target}`,
    metadata: { target, role: shooter.role, faction: 'mafia', visibility: 'faction' },
  });

  return [{ kind: 'kill', actor: shooter.config.name, target, source: 'mafia' }];
}

