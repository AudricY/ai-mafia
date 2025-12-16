import type { GameEngine } from '../engine/gameEngine.js';
import { logger } from '../logger.js';

function clamp01(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

function clampInt(x: number, min: number, max: number): number {
  const lo = Number.isFinite(min) ? min : 0;
  const hi = Number.isFinite(max) ? max : lo;
  const bounded = Math.min(Math.max(x, lo), hi);
  // Ensure a stable integer for message budgets.
  return Math.round(bounded);
}

export function computeOpenDiscussionMaxMessages(params: {
  aliveCount: number;
  day: number;
  plannedRounds: number;
  floor: number;
  cap: number;
  perPlayerBase: number;
  perPlayerRoundBonus: number;
}): number {
  const aliveCount = Math.max(0, Math.floor(params.aliveCount));
  const day = Math.max(1, Math.floor(params.day));
  const plannedRounds = Math.max(1, Math.floor(params.plannedRounds));

  const floor = Math.max(0, Math.floor(params.floor));
  const cap = Math.max(floor, Math.floor(params.cap));

  const perPlayerBase = Math.max(0, params.perPlayerBase);
  const perPlayerRoundBonus = Math.max(0, params.perPlayerRoundBonus);

  // Normalize day progress to [0,1] based on configured planned rounds.
  // If plannedRounds=1, progress is 0 (no scaling).
  const progress =
    plannedRounds > 1 ? clamp01((day - 1) / (plannedRounds - 1)) : 0;

  const perPlayer = perPlayerBase + perPlayerRoundBonus * progress;
  const raw = Math.round(aliveCount * perPlayer);
  return clampInt(raw, floor, cap);
}

/**
 * Parses vote tokens from a message and returns the cleaned message and vote action.
 * Returns { cleanedMessage, voteAction } where voteAction is 'vote', 'unvote', or null.
 */
export function parseSkipVoteToken(message: string): { cleanedMessage: string; voteAction: 'vote' | 'unvote' | null } {
  const lines = message.split('\n');
  let hasVote = false;
  let hasUnvote = false;
  const cleanedLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const upper = trimmed.toUpperCase();
    if (upper === 'VOTE_SKIP_DISCUSSION') {
      hasVote = true;
      // Skip this line (don't add to cleanedLines)
    } else if (upper === 'UNVOTE_SKIP_DISCUSSION') {
      hasUnvote = true;
      // Skip this line (don't add to cleanedLines)
    } else {
      cleanedLines.push(line);
    }
  }

  // If both tokens present, prefer unvote (more conservative - allows retraction)
  let voteAction: 'vote' | 'unvote' | null = null;
  if (hasUnvote) {
    voteAction = 'unvote';
  } else if (hasVote) {
    voteAction = 'vote';
  }

  const cleanedMessage = cleanedLines.join('\n').trim();
  return { cleanedMessage, voteAction };
}

export class DayDiscussionPhase {
  async run(engine: GameEngine): Promise<void> {
    engine.recordPublic({ type: 'SYSTEM', content: `--- Day ${engine.state.round} Discussion ---` });

    const alivePlayers = engine.getAlivePlayers();
    const aliveCount = alivePlayers.length;
    const aliveNames = alivePlayers.map(p => p.config.name);
    let lastSpeakerName = 'none';

    const mechanicsReminder = [
      'Mechanics reminder (public):',
      (engine.roleCounts.tracker || engine.config.role_setup_visibility !== 'exact')
        ? '- Tracker sees ONLY successful visits. "No visit" can mean they stayed home OR they were blocked.'
        : null,
      '- Town Roleblocker and Mafia Roleblocker cannot target themselves. Doctor CAN self-save.',
      '- If the Mafia killer is blocked, the Mafia kill fails.',
    ]
      .filter(Boolean)
      .join('\n');

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
      content: `${mechanicsReminder}\n\nRecap:\n- ${recapLines.join('\n- ')}`,
    });

    const openDiscussionMaxMessages = computeOpenDiscussionMaxMessages({
      aliveCount,
      day: engine.state.round,
      plannedRounds: engine.config.rounds,
      floor: engine.config.discussion_open_floor,
      cap: engine.config.discussion_open_cap,
      perPlayerBase: engine.config.discussion_open_per_player_base,
      perPlayerRoundBonus: engine.config.discussion_open_per_player_round_bonus,
    });

    logger.log({
      type: 'SYSTEM',
      content: `Discussion started. Phases: QuestionRound(${aliveCount} turns) -> OpenDiscussion(max ${openDiscussionMaxMessages} messages) -> PreVote(${aliveCount} turns).`,
    });

    // Track skip-discussion votes
    const skipVotes = new Set<string>();
    const majorityThreshold = Math.floor(aliveCount / 2) + 1;

    /**
     * Helper to check if skip vote threshold is reached and handle early exit if so.
     * Returns true if discussion should end early.
     */
    const checkSkipThreshold = (): boolean => {
      if (skipVotes.size >= majorityThreshold) {
        engine.recordPublic({
          type: 'SYSTEM',
          content: `Discussion ended early: ${skipVotes.size}/${aliveCount} players voted to skip discussion (majority reached).`,
        });
        return true;
      }
      return false;
    };

    /**
     * Helper to process a player's message for skip vote tokens and update vote state.
     * Returns the cleaned message (with vote tokens removed).
     */
    const processSkipVote = (playerName: string, message: string): string => {
      const { cleanedMessage, voteAction } = parseSkipVoteToken(message);
      
      if (voteAction === 'vote') {
        if (!skipVotes.has(playerName)) {
          skipVotes.add(playerName);
          engine.recordPublic({
            type: 'VOTE',
            player: playerName,
            content: 'voted to skip discussion',
            metadata: { vote: 'skip_discussion' },
          });
        }
      } else if (voteAction === 'unvote') {
        if (skipVotes.has(playerName)) {
          skipVotes.delete(playerName);
          engine.recordPublic({
            type: 'VOTE',
            player: playerName,
            content: 'retracted skip-discussion vote',
            metadata: { vote: 'skip_discussion', retracted: true },
          });
        }
      }
      
      return cleanedMessage;
    };

    /**
     * Helper to build skip vote status text for prompts.
     */
    const getSkipVoteStatus = (playerName: string): string => {
      const currentVote = skipVotes.has(playerName) ? 'voted' : 'not voted';
      return `Skip-discussion votes: ${skipVotes.size}/${aliveCount} (need ${majorityThreshold}). You currently: ${currentVote}.`;
    };

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

