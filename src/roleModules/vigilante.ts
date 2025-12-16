import type { GameEngine } from '../engine/gameEngine.js';
import type { NightActionIntent } from '../actions/types.js';
import { logger } from '../logger.js';

export async function collectVigilanteActions(
  engine: GameEngine
): Promise<Array<Extract<NightActionIntent, { kind: 'kill'; source: 'vigilante' }>>> {
  const alivePlayers = engine.getAlivePlayers();
  const aliveNames = alivePlayers.map(p => p.config.name);

  const vigilantes = alivePlayers.filter(p => p.role === 'vigilante');
  const actions: Array<Extract<NightActionIntent, { kind: 'kill'; source: 'vigilante' }>> = [];

  for (const vigi of vigilantes) {
    const validTargets = aliveNames.filter(n => n !== vigi.config.name);
    if (validTargets.length === 0) continue;

    const options = [...validTargets, 'nobody'];

    const decision = await engine.agentIO.decide(
      vigi.config.name,
      `Night ${engine.state.round}. You are the Vigilante.
Alive players: ${aliveNames.join(', ')}.

Choose ONE player to shoot, or 'nobody' to hold fire.
Guidance (soft):
- Avoid random shots early; shoot when you have a concrete suspect or town is stalling with repeated skips.
- Prefer targets supported by multiple concrete red flags (vote positioning, contradictions, narrative steering).
- If you're uncertain, 'nobody' is acceptable.
- Note: If you are blocked, you will receive an explicit message saying "You were blocked and could not perform the kill!".
- If you do NOT receive a "blocked" message, your shot was fired. If the target doesn't die, they were likely protected (e.g. by a Doctor) or immune. Do not confuse "target didn't die" with "I was blocked".`,
      options,
      [],
      undefined
    );

    if (decision === 'nobody') continue;

    actions.push({ kind: 'kill', actor: vigi.config.name, target: decision, source: 'vigilante' });

    engine.agents[vigi.config.name]?.observePrivateEvent(`You chose to shoot ${decision}.`);
    logger.log({
      type: 'ACTION',
      player: vigi.config.name,
      content: `chose to shoot ${decision}`,
      metadata: { target: decision, role: 'vigilante', visibility: 'private' },
    });
  }

  return actions;
}


