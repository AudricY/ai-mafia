import type { GameEngine } from '../engine/gameEngine.js';

export class DayVotingPhase {
  async run(engine: GameEngine): Promise<void> {
    engine.recordPublic({ type: 'SYSTEM', content: `--- Day ${engine.state.round} Voting ---` });

    const alivePlayers = engine.getAlivePlayers();
    const aliveNames = alivePlayers.map(p => p.config.name);
    const options = [...aliveNames, 'skip'] as const;

    const votes: Record<string, number> = {};
    options.forEach(o => (votes[o] = 0));

    // Collect all votes concurrently so each agent decides in parallel.
    const voteResults = await Promise.all(
      alivePlayers.map(async player => {
        const vote = await engine.agentIO.decide(
          player.config.name,
          `Day ${engine.state.round} voting. Choose a player to eliminate or 'skip'.`,
          options
        );
        return { playerName: player.config.name, vote };
      })
    );

    // Apply and log votes in a stable order (by player name) for deterministic logs.
    const aliveSet = new Set(aliveNames);
    voteResults
      .sort((a, b) => a.playerName.localeCompare(b.playerName))
      .forEach(({ playerName, vote }) => {
        if (vote !== 'skip' && !aliveSet.has(vote)) {
          engine.recordPublic({
            type: 'SYSTEM',
            content: `${playerName} voted for invalid target "${vote}" — vote discarded.`,
          });
          return;
        }

        engine.recordPublic({
          type: 'VOTE',
          player: playerName,
          content: `voted for ${vote}`,
          metadata: { vote },
        });

        votes[vote] = (votes[vote] || 0) + 1;
      });

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
      
      const eliminatedPlayer = engine.state.players[candidate];
      const eliminatedRole = eliminatedPlayer?.role;
      
      engine.killPlayer(candidate);
      
      // Check for Jester win (game continues)
      if (eliminatedRole === 'jester') {
        if (!engine.state.neutralWinners) {
          engine.state.neutralWinners = [];
        }
        if (!engine.state.neutralWinners.includes(candidate)) {
          engine.state.neutralWinners.push(candidate);
        }
        engine.recordPublic({
          type: 'SYSTEM',
          content: `${candidate} (Jester) wins by being eliminated! The game continues.`,
        });
      }
      
      // Check for Executioner co-win
      if (engine.state.executionerTargetByPlayer) {
        for (const [exeName, targetName] of Object.entries(engine.state.executionerTargetByPlayer)) {
          if (targetName === candidate) {
            const exePlayer = engine.state.players[exeName];
            if (exePlayer && exePlayer.isAlive) {
              if (!engine.state.neutralWinners) {
                engine.state.neutralWinners = [];
              }
              if (!engine.state.neutralWinners.includes(exeName)) {
                engine.state.neutralWinners.push(exeName);
              }
              engine.agents[exeName]?.observePrivateEvent(
                `Your target ${candidate} was eliminated by day vote. You have achieved your win condition!`
              );
            }
          }
        }
      }
    } else {
      engine.recordPublic({
        type: 'SYSTEM',
        content: `Vote result: ${tie ? 'Tie' : 'Skip'}. No one was eliminated.`,
      });
    }
  }
}







