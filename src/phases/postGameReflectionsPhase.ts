import type { GameEngine } from '../engine/gameEngine.js';
import type { GameLogEntry } from '../types.js';
import { isMafiaRole } from '../utils.js';

export class PostGameReflectionsPhase {
  async run(engine: GameEngine): Promise<void> {
    engine.recordPublic({ type: 'SYSTEM', content: '--- Post-game reflections ---' });

    // Build a compact transcript from public history entries
    // This gives all players (including dead ones) the same context
    const publicHistory = engine.state.history.filter(e => {
      const visibility = e.metadata?.visibility;
      const publicTypes = new Set<GameLogEntry['type']>(['CHAT', 'VOTE', 'DEATH', 'WIN']);
      if (publicTypes.has(e.type)) return true;
      if (e.type === 'SYSTEM') {
        return visibility !== 'private' && visibility !== 'faction';
      }
      return visibility === 'public';
    });

    // Format transcript for prompt
    const transcriptLines: string[] = [];
    for (const entry of publicHistory) {
      if (entry.type === 'SYSTEM') {
        transcriptLines.push(`[SYSTEM] ${entry.content}`);
      } else if (entry.type === 'CHAT' && entry.player) {
        transcriptLines.push(`${entry.player}: ${entry.content}`);
      } else if (entry.type === 'VOTE' && entry.player) {
        transcriptLines.push(`[VOTE] ${entry.player} ${entry.content}`);
      } else if (entry.type === 'DEATH' && entry.player) {
        transcriptLines.push(`[DEATH] ${entry.player} ${entry.content}`);
      } else if (entry.type === 'WIN') {
        transcriptLines.push(`[WIN] ${entry.content}`);
      }
    }
    const transcript = transcriptLines.join('\n');

    // Get all players (alive + dead)
    const allPlayers = Object.values(engine.state.players);

    // Build role summary for context
    const roleSummary: string[] = [];
    for (const [name, playerState] of Object.entries(engine.state.players)) {
      roleSummary.push(`${name} was ${playerState.role}`);
    }

    // Collect reflections from each player
    for (const player of allPlayers) {
      const name = player.config.name;
      const role = player.role;
      const isAlive = player.isAlive;
      const winners = engine.state.winners;
      
      // Determine if this player won
      let won = false;
      let winDescription = '';
      
      // Check if player is a jester winner (from neutralWinners)
      const isJesterWinner = role === 'jester' && (engine.state.neutralWinners?.includes(name) ?? false);
      
      if (winners === 'jester') {
        won = engine.state.neutralWinners?.includes(name) ?? false;
        winDescription = won ? `${name} (Jester) won` : 'Jester won';
      } else if (isJesterWinner) {
        // Jester won but game continued (winners !== 'jester')
        won = true;
        winDescription = `${name} (Jester) won (co-win)`;
      } else if (winners === 'mafia') {
        won = isMafiaRole(role) || (engine.state.neutralWinners?.includes(name) ?? false) || isJesterWinner;
        winDescription = 'Mafia won';
        if (engine.state.neutralWinners && engine.state.neutralWinners.length > 0) {
          winDescription += ` (Neutral co-winners: ${engine.state.neutralWinners.join(', ')})`;
        }
      } else if (winners === 'villagers') {
        won = (!isMafiaRole(role) || (engine.state.neutralWinners?.includes(name) ?? false)) || isJesterWinner;
        winDescription = 'Villagers won';
        if (engine.state.neutralWinners && engine.state.neutralWinners.length > 0) {
          winDescription += ` (Neutral co-winners: ${engine.state.neutralWinners.join(', ')})`;
        }
      }

      const prompt = `The game has ended. ${winDescription}.

Final role reveal:
${roleSummary.join('\n')}

Game transcript:
${transcript}

Your role was ${role}. You ${isAlive ? 'survived' : 'died'} during the game. You ${won ? 'won' : 'lost'}.

Give a brief post-game reflection (2-3 sentences). You can now discuss your true role, what you were thinking during key moments, what surprised you, or what you'd do differently. Keep it concise and conversational, like IRL post-game chat.`;

      const reflection = await engine.agentIO.reflect(name, prompt);

      engine.recordPublic({
        type: 'CHAT',
        player: name,
        content: reflection,
        metadata: { visibility: 'public', kind: 'post_game_reflection' },
      });
    }
  }
}

