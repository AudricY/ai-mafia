import type { GameEngine } from '../engine/gameEngine.js';
import type { NightActionIntent } from '../actions/types.js';
import { logger } from '../logger.js';

export async function collectDoctorActions(
  engine: GameEngine
): Promise<Array<Extract<NightActionIntent, { kind: 'save' }>>> {
  const alivePlayers = engine.getAlivePlayers();
  const aliveNames = alivePlayers.map(p => p.config.name);

  const doctors = alivePlayers.filter(p => p.role === 'doctor');
  const actions: Array<Extract<NightActionIntent, { kind: 'save' }>> = [];

  for (const doc of doctors) {
    const systemAddendum = engine.getNight1AssignedRandomTargetSystemAddendum({
      actor: doc.config.name,
      decisionKind: 'save',
      candidateTargets: aliveNames,
    });

    const target = await engine.agentIO.decide(
      doc.config.name,
      `Night ${engine.state.round}. You are the Doctor.
Alive players: ${aliveNames.join(', ')}.

Choose ONE player to save tonight.
Guidance (soft):
- Protect the player most likely to be killed (often a strong town voice or an obvious power-role candidate).
- Repeated self-protect is usually low value unless you expect to be attacked or you are broadly suspected.
- If you have no strong read, rotate protection to avoid being predictable.
- Note: If you are blocked, you will receive an explicit message saying "You were blocked and could not save anyone!".
- If you do NOT receive a "blocked" message, your save was successful (even if the target wasn't attacked and you get no other feedback). Assume your action went through unless told otherwise.`,
      aliveNames,
      [],
      systemAddendum ?? undefined
    );

    actions.push({ kind: 'save', actor: doc.config.name, target });

    engine.agents[doc.config.name]?.observePrivateEvent(`You chose to save ${target}.`);
    logger.log({
      type: 'ACTION',
      player: doc.config.name,
      content: `chose to save ${target}`,
      metadata: { target, role: 'doctor', visibility: 'private' },
    });
  }

  return actions;
}


