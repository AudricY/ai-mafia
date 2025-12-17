import type { Role } from './types.js';

export type RoleTeam = 'town' | 'mafia' | 'neutral';

export interface RoleDefinition {
  role: Role;
  team: RoleTeam;
  summary: string;
  abilities: string[];
  notes?: string[];
}

export const ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  villager: {
    role: 'villager',
    team: 'town',
    summary: 'No night action. Win by eliminating all Mafia.',
    abilities: ['Discuss, vote, and reason during the day.'],
  },
  cop: {
    role: 'cop',
    team: 'town',
    summary: 'Investigates one player each night to learn MAFIA vs INNOCENT.',
    abilities: ['Night: investigate one living player (not yourself).'],
    notes: ['Godfather appears INNOCENT to investigations.'],
  },
  doctor: {
    role: 'doctor',
    team: 'town',
    summary: 'Protects one player each night from dying to night kills.',
    abilities: ['Night: choose one living player to save (can target yourself).'],
    notes: ['In this engine, saves can prevent Mafia kills and Vigilante shots.'],
  },
  vigilante: {
    role: 'vigilante',
    team: 'town',
    summary: 'May shoot a suspect at night (or hold fire).',
    abilities: ["Night: shoot one living player (not yourself), or choose 'nobody' to hold fire."],
  },
  roleblocker: {
    role: 'roleblocker',
    team: 'town',
    summary: "Blocks one player's night action, causing it to fail.",
    abilities: ['Night: choose one player to block (not yourself).'],
    notes: ['Blocking can prevent kills, investigations, and saves that night.'],
  },
  mafia: {
    role: 'mafia',
    team: 'mafia',
    summary: 'Works with Mafia team to eliminate the Town.',
    abilities: ['Night: coordinate with Mafia to choose a kill target (town-aligned players only).'],
    notes: ['If a Godfather exists, they are the default shooter.'],
  },
  godfather: {
    role: 'godfather',
    team: 'mafia',
    summary: 'Leads the Mafia kill and appears INNOCENT to the Cop.',
    abilities: ['Night: coordinate with Mafia and perform the kill action.'],
    notes: ['Investigation immunity: Cop sees INNOCENT.'],
  },
  tracker: {
    role: 'tracker',
    team: 'town',
    summary: 'Tracks one player each night to learn who they visited (if anyone).',
    abilities: ['Night: choose one living player to track (not yourself).'],
    notes: ['Sees only successful visits. If the tracked player was blocked or did nothing, result is "no visit".'],
  },
  jailkeeper: {
    role: 'jailkeeper',
    team: 'town',
    summary: 'Jails one player each night, protecting and blocking them.',
    abilities: ['Night: choose one living player to jail (not yourself).'],
    notes: ['Jailed players are both protected from kills and blocked from performing actions.'],
  },
  mason: {
    role: 'mason',
    team: 'town',
    summary: 'Knows the identity of other Mason(s) at game start.',
    abilities: ['No night action.'],
    notes: ['Masons know each other are town-aligned.'],
  },
  bomb: {
    role: 'bomb',
    team: 'town',
    summary: 'If killed at night, the killer also dies.',
    abilities: ['No night action.'],
    notes: ['Passive ability: retaliates against night killers.'],
  },
  mafia_roleblocker: {
    role: 'mafia_roleblocker',
    team: 'mafia',
    summary: 'Mafia member who can block one player each night.',
    abilities: ['Night: choose one player to block (not yourself).'],
    notes: ['Works with Mafia team. Blocking can prevent investigations, saves, and other night actions.'],
  },
  framer: {
    role: 'framer',
    team: 'mafia',
    summary: 'Frames one player each night to appear MAFIA to the Cop.',
    abilities: ['Night: choose one living player to frame (not yourself).'],
    notes: ['Framed players appear MAFIA to Cop investigations that night only.'],
  },
  janitor: {
    role: 'janitor',
    team: 'mafia',
    summary: 'Can hide the role reveal of a Mafia kill victim.',
    abilities: ['Night: choose to clean a Mafia kill (if one occurs).'],
    notes: ['If used, the victim\'s role is not revealed publicly (shows as "unknown").'],
  },
  forger: {
    role: 'forger',
    team: 'mafia',
    summary: 'Can forge a fake role reveal for a Mafia kill victim.',
    abilities: ['Night: choose a fake role to reveal if a Mafia kill occurs.'],
    notes: ['If used, the victim\'s role reveal shows the forged role instead of their real role.'],
  },
  jester: {
    role: 'jester',
    team: 'neutral',
    summary: 'Wins if eliminated by day vote. Game continues.',
    abilities: ['No night action.'],
    notes: ['If you are eliminated during the day voting phase, you win but the game continues.'],
  },
  executioner: {
    role: 'executioner',
    team: 'neutral',
    summary: 'Wins if your assigned target is eliminated by day vote. If target dies at night, you become Jester.',
    abilities: ['No night action.'],
    notes: ['You have a secret target assigned at game start. If your target is eliminated by day vote, you win (game continues). If your target dies at night, you become the Jester.'],
  },
};

