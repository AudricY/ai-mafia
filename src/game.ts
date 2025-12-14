import { GameConfig, GameState, PlayerState, Role } from './types.js';
import type { CoreMessage } from 'ai';
import { Agent } from './agent.js';
import { logger } from './logger.js';

export class Game {
  private config: GameConfig;
  private state: GameState;
  private agents: Record<string, Agent>;

  constructor(config: GameConfig) {
    this.config = config;
    this.agents = {};
    const players: Record<string, PlayerState> = {};

    // Initialize players and agents
    config.players.forEach(p => {
      this.agents[p.name] = new Agent(p);
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

  private assignRoles() {
    const playerNames = Object.keys(this.state.players);
    const shuffled = [...playerNames].sort(() => Math.random() - 0.5);
    
    // Simple assignment logic based on config or random
    // If config.roles exists, use it. Otherwise random.
    if (this.config.roles) {
      for (const [name, role] of Object.entries(this.config.roles)) {
        if (this.state.players[name]) {
          this.state.players[name].role = role;
          // IMPORTANT: Update the agent so it knows its role for prompts!
          // We need a setter in Agent or pass it during action generation.
          // For now, let's just assume `generateDecision` uses the `context` we pass it efficiently
          // effectively injecting the role knowledge.
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
      // Sync role to agent helper (we will modify Agent class slightly to store this if needed, 
      // but purely context injection works too. Let's rely on context injection for now to keep it stateless).
      logger.log({
        type: 'SYSTEM',
        content: `Assigned role ${p.role} to ${p.config.name}`,
        metadata: { role: p.role, player: p.config.name }
      });
    });
  }

  async start() {
    logger.log({ type: 'SYSTEM', content: 'Game Starting...' });
    
    while (!this.state.winners) {
      await this.playRound();
    }

    logger.log({ type: 'WIN', content: `Game Over! Winners: ${this.state.winners}` });
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
    logger.log({ type: 'SYSTEM', content: `--- Night ${this.state.round} ---` });
    
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
          `You are Mafia. Choose a villager to kill.`,
          validTargets
        );
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
           `You are the Cop. Choose a player to investigate to see if they are Mafia.`,
           validTargets
        );
        const isMafia = this.state.players[target].role === 'mafia';
        const result = isMafia ? 'MAFIA' : 'INNOCENT';
        
        // Give knowledge to Cop (update their notes/context)
        // For now, just log it as a private system event for the cop
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
        `You are the Doctor. Choose a player to save from potential assassination.`,
        aliveNames
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
        logger.log({ type: 'SYSTEM', content: `Mafia tried to kill ${targetToKill}, but they were saved by the Doctor!` });
      } else {
        this.killPlayer(targetToKill);
        logger.log({ type: 'DEATH', content: `${targetToKill} was killed during the night.` });
      }
    } else {
      logger.log({ type: 'SYSTEM', content: 'Peaceful night. No one died.' });
    }
  }

  private async dayPhase() {
    logger.log({ type: 'SYSTEM', content: `--- Day ${this.state.round} Discussion ---` });
    
    // Configurable rounds of discussion
    const discussionRounds = this.config.rounds || 3;
    
    for (let r = 0; r < discussionRounds; r++) {
       const alivePlayers = Object.values(this.state.players).filter(p => p.isAlive);
       // Round robin
       for (const player of alivePlayers) {
         const name = player.config.name;
         // Construct public context from recent history
         // In a real app we'd summarize headers, but here we pass raw messages
         const recentHistory: CoreMessage[] = this.state.history
           .filter(h => h.type === 'CHAT' || h.type === 'DEATH' || h.type === 'SYSTEM')
           .slice(-10) // Context window limit
           .map(h => ({
             role: (h.player ? 'user' : 'system') as 'user' | 'system', // simplify mapping
             content: h.player ? `${h.player}: ${h.content}` : `[SYSTEM]: ${h.content}`
           }));

         const context = `
           Current Phase: Day ${this.state.round}, Discussion Round ${r + 1}.
           You are ${name}. Your role is ${player.role}.
           Goal: Convince others, find mafia (or hide if you are mafia).
           Alive players: ${alivePlayers.map(p => p.config.name).join(', ')}.
         `;

         const message = await this.agents[name].generateResponse(context, recentHistory);
         
         const entry = {
           type: 'CHAT' as const,
           player: name,
           content: message
         };
         
         // Add to local state history
         this.state.history.push({
           id: crypto.randomUUID(),
           timestamp: new Date().toISOString(),
           ...entry
         });
         
         // Log it
         logger.log(entry);
       }
    }
  }

  private async votingPhase() {
    logger.log({ type: 'SYSTEM', content: `--- Day ${this.state.round} Voting ---` });
    
    const alivePlayers = Object.values(this.state.players).filter(p => p.isAlive);
    const aliveNames = alivePlayers.map(p => p.config.name);
    const options = [...aliveNames, 'skip'];
    
    const votes: Record<string, number> = {};
    options.forEach(o => votes[o] = 0);

    for (const player of alivePlayers) {
      const vote = await this.agents[player.config.name].generateDecision(
        `It is time to vote. Choose a player to eliminate or 'skip'.`,
        options
      );
      
      logger.log({
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
      logger.log({ type: 'SYSTEM', content: `The town has voted to eliminate ${candidate} with ${maxVotes} votes.` });
      this.killPlayer(candidate);
    } else {
      logger.log({ type: 'SYSTEM', content: `Vote result: ${tie ? 'Tie' : 'Skip'}. No one was eliminated.` });
    }
  }

  private killPlayer(name: string) {
    if (this.state.players[name]) {
      this.state.players[name].isAlive = false;
      logger.log({
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
