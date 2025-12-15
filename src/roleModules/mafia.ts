import type { GameEngine } from '../engine/gameEngine.js';
import type { NightActionIntent } from '../actions/types.js';
import type { PlayerState } from '../types.js';
import { logger } from '../logger.js';

export async function runMafiaDiscussion(
  engine: GameEngine,
  mafiaTeam: PlayerState[],
  aliveNames: string[],
  opts: {
    systemLogContent: string;
    goal: string;
    rounds?: number;
  }
): Promise<void> {
  if (mafiaTeam.length <= 1) return;

  logger.log({
    type: 'SYSTEM',
    content: opts.systemLogContent,
    metadata: { faction: 'mafia', visibility: 'faction' },
  });

  const discussionRounds = Math.max(1, opts.rounds ?? 1);
  for (let r = 0; r < discussionRounds; r++) {
    for (const member of mafiaTeam) {
      const others = mafiaTeam
        .filter(m => m !== member)
        .map(m => m.config.name)
        .join(', ');

      const context = `Night ${engine.state.round} Mafia Discussion (Round ${r + 1}/${discussionRounds}).
Teammates: ${others}.
Goal: ${opts.goal}
Important:
- Avoid empty confirmations ("confirmed", "locked in") unless you add new information.
- If you have nothing NEW to add, reply with the single word "SKIP".
Alive players: ${aliveNames.join(', ')}.`;

      const message = await engine.agentIO.respond(member.config.name, context, []);
      const isSkip = message.trim().toUpperCase() === 'SKIP';

      if (isSkip) {
        engine.agents[member.config.name]?.observePrivateEvent(
          'You chose to SKIP this mafia discussion turn.'
        );
        continue;
      }

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

/**
 * @deprecated Use collectMafiaCouncilIntents instead. This function is kept for backwards compatibility
 * but no longer runs mafia discussion (that's handled by the council).
 */
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

  // Note: Mafia discussion is now handled by collectMafiaCouncilIntents.
  // This function is kept for backwards compatibility but skips discussion.

  // Find shooter (Godfather priority, then mafia, then other mafia roles).
  // Rule: If the chosen shooter is blocked, the Mafia kill fails.
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
Note: If you are blocked, the Mafia kill fails.`,
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

