import type { GameEngine } from './engine/gameEngine.js';
import type { NightActionIntent } from './actions/types.js';
import { collectRoleblockerActions } from './roleModules/roleblocker.ts';
import { collectJailkeeperActions } from './roleModules/jailkeeper.ts';
import { collectCopActions } from './roleModules/cop.ts';
import { collectDoctorActions } from './roleModules/doctor.ts';
import { collectVigilanteActions } from './roleModules/vigilante.ts';
import { collectTrackerActions } from './roleModules/tracker.ts';
import { collectMafiaCouncilIntents } from './roleModules/mafiaCouncil.ts';

/**
 * Collects all night actions concurrently (town roles decide while mafia planning runs),
 * then merges them in canonical deterministic order.
 */
export async function collectNightActions(engine: GameEngine): Promise<NightActionIntent[]> {
  // Run town collectors and mafia council concurrently
  const [
    jails,
    blocks,
    copActions,
    doctorActions,
    vigilanteActions,
    trackerActions,
    mafiaIntents,
  ] = await Promise.all([
    collectJailkeeperActions(engine),
    collectRoleblockerActions(engine),
    collectCopActions(engine),
    collectDoctorActions(engine),
    collectVigilanteActions(engine),
    collectTrackerActions(engine),
    collectMafiaCouncilIntents(engine),
  ]);

  // Merge in canonical order (same as before, but now deterministic regardless of async completion)
  // Ordering: blocks/jails first (they affect other actions), then mafia actions, then town actions
  // Priority order: jailkeeper > roleblocker > mafia_roleblocker (handled in resolver)
  const actions: NightActionIntent[] = [];

  // Jails first (highest priority blocks)
  actions.push(...jails);

  // Town roleblocker blocks
  actions.push(...blocks);

  // Mafia intents (includes kill, mafia_roleblocker blocks, frame, clean, forge)
  // Within mafia intents, we maintain order: kill, block, frame, clean, forge
  // (mafiaCouncil already emits them in this order)
  actions.push(...mafiaIntents);

  // Town actions (investigate, save, kill, track)
  actions.push(...copActions);
  actions.push(...doctorActions);
  actions.push(...vigilanteActions);
  actions.push(...trackerActions);

  return actions;
}






