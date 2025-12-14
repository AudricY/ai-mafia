import type { GameEngine } from './engine/gameEngine.js';
import type { NightActionIntent } from './actions/types.js';
import { collectRoleblockerActions } from './roleModules/roleblocker.ts';
import { collectMafiaActions } from './roleModules/mafia.ts';
import { collectCopActions } from './roleModules/cop.ts';
import { collectDoctorActions } from './roleModules/doctor.ts';
import { collectVigilanteActions } from './roleModules/vigilante.ts';

export async function collectNightActions(engine: GameEngine): Promise<NightActionIntent[]> {
  const actions: NightActionIntent[] = [];

  // Ordering matches the existing game logic: roleblock -> mafia -> cop -> doctor -> vigilante.
  const blocks = await collectRoleblockerActions(engine);
  actions.push(...blocks);

  const blockedPlayers = new Set(blocks.map(b => b.target));

  actions.push(...(await collectMafiaActions(engine, blockedPlayers)));
  actions.push(...(await collectCopActions(engine, blockedPlayers)));
  actions.push(...(await collectDoctorActions(engine, blockedPlayers)));
  actions.push(...(await collectVigilanteActions(engine, blockedPlayers)));

  return actions;
}

