import type { GameConfig, GameState, PlayerState, GameLogEntry, Role } from '../types.js';
import { Agent, type FactionMemory, createFactionMemory } from '../agent.js';
import { AgentIO } from '../agentIo.js';
import { logger } from '../logger.js';
import {
  formatRoleSetupForPrompt,
  formatRoleSetupForPublicLog,
  formatPossibleRolesForPrompt,
  formatPossibleRolesForPublicLog,
  ROLE_DEFINITIONS,
} from '../roles.js';
import { NightPhase } from '../phases/nightPhase.ts';
import { DayDiscussionPhase } from '../phases/dayDiscussionPhase.ts';
import { DayVotingPhase } from '../phases/dayVotingPhase.ts';
import { PostGameReflectionsPhase } from '../phases/postGameReflectionsPhase.ts';
import { isDryRun, isMafiaRole } from '../utils.js';

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  // Fisher–Yates shuffle (deterministic given `rng`).
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j]!;
    arr[j] = tmp!;
  }
}

export class GameEngine {
  readonly config: GameConfig;
  readonly agents: Record<string, Agent>;
  readonly agentIO: AgentIO;
  readonly mafiaMemory?: FactionMemory;

  state: GameState;
  lastNightDeaths: string[] = [];
  roleCounts: Partial<Record<Role, number>> = {};
  roleSetupPublicText = '';

  private night1RandomTargets = new Map<string, string>();
  private night1Rng: () => number;

  private nightPhaseRunner = new NightPhase();
  private dayDiscussionPhaseRunner = new DayDiscussionPhase();
  private dayVotingPhaseRunner = new DayVotingPhase();
  private postGameReflectionsPhaseRunner = new PostGameReflectionsPhase();

  constructor(config: GameConfig) {
    this.config = config;
    this.agents = {};
    this.mafiaMemory = config.enable_faction_memory ? createFactionMemory('mafia') : undefined;
    const players: Record<string, PlayerState> = {};

    const dryRun = isDryRun();

    // Pass known players to logger for highlighting
    logger.setKnownPlayers(config.players.map(p => p.name));

    // Randomize the initial player ordering once, so turn order isn't always the
    // same as the config file. Use a stable seed in dry-run / role-seeded games.
    const playerOrderSeed =
      this.config.player_order_seed ??
      (process.env.AI_MAFIA_DRY_RUN_SEED ? Number(process.env.AI_MAFIA_DRY_RUN_SEED) : undefined) ??
      (this.config.role_seed !== undefined ? this.config.role_seed + 1 : Date.now());
    const playerOrderRng = mulberry32(Number.isFinite(playerOrderSeed) ? playerOrderSeed : Date.now());
    const initialPlayerConfigs = [...config.players];
    shuffleInPlace(initialPlayerConfigs, playerOrderRng);

    // Initialize players and agents
    initialPlayerConfigs.forEach(p => {
      this.agents[p.name] = new Agent(p, {
        gameRules: config.system_prompt,
        memory: {
          publicWindowSize: config.memory_window_size,
        },
        logThoughts: config.log_thoughts,
      });
      players[p.name] = {
        config: p,
        role: 'villager',
        isAlive: true,
        notes: '',
      };
    });

    this.agentIO = new AgentIO(this.agents);

    this.state = {
      phase: 'night',
      round: 1,
      turn: 0,
      players,
      history: [],
      neutralWinners: [],
      executionerTargetByPlayer: {},
    };

    // RNG for Night 1 bias-mitigation "assigned random target" prompts.
    // In dry-run, keep deterministic. Otherwise, default to a time-based seed so runs vary.
    const night1Seed =
      (dryRun && process.env.AI_MAFIA_DRY_RUN_SEED ? Number(process.env.AI_MAFIA_DRY_RUN_SEED) : undefined) ??
      (dryRun && this.config.role_seed !== undefined ? this.config.role_seed + 4242 : undefined) ??
      Date.now();
    this.night1Rng = mulberry32(Number.isFinite(night1Seed) ? night1Seed : Date.now());

    this.assignRoles();
  }

