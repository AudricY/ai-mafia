import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSkipVoteToken } from './dayDiscussionPhase.js';

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

