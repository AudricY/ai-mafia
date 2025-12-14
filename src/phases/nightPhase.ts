import type { GameEngine } from '../engine/gameEngine.js';
import { logger } from '../logger.js';
import { collectNightActions } from '../roleRegistry.js';
import { resolveNightActions } from '../actions/resolver.js';

export class NightPhase {
  async run(engine: GameEngine): Promise<void> {
    engine.recordPublic({ type: 'SYSTEM', content: `--- Night ${engine.state.round} ---` });

    const actionsRaw = await collectNightActions(engine);
    const alive = new Set(engine.getAliveNames());
    const actions = actionsRaw.filter(a => {
      if (!alive.has(a.actor)) return false;
      // All current night actions target a living player; ignore any stale targets.
      if ('target' in a && typeof a.target === 'string' && !alive.has(a.target)) return false;
      return true;
    });

    const rolesByPlayer = Object.fromEntries(
      Object.entries(engine.state.players).map(([name, ps]) => [name, ps.role])
    );

    const resolved = resolveNightActions({ actions, rolesByPlayer });

    // Deliver investigation results (private)
    for (const inv of resolved.investigations) {
      engine.agents[inv.actor]?.observePrivateEvent(
        `Investigation result (night ${engine.state.round}): ${inv.target} is ${inv.result}.`
      );
      logger.log({
        type: 'ACTION',
        player: inv.actor,
        content: `investigated ${inv.target} and found ${inv.result}`,
        metadata: { target: inv.target, result: inv.result, role: 'cop', visibility: 'private' },
      });
    }

    // Publicly announce saved kill attempts.
    for (const k of resolved.kills) {
      if (k.blocked) continue;
      if (!k.saved) continue;

      if (k.source === 'mafia') {
        engine.recordPublic({
          type: 'SYSTEM',
          content: `Mafia tried to kill ${k.target}, but they were saved by the Doctor!`,
        });
      } else {
        engine.recordPublic({
          type: 'SYSTEM',
          content: `Vigilante tried to shoot ${k.target}, but they were saved!`,
        });
      }
    }

    if (resolved.deaths.size > 0) {
      engine.lastNightDeaths = [...resolved.deaths];
      for (const player of resolved.deaths) {
        engine.killPlayer(player);
        engine.recordPublic({ type: 'SYSTEM', content: `${player} died during the night.` });
      }
      return;
    }

    engine.lastNightDeaths = [];

    // If there were no kill attempts at all, we keep the old "peaceful night" message.
    if (resolved.kills.length === 0) {
      engine.recordPublic({ type: 'SYSTEM', content: 'Peaceful night. No attempts were made.' });
    }
  }
}
