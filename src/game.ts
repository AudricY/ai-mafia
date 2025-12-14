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
          this.agents[name]?.setFactionMemory(role === 'mafia' ? this.mafiaMemory : undefined);
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
      this.agents[p.config.name]?.setFactionMemory(p.role === 'mafia' ? this.mafiaMemory : undefined);
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
    
    // Mafia Action
    const mafias = alivePlayers.filter(p => p.role === 'mafia');
    let targetToKill: string | null = null;
    
    if (mafias.length > 0) {
      // For simplicity, if multiple mafia, first one decides or they vote. 
      // Let's just have the first one decide for MVP.
      const killer = mafias[0];
      const validTargets = aliveNames.filter(n => n !== killer.config.name && this.state.players[n].role !== 'mafia');
      
      if (validTargets.length > 0) {
        targetToKill = await this.agents[killer.config.name].generateDecision(
          `Night ${this.state.round}. You are Mafia. Choose a non-mafia player to kill.`,
          validTargets
        );
        this.agents[killer.config.name]?.observeFactionEvent(`We chose to kill ${targetToKill} on night ${this.state.round}.`);
        logger.log({ 
          type: 'ACTION', 
          player: killer.config.name, 
          content: `chose to kill ${targetToKill}`,
          metadata: { target: targetToKill, role: 'mafia' }
        });
      }
    }

    // Cop Action
    const cops = alivePlayers.filter(p => p.role === 'cop');
    if (cops.length > 0) {
      const cop = cops[0];
      const validTargets = aliveNames.filter(n => n !== cop.config.name);
      if (validTargets.length > 0) {
        const target = await this.agents[cop.config.name].generateDecision(
           `Night ${this.state.round}. You are the Cop. Choose a player to investigate to see if they are Mafia.`,
           validTargets
        );
        const isMafia = this.state.players[target].role === 'mafia';
        const result = isMafia ? 'MAFIA' : 'INNOCENT';
        
        this.agents[cop.config.name]?.observePrivateEvent(
          `Investigation result (night ${this.state.round}): ${target} is ${result}.`
        );
        logger.log({
          type: 'ACTION',
          player: cop.config.name,
          content: `investigated ${target} and found they are ${result}`,
          metadata: { target, result, role: 'cop' }
        });
        // In a real implementation, we'd persist this knowledge to the agent's memory
      }
    }

    // Doctor Action
    const doctors = alivePlayers.filter(p => p.role === 'doctor');
    let savedTarget: string | null = null;
    if (doctors.length > 0) {
      const doc = doctors[0];
      savedTarget = await this.agents[doc.config.name].generateDecision(
        `Night ${this.state.round}. You are the Doctor. Choose a player to save from potential assassination.`,
        aliveNames
      );
      this.agents[doc.config.name]?.observePrivateEvent(
        `Doctor action (night ${this.state.round}): you chose to save ${savedTarget}.`
      );
      logger.log({
        type: 'ACTION',
        player: doc.config.name,
        content: `chose to save ${savedTarget}`,
        metadata: { target: savedTarget, role: 'doctor' }
      });
    }

    // Resolution
    if (targetToKill) {
      if (targetToKill === savedTarget) {
        this.recordPublic({ type: 'SYSTEM', content: `Mafia tried to kill ${targetToKill}, but they were saved by the Doctor!` });
      } else {
        this.killPlayer(targetToKill);
        this.recordPublic({ type: 'SYSTEM', content: `${targetToKill} was killed during the night.` });
      }
    } else {
      this.recordPublic({ type: 'SYSTEM', content: 'Peaceful night. No one died.' });
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
