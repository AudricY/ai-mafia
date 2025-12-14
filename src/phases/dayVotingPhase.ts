import type { GameEngine } from '../engine/gameEngine.js';

export class DayVotingPhase {
  async run(engine: GameEngine): Promise<void> {
    engine.recordPublic({ type: 'SYSTEM', content: `--- Day ${engine.state.round} Voting ---` });

    const alivePlayers = engine.getAlivePlayers();
    const aliveNames = alivePlayers.map(p => p.config.name);
    const options = [...aliveNames, 'skip'];

    const votes: Record<string, number> = {};
    options.forEach(o => (votes[o] = 0));

    for (const player of alivePlayers) {
      const vote = await engine.agentIO.decide(
        player.config.name,
        `Day ${engine.state.round} voting. Choose a player to eliminate or 'skip'.`,
        options
      );

      engine.recordPublic({
        type: 'VOTE',
        player: player.config.name,
        content: `voted for ${vote}`,
        metadata: { vote },
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
      engine.recordPublic({
        type: 'SYSTEM',
        content: `The town has voted to eliminate ${candidate} with ${maxVotes} votes.`,
      });
      engine.killPlayer(candidate);
    } else {
      engine.recordPublic({
        type: 'SYSTEM',
        content: `Vote result: ${tie ? 'Tie' : 'Skip'}. No one was eliminated.`,
      });
    }
  }
}

