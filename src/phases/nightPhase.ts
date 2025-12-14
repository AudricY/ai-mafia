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

    // Deliver tracker results (private)
    for (const track of resolved.trackerResults) {
      const resultText =
        track.visited === null
          ? `Tracking result (night ${engine.state.round}): ${track.target} did not visit anyone.`
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

    // Handle backup shooter for mafia kills
    // If the primary shooter was blocked, try to find another mafia member to perform the kill
    const mafiaKills = resolved.kills.filter(k => k.source === 'mafia');
    if (mafiaKills.length > 0) {
      const blockedKill = mafiaKills.find(k => k.blocked);
      if (blockedKill) {
        // Find another mafia member who is not blocked
        const mafiaTeam = engine
          .getAlivePlayers()
          .filter(
            p =>
              (p.role === 'mafia' ||
                p.role === 'godfather' ||
                p.role === 'mafia_roleblocker' ||
                p.role === 'framer' ||
                p.role === 'janitor' ||
                p.role === 'forger') &&
              p.config.name !== blockedKill.actor &&
              !resolved.blockedPlayers.has(p.config.name)
          );
        if (mafiaTeam.length > 0) {
          // Backup shooter performs the kill
          const backupShooter = mafiaTeam[0]!;
          const target = blockedKill.target;
          const wasSaved = resolved.savedPlayers.has(target);
          
          // Update the kill to use backup shooter
          const killIndex = resolved.kills.findIndex(
            k => k.actor === blockedKill.actor && k.target === blockedKill.target && k.source === 'mafia'
          );
          if (killIndex >= 0) {
            resolved.kills[killIndex] = {
              actor: backupShooter.config.name,
              target,
              source: 'mafia',
              blocked: false,
              saved: wasSaved,
            };
            
            // Update deaths if not saved
            if (!wasSaved && !resolved.deaths.has(target)) {
              resolved.deaths.add(target);
            }
            
            // Notify mafia team
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
                `Primary shooter ${blockedKill.actor} was blocked. Backup shooter ${backupShooter.config.name} performed the kill on ${target}.`
              );
            });
            logger.log({
              type: 'ACTION',
              player: backupShooter.config.name,
              content: `performed backup kill on ${target} (primary shooter ${blockedKill.actor} was blocked)`,
              metadata: { target, role: backupShooter.role, faction: 'mafia', visibility: 'faction' },
            });
          }
        }
      }
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
