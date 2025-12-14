import type { Role } from './types.js';

export type RoleTeam = 'town' | 'mafia';

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

  return [
    'Role setup for this game (public knowledge):',
    ...lines,
    '',
    'Win conditions:',
    "- Town: eliminate all Mafia (mafia + godfather).",
    '- Mafia: equal or outnumber the Town.',
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
