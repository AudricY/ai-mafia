import type { GameEngine } from '../engine/gameEngine.js';
import type { NightActionIntent } from '../actions/types.js';
import { logger } from '../logger.js';

export async function collectJailkeeperActions(
  engine: GameEngine
): Promise<Array<Extract<NightActionIntent, { kind: 'jail' }>>> {
  const alivePlayers = engine.getAlivePlayers();
  const aliveNames = alivePlayers.map(p => p.config.name);

  const jailkeepers = alivePlayers.filter(p => p.role === 'jailkeeper');
  const actions: Array<Extract<NightActionIntent, { kind: 'jail' }>> = [];

  for (const jk of jailkeepers) {
    const validTargets = aliveNames.filter(n => n !== jk.config.name);
    if (validTargets.length === 0) continue;

    const target = await engine.agentIO.decide(
      jk.config.name,
      `Night ${engine.state.round}. You are the Jailkeeper.
Alive players: ${aliveNames.join(', ')}.

Choose ONE player to jail tonight.
Guidance (soft):
- Jailing protects AND blocks the target (they cannot act and cannot be killed).
- Use on players you want to protect (likely town power roles) or suspect (to prevent mafia actions).
- Be strategic - jailing prevents both actions and kills.`,
      validTargets
    );

    actions.push({ kind: 'jail', actor: jk.config.name, target });

    engine.agents[jk.config.name]?.observePrivateEvent(`You chose to jail ${target}.`);
    logger.log({
      type: 'ACTION',
      player: jk.config.name,
      content: `chose to jail ${target}`,
      metadata: { target, role: 'jailkeeper', visibility: 'private' },
    });
  }

  return actions;
}
