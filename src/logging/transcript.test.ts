import test from 'node:test';
import assert from 'node:assert/strict';
import type { GameLogEntry } from '../types.js';
import { formatPublicTranscriptLine, isPublicTranscriptEntry } from './transcript.js';

function makeEntry(overrides: Partial<GameLogEntry> = {}): GameLogEntry {
  return {
    id: overrides.id ?? 'entry-1',
    timestamp: overrides.timestamp ?? '2026-03-18T12:00:00.000Z',
    type: overrides.type ?? 'SYSTEM',
    content: overrides.content ?? 'hello',
    ...overrides,
  };
}

test('formatPublicTranscriptLine tags chat speakers explicitly', () => {
  const line = formatPublicTranscriptLine(
    makeEntry({
      type: 'CHAT',
      player: 'Alice',
      content: 'Bob: I still think we should vote Carol.',
    })
  );

  assert.equal(line, '[CHAT][Alice] Bob: I still think we should vote Carol.');
});

test('formatPublicTranscriptLine flattens multiline content', () => {
  const line = formatPublicTranscriptLine(
    makeEntry({
      type: 'CHAT',
      player: 'Alice',
      content: 'First line.\nSecond line.\n\nThird line.',
    })
  );

  assert.equal(line, '[CHAT][Alice] First line. Second line. Third line.');
});

test('isPublicTranscriptEntry excludes explicitly private legacy-visible types', () => {
  const entry = makeEntry({
    type: 'SYSTEM',
    content: 'private debug detail',
    metadata: { visibility: 'private' },
  });

  assert.equal(isPublicTranscriptEntry(entry), false);
  assert.equal(formatPublicTranscriptLine(entry), null);
});

test('formatPublicTranscriptLine still includes legacy public entries without visibility metadata', () => {
  const line = formatPublicTranscriptLine(
    makeEntry({
      type: 'VOTE',
      player: 'Bob',
      content: 'voted to eliminate Alice',
    })
  );

  assert.equal(line, '[VOTE][Bob] voted to eliminate Alice');
});
