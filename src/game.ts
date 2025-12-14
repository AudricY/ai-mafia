import { GameConfig, GameState, PlayerState, GameLogEntry, Role } from './types.js';
import { Agent, FactionMemory, createFactionMemory } from './agent.js';
import { logger } from './logger.js';
import { formatRoleSetupForPrompt, formatRoleSetupForPublicLog } from './roles.js';

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

export class Game {
  private config: GameConfig;
  private state: GameState;
  private agents: Record<string, Agent>;
  private mafiaMemory?: FactionMemory;
  private lastNightDeaths: string[] = [];
  private roleCounts: Partial<Record<Role, number>> = {};
  private roleSetupPublicText = '';

  constructor(config: GameConfig) {
    this.config = config;
    this.agents = {};
    this.mafiaMemory = config.enable_faction_memory ? createFactionMemory('mafia') : undefined;
    const players: Record<string, PlayerState> = {};
    
    // Pass known players to logger for highlighting
    logger.setKnownPlayers(config.players.map(p => p.name));

    // Initialize players and agents
    config.players.forEach(p => {
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

    this.state = {
      phase: 'night',
      round: 1,
      turn: 0,
      players,
      history: [],
    };

    this.assignRoles();
  }

  private broadcastPublicEvent(entry: Omit<GameLogEntry, 'id' | 'timestamp'>) {
    for (const [name, ps] of Object.entries(this.state.players)) {
      if (!ps.isAlive) continue;
      this.agents[name]?.observePublicEvent(entry);
    }
  }

  private recordPublic(entry: Omit<GameLogEntry, 'id' | 'timestamp'>) {
    // Mark as public so the UI can render "player POV" views correctly.
    const entryWithVisibility: Omit<GameLogEntry, 'id' | 'timestamp'> = {
      ...entry,
      metadata: { ...(entry.metadata ?? {}), visibility: 'public' },
    };
    this.state.history.push({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...entryWithVisibility,
    });
    this.broadcastPublicEvent(entryWithVisibility);
    logger.log(entryWithVisibility);
  }

  private getVoteTallyForDay(day: number): Record<string, number> | null {
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

  private formatVoteTally(tally: Record<string, number>): string {
    const entries = Object.entries(tally).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (entries.length === 0) return '(no votes)';
    return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
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
      this.agents[p.config.name]?.setFactionMemory(['mafia', 'godfather'].includes(p.role) ? this.mafiaMemory : undefined);
      logger.setPlayerRole(p.config.name, p.role);
      logger.log({
        type: 'SYSTEM',
        content: `Assigned role ${p.role} to ${p.config.name}`,
        metadata: { role: p.role, player: p.config.name, visibility: 'private' },
      });
      this.agents[p.config.name]?.observePrivateEvent(`Your role is ${p.role}.`);
    });

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

  async start() {
    this.recordPublic({
      type: 'SYSTEM',
      content: `Available roles this game: ${this.roleSetupPublicText}`,
    });
    this.recordPublic({ type: 'SYSTEM', content: 'Game Starting...' });
    
    while (!this.state.winners) {
      await this.playRound();
    }

    this.recordPublic({ type: 'WIN', content: `Game Over! Winners: ${this.state.winners}` });
  }

  private async playRound() {
    // Night Phase
    this.state.phase = 'night';
    await this.nightPhase();

    // Check win
    if (this.checkWin()) return;

    // Day Phase
    this.state.phase = 'day_discussion';
    await this.dayPhase();

    // Voting Phase
    this.state.phase = 'day_voting';
    await this.votingPhase();

    // Check win
    if (this.checkWin()) return;

    this.state.round++;
  }

  private async nightPhase() {
    this.recordPublic({ type: 'SYSTEM', content: `--- Night ${this.state.round} ---` });
    
    const alivePlayers = Object.values(this.state.players).filter(p => p.isAlive);
    const aliveNames = alivePlayers.map(p => p.config.name);

    // Track blocks
    const blockedPlayers = new Set<string>();
    
    // --- 1. Roleblocker Action ---
    const roleblockers = alivePlayers.filter(p => p.role === 'roleblocker');
    for (const rb of roleblockers) {
      const validTargets = aliveNames.filter(n => n !== rb.config.name);
      if (validTargets.length > 0) {
        const target = await this.agents[rb.config.name].generateDecision(
          `Night ${this.state.round}. You are the Roleblocker.
Alive players: ${aliveNames.join(', ')}.

Choose ONE player to block from performing an action tonight.
Guidance (soft):
- Prefer blocking someone you suspect is mafia or someone whose night action would be dangerous if they are mafia.
- Use public behavior (pushy framing, coordinated narratives, strange vote positioning) to pick a target.
- Avoid purely random blocks unless you have no read.`,
          validTargets
        );
        blockedPlayers.add(target);
        
        this.agents[rb.config.name]?.observePrivateEvent(
          `You chose to block ${target}.`
        );
        logger.log({
          type: 'ACTION',
          player: rb.config.name,
          content: `blocked ${target}`,
          metadata: { target, role: 'roleblocker', visibility: 'private' }
        });
      }
    }

    // Definition of actions to resolve
    let mafiaTarget: string | null = null;
    let doctorTarget: string | null = null;
    let vigilanteTarget: string | null = null;

    // --- 2. Mafia Action ---
    // Shooter logic: Priority to Godfather, then Mafia
    const mafiaTeam = alivePlayers.filter(p => ['mafia', 'godfather'].includes(p.role));
    if (mafiaTeam.length > 0) {
      // --- Mafia Discussion ---
      if (mafiaTeam.length > 1) {
        logger.log({ type: 'SYSTEM', content: `Mafia team is discussing targeting strategy...` });
        const discussionRounds = 2;
        for (let r = 0; r < discussionRounds; r++) {
          for (const member of mafiaTeam) {
             const others = mafiaTeam.filter(m => m !== member).map(m => m.config.name).join(', ');
             const context = `Night ${this.state.round} Mafia Discussion (Round ${r + 1}/${discussionRounds}).
Teammates: ${others}.
Goal: Discuss who to kill tonight. Coordinate with your team.
Alive players: ${aliveNames.join(', ')}.`;
             
             const message = await this.agents[member.config.name].generateResponse(context, []);
             
             // Broadcast to faction
             const formattedMsg = `${member.config.name}: ${message}`;
             mafiaTeam.forEach(m => {
                 this.agents[m.config.name]?.observeFactionEvent(formattedMsg);
             });
             
             logger.log({ 
               type: 'FACTION_CHAT', 
               player: member.config.name, 
               content: message, 
               metadata: { role: member.role, faction: 'mafia', visibility: 'faction' } 
             });
          }
        }
      }

      // Find shooter (Godfather priority)
      const shooter = mafiaTeam.find(p => p.role === 'godfather') || mafiaTeam[0];
      
      if (blockedPlayers.has(shooter.config.name)) {
         this.agents[shooter.config.name]?.observePrivateEvent(`You were roleblocked and could not perform the kill!`);
         // Other mafias might know this? For now, simple.
      } else {
        const validTargets = aliveNames.filter(n => !['mafia', 'godfather'].includes(this.state.players[n].role));
        if (validTargets.length > 0) {
            mafiaTarget = await this.agents[shooter.config.name].generateDecision(
            `Night ${this.state.round}. You are leading the Mafia kill. Choose a target.`,
            validTargets
          );
          
          // Notify the whole faction (simplified)
          mafiaTeam.forEach(m => {
             this.agents[m.config.name]?.observeFactionEvent(`Our team (via ${shooter.config.name}) chose to kill ${mafiaTarget}.`);
          });

          logger.log({ 
            type: 'ACTION', 
            player: shooter.config.name, 
            content: `chose to kill ${mafiaTarget}`,
            metadata: { target: mafiaTarget, role: shooter.role, faction: 'mafia', visibility: 'faction' }
          });
        }
      }
    }

    // --- 3. Cop Action ---
    const cops = alivePlayers.filter(p => p.role === 'cop');
    for (const cop of cops) {
      if (blockedPlayers.has(cop.config.name)) {
        this.agents[cop.config.name]?.observePrivateEvent(`You were roleblocked and could not investigate!`);
        continue;
      }

      const validTargets = aliveNames.filter(n => n !== cop.config.name);
      if (validTargets.length > 0) {
        const target = await this.agents[cop.config.name].generateDecision(
           `Night ${this.state.round}. You are the Cop.
Alive players: ${aliveNames.join(', ')}.

Choose ONE player to investigate tonight.
Guidance (soft):
- Prioritize players driving narratives, coordinating votes, or whose behavior feels strategically motivated.
- If town is stuck, investigate someone central to the discussion rather than a silent bystander.`,
           validTargets
        );
        
        const targetRole = this.state.players[target].role;
        // Godfather appears innocent
        const isMafia = targetRole === 'mafia'; 
        const result = isMafia ? 'MAFIA' : 'INNOCENT';
        
        this.agents[cop.config.name]?.observePrivateEvent(
          `Investigation result (night ${this.state.round}): ${target} is ${result}.`
        );
        logger.log({
          type: 'ACTION',
          player: cop.config.name,
          content: `investigated ${target} and found ${result}`,
          metadata: { target, result, role: 'cop', visibility: 'private' }
        });
      }
    }

    // --- 4. Doctor Action ---
    const doctors = alivePlayers.filter(p => p.role === 'doctor');
    for (const doc of doctors) {
      if (blockedPlayers.has(doc.config.name)) {
         this.agents[doc.config.name]?.observePrivateEvent(`You were roleblocked and could not save anyone!`);
         continue;
      }

      doctorTarget = await this.agents[doc.config.name].generateDecision(
        `Night ${this.state.round}. You are the Doctor.
Alive players: ${aliveNames.join(', ')}.

Choose ONE player to save tonight.
Guidance (soft):
- Protect the player most likely to be killed (often a strong town voice or an obvious power-role candidate).
- Repeated self-protect is usually low value unless you expect to be attacked or you are broadly suspected.
- If you have no strong read, rotate protection to avoid being predictable.`,
        aliveNames
      );
      this.agents[doc.config.name]?.observePrivateEvent(
        `You chose to save ${doctorTarget}.`
      );
      logger.log({
        type: 'ACTION',
        player: doc.config.name,
        content: `chose to save ${doctorTarget}`,
        metadata: { target: doctorTarget, role: 'doctor', visibility: 'private' }
      });
    }

    // --- 5. Vigilante Action ---
    const vigilantes = alivePlayers.filter(p => p.role === 'vigilante');
    for (const vigi of vigilantes) {
       if (blockedPlayers.has(vigi.config.name)) {
         this.agents[vigi.config.name]?.observePrivateEvent(`You were roleblocked and could not shoot!`);
         continue;
      }
      
      const validTargets = aliveNames.filter(n => n !== vigi.config.name);
      if (validTargets.length > 0) {
         // Vigilante might choose NOT to shoot. We need a "skip" or similar option? 
         // For now, forced shot or maybe we can add "skip" to valid targets if we want them to be able to hold fire.
         // Let's assume forced shot for simplicity unless we change the prompt logic to allow null.
         // Or we can add "nobody" as an option.
         const options = [...validTargets, 'nobody'];
         const decision = await this.agents[vigi.config.name].generateDecision(
            `Night ${this.state.round}. You are the Vigilante.
Alive players: ${aliveNames.join(', ')}.

Choose ONE player to shoot, or 'nobody' to hold fire.
Guidance (soft):
- Avoid random shots early; shoot when you have a concrete suspect or town is stalling with repeated skips.
- Prefer targets supported by multiple concrete red flags (vote positioning, contradictions, narrative steering).
- If you're uncertain, 'nobody' is acceptable.`,
            options
         );

         if (decision !== 'nobody') {
             vigilanteTarget = decision;
             this.agents[vigi.config.name]?.observePrivateEvent(`You chose to shoot ${vigilanteTarget}.`);
             logger.log({
                type: 'ACTION',
                player: vigi.config.name,
                content: `chose to shoot ${vigilanteTarget}`,
                metadata: { target: vigilanteTarget, role: 'vigilante', visibility: 'private' }
            });
         }
      }
    }

    // --- Resolution ---
    const deaths = new Set<string>();

    // Resolve Mafia Kill
    if (mafiaTarget) {
      if (mafiaTarget === doctorTarget) {
        this.recordPublic({ type: 'SYSTEM', content: `Mafia tried to kill ${mafiaTarget}, but they were saved by the Doctor!` });
      } else {
        deaths.add(mafiaTarget);
      }
    }

    // Resolve Vigilante Kill
    if (vigilanteTarget) {
      // Doctor can save from Vigilante too? Usually yes.
      if (vigilanteTarget === doctorTarget) {
         this.recordPublic({ type: 'SYSTEM', content: `Vigilante tried to shoot ${vigilanteTarget}, but they were saved!` });
      } else {
         deaths.add(vigilanteTarget);
      }
    }

    if (deaths.size > 0) {
      this.lastNightDeaths = [...deaths];
      for (const player of deaths) {
        this.killPlayer(player);
        this.recordPublic({ type: 'SYSTEM', content: `${player} died during the night.` });
      }
    } else if (!mafiaTarget && !vigilanteTarget) {
       this.lastNightDeaths = [];
       this.recordPublic({ type: 'SYSTEM', content: 'Peaceful night. No attempts were made.' });
    } else if (deaths.size === 0) {
       this.lastNightDeaths = [];
       // Attempts made but failed (saved)
       // Messages already logged above for saves
    }
  }

  private async dayPhase() {
    this.recordPublic({ type: 'SYSTEM', content: `--- Day ${this.state.round} Discussion ---` });
    
    const alivePlayers = Object.values(this.state.players).filter(p => p.isAlive);
    const aliveCount = alivePlayers.length;
    const aliveNames = alivePlayers.map(p => p.config.name);

    const voteTally =
      this.state.round > 1 ? this.getVoteTallyForDay(this.state.round - 1) : null;
    const recapLines = [
      `Alive: ${aliveNames.join(', ') || '(none)'}`,
      `Last night deaths: ${this.lastNightDeaths.length ? this.lastNightDeaths.join(', ') : 'none'}`,
      this.state.round > 1
        ? `Yesterday's votes: ${voteTally ? this.formatVoteTally(voteTally) : '(no vote data)'}`
        : `Yesterday's votes: (Day 0)`,
    ];
    this.recordPublic({
      type: 'SYSTEM',
      content: `Recap:\n- ${recapLines.join('\n- ')}`,
    });

    // Open discussion keeps the old pacing:
    // Day 1 = 15, Day 2 = 20, ...
    const openDiscussionMaxMessages = 10 + (this.state.round * 5);

    logger.log({
      type: 'SYSTEM',
      content: `Discussion started. Phases: QuestionRound(${aliveCount} turns) -> OpenDiscussion(max ${openDiscussionMaxMessages} messages) -> PreVote(${aliveCount} turns).`,
    });

    // --- Phase A: Question Round (1 turn per alive player) ---
    for (let i = 0; i < alivePlayers.length; i++) {
      const player = alivePlayers[i]!;
      const name = player.config.name;
      const context = `
Current Phase: Day ${this.state.round}, Question Round.
This is your public speaking turn. Speak as ${name}.
Alive players: ${aliveNames.join(', ')}.
Instruction:
- Ask ONE targeted question to a specific living player.
- Your question should reduce uncertainty (alignment, motives, votes, night actions).
- Keep it concise and concrete. No generic “any thoughts?” questions.
- If you truly cannot ask any question, reply with the single word "SKIP".
      `.trim();

      const message = await this.agents[name].generateResponse(context, []);
      const isSkip = message.trim().toUpperCase() === 'SKIP';

      if (isSkip) {
        this.agents[name]?.observePrivateEvent('You chose to SKIP this turn.');
      } else {
        this.recordPublic({
          type: 'CHAT',
          player: name,
          content: message,
        });
      }
    }

    // --- Phase B: Open Discussion (round-robin until message budget or silence) ---
    let openMessagesSent = 0;
    let consecutiveSkips = 0;
    let turnIndex = 0;

    while (openMessagesSent < openDiscussionMaxMessages && consecutiveSkips < aliveCount) {
      const player = alivePlayers[turnIndex % aliveCount]!;
      turnIndex++;

      const name = player.config.name;
      const context = `
Current Phase: Day ${this.state.round}, Open Discussion.
This is your public speaking turn. Speak as ${name}.
Alive players: ${aliveNames.join(', ')}.
Status: ${openMessagesSent}/${openDiscussionMaxMessages} open-discussion messages used.

Guidance:
- Move the game forward with a concrete claim, inference, or question.
- Prefer referencing specific prior events (votes, night deaths, inconsistencies).
- If you agree with someone, add a NEW reason or a different angle; don't just echo.
- If you have nothing useful to add, you may reply with the single word "SKIP".
      `.trim();

      const message = await this.agents[name].generateResponse(context, []);
      const isSkip = message.trim().toUpperCase() === 'SKIP';

      if (isSkip) {
        consecutiveSkips++;
        this.agents[name]?.observePrivateEvent('You chose to SKIP this turn.');
      } else {
        consecutiveSkips = 0;
        openMessagesSent++;
        this.recordPublic({
          type: 'CHAT',
          player: name,
          content: message,
        });
      }
    }
    
    if (consecutiveSkips >= aliveCount) {
      this.recordPublic({ type: 'SYSTEM', content: 'Open discussion ended (silence settled over the town).' });
    } else {
      this.recordPublic({ type: 'SYSTEM', content: 'Open discussion ended (message limit reached).' });
    }

    // --- Phase C: Pre-vote Statements (1 turn per alive player) ---
    for (let i = 0; i < alivePlayers.length; i++) {
      const player = alivePlayers[i]!;
      const name = player.config.name;
      const context = `
Current Phase: Day ${this.state.round}, Pre-vote Statement.
This is your final public statement before voting. Speak as ${name}.
Alive players: ${aliveNames.join(', ')}.
Instruction:
- State your current #1 suspect OR say "skip" if you genuinely have no read.
- Give a concrete reason tied to an event (vote, wording, inconsistency).
- Say what evidence would change your mind.
- Keep it short.
      `.trim();

      const message = await this.agents[name].generateResponse(context, []);
      const isSkip = message.trim().toUpperCase() === 'SKIP';
      if (isSkip) {
        this.agents[name]?.observePrivateEvent('You chose to SKIP this turn.');
      } else {
        this.recordPublic({
          type: 'CHAT',
          player: name,
          content: message,
        });
      }
    }

    this.recordPublic({ type: 'SYSTEM', content: 'Discussion ended (pre-vote statements complete).' });
  }

  private async votingPhase() {
    this.recordPublic({ type: 'SYSTEM', content: `--- Day ${this.state.round} Voting ---` });
    
    const alivePlayers = Object.values(this.state.players).filter(p => p.isAlive);
    const aliveNames = alivePlayers.map(p => p.config.name);
    const options = [...aliveNames, 'skip'];
    
    const votes: Record<string, number> = {};
    options.forEach(o => votes[o] = 0);

    for (const player of alivePlayers) {
      const vote = await this.agents[player.config.name].generateDecision(
        `Day ${this.state.round} voting. Choose a player to eliminate or 'skip'.`,
        options
      );
      
      this.recordPublic({
        type: 'VOTE',
        player: player.config.name,
        content: `voted for ${vote}`,
        metadata: { vote }
      });
      
      votes[vote] = (votes[vote] || 0) + 1;
    }

    // Tally
    let maxVotes = 0;
    let candidate: string | null = null;
    let tie = false;

    for (const [target, count] of Object.entries(votes)) {
      if (count > maxVotes) {
        maxVotes = count;
        candidate = target;
        tie = false;
      } else if (count === maxVotes) {
        tie = true;
      }
    }

    if (candidate && !tie && candidate !== 'skip') {
      this.recordPublic({ type: 'SYSTEM', content: `The town has voted to eliminate ${candidate} with ${maxVotes} votes.` });
      this.killPlayer(candidate);
    } else {
      this.recordPublic({ type: 'SYSTEM', content: `Vote result: ${tie ? 'Tie' : 'Skip'}. No one was eliminated.` });
    }
  }

  private killPlayer(name: string) {
    if (this.state.players[name]) {
      this.state.players[name].isAlive = false;
      this.recordPublic({
        type: 'DEATH',
        player: name,
        content: `has died. Their role was ${this.state.players[name].role}.`,
        metadata: { role: this.state.players[name].role }
      });
    }
  }

  private checkWin(): boolean {
    const aliveFunctions = Object.values(this.state.players).filter(p => p.isAlive);
    const mafiaCount = aliveFunctions.filter(p => p.role === 'mafia' || p.role === 'godfather').length;
    const villagerCount = aliveFunctions.length - mafiaCount;

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
}
