import test from 'node:test';
import assert from 'node:assert/strict';
import { computeOpenDiscussionMaxMessages, parseSkipVoteToken } from './dayDiscussionPhase.js';

test('parseSkipVoteToken: token-only message (vote)', () => {
  const result = parseSkipVoteToken('VOTE_SKIP_DISCUSSION');
  assert.equal(result.cleanedMessage, '');
  assert.equal(result.voteAction, 'vote');
});

test('parseSkipVoteToken: token-only message (unvote)', () => {
  const result = parseSkipVoteToken('UNVOTE_SKIP_DISCUSSION');
  assert.equal(result.cleanedMessage, '');
  assert.equal(result.voteAction, 'unvote');
});

test('parseSkipVoteToken: token + chat text (token removed)', () => {
  const result = parseSkipVoteToken('I think we should move on.\nVOTE_SKIP_DISCUSSION\nLet\'s vote.');
  assert.equal(result.cleanedMessage, 'I think we should move on.\nLet\'s vote.');
  assert.equal(result.voteAction, 'vote');
});

test('parseSkipVoteToken: chat text with token in middle', () => {
  const result = parseSkipVoteToken('First line\nVOTE_SKIP_DISCUSSION\nLast line');
  assert.equal(result.cleanedMessage, 'First line\nLast line');
  assert.equal(result.voteAction, 'vote');
});

test('parseSkipVoteToken: case-insensitive vote token', () => {
  const result = parseSkipVoteToken('vote_skip_discussion');
  assert.equal(result.cleanedMessage, '');
  assert.equal(result.voteAction, 'vote');
});

test('parseSkipVoteToken: case-insensitive unvote token', () => {
  const result = parseSkipVoteToken('UnVote_SkIp_DiScUsSiOn');
  assert.equal(result.cleanedMessage, '');
  assert.equal(result.voteAction, 'unvote');
});

test('parseSkipVoteToken: both tokens present (unvote takes precedence)', () => {
  const result = parseSkipVoteToken('VOTE_SKIP_DISCUSSION\nSome text\nUNVOTE_SKIP_DISCUSSION');
  assert.equal(result.cleanedMessage, 'Some text');
  assert.equal(result.voteAction, 'unvote');
});

test('parseSkipVoteToken: both tokens present (unvote first, vote last - unvote wins)', () => {
  const result = parseSkipVoteToken('UNVOTE_SKIP_DISCUSSION\nSome text\nVOTE_SKIP_DISCUSSION');
  assert.equal(result.cleanedMessage, 'Some text');
  assert.equal(result.voteAction, 'unvote');
});

test('parseSkipVoteToken: no tokens present', () => {
  const result = parseSkipVoteToken('Just some regular chat text here.');
  assert.equal(result.cleanedMessage, 'Just some regular chat text here.');
  assert.equal(result.voteAction, null);
});

test('parseSkipVoteToken: empty message', () => {
  const result = parseSkipVoteToken('');
  assert.equal(result.cleanedMessage, '');
  assert.equal(result.voteAction, null);
});

test('parseSkipVoteToken: whitespace-only message', () => {
  const result = parseSkipVoteToken('   \n  \t  ');
  assert.equal(result.cleanedMessage, '');
  assert.equal(result.voteAction, null);
});

test('parseSkipVoteToken: token with surrounding whitespace (should match)', () => {
  const result = parseSkipVoteToken('  VOTE_SKIP_DISCUSSION  ');
  assert.equal(result.cleanedMessage, '');
  assert.equal(result.voteAction, 'vote');
});

test('parseSkipVoteToken: partial token match (should not match)', () => {
  const result = parseSkipVoteToken('VOTE_SKIP_DISCUSSION_EXTRA');
  assert.equal(result.cleanedMessage, 'VOTE_SKIP_DISCUSSION_EXTRA');
  assert.equal(result.voteAction, null);
});

test('parseSkipVoteToken: multiple vote tokens (last one wins)', () => {
  const result = parseSkipVoteToken('VOTE_SKIP_DISCUSSION\nText\nVOTE_SKIP_DISCUSSION');
  assert.equal(result.cleanedMessage, 'Text');
  assert.equal(result.voteAction, 'vote');
});

test('parseSkipVoteToken: token on line with other text (should not match)', () => {
  const result = parseSkipVoteToken('I want to VOTE_SKIP_DISCUSSION now');
  assert.equal(result.cleanedMessage, 'I want to VOTE_SKIP_DISCUSSION now');
  assert.equal(result.voteAction, null);
});

test('computeOpenDiscussionMaxMessages: respects floor and cap', () => {
  const common = {
    plannedRounds: 3,
    perPlayerBase: 1.2,
    perPlayerRoundBonus: 1.0,
  };

  // Floor hit: small alive count early day
  assert.equal(
    computeOpenDiscussionMaxMessages({ ...common, aliveCount: 2, day: 1, floor: 8, cap: 60 }),
    8
  );

  // Cap hit: large alive count late day
  assert.equal(
    computeOpenDiscussionMaxMessages({ ...common, aliveCount: 40, day: 3, floor: 8, cap: 60 }),
    60
  );
});

test('computeOpenDiscussionMaxMessages: increases with aliveCount (monotonic)', () => {
  const common = {
    day: 2,
    plannedRounds: 3,
    floor: 0,
    cap: 1000,
    perPlayerBase: 1.2,
    perPlayerRoundBonus: 1.0,
  };

  const a = computeOpenDiscussionMaxMessages({ ...common, aliveCount: 4 });
  const b = computeOpenDiscussionMaxMessages({ ...common, aliveCount: 5 });
  const c = computeOpenDiscussionMaxMessages({ ...common, aliveCount: 6 });

  assert.ok(a <= b, `expected aliveCount 4 <= 5 (got ${a} <= ${b})`);
  assert.ok(b <= c, `expected aliveCount 5 <= 6 (got ${b} <= ${c})`);
});

test('computeOpenDiscussionMaxMessages: increases with day (monotonic, clamped to plannedRounds)', () => {
  const common = {
    aliveCount: 8,
    plannedRounds: 3,
    floor: 0,
    cap: 1000,
    perPlayerBase: 1.2,
    perPlayerRoundBonus: 1.0,
  };

  const d1 = computeOpenDiscussionMaxMessages({ ...common, day: 1 });
  const d2 = computeOpenDiscussionMaxMessages({ ...common, day: 2 });
  const d3 = computeOpenDiscussionMaxMessages({ ...common, day: 3 });
  const d10 = computeOpenDiscussionMaxMessages({ ...common, day: 10 }); // should clamp progress to 1

  assert.ok(d1 <= d2, `expected day 1 <= 2 (got ${d1} <= ${d2})`);
  assert.ok(d2 <= d3, `expected day 2 <= 3 (got ${d2} <= ${d3})`);
  assert.equal(d3, d10, 'expected day beyond plannedRounds to clamp to the max budget');
});

