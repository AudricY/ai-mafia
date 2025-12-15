import { z } from 'zod';

// --- Configuration Types ---

export const RoleSchema = z.enum([
  'villager',
  'mafia',
  'cop',
  'doctor',
  'vigilante',
  'roleblocker',
  'godfather',
  'tracker',
  'jailkeeper',
  'mason',
  'bomb',
  'mafia_roleblocker',
  'framer',
  'janitor',
  'forger',
  'jester',
  'executioner',
]);
export type Role = z.infer<typeof RoleSchema>;

export const PlayerConfigSchema = z.object({
  name: z.string(),
  // AI Gateway model id in `provider/model` format, e.g. `openai/gpt-4o`.
  model: z.string().default('openai/gpt-4o'),
  temperature: z.number().default(0.7),
  systemPrompt: z.string().optional(),
});
export type PlayerConfig = z.infer<typeof PlayerConfigSchema>;

export const GameConfigSchema = z.object({
  rounds: z.number().default(3),
  system_prompt: z.string().default('You are playing a game of Mafia.'),
  players: z.array(PlayerConfigSchema),
  roles: z.record(z.string(), RoleSchema).optional(), // Map player name to role (optional, for forced assignment)
  // If roles are not explicitly assigned, the game can select roles from a pool.
  // The selected role setup (including counts) is intended to be public knowledge, while assignments remain hidden.
  role_pool: z.array(RoleSchema).optional(),
  role_counts: z.record(RoleSchema, z.number().int().nonnegative()).optional(),
  role_seed: z.number().int().optional(),
  // Seed for the initial player turn order (optional). If omitted, a best-effort
  // seed is chosen (dry-run seed if present, otherwise time-based).
  player_order_seed: z.number().int().optional(),
  memory_window_size: z.number().int().positive().default(20),
  enable_faction_memory: z.boolean().default(true),
  log_thoughts: z.boolean().default(false),
  // Controls what role mechanics are disclosed to agents: 'exact' (only roles in play with counts),
  // 'pool' (possible roles from role_pool/role_counts, no counts), or 'all' (all roles, no counts).
  role_setup_visibility: z.enum(['exact', 'pool', 'all']).default('exact'),
  // If roles are not explicitly assigned, the game engine will randomize them based on player count
});
export type GameConfig = z.infer<typeof GameConfigSchema>;

// --- Game State Types ---

export interface PlayerState {
  config: PlayerConfig;
  role: Role;
  isAlive: boolean;
  notes: string; // Private scratchpad for the agent
}

export type Phase = 'night' | 'day_discussion' | 'day_voting' | 'game_over';

export interface GameState {
  phase: Phase;
  round: number; // Day number
  turn: number; // Discussion turn within a day
  players: Record<string, PlayerState>;
  history: GameLogEntry[];
  winners?: 'mafia' | 'villagers' | 'jester';
  neutralWinners?: string[];
  executionerTargetByPlayer?: Record<string, string>;
  abortReason?: string;
}

// --- Logging Types ---

export type LogType = 'SYSTEM' | 'CHAT' | 'ACTION' | 'VOTE' | 'DEATH' | 'WIN' | 'THOUGHT' | 'FACTION_CHAT';

export type LogVisibility = 'public' | 'private' | 'faction';
export type Faction = 'mafia';

export interface GameLogMetadata {
  // Common structured fields (used by the UI and game engine)
  role?: Role;
  faction?: Faction;
  visibility?: LogVisibility;

  // Frequently used game fields
  player?: string; // player referred-to (not necessarily the actor)
  target?: string;
  vote?: string | number;
  result?: string;

  // Allow additional structured fields without `any`
  [key: string]: unknown;
}

export interface GameLogEntry {
  id: string;
  timestamp: string;
  type: LogType;
  player?: string;
  content: string;
  metadata?: GameLogMetadata;
}
