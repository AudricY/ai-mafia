import { GameConfig, GameState, PlayerState, GameLogEntry } from './types.js';
import { Agent, FactionMemory, createFactionMemory } from './agent.js';
import { logger } from './logger.js';

export class Game {
  private config: GameConfig;
  private state: GameState;
  private agents: Record<string, Agent>;
  private mafiaMemory?: FactionMemory;

  constructor(config: GameConfig) {
    this.config = config;
    this.agents = {};
    this.mafiaMemory = config.enable_faction_memory ? createFactionMemory('mafia') : undefined;
    const players: Record<string, PlayerState> = {};

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
    this.state.history.push({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    });
    this.broadcastPublicEvent(entry);
    logger.log(entry);
  }

  private assignRoles() {
    const playerNames = Object.keys(this.state.players);
    const shuffled = [...playerNames].sort(() => Math.random() - 0.5);
    
    // Simple assignment logic based on config or random
    // If config.roles exists, use it. Otherwise random.
    if (this.config.roles) {
      for (const [name, role] of Object.entries(this.config.roles)) {
        if (this.state.players[name]) {
          this.state.players[name].role = role;
          this.agents[name]?.setRole(role);
          this.agents[name]?.setFactionMemory(['mafia', 'godfather'].includes(role) ? this.mafiaMemory : undefined);
        }
      }
    } else {
      // Default: 1 Mafia for every 4 players?
      // For now, let's keep it simple: 1 mafia, 1 cop, rest villagers for < 6 players
      // This logic can be expanded
      const mafia = shuffled.pop();
      const cop = shuffled.pop();
       if (mafia) this.state.players[mafia].role = 'mafia';
      if (cop) this.state.players[cop].role = 'cop';
      // Role is managed by state injection logic in generating prompts.
    }

    // Log roles (system only)
    Object.values(this.state.players).forEach(p => {
      this.agents[p.config.name]?.setRole(p.role);
      this.agents[p.config.name]?.setFactionMemory(['mafia', 'godfather'].includes(p.role) ? this.mafiaMemory : undefined);
      logger.log({
        type: 'SYSTEM',
        content: `Assigned role ${p.role} to ${p.config.name}`,
        metadata: { role: p.role, player: p.config.name },
      });
      // Private role knowledge for the agent itself.
      this.agents[p.config.name]?.observePrivateEvent(`Your role is ${p.role}.`);
    });
  }

  async start() {
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
          `Night ${this.state.round}. You are the Roleblocker. Choose a player to block from performing an action.`,
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
          metadata: { target, role: 'roleblocker' }
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
            metadata: { target: mafiaTarget, role: shooter.role }
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
           `Night ${this.state.round}. You are the Cop. Choose a player to investigate.`,
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
          metadata: { target, result, role: 'cop' }
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
        `Night ${this.state.round}. You are the Doctor. Choose a player to save.`,
        aliveNames
      );
      this.agents[doc.config.name]?.observePrivateEvent(
        `You chose to save ${doctorTarget}.`
      );
      logger.log({
        type: 'ACTION',
        player: doc.config.name,
        content: `chose to save ${doctorTarget}`,
        metadata: { target: doctorTarget, role: 'doctor' }
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
            `Night ${this.state.round}. You are the Vigilante. Choose a player to shoot, or 'nobody'.`,
            options
         );

         if (decision !== 'nobody') {
             vigilanteTarget = decision;
             this.agents[vigi.config.name]?.observePrivateEvent(`You chose to shoot ${vigilanteTarget}.`);
             logger.log({
                type: 'ACTION',
                player: vigi.config.name,
                content: `chose to shoot ${vigilanteTarget}`,
                metadata: { target: vigilanteTarget, role: 'vigilante' }
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
      for (const player of deaths) {
        this.killPlayer(player);
        this.recordPublic({ type: 'SYSTEM', content: `${player} died during the night.` });
      }
    } else if (!mafiaTarget && !vigilanteTarget) {
       this.recordPublic({ type: 'SYSTEM', content: 'Peaceful night. No attempts were made.' });
    } else if (deaths.size === 0) {
       // Attempts made but failed (saved)
       // Messages already logged above for saves
    }
  }

  private async dayPhase() {
    this.recordPublic({ type: 'SYSTEM', content: `--- Day ${this.state.round} Discussion ---` });
    
    // Configurable rounds of discussion
    const discussionRounds = this.config.rounds || 3;
    
    for (let r = 0; r < discussionRounds; r++) {
       const alivePlayers = Object.values(this.state.players).filter(p => p.isAlive);
       // Round robin
       for (const player of alivePlayers) {
         const name = player.config.name;
         const context = `
Current Phase: Day ${this.state.round}, Discussion Round ${r + 1}.
This is your public speaking turn. Speak as ${name}.
Goal: Convince others, find mafia (or hide if you are mafia).
Alive players: ${alivePlayers.map(p => p.config.name).join(', ')}.
         `.trim();

         const message = await this.agents[name].generateResponse(context, []);
         
         const entry = {
           type: 'CHAT' as const,
           player: name,
           content: message
         };
         
         this.recordPublic(entry);
       }
    }
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
    const mafiaCount = aliveFunctions.filter(p => p.role === 'mafia').length;
    const villagerCount = aliveFunctions.filter(p => p.role !== 'mafia').length;

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
