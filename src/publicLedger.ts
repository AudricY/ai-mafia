import type { GameLogEntry, Role } from './types.js';

export interface PublicLedger {
  roleSetup?: string;
  graveyard: Array<{ player: string; when: string; role: Role | 'unknown' }>;
  voteSummaries: Array<{
    day: number;
    outcome: 'eliminate' | 'tie' | 'skip';
    eliminated?: string;
    tally: Record<string, number>;
  }>;
  win?: string;
}

export function buildPublicLedger(entries: readonly GameLogEntry[]): PublicLedger {
  const ledger: PublicLedger = {
    graveyard: [],
    voteSummaries: [],
  };

  // Filter to public entries only
  const publicEntries = entries.filter(
    e =>
      e.metadata?.visibility === 'public' ||
      e.type === 'SYSTEM' ||
      e.type === 'CHAT' ||
      e.type === 'VOTE' ||
      e.type === 'DEATH' ||
      e.type === 'WIN'
  );

  // Extract role setup (first SYSTEM entry about roles)
  for (const entry of publicEntries) {
    if (entry.type === 'SYSTEM') {
      const content = entry.content;
      if (
        content.startsWith('Available roles this game') ||
        content.startsWith('Possible roles this game')
      ) {
        ledger.roleSetup = content;
        break;
      }
    }
  }

  // Extract deaths
  for (const entry of publicEntries) {
    if (entry.type === 'DEATH' && entry.player) {
      const phase = entry.metadata?.phase as string | undefined;
      const day = entry.metadata?.day as number | undefined;
      const role = entry.metadata?.role as Role | undefined;

      let when = 'unknown';
      if (day !== undefined) {
        if (phase === 'day_voting' || phase === 'day_discussion') {
          when = `Day ${day} (lynch)`;
        } else if (phase === 'night') {
          when = `Night ${day}`;
        } else {
          when = `Day ${day}`;
        }
      } else if (phase === 'night') {
        when = 'Night';
      } else if (phase === 'day_voting' || phase === 'day_discussion') {
        when = 'Day (lynch)';
      }

      ledger.graveyard.push({
        player: entry.player,
        when,
        role: role ?? 'unknown',
      });
    }
  }

  // Extract vote summaries
  let currentDay: number | null = null;
  let currentVotes: Record<string, number> = {};
  let currentVoters: Record<string, string> = {};

  for (const entry of publicEntries) {
    // Detect voting phase markers
    if (entry.type === 'SYSTEM') {
      const markerMatch = entry.content.match(/^--- Day (\d+) Voting ---$/);
      if (markerMatch) {
        // Save previous day's summary if exists
        if (currentDay !== null && Object.keys(currentVotes).length > 0) {
          const maxVotes = Math.max(...Object.values(currentVotes));
          const candidates = Object.entries(currentVotes)
            .filter(([, count]) => count === maxVotes)
            .map(([target]) => target);

          let outcome: 'eliminate' | 'tie' | 'skip' = 'skip';
          let eliminated: string | undefined;

          if (candidates.length === 1 && candidates[0] !== 'skip' && maxVotes > 0) {
            outcome = 'eliminate';
            eliminated = candidates[0];
          } else if (candidates.length > 1 && maxVotes > 0) {
            outcome = 'tie';
          }

          ledger.voteSummaries.push({
            day: currentDay,
            outcome,
            eliminated,
            tally: { ...currentVotes },
          });
        }

        // Start new day
        currentDay = parseInt(markerMatch[1]!, 10);
        currentVotes = {};
        currentVoters = {};
        continue;
      }

      // Check for vote result summary
      if (currentDay !== null) {
        if (entry.content.includes('voted to eliminate')) {
          const match = entry.content.match(/eliminate (\w+)/);
          if (match) {
            const eliminated = match[1]!;
            const maxVotes = Math.max(...Object.values(currentVotes));
            ledger.voteSummaries.push({
              day: currentDay,
              outcome: 'eliminate',
              eliminated,
              tally: { ...currentVotes },
            });
            currentDay = null;
            currentVotes = {};
            currentVoters = {};
            continue;
          }
        } else if (entry.content.includes('Vote result:') && (entry.content.includes('Tie') || entry.content.includes('Skip'))) {
          const outcome = entry.content.includes('Tie') ? 'tie' : 'skip';
          ledger.voteSummaries.push({
            day: currentDay,
            outcome,
            tally: { ...currentVotes },
          });
          currentDay = null;
          currentVotes = {};
          currentVoters = {};
          continue;
        }
      }
    }

    // Collect votes
    if (entry.type === 'VOTE' && entry.player && currentDay !== null) {
      const voteTarget = entry.metadata?.vote;
      const target = typeof voteTarget === 'string' ? voteTarget : String(voteTarget ?? 'skip');
      currentVotes[target] = (currentVotes[target] ?? 0) + 1;
      currentVoters[entry.player] = target;
    }
  }

  // Handle final day if voting ended without explicit result
  if (currentDay !== null && Object.keys(currentVotes).length > 0) {
    const maxVotes = Math.max(...Object.values(currentVotes));
    const candidates = Object.entries(currentVotes)
      .filter(([, count]) => count === maxVotes)
      .map(([target]) => target);

    let outcome: 'eliminate' | 'tie' | 'skip' = 'skip';
    let eliminated: string | undefined;

    if (candidates.length === 1 && candidates[0] !== 'skip' && maxVotes > 0) {
      outcome = 'eliminate';
      eliminated = candidates[0];
    } else if (candidates.length > 1 && maxVotes > 0) {
      outcome = 'tie';
    }

    ledger.voteSummaries.push({
      day: currentDay,
      outcome,
      eliminated,
      tally: { ...currentVotes },
    });
  }

  // Extract win state
  for (let i = publicEntries.length - 1; i >= 0; i--) {
    const entry = publicEntries[i]!;
    if (entry.type === 'WIN') {
      ledger.win = entry.content;
      break;
    }
  }

  return ledger;
}

export function formatPublicLedger(ledger: PublicLedger): string {
  const lines: string[] = [];

  if (ledger.roleSetup) {
    lines.push(`Role Setup: ${ledger.roleSetup}`);
  }

  if (ledger.graveyard.length > 0) {
    lines.push('\nGraveyard:');
    for (const death of ledger.graveyard) {
      const roleStr = death.role === 'unknown' ? 'role unknown' : `was ${death.role}`;
      lines.push(`  ${death.when}: ${death.player} died (${roleStr})`);
    }
  }

  if (ledger.voteSummaries.length > 0) {
    lines.push('\nVote History:');
    for (const summary of ledger.voteSummaries) {
      const tallyStr = Object.entries(summary.tally)
        .filter(([, count]) => count > 0)
        .map(([target, count]) => `${target}: ${count}`)
        .join(', ');
      
      if (summary.outcome === 'eliminate' && summary.eliminated) {
        lines.push(`  Day ${summary.day}: Eliminated ${summary.eliminated} (${tallyStr})`);
      } else if (summary.outcome === 'tie') {
        lines.push(`  Day ${summary.day}: Tie (${tallyStr})`);
      } else {
        lines.push(`  Day ${summary.day}: Skip (${tallyStr})`);
      }
    }
  }

  if (ledger.win) {
    lines.push(`\n${ledger.win}`);
  }

  return lines.join('\n');
}
