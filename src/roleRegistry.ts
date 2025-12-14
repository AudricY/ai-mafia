import type { GameEngine } from './engine/gameEngine.js';
import type { NightActionIntent } from './actions/types.js';
import { collectRoleblockerActions } from './roleModules/roleblocker.ts';
import { collectJailkeeperActions } from './roleModules/jailkeeper.ts';
import { collectMafiaRoleblockerActions } from './roleModules/mafiaRoleblocker.ts';
import { collectMafiaActions } from './roleModules/mafia.ts';
import { collectCopActions } from './roleModules/cop.ts';
import { collectDoctorActions } from './roleModules/doctor.ts';
import { collectVigilanteActions } from './roleModules/vigilante.ts';
import { collectTrackerActions } from './roleModules/tracker.ts';
import { collectFramerActions } from './roleModules/framer.ts';
import { collectJanitorActions } from './roleModules/janitor.ts';
import { collectForgerActions } from './roleModules/forger.ts';

export async function collectNightActions(engine: GameEngine): Promise<NightActionIntent[]> {
  const actions: NightActionIntent[] = [];

  // Ordering: blocks/jails first (they affect other actions), then other actions
  // Priority order: jailkeeper > roleblocker > mafia_roleblocker (handled in resolver)
  const jails = await collectJailkeeperActions(engine);
  actions.push(...jails);

  const blocks = await collectRoleblockerActions(engine);
  actions.push(...blocks);

  const mafiaBlocks = await collectMafiaRoleblockerActions(engine);
  actions.push(...mafiaBlocks);

  // Mafia actions (kill, frame, janitor, forger)
  actions.push(...(await collectMafiaActions(engine)));
  actions.push(...(await collectFramerActions(engine)));
  actions.push(...(await collectJanitorActions(engine)));
  actions.push(...(await collectForgerActions(engine)));

  // Town actions
  actions.push(...(await collectCopActions(engine)));
  actions.push(...(await collectDoctorActions(engine)));
  actions.push(...(await collectVigilanteActions(engine)));
  actions.push(...(await collectTrackerActions(engine)));

  return actions;
}