  /**
   * Night 1 bias mitigation:
   * If an agent would otherwise "pick a random person", we pre-roll a random target
   * and tell them who it is in the system prompt. This avoids model-name biases
   * (e.g. repeatedly choosing the same name across runs).
   */
  getNight1AssignedRandomTargetSystemAddendum(params: {
    actor: string;
    decisionKind: string;
    candidateTargets: readonly string[];
  }): string | null {
    if (this.state.round !== 1) return null;
    const candidates = params.candidateTargets.filter(c => c && c !== params.actor);
    if (candidates.length === 0) return null;

    const key = `night1|${params.decisionKind}|${params.actor}`;
    const existing = this.night1RandomTargets.get(key);
    let chosen = existing && candidates.includes(existing) ? existing : null;
    if (!chosen) {
      const idx = Math.floor(this.night1Rng() * candidates.length);
      chosen = candidates[idx]!;
      this.night1RandomTargets.set(key, chosen);
    }

    return `Night 1 randomization (bias mitigation):
- If you would otherwise choose a target "at random" due to lack of evidence, your assigned random target for this decision is: ${chosen}
- If you have no evidence-based preference, choose ${chosen}. Otherwise, choose based on your strategy.`;
  }

  /**
   * Gets the Night 1 random target for a decision (returns just the target name, not the formatted message).
   * Returns null if not Night 1 or if no valid target exists.
   */
  getNight1RandomTarget(params: {
    actor: string;
    decisionKind: string;
    candidateTargets: readonly string[];
  }): string | null {
    if (this.state.round !== 1) return null;
    const candidates = params.candidateTargets.filter(c => c && c !== params.actor);
    if (candidates.length === 0) return null;

    const key = `night1|${params.decisionKind}|${params.actor}`;
    const existing = this.night1RandomTargets.get(key);
    let chosen = existing && candidates.includes(existing) ? existing : null;
    if (!chosen) {
      const idx = Math.floor(this.night1Rng() * candidates.length);
      chosen = candidates[idx]!;
      this.night1RandomTargets.set(key, chosen);
    }

    return chosen;
  }

  getAlivePlayers(): PlayerState[] {
    return Object.values(this.state.players).filter(p => p.isAlive);
  }

  getAliveNames(): string[] {
    return this.getAlivePlayers().map(p => p.config.name);
  }

  broadcastPublicEvent(entry: Pick<GameLogEntry, 'type' | 'player' | 'content' | 'metadata' | 'id' | 'timestamp'>) {
    for (const [name, ps] of Object.entries(this.state.players)) {
      if (!ps.isAlive) continue;
      this.agents[name]?.observePublicEvent(entry);
    }
  }

  recordPublic(entry: Omit<GameLogEntry, 'id' | 'timestamp'>) {
    // Mark as public so the UI can render "player POV" views correctly.
    const entryWithVisibility: Omit<GameLogEntry, 'id' | 'timestamp'> = {
      ...entry,
      metadata: { 
        ...(entry.metadata ?? {}), 
        visibility: 'public',
        day: this.state.round,
        phase: this.state.phase,
      },
    };
    const fullEntry = logger.log(entryWithVisibility);
    this.state.history.push(fullEntry);
    this.broadcastPublicEvent(fullEntry);
  }

  getVoteTallyForDay(day: number): Record<string, number> | null {
    const marker = `--- Day ${day} Voting ---`;
    const startIndex = this.state.history.findIndex(e => e.type === 'SYSTEM' && e.content === marker);
    if (startIndex < 0) return null;

    const tally: Record<string, number> = {};
    for (let i = startIndex + 1; i < this.state.history.length; i++) {
      const e = this.state.history[i]!;
      if (e.type === 'SYSTEM' && e.content.startsWith('--- ')) break;
      if (e.type !== 'VOTE') continue;
      const voteRaw = e.metadata?.vote;
      const vote = typeof voteRaw === 'string' ? voteRaw : typeof voteRaw === 'number' ? String(voteRaw) : '';
      if (!vote) continue;
      tally[vote] = (tally[vote] ?? 0) + 1;
    }
    return tally;
  }

  formatVoteTally(tally: Record<string, number>): string {
    const entries = Object.entries(tally).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (entries.length === 0) return '(no votes)';
    return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
  }

  killPlayer(name: string, revealedRole?: Role | null) {
    if (this.state.players[name]) {
      this.state.players[name].isAlive = false;
      const roleToReveal = revealedRole !== undefined ? revealedRole : this.state.players[name].role;
      if (roleToReveal === null) {
        // Explicitly set role to undefined to mark it as unknown (janitor cleaned)
        // The logger will respect this and not infer the role
        this.recordPublic({
          type: 'DEATH',
          player: name,
          content: `has died. Their role is unknown.`,
          metadata: { role: undefined },
        });
      } else {
        this.recordPublic({
          type: 'DEATH',
          player: name,
          content: `has died. Their role was ${roleToReveal}.`,
          metadata: { role: roleToReveal },
        });
      }
    }
  }

