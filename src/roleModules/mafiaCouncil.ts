import { z } from 'zod';
import type { GameEngine } from '../engine/gameEngine.js';
import type { NightActionIntent } from '../actions/types.js';
import type { Role } from '../types.js';
import { logger } from '../logger.js';
import { runMafiaDiscussion } from './mafia.ts';

// Valid roles for forging (all non-mafia roles)
const VALID_FORGE_ROLES: Role[] = [
  'villager',
  'cop',
  'doctor',
  'vigilante',
  'roleblocker',
  'tracker',
  'jailkeeper',
  'mason',
  'bomb',
];

// Zod schema for the mafia night plan JSON
const MafiaNightPlanSchema = z.object({
  killTarget: z.string(),
  blockTarget: z.string().optional(),
  frameTarget: z.string().optional(),
  cleanTarget: z.string().optional(),
  forgeTarget: z.string().optional(),
  fakeRole: z.enum([
    'villager',
    'cop',
    'doctor',
    'vigilante',
    'roleblocker',
    'tracker',
    'jailkeeper',
    'mason',
    'bomb',
  ] as const).optional(),
});

type MafiaNightPlan = z.infer<typeof MafiaNightPlanSchema>;

function isMafiaRole(role: Role): boolean {
  return (
    role === 'mafia' ||
    role === 'godfather' ||
    role === 'mafia_roleblocker' ||
    role === 'framer' ||
    role === 'janitor' ||
    role === 'forger'
  );
}

function getMafiaTeam(engine: GameEngine) {
  const alivePlayers = engine.getAlivePlayers();
  return alivePlayers.filter(p => isMafiaRole(p.role));
}

function chooseLeader(mafiaTeam: ReturnType<typeof getMafiaTeam>) {
  // Priority: godfather > mafia > first team member
  return (
    mafiaTeam.find(p => p.role === 'godfather') ||
    mafiaTeam.find(p => p.role === 'mafia') ||
    mafiaTeam[0]
  );
}

function getValidKillTargets(engine: GameEngine): string[] {
  const aliveNames = engine.getAlivePlayers().map(p => p.config.name);
  return aliveNames.filter(n => {
    const role = engine.state.players[n]?.role;
    return !isMafiaRole(role);
  });
}

function getValidNonMafiaTargets(engine: GameEngine): string[] {
  const aliveNames = engine.getAlivePlayers().map(p => p.config.name);
  return aliveNames.filter(n => {
    const role = engine.state.players[n]?.role;
    return role !== 'mafia' && role !== 'godfather' && role !== 'mafia_roleblocker';
  });
}

function parseLeaderPlan(rawText: string): MafiaNightPlan | null {
  try {
    // Try to extract JSON from the response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    
    const parsed = JSON.parse(jsonMatch[0]);
    const validated = MafiaNightPlanSchema.parse(parsed);
    return validated;
  } catch (error) {
    logger.log({
      type: 'SYSTEM',
      content: `Failed to parse mafia leader plan: ${String(error)}`,
      metadata: { error, rawText: rawText.substring(0, 200) },
    });
    return null;
  }
}

