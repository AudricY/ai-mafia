import type { GameEngine } from '../engine/gameEngine.js';
import type { NightActionIntent } from '../actions/types.js';
import { logger } from '../logger.js';

export async function collectTrackerActions(
  engine: GameEngine
): Promise<Array<Extract<NightActionIntent, { kind: 'track' }>>> {
  const alivePlayers = engine.getAlivePlayers();
  const aliveNames = alivePlayers.map(p => p.config.name);

  const trackers = alivePlayers.filter(p => p.role === 'tracker');
  const actions: Array<Extract<NightActionIntent, { kind: 'track' }>> = [];

  for (const tracker of trackers) {
    const validTargets = aliveNames.filter(n => n !== tracker.config.name);
    if (validTargets.length === 0) continue;

    const target = await engine.agentIO.decide(
      tracker.config.name,
      `Night ${engine.state.round}. You are the Tracker.
Alive players: ${aliveNames.join(', ')}.

Choose ONE player to track tonight.
Guidance (soft):
- Track players you suspect might be performing night actions (power roles, suspected mafia).
- You will learn who they visited (if anyone) - successful visits only.
- If the tracked player was blocked or did nothing, you'll see "no visit".`,
      validTargets
    );

    actions.push({ kind: 'track', actor: tracker.config.name, target });

    engine.agents[tracker.config.name]?.observePrivateEvent(`You chose to track ${target}.`);
    logger.log({
      type: 'ACTION',
      player: tracker.config.name,
      content: `chose to track ${target}`,
      metadata: { target, role: 'tracker', visibility: 'private' },
    });
  }

  return actions;
}