  checkWin(): boolean {
    const alive = this.getAlivePlayers();
    const mafiaCount = alive.filter(p => isMafiaRole(p.role)).length;
    const villagerCount = alive.length - mafiaCount;

    if (mafiaCount === 0) {
      this.state.winners = 'villagers';
      return true;
    }
    if (mafiaCount >= villagerCount) {
      this.state.winners = 'mafia';
      return true;
    }
    return false;
  }

  async start() {
    const visibility = this.config.role_setup_visibility ?? 'exact';
    const label =
      visibility === 'exact'
        ? 'Available roles this game'
        : 'Possible roles this game (not confirmed)';
    this.recordPublic({
      type: 'SYSTEM',
      content: `${label}: ${this.roleSetupPublicText}`,
    });
    this.recordPublic({ type: 'SYSTEM', content: 'Game Starting...' });

    while (!this.state.winners && !this.state.abortReason) {
      await this.playRound();
    }

    if (this.state.winners) {
      let winMessage = '';
      if (this.state.winners === 'jester') {
        const jesterWinner = this.state.neutralWinners?.[0] ?? 'Unknown';
        winMessage = `Game Over! ${jesterWinner} (Jester) wins!`;
      } else {
        winMessage = `Game Over! Winners: ${this.state.winners}`;
        if (this.state.neutralWinners && this.state.neutralWinners.length > 0) {
          winMessage += ` (Neutral co-winners: ${this.state.neutralWinners.join(', ')})`;
        }
      }
      this.recordPublic({ type: 'WIN', content: winMessage });
      this.state.phase = 'game_over';
      
      // Final role reveal
      this.recordPublic({ type: 'SYSTEM', content: '--- Final Role Reveal ---' });
      for (const [name, playerState] of Object.entries(this.state.players)) {
        this.recordPublic({
          type: 'SYSTEM',
          content: `${name} was ${playerState.role}.`,
          metadata: { visibility: 'public', player: name, role: playerState.role, kind: 'final_reveal' },
        });
      }
      
      // Post-game reflections
      try {
        await this.postGameReflectionsPhaseRunner.run(this);
      } catch (error) {
        logger.log({
          type: 'SYSTEM',
          content: `Post-game reflections phase failed: ${error instanceof Error ? error.message : String(error)}`,
          metadata: { visibility: 'private', error },
        });
      }
      return;
    }
    if (this.state.abortReason) {
      this.recordPublic({ type: 'SYSTEM', content: `Game aborted: ${this.state.abortReason}` });
    }
  }

  private async playRound() {
    // Night Phase
    this.state.phase = 'night';
    try {
      await this.nightPhaseRunner.run(this);
    } catch (error) {
      this.abort('night phase failed', error);
      return;
    }

    // Check win
    if (this.checkWin()) return;
    if (this.state.abortReason) return;

    // Day Phase
    this.state.phase = 'day_discussion';
    try {
      await this.dayDiscussionPhaseRunner.run(this);
    } catch (error) {
      this.abort('day discussion phase failed', error);
      return;
    }

    // Voting Phase
    this.state.phase = 'day_voting';
    try {
      await this.dayVotingPhaseRunner.run(this);
    } catch (error) {
      this.abort('day voting phase failed', error);
      return;
    }

    // Check win
    if (this.checkWin()) return;
    if (this.state.abortReason) return;

    this.state.round++;
  }

  private abort(message: string, error: unknown) {
    const details = error instanceof Error ? error.message : String(error);
    this.state.abortReason = `${message}: ${details}`;
    logger.log({
      type: 'SYSTEM',
      content: `Engine abort: ${message}: ${details}`,
      metadata: { visibility: 'private', error },
    });
  }

  private computeRoleCountsFromState(): Partial<Record<Role, number>> {
    const counts: Partial<Record<Role, number>> = {};
    for (const ps of Object.values(this.state.players)) {
      const r = ps.role;
      counts[r] = (counts[r] ?? 0) + 1;
    }
    return counts;
  }