export async function collectMafiaCouncilIntents(engine: GameEngine): Promise<NightActionIntent[]> {
  const mafiaTeam = getMafiaTeam(engine);
  if (mafiaTeam.length === 0) return [];

  const aliveNames = engine.getAlivePlayers().map(p => p.config.name);
  const validKillTargets = getValidKillTargets(engine);
  const validNonMafiaTargets = getValidNonMafiaTargets(engine);

  if (validKillTargets.length === 0) return [];

  // Step 1: Run mafia discussion once
  await runMafiaDiscussion(engine, mafiaTeam, aliveNames, {
    systemLogContent: 'Mafia team is discussing night strategy...',
    goal: 'Discuss all night actions: who to kill, who to block (if you have a roleblocker), who to frame (if you have a framer), who to clean (if you have a janitor), and who to forge (if you have a forger). Coordinate with your team.',
    rounds: mafiaTeam.length >= 3 ? 2 : 1,
  });

  // Step 2: Choose leader and get JSON plan
  const leader = chooseLeader(mafiaTeam);
  if (!leader) return [];

  // Build context for leader to generate plan
  const hasRoleblocker = mafiaTeam.some(p => p.role === 'mafia_roleblocker');
  const hasFramer = mafiaTeam.some(p => p.role === 'framer');
  const hasJanitor = mafiaTeam.some(p => p.role === 'janitor');
  const hasForger = mafiaTeam.some(p => p.role === 'forger');

  const planContext = `Night ${engine.state.round}. You are leading the Mafia team's night actions.

Alive players: ${aliveNames.join(', ')}.
Valid kill targets: ${validKillTargets.join(', ')}.
Valid non-mafia targets (for block/frame/clean/forge): ${validNonMafiaTargets.join(', ')}.

Your team has:
${hasRoleblocker ? '- Mafia Roleblocker (can block one player)' : ''}
${hasFramer ? '- Framer (can frame one player to appear MAFIA to Cop)' : ''}
${hasJanitor ? '- Janitor (can clean one kill to hide role reveal)' : ''}
${hasForger ? '- Forger (can forge one kill with a fake role)' : ''}

Output a JSON object with this exact structure:
{
  "killTarget": "player_name",
  "blockTarget": "player_name" (optional, only if you have a roleblocker),
  "frameTarget": "player_name" (optional, only if you have a framer),
  "cleanTarget": "player_name" (optional, only if you have a janitor),
  "forgeTarget": "player_name" (optional, only if you have a forger),
  "fakeRole": "villager" (optional, required if forgeTarget is set; must be one of: ${VALID_FORGE_ROLES.join(', ')})
}

Important:
- killTarget is REQUIRED and must be a valid kill target.
- Only include optional fields if your team has that role.
- If forgeTarget is set, fakeRole is REQUIRED.
- All targets must be valid non-mafia players (except killTarget can be any non-mafia).`;

  const rawPlan = await engine.agentIO.respond(leader.config.name, planContext, []);
  const plan = parseLeaderPlan(rawPlan);

  if (!plan) {
    // Fallback: just do a kill with the leader as shooter
    logger.log({
      type: 'SYSTEM',
      content: `Mafia leader plan parsing failed, falling back to simple kill decision`,
      metadata: { leader: leader.config.name, visibility: 'faction' },
    });

    const fallbackTarget = await engine.agentIO.decide(
      leader.config.name,
      `Night ${engine.state.round}. You are leading the Mafia kill. Choose a target.
Note: If you are blocked, the Mafia kill fails.`,
      validKillTargets
    );

    mafiaTeam.forEach(m => {
      engine.agents[m.config.name]?.observeFactionEvent(
        `Our team (via ${leader.config.name}) chose to kill ${fallbackTarget}.`
      );
    });

    logger.log({
      type: 'ACTION',
      player: leader.config.name,
      content: `chose to kill ${fallbackTarget}`,
      metadata: { target: fallbackTarget, role: leader.role, faction: 'mafia', visibility: 'faction' },
    });

    return [{ kind: 'kill', actor: leader.config.name, target: fallbackTarget, source: 'mafia' }];
  }

  // Validate plan targets
  const validatedPlan: MafiaNightPlan = {
    killTarget: validKillTargets.includes(plan.killTarget) ? plan.killTarget : validKillTargets[0]!,
    blockTarget: plan.blockTarget && validNonMafiaTargets.includes(plan.blockTarget) ? plan.blockTarget : undefined,
    frameTarget: plan.frameTarget && validNonMafiaTargets.includes(plan.frameTarget) ? plan.frameTarget : undefined,
    cleanTarget: plan.cleanTarget && validNonMafiaTargets.includes(plan.cleanTarget) ? plan.cleanTarget : undefined,
    forgeTarget: plan.forgeTarget && validNonMafiaTargets.includes(plan.forgeTarget) ? plan.forgeTarget : undefined,
    fakeRole: plan.forgeTarget && VALID_FORGE_ROLES.includes(plan.fakeRole!) ? plan.fakeRole : undefined,
  };

  // Log the plan (faction visibility)
  logger.log({
    type: 'ACTION',
    player: leader.config.name,
    content: `mafia night plan: kill=${validatedPlan.killTarget}${validatedPlan.blockTarget ? `, block=${validatedPlan.blockTarget}` : ''}${validatedPlan.frameTarget ? `, frame=${validatedPlan.frameTarget}` : ''}${validatedPlan.cleanTarget ? `, clean=${validatedPlan.cleanTarget}` : ''}${validatedPlan.forgeTarget ? `, forge=${validatedPlan.forgeTarget} as ${validatedPlan.fakeRole}` : ''}`,
    metadata: { plan: validatedPlan, role: leader.role, faction: 'mafia', visibility: 'faction' },
  });

  // Step 3: Convert plan to intents
  const intents: NightActionIntent[] = [];

  // Kill intent (from chosen shooter)
  const shooter = mafiaTeam.find(p => p.role === 'godfather') ||
    mafiaTeam.find(p => p.role === 'mafia') ||
    mafiaTeam[0]!;
  
  intents.push({
    kind: 'kill',
    actor: shooter.config.name,
    target: validatedPlan.killTarget,
    source: 'mafia',
  });

  mafiaTeam.forEach(m => {
    engine.agents[m.config.name]?.observeFactionEvent(
      `Our team (via ${shooter.config.name}) chose to kill ${validatedPlan.killTarget}.`
    );
  });

  logger.log({
    type: 'ACTION',
    player: shooter.config.name,
    content: `chose to kill ${validatedPlan.killTarget}`,
    metadata: { target: validatedPlan.killTarget, role: shooter.role, faction: 'mafia', visibility: 'faction' },
  });

  // Block intents (one per mafia roleblocker)
  if (validatedPlan.blockTarget) {
    const roleblockers = mafiaTeam.filter(p => p.role === 'mafia_roleblocker');
    for (const rb of roleblockers) {
      intents.push({
        kind: 'block',
        actor: rb.config.name,
        target: validatedPlan.blockTarget!,
      });

      mafiaTeam.forEach(m => {
        engine.agents[m.config.name]?.observeFactionEvent(
          `Our roleblocker (${rb.config.name}) chose to block ${validatedPlan.blockTarget}.`
        );
      });

      logger.log({
        type: 'ACTION',
        player: rb.config.name,
        content: `chose to block ${validatedPlan.blockTarget}`,
        metadata: { target: validatedPlan.blockTarget, role: 'mafia_roleblocker', faction: 'mafia', visibility: 'faction' },
      });
    }
  }

  // Frame intents (one per framer)
  if (validatedPlan.frameTarget) {
    const framers = mafiaTeam.filter(p => p.role === 'framer');
    for (const framer of framers) {
      intents.push({
        kind: 'frame',
        actor: framer.config.name,
        target: validatedPlan.frameTarget!,
      });

      mafiaTeam.forEach(m => {
        engine.agents[m.config.name]?.observeFactionEvent(
          `Our framer (${framer.config.name}) chose to frame ${validatedPlan.frameTarget}.`
        );
      });

      logger.log({
        type: 'ACTION',
        player: framer.config.name,
        content: `chose to frame ${validatedPlan.frameTarget}`,
        metadata: { target: validatedPlan.frameTarget, role: 'framer', faction: 'mafia', visibility: 'faction' },
      });
    }
  }

  // Clean intents (one per janitor)
  if (validatedPlan.cleanTarget) {
    const janitors = mafiaTeam.filter(p => p.role === 'janitor');
    for (const janitor of janitors) {
      intents.push({
        kind: 'clean',
        actor: janitor.config.name,
        target: validatedPlan.cleanTarget!,
      });

      mafiaTeam.forEach(m => {
        engine.agents[m.config.name]?.observeFactionEvent(
          `Our janitor (${janitor.config.name}) chose to clean ${validatedPlan.cleanTarget} if killed.`
        );
      });

      logger.log({
        type: 'ACTION',
        player: janitor.config.name,
        content: `chose to clean ${validatedPlan.cleanTarget} if killed`,
        metadata: { target: validatedPlan.cleanTarget, role: 'janitor', faction: 'mafia', visibility: 'faction' },
      });
    }
  }

  // Forge intents (one per forger)
  if (validatedPlan.forgeTarget && validatedPlan.fakeRole) {
    const forgers = mafiaTeam.filter(p => p.role === 'forger');
    for (const forger of forgers) {
      intents.push({
        kind: 'forge',
        actor: forger.config.name,
        target: validatedPlan.forgeTarget!,
        fakeRole: validatedPlan.fakeRole!,
      });

      mafiaTeam.forEach(m => {
        engine.agents[m.config.name]?.observeFactionEvent(
          `Our forger (${forger.config.name}) chose to forge ${validatedPlan.forgeTarget} as ${validatedPlan.fakeRole} if killed.`
        );
      });

      logger.log({
        type: 'ACTION',
        player: forger.config.name,
        content: `chose to forge ${validatedPlan.forgeTarget} as ${validatedPlan.fakeRole} if killed`,
        metadata: { target: validatedPlan.forgeTarget, fakeRole: validatedPlan.fakeRole, role: 'forger', faction: 'mafia', visibility: 'faction' },
      });
    }
  }

  return intents;
}

