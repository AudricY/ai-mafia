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
          ? `Tracking result (night ${engine.state.round}): You successfully tracked ${track.target}. You saw them visit NO ONE (they either stayed home or their action was blocked).`
          : `Tracking result (night ${engine.state.round}): You successfully tracked ${track.target}. You saw them visit ${track.visited}.`;
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
          message = `You were blocked and could not track anyone! You gathered NO INFORMATION tonight.`;
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

    // Note: Mafia backup-shooter behavior is intentionally NOT supported.
    // If the Mafia killer is blocked, the kill fails.

    // Publicly announce saved kill attempts.
    for (const k of resolved.kills) {
      if (k.blocked) continue;
      if (!k.saved) continue;

      if (k.source === 'mafia') {
        engine.recordPublic({
          type: 'SYSTEM',
          content: `Mafia tried to kill ${k.target}, but they were saved!`,
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

        // If janitor successfully cleaned this victim, notify janitor and mafia team of actual role
        if (override && override.revealedRole === null) {
          // This was cleaned by janitor (null = unknown to public)
          const cleanAction = actions.find(
            a => a.kind === 'clean' && a.target === player && !resolved.blockedPlayers.has(a.actor)
          );
          if (cleanAction) {
            const actualRole = rolesByPlayer[player];
            const janitorName = cleanAction.actor;
            
            // Notify janitor privately
            engine.agents[janitorName]?.observePrivateEvent(
              `You successfully cleaned ${player}'s body. Their actual role was ${actualRole}.`
            );
            
            // Notify mafia team via faction event
            const alivePlayers = engine.getAlivePlayers();
            const mafiaTeam = alivePlayers.filter(
              p =>
                p.role === 'mafia' ||
                p.role === 'godfather' ||
                p.role === 'mafia_roleblocker' ||
                p.role === 'framer' ||
                p.role === 'janitor' ||
                p.role === 'forger'
            );
            mafiaTeam.forEach(m => {
              engine.agents[m.config.name]?.observeFactionEvent(
                `Our janitor (${janitorName}) successfully cleaned ${player}'s body. Their actual role was ${actualRole}.`
              );
            });
            
            logger.log({
              type: 'ACTION',
              player: janitorName,
              content: `learned that ${player}'s actual role was ${actualRole} while cleaning`,
              metadata: { target: player, actualRole, role: 'janitor', faction: 'mafia', visibility: 'faction' },
            });
          }
        }

        engine.killPlayer(player, revealedRole);
        engine.recordPublic({ type: 'SYSTEM', content: `${player} died during the night.` });
      }
      
      // Check for Executioner→Jester conversion
      if (engine.state.executionerTargetByPlayer) {
        for (const [exeName, targetName] of Object.entries(engine.state.executionerTargetByPlayer)) {
          if (resolved.deaths.has(targetName)) {
            const exePlayer = engine.state.players[exeName];
            if (exePlayer && exePlayer.isAlive && exePlayer.role === 'executioner') {
              // Convert Executioner to Jester
              engine.state.players[exeName]!.role = 'jester';
              engine.agents[exeName]?.setRole('jester');
              logger.setPlayerRole(exeName, 'jester');
              engine.agents[exeName]?.observePrivateEvent(
                `Your target ${targetName} died at night. You are now the Jester. Your new goal is to get eliminated by day vote.`
              );
              logger.log({
                type: 'SYSTEM',
                content: `Executioner ${exeName} converted to Jester (target ${targetName} died at night)`,
                metadata: { role: 'jester', player: exeName, visibility: 'private' },
              });
              // Remove the target from the mapping
              delete engine.state.executionerTargetByPlayer[exeName];
            }
          }
        }
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