  private buildRoleListForGame(playerCount: number, rng: () => number): Role[] {
    const allowed = this.config.role_pool?.length ? new Set<Role>(this.config.role_pool) : null;
    const isAllowed = (r: Role) => (allowed ? allowed.has(r) : true);

    const counts: Partial<Record<Role, number>> = {};

    const add = (r: Role, n: number) => {
      if (n <= 0) return;
      if (!isAllowed(r)) {
        throw new Error(`Role "${r}" is not allowed by role_pool.`);
      }
      counts[r] = (counts[r] ?? 0) + n;
    };

    // Explicit counts override defaults.
    if (this.config.role_counts) {
      for (const [role, raw] of Object.entries(this.config.role_counts) as Array<[Role, number]>) {
        add(role, raw);
      }
    } else if (this.config.role_pool?.length) {
      // Heuristic defaults when using role_pool but no explicit counts.
      const hasMafiaRole = isAllowed('mafia') || isAllowed('godfather');
      if (!hasMafiaRole) {
        throw new Error('role_pool must include at least one mafia role (mafia or godfather).');
      }

      // Mafia size heuristic: ~25% of players, at least 1.
      let mafiaTotal = Math.max(1, Math.floor(playerCount / 4));
      if (isAllowed('godfather')) {
        add('godfather', 1);
        mafiaTotal = Math.max(0, mafiaTotal - 1);
      }
      if (mafiaTotal > 0 && isAllowed('mafia')) add('mafia', mafiaTotal);

      // Town power roles (only if allowed).
      if (playerCount >= 5 && isAllowed('cop')) add('cop', 1);
      if (playerCount >= 5 && isAllowed('doctor')) add('doctor', 1);
      if (playerCount >= 6 && isAllowed('roleblocker')) add('roleblocker', 1);
      if (playerCount >= 7 && isAllowed('vigilante')) add('vigilante', 1);
    } else {
      // Back-compat fallback: simple default if no pool/counts are provided.
      add('mafia', Math.max(1, Math.floor(playerCount / 4)));
      if (playerCount >= 4) add('cop', 1);
    }

    const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
    if (total > playerCount) {
      throw new Error(
        `Selected role counts (${total}) exceed player count (${playerCount}). Adjust role_counts / role_pool defaults.`
      );
    }

    // Fill remaining seats with villagers (must be allowed if role_pool is used).
    const remaining = playerCount - total;
    if (remaining > 0) {
      if (!isAllowed('villager')) {
        throw new Error(
          `Need ${remaining} filler roles but "villager" is not allowed by role_pool. Add villager or provide exact role_counts.`
        );
      }
      add('villager', remaining);
    }

    // Materialize list.
    const roleList: Role[] = [];
    for (const [role, n] of Object.entries(counts) as Array<[Role, number]>) {
      for (let i = 0; i < n; i++) roleList.push(role);
    }

    // Small shuffle to avoid predictable ordering from counts materialization.
    return roleList.sort(() => rng() - 0.5);
  }

