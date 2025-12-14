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

    const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: engine.getAliveNames() });

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

    // Deliver tracker results (private)
    for (const track of resolved.trackerResults) {
      const resultText =
        track.visited === null
          ? `Tracking result (night ${engine.state.round}): ${track.target} did not make a successful visit (they may have stayed home or been blocked).`
          : `Tracking result (night ${engine.state.round}): ${track.target} visited ${track.visited}.`;
      engine.agents[track.actor]?.observePrivateEvent(resultText);
      logger.log({
        type: 'ACTION',
        player: track.actor,
        content: `tracked ${track.target} and found ${track.visited === null ? 'no visit' : `visit to ${track.visited}`}`,
        metadata: { target: track.target, visited: track.visited, role: 'tracker', visibility: 'private' },
      });
    }

    // Deliver "action was blocked" messages (private)
    for (const action of actions) {
      if (resolved.blockedPlayers.has(action.actor)) {
        let message = '';
        if (action.kind === 'investigate') {
          message = `You were blocked and could not investigate!`;
        } else if (action.kind === 'save') {
          message = `You were blocked and could not save anyone!`;
        } else if (action.kind === 'kill') {
          message = `You were blocked and could not perform the kill!`;
        } else if (action.kind === 'block') {
          message = `You were blocked and could not block anyone!`;
        } else if (action.kind === 'jail') {
          message = `You were blocked and could not jail anyone!`;
        } else if (action.kind === 'frame') {
          message = `You were blocked and could not frame anyone!`;
        } else if (action.kind === 'track') {
          message = `You were blocked and could not track anyone!`;
        } else if (action.kind === 'clean') {
          message = `You were blocked and could not clean!`;
        } else if (action.kind === 'forge') {
          message = `You were blocked and could not forge!`;
        }
        if (message) {
          engine.agents[action.actor]?.observePrivateEvent(message);
        }
      }
    }

    // If the mafia kill was performed by a different actor than the original kill leader,
    // notify the mafia faction (for transparency).
    const mafiaKillIntents = actions.filter(
      a => a.kind === 'kill' && a.source === 'mafia'
    );
    for (const intent of mafiaKillIntents) {
      const resolvedKill = resolved.kills.find(
        k => k.source === 'mafia' && k.target === intent.target
      );
      if (!resolvedKill) continue;
      if (resolvedKill.blocked) continue;
      if (resolvedKill.actor === intent.actor) continue;

      const allMafia = engine
        .getAlivePlayers()
        .filter(
          p =>
            p.role === 'mafia' ||
            p.role === 'godfather' ||
            p.role === 'mafia_roleblocker' ||
            p.role === 'framer' ||
            p.role === 'janitor' ||
            p.role === 'forger'
        );
      allMafia.forEach(m => {
        engine.agents[m.config.name]?.observeFactionEvent(
          `Primary shooter ${intent.actor} was blocked. Backup shooter ${resolvedKill.actor} performed the kill on ${resolvedKill.target}.`
        );
      });
      logger.log({
        type: 'ACTION',
        player: resolvedKill.actor,
        content: `performed backup kill on ${resolvedKill.target} (primary shooter ${intent.actor} was blocked)`,
        metadata: { target: resolvedKill.target, role: engine.state.players[resolvedKill.actor]?.role, faction: 'mafia', visibility: 'faction' },
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
        // Check for death reveal override
        const override = resolved.deathRevealOverrides.find(o => o.player === player);
        const revealedRole = override ? override.revealedRole : undefined;

        engine.killPlayer(player, revealedRole);
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
