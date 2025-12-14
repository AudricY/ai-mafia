import type { GameConfig, GameState, PlayerState, GameLogEntry, Role } from '../types.js';
import { Agent, type FactionMemory, createFactionMemory } from '../agent.js';
import { AgentIO } from '../agentIo.js';
import { logger } from '../logger.js';
import { formatRoleSetupForPrompt, formatRoleSetupForPublicLog } from '../roles.js';
import { NightPhase } from '../phases/nightPhase.ts';
import { DayDiscussionPhase } from '../phases/dayDiscussionPhase.ts';
import { DayVotingPhase } from '../phases/dayVotingPhase.ts';

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

  private nightPhaseRunner = new NightPhase();
  private dayDiscussionPhaseRunner = new DayDiscussionPhase();
  private dayVotingPhaseRunner = new DayVotingPhase();

  constructor(config: GameConfig) {
    this.config = config;
    this.agents = {};
    this.mafiaMemory = config.enable_faction_memory ? createFactionMemory('mafia') : undefined;
    const players: Record<string, PlayerState> = {};

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
          summaryMaxChars: config.memory_summary_max_chars,
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
    };

    this.assignRoles();
  }

  getAlivePlayers(): PlayerState[] {
    return Object.values(this.state.players).filter(p => p.isAlive);
  }

  getAliveNames(): string[] {
    return this.getAlivePlayers().map(p => p.config.name);
  }

  broadcastPublicEvent(entry: Pick<GameLogEntry, 'type' | 'player' | 'content'>) {
    for (const [name, ps] of Object.entries(this.state.players)) {
      if (!ps.isAlive) continue;
      this.agents[name]?.observePublicEvent(entry);
    }
  }

  recordPublic(entry: Omit<GameLogEntry, 'id' | 'timestamp'>) {
    // Mark as public so the UI can render "player POV" views correctly.
    const entryWithVisibility: Omit<GameLogEntry, 'id' | 'timestamp'> = {
      ...entry,
      metadata: { ...(entry.metadata ?? {}), visibility: 'public' },
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

  killPlayer(name: string, revealedRole?: string | null) {
    if (this.state.players[name]) {
      this.state.players[name].isAlive = false;
      const roleToReveal = revealedRole !== undefined ? revealedRole : this.state.players[name].role;
      if (roleToReveal === null) {
        this.recordPublic({
          type: 'DEATH',
          player: name,
          content: `has died. Their role is unknown.`,
          metadata: { role: null },
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
    const mafiaCount = alive.filter(
      p =>
        p.role === 'mafia' ||
        p.role === 'godfather' ||
        p.role === 'mafia_roleblocker' ||
        p.role === 'framer' ||
        p.role === 'janitor' ||
        p.role === 'forger'
    ).length;
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
    this.recordPublic({
      type: 'SYSTEM',
      content: `Available roles this game: ${this.roleSetupPublicText}`,
    });
    this.recordPublic({ type: 'SYSTEM', content: 'Game Starting...' });

    while (!this.state.winners && !this.state.abortReason) {
      await this.playRound();
    }

    if (this.state.winners) {
      this.recordPublic({ type: 'WIN', content: `Game Over! Winners: ${this.state.winners}` });
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
      const isMafiaRole =
        p.role === 'mafia' ||
        p.role === 'godfather' ||
        p.role === 'mafia_roleblocker' ||
        p.role === 'framer' ||
        p.role === 'janitor' ||
        p.role === 'forger';
      this.agents[p.config.name]?.setFactionMemory(isMafiaRole ? this.mafiaMemory : undefined);
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

    this.roleCounts = this.computeRoleCountsFromState();
    this.roleSetupPublicText = formatRoleSetupForPublicLog(this.roleCounts);

    // Inject dynamic rules so everyone knows the role setup and mechanics for this game.
    const baseRules = this.config.system_prompt?.trim() ?? '';
    const roleRules = formatRoleSetupForPrompt(this.roleCounts);
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