export function formatRoleSetupForPrompt(roleCounts: Partial<Record<Role, number>>): string {
  const roles = Object.keys(roleCounts) as Role[];
  const selected = roles.filter(r => (roleCounts[r] ?? 0) > 0);
  const lines = selected
    .sort((a, b) => a.localeCompare(b))
    .map(r => {
      const def = ROLE_DEFINITIONS[r];
      const count = roleCounts[r] ?? 0;
      const countStr = count > 1 ? ` x${count}` : '';
      const parts: string[] = [`- ${r}${countStr}: ${def.summary}`];
      if (def.abilities.length) parts.push(`  Abilities: ${def.abilities.join(' ')}`);
      if (def.notes?.length) parts.push(`  Notes: ${def.notes.join(' ')}`);
      return parts.join('\n');
    });

  const neutralRoles = selected.filter(r => ROLE_DEFINITIONS[r]?.team === 'neutral');
  const neutralWinConditions: string[] = [];
  if (neutralRoles.includes('jester')) {
    neutralWinConditions.push('- Jester: get eliminated by day vote (co-win, game continues).');
  }
  if (neutralRoles.includes('executioner')) {
    neutralWinConditions.push('- Executioner: get your assigned target eliminated by day vote (co-win, game continues).');
  }

  return [
    'Role setup for this game (public knowledge):',
    ...lines,
    '',
    'Win conditions:',
    "- Town: eliminate all Mafia (mafia, godfather, mafia_roleblocker, framer, janitor, forger).",
    '- Mafia: equal or outnumber the Town.',
    ...(neutralWinConditions.length > 0 ? neutralWinConditions : []),
  ].join('\n');
}

export function formatRoleSetupForPublicLog(roleCounts: Partial<Record<Role, number>>): string {
  const roles = Object.keys(roleCounts) as Role[];
  const parts = roles
    .filter(r => (roleCounts[r] ?? 0) > 0)
    .sort((a, b) => a.localeCompare(b))
    .map(r => `${r}${(roleCounts[r] ?? 0) > 1 ? ` x${roleCounts[r]}` : ''}`);
  return parts.length ? parts.join(', ') : '(unknown)';
}

export function formatPossibleRolesForPrompt(
  roles: Role[],
  opts?: { includeAbilitiesAndNotes?: boolean }
): string {
  const includeDetails = opts?.includeAbilitiesAndNotes ?? true;
  const uniqueRoles = Array.from(new Set(roles)).sort((a, b) => a.localeCompare(b));
  const lines = uniqueRoles.map(r => {
    const def = ROLE_DEFINITIONS[r];
    if (!def) return `- ${r}: (unknown role)`;
    const parts: string[] = [`- ${r}: ${def.summary}`];
    if (includeDetails) {
      if (def.abilities.length) parts.push(`  Abilities: ${def.abilities.join(' ')}`);
      if (def.notes?.length) parts.push(`  Notes: ${def.notes.join(' ')}`);
    }
    return parts.join('\n');
  });

  const neutralRoles = uniqueRoles.filter(r => ROLE_DEFINITIONS[r]?.team === 'neutral');
  const neutralWinConditions: string[] = [];
  if (neutralRoles.includes('jester')) {
    neutralWinConditions.push('- Jester: get eliminated by day vote (co-win, game continues).');
  }
  if (neutralRoles.includes('executioner')) {
    neutralWinConditions.push('- Executioner: get your assigned target eliminated by day vote (co-win, game continues).');
  }

  return [
    'Possible roles in this match (not confirmed):',
    'Do not assume any specific role exists unless supported by public evidence.',
    ...lines,
    '',
    'Win conditions:',
    "- Town: eliminate all Mafia (mafia, godfather, mafia_roleblocker, framer, janitor, forger).",
    '- Mafia: equal or outnumber the Town.',
    ...(neutralWinConditions.length > 0 ? neutralWinConditions : []),
  ].join('\n');
}

export function formatPossibleRolesForPublicLog(roles: Role[]): string {
  const uniqueRoles = Array.from(new Set(roles)).sort((a, b) => a.localeCompare(b));
  return uniqueRoles.length ? uniqueRoles.join(', ') : '(unknown)';
}

