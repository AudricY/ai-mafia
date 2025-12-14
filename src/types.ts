import { z } from 'zod';

// --- Configuration Types ---

export const RoleSchema = z.enum(['villager', 'mafia', 'cop', 'doctor', 'god']);
export type Role = z.infer<typeof RoleSchema>;

export const PlayerConfigSchema = z.object({
  name: z.string(),
  model: z.string().default('gpt-4o'),
  temperature: z.number().default(0.7),
  systemPrompt: z.string().optional(),
});
export type PlayerConfig = z.infer<typeof PlayerConfigSchema>;

export const GameConfigSchema = z.object({
  rounds: z.number().default(3),
  system_prompt: z.string().default('You are playing a game of Mafia.'),
  players: z.array(PlayerConfigSchema),
  roles: z.record(z.string(), RoleSchema).optional(), // Map player name to role (optional, for forced assignment)
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
  winners?: 'mafia' | 'villagers';
}

// --- Logging Types ---

export type LogType = 'SYSTEM' | 'CHAT' | 'ACTION' | 'VOTE' | 'DEATH' | 'WIN';

export interface GameLogEntry {
  id: string;
  timestamp: string;
  type: LogType;
  player?: string;
  content: string;
  metadata?: Record<string, any>;
}
