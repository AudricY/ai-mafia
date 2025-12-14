import type { GameEngine } from '../engine/gameEngine.js';
import { logger } from '../logger.js';

export class DayDiscussionPhase {
  async run(engine: GameEngine): Promise<void> {
    engine.recordPublic({ type: 'SYSTEM', content: `--- Day ${engine.state.round} Discussion ---` });

    const alivePlayers = engine.getAlivePlayers();
    const aliveCount = alivePlayers.length;
    const aliveNames = alivePlayers.map(p => p.config.name);
    let lastSpeakerName = 'none';

    const voteTally = engine.state.round > 1 ? engine.getVoteTallyForDay(engine.state.round - 1) : null;
    const recapLines = [
      `Alive: ${aliveNames.join(', ') || '(none)'}`,
      `Last night deaths: ${engine.lastNightDeaths.length ? engine.lastNightDeaths.join(', ') : 'none'}`,
      engine.state.round > 1
        ? `Yesterday's votes: ${voteTally ? engine.formatVoteTally(voteTally) : '(no vote data)'}`
        : `Yesterday's votes: (none yet)`,
    ];
    engine.recordPublic({
      type: 'SYSTEM',
      content: `Recap:\n- ${recapLines.join('\n- ')}`,
    });

    // Open discussion keeps the old pacing:
    // Day 1 = 15, Day 2 = 20, ...
    const openDiscussionMaxMessages = 10 + engine.state.round * 5;

    logger.log({
      type: 'SYSTEM',
      content: `Discussion started. Phases: QuestionRound(${aliveCount} turns) -> OpenDiscussion(max ${openDiscussionMaxMessages} messages) -> PreVote(${aliveCount} turns).`,
    });

    // --- Phase A: Question Round (1 turn per alive player) ---
    for (let i = 0; i < alivePlayers.length; i++) {
      const player = alivePlayers[i]!;
      const name = player.config.name;
      const nextSpeaker = alivePlayers[(i + 1) % aliveCount]?.config.name ?? 'none';
      const context = `
Current Phase: Day ${engine.state.round}, Question Round.
This is your public speaking turn. Speak as ${name}.
Alive players: ${aliveNames.join(', ')}.
Speaking order (fixed, round-robin): ${aliveNames.join(' -> ')}.
Your position in the order: ${i + 1}/${aliveCount}. Next speaker: ${nextSpeaker}.
Previous speaker: ${lastSpeakerName}.

Turn protocol (important):
- Discussion is strictly sequential / turn-based (one speaker at a time).
- You are speaking immediately after the previous speaker above.
- Avoid rehashing the previous speaker’s main point. If you reference it, do so briefly and add something new (a different angle or a targeted question).
- If you truly cannot add value, reply with the single word "SKIP".

Instruction:
- Ask ONE targeted question to a specific living player.
- Your question should reduce uncertainty (alignment, motives, votes, night actions).
- Keep it concise and concrete. No generic “any thoughts?” questions.
- If you truly cannot ask any question, reply with the single word "SKIP".
      `.trim();

      const message = await engine.agentIO.respond(name, context, []);
      const isSkip = message.trim().toUpperCase() === 'SKIP';

      if (isSkip) {
        engine.agents[name]?.observePrivateEvent('You chose to SKIP this turn.');
      } else {
        engine.recordPublic({
          type: 'CHAT',
          player: name,
          content: message,
        });
        lastSpeakerName = name;
      }
    }

    // --- Phase B: Open Discussion (round-robin until message budget or silence) ---
    let openMessagesSent = 0;
    let consecutiveSkips = 0;
    let turnIndex = 0;

    while (openMessagesSent < openDiscussionMaxMessages && consecutiveSkips < aliveCount) {
      const idx = turnIndex % aliveCount;
      const player = alivePlayers[idx]!;
      const nextSpeaker = alivePlayers[(idx + 1) % aliveCount]?.config.name ?? 'none';
      turnIndex++;

      const name = player.config.name;
      const context = `
Current Phase: Day ${engine.state.round}, Open Discussion.
This is your public speaking turn. Speak as ${name}.
Alive players: ${aliveNames.join(', ')}.
Speaking order (fixed, round-robin): ${aliveNames.join(' -> ')}.
Your position in the order: ${idx + 1}/${aliveCount}. Next speaker: ${nextSpeaker}.
Status: ${openMessagesSent}/${openDiscussionMaxMessages} open-discussion messages used.
Previous speaker: ${lastSpeakerName}.

Turn protocol (important):
- Discussion is strictly sequential / turn-based (one speaker at a time).
- You are speaking immediately after the previous speaker above.
- Avoid repeating the previous speaker’s core point. If you agree, reference it briefly and add a new reason, a different implication, or a targeted question.
- If you have nothing useful to add, you may reply with the single word "SKIP".

Guidance:
- Move the game forward with a concrete claim, inference, or question.
- Prefer referencing specific prior events (votes, night deaths, inconsistencies).
- If you agree with someone, add a NEW reason or a different angle; don't just echo.
- If you have nothing useful to add, you may reply with the single word "SKIP".
      `.trim();

      const message = await engine.agentIO.respond(name, context, []);
      const isSkip = message.trim().toUpperCase() === 'SKIP';

      if (isSkip) {
        consecutiveSkips++;
        engine.agents[name]?.observePrivateEvent('You chose to SKIP this turn.');
      } else {
        consecutiveSkips = 0;
        openMessagesSent++;
        engine.recordPublic({
          type: 'CHAT',
          player: name,
          content: message,
        });
        lastSpeakerName = name;
      }
    }

    if (consecutiveSkips >= aliveCount) {
      engine.recordPublic({ type: 'SYSTEM', content: 'Open discussion ended (silence settled over the town).' });
    } else {
      engine.recordPublic({ type: 'SYSTEM', content: 'Open discussion ended (message limit reached).' });
    }

    // --- Phase C: Pre-vote Statements (1 turn per alive player) ---
    for (let i = 0; i < alivePlayers.length; i++) {
      const player = alivePlayers[i]!;
      const name = player.config.name;
      const nextSpeaker = alivePlayers[(i + 1) % aliveCount]?.config.name ?? 'none';
      const context = `
Current Phase: Day ${engine.state.round}, Pre-vote Statement.
This is your final public statement before voting. Speak as ${name}.
Alive players: ${aliveNames.join(', ')}.
Speaking order (fixed, round-robin): ${aliveNames.join(' -> ')}.
Your position in the order: ${i + 1}/${aliveCount}. Next speaker: ${nextSpeaker}.
Previous speaker: ${lastSpeakerName}.

Turn protocol (important):
- Discussion is strictly sequential / turn-based (one speaker at a time).
- You are speaking immediately after the previous speaker above.
- Avoid repeating what was just said unless you are adding a materially new angle.
- If you have no read, say "SKIP".

Instruction:
- State your current #1 suspect OR say "skip" if you genuinely have no read.
- Give a concrete reason tied to an event (vote, wording, inconsistency).
- Say what evidence would change your mind.
- Keep it short.
      `.trim();

      const message = await engine.agentIO.respond(name, context, []);
      const isSkip = message.trim().toUpperCase() === 'SKIP';
      if (isSkip) {
        engine.agents[name]?.observePrivateEvent('You chose to SKIP this turn.');
      } else {
        engine.recordPublic({
          type: 'CHAT',
          player: name,
          content: message,
        });
        lastSpeakerName = name;
      }
    }

    engine.recordPublic({ type: 'SYSTEM', content: 'Discussion ended (pre-vote statements complete).' });
  }
}

