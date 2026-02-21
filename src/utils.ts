import type { Role } from './types.js';

const MAFIA_ROLES: ReadonlySet<Role> = new Set<Role>([
  'mafia',
  'godfather',
  'mafia_roleblocker',
  'framer',
  'janitor',
  'forger',
]);

export function isMafiaRole(role: Role | undefined): boolean {
  return role !== undefined && MAFIA_ROLES.has(role);
}

export function isDryRun(): boolean {
  const v = (process.env.AI_MAFIA_DRY_RUN ?? process.env.DRY_RUN ?? '').toLowerCase().trim();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function dryRunSeed(): number {
  const raw = process.env.AI_MAFIA_DRY_RUN_SEED;
  if (!raw) return 1;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 1;
}

export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
