import type { GameEngine } from '../engine/gameEngine.js';
import type { NightActionIntent } from '../actions/types.js';

export async function collectCopActions(
  engine: GameEngine
): Promise<Array<Extract<NightActionIntent, { kind: 'investigate' }>>> {
  const alivePlayers = engine.getAlivePlayers();
  const aliveNames = alivePlayers.map(p => p.config.name);

  const cops = alivePlayers.filter(p => p.role === 'cop');
  const actions: Array<Extract<NightActionIntent, { kind: 'investigate' }>> = [];

  for (const cop of cops) {
    const validTargets = aliveNames.filter(n => n !== cop.config.name);
    if (validTargets.length === 0) continue;

    const systemAddendum = engine.getNight1AssignedRandomTargetSystemAddendum({
      actor: cop.config.name,
      decisionKind: 'investigate',
      candidateTargets: validTargets,
    });

    const target = await engine.agentIO.decide(
      cop.config.name,
      `Night ${engine.state.round}. You are the Cop.
Alive players: ${aliveNames.join(', ')}.

Choose ONE player to investigate tonight.
Guidance (soft):
- Prioritize players driving narratives, coordinating votes, or whose behavior feels strategically motivated.
- If town is stuck, investigate someone central to the discussion rather than a silent bystander.
- Note: If you are blocked, your investigation will not work. Also note that Framers can make players appear MAFIA.`,
      validTargets,
      [],
      systemAddendum ?? undefined
    );

    actions.push({ kind: 'investigate', actor: cop.config.name, target });
  }

  return actions;
}