  private assignRoles() {
    const playerNames = Object.keys(this.state.players);

    const seed =
      this.config.role_seed ??
      (process.env.AI_MAFIA_DRY_RUN_SEED ? Number(process.env.AI_MAFIA_DRY_RUN_SEED) : undefined) ??
      Date.now();
    const rng = mulberry32(Number.isFinite(seed) ? seed : Date.now());

    const shuffledPlayers = [...playerNames].sort(() => rng() - 0.5);

    // If config.roles exists, use it (forced assignment).
    // Otherwise, select a role setup and assign to all players.
    if (this.config.roles) {
      for (const name of playerNames) {
        const forced = this.config.roles[name];
        if (forced) this.state.players[name]!.role = forced;
      }
    } else {
      const selectedRoleList = this.buildRoleListForGame(shuffledPlayers.length, rng);
      const shuffledRoles = [...selectedRoleList].sort(() => rng() - 0.5);
      for (let i = 0; i < shuffledPlayers.length; i++) {
        const name = shuffledPlayers[i]!;
        const role = shuffledRoles[i]!;
        this.state.players[name]!.role = role;
      }
    }

    // Log roles (system only) + initialize agent-private knowledge.
    Object.values(this.state.players).forEach(p => {
      this.agents[p.config.name]?.setRole(p.role);
      this.agents[p.config.name]?.setFactionMemory(isMafiaRole(p.role) ? this.mafiaMemory : undefined);
      logger.setPlayerRole(p.config.name, p.role);
      logger.log({
        type: 'SYSTEM',
        content: `Assigned role ${p.role} to ${p.config.name}`,
        metadata: { role: p.role, player: p.config.name, visibility: 'private' },
      });
      this.agents[p.config.name]?.observePrivateEvent(`Your role is ${p.role}.`);
    });

    // Handle Masons: they know each other
    const masons = Object.values(this.state.players).filter(p => p.role === 'mason');
    if (masons.length > 1) {
      const masonNames = masons.map(m => m.config.name);
      masons.forEach(mason => {
        const otherMasons = masonNames.filter(n => n !== mason.config.name);
        this.agents[mason.config.name]?.observePrivateEvent(
          `You are a Mason. The other Mason(s) are: ${otherMasons.join(', ')}. You know they are town-aligned.`
        );
      });
    }

    // Handle Executioners: assign targets
    const executioners = Object.values(this.state.players).filter(p => p.role === 'executioner');
    if (executioners.length > 0) {
      const seed =
        this.config.role_seed ??
        (process.env.AI_MAFIA_DRY_RUN_SEED ? Number(process.env.AI_MAFIA_DRY_RUN_SEED) : undefined) ??
        Date.now();
      const rng = mulberry32(Number.isFinite(seed) ? seed : Date.now());
      
      // Valid targets: non-mafia, non-executioner, non-jester, alive players
      const validTargets = Object.values(this.state.players).filter(
        p =>
          p.isAlive &&
          !isMafiaRole(p.role) &&
          p.role !== 'executioner' &&
          p.role !== 'jester'
      );

      for (const exe of executioners) {
        if (validTargets.length === 0) {
          // Edge case: no valid targets (shouldn't happen in normal games)
          this.agents[exe.config.name]?.observePrivateEvent(
            'You are an Executioner, but there are no valid targets. You will become a Jester if any player dies at night.'
          );
          continue;
        }

        const targetIndex = Math.floor(rng() * validTargets.length);
        const target = validTargets[targetIndex]!;
        this.state.executionerTargetByPlayer![exe.config.name] = target.config.name;
        
        this.agents[exe.config.name]?.observePrivateEvent(
          `You are an Executioner. Your target is ${target.config.name}. If ${target.config.name} is eliminated by day vote, you win. If ${target.config.name} dies at night, you become the Jester.`
        );
        
        logger.log({
          type: 'SYSTEM',
          content: `Executioner ${exe.config.name} assigned target ${target.config.name}`,
          metadata: { role: 'executioner', player: exe.config.name, target: target.config.name, visibility: 'private' },
        });
      }
    }

    this.roleCounts = this.computeRoleCountsFromState();
    const visibility = this.config.role_setup_visibility ?? 'exact';

    // Compute possible roles and format rules based on visibility mode
    let possibleRoles: Role[] = [];
    if (visibility === 'pool') {
      if (this.config.role_pool && this.config.role_pool.length > 0) {
        possibleRoles = this.config.role_pool;
      } else if (this.config.role_counts) {
        possibleRoles = Object.keys(this.config.role_counts) as Role[];
      } else {
        // Fallback to all roles if no pool/counts specified
        possibleRoles = Object.keys(ROLE_DEFINITIONS) as Role[];
      }
    } else if (visibility === 'all') {
      possibleRoles = Object.keys(ROLE_DEFINITIONS) as Role[];
    }

    // Set public text based on visibility
    if (visibility === 'exact') {
      this.roleSetupPublicText = formatRoleSetupForPublicLog(this.roleCounts);
    } else {
      this.roleSetupPublicText = formatPossibleRolesForPublicLog(possibleRoles);
    }

    // Inject dynamic rules so everyone knows the role setup and mechanics for this game.
    const baseRules = this.config.system_prompt?.trim() ?? '';
    let roleRules: string;
    if (visibility === 'exact') {
      roleRules = formatRoleSetupForPrompt(this.roleCounts);
    } else {
      roleRules = formatPossibleRolesForPrompt(possibleRoles);
    }
    const fullRules = [baseRules, roleRules].filter(Boolean).join('\n\n');
    for (const name of playerNames) {
      this.agents[name]?.setGameRules(fullRules);
    }

    // Let the logger auto-tag future entries with actor roles.
    logger.setPlayerRoles(
      Object.fromEntries(Object.entries(this.state.players).map(([name, ps]) => [name, ps.role]))
    );
  }
}