${getSkipVoteStatus(name)}

Skip-discussion voting:
- You can vote to skip discussion by including "VOTE_SKIP_DISCUSSION" on its own line in your response.
- You can retract your vote by including "UNVOTE_SKIP_DISCUSSION" on its own line.
- If a majority of players vote to skip, discussion ends immediately and voting begins.
- The vote command line will be removed from your public message; any other text you write will still be spoken.

Turn protocol (important):
- Discussion is strictly sequential / turn-based (one speaker at a time).
- You are speaking immediately after the previous speaker above.
- Avoid rehashing the previous speaker's main point. If you reference it, do so briefly and add something new (a different angle or a targeted question).
- If you truly cannot add value, reply with the single word "SKIP".

Instruction:
- Ask ONE targeted question to a specific living player.
- Your question should reduce uncertainty (alignment, motives, votes, night actions).
- Keep it concise and concrete. No generic "any thoughts?" questions.
- If you truly cannot ask any question, reply with the single word "SKIP".
      `.trim();

      const rawMessage = await engine.agentIO.respond(name, context, []);
      const message = processSkipVote(name, rawMessage);
      
      // Check if threshold reached after processing vote
      if (checkSkipThreshold()) {
        return;
      }

      const isSkip = message.trim().toUpperCase() === 'SKIP';

      if (isSkip) {
        engine.agents[name]?.observePrivateEvent('You chose to SKIP this turn.');
      } else if (message.trim()) {
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

${getSkipVoteStatus(name)}

Skip-discussion voting:
- You can vote to skip discussion by including "VOTE_SKIP_DISCUSSION" on its own line in your response.
- You can retract your vote by including "UNVOTE_SKIP_DISCUSSION" on its own line.
- If a majority of players vote to skip, discussion ends immediately and voting begins.
- The vote command line will be removed from your public message; any other text you write will still be spoken.

Turn protocol (important):
- Discussion is strictly sequential / turn-based (one speaker at a time).
- You are speaking immediately after the previous speaker above.
- Avoid repeating the previous speaker's core point. If you agree, reference it briefly and add a new reason, a different implication, or a targeted question.
- If you have nothing useful to add, you may reply with the single word "SKIP".

Guidance:
- Move the game forward with a concrete claim, inference, or question.
- Prefer referencing specific prior events (votes, night deaths, inconsistencies).
- If you agree with someone, add a NEW reason or a different angle; don't just echo.
- If you have nothing useful to add, you may reply with the single word "SKIP".
      `.trim();

      const rawMessage = await engine.agentIO.respond(name, context, []);
      const message = processSkipVote(name, rawMessage);
      
      // Check if threshold reached after processing vote
      if (checkSkipThreshold()) {
        return;
      }

      const isSkip = message.trim().toUpperCase() === 'SKIP';

      if (isSkip) {
        consecutiveSkips++;
        engine.agents[name]?.observePrivateEvent('You chose to SKIP this turn.');
      } else if (message.trim()) {
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

${getSkipVoteStatus(name)}

Skip-discussion voting:
- You can vote to skip discussion by including "VOTE_SKIP_DISCUSSION" on its own line in your response.
- You can retract your vote by including "UNVOTE_SKIP_DISCUSSION" on its own line.
- If a majority of players vote to skip, discussion ends immediately and voting begins.
- The vote command line will be removed from your public message; any other text you write will still be spoken.

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

      const rawMessage = await engine.agentIO.respond(name, context, []);
      const message = processSkipVote(name, rawMessage);
      
      // Check if threshold reached after processing vote
      if (checkSkipThreshold()) {
        return;
      }

      const isSkip = message.trim().toUpperCase() === 'SKIP';
      if (isSkip) {
        engine.agents[name]?.observePrivateEvent('You chose to SKIP this turn.');
      } else if (message.trim()) {
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

