import type { GameEngine } from '../engine/gameEngine.js';
import type { NightActionIntent } from '../actions/types.js';
import { logger } from '../logger.js';

export async function collectRoleblockerActions(engine: GameEngine): Promise<Array<Extract<NightActionIntent, { kind: 'block' }>>> {
  const alivePlayers = engine.getAlivePlayers();
  const aliveNames = alivePlayers.map(p => p.config.name);

  const actions: Array<Extract<NightActionIntent, { kind: 'block' }>> = [];
  const roleblockers = alivePlayers.filter(p => p.role === 'roleblocker');

  for (const rb of roleblockers) {
    const validTargets = aliveNames.filter(n => n !== rb.config.name);
    if (validTargets.length === 0) continue;

    const systemAddendum = engine.getNight1AssignedRandomTargetSystemAddendum({
      actor: rb.config.name,
      decisionKind: 'block',
      candidateTargets: validTargets,
    });

    const target = await engine.agentIO.decide(
      rb.config.name,
      `Night ${engine.state.round}. You are the Roleblocker.
Alive players: ${aliveNames.join(', ')}.

Choose ONE player to block from performing an action tonight.
Guidance (soft):
- Prefer blocking someone you suspect is mafia or someone whose night action would be dangerous if they are mafia.
- If you block the Mafia's chosen killer, the Mafia kill fails.
- Use public behavior (pushy framing, coordinated narratives, strange vote positioning) to pick a target.
- Avoid purely random blocks unless you have no read.
- Note: If YOU are blocked, you will receive an explicit message saying "You were blocked and could not block anyone!".
- If you do NOT receive a "blocked" message, your block attempt went through. You will not receive a confirmation message of success, but you can assume you performed your action.`,
      validTargets,
      [],
      systemAddendum ?? undefined
    );

    actions.push({ kind: 'block', actor: rb.config.name, target });

    engine.agents[rb.config.name]?.observePrivateEvent(`You chose to block ${target}.`);
    logger.log({
      type: 'ACTION',
      player: rb.config.name,
      content: `blocked ${target}`,
      metadata: { target, role: 'roleblocker', visibility: 'private' },
    });
  }

  return actions;
}


