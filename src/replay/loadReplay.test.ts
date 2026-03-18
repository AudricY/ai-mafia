import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { loadReplayEntries, resolveReplayPath } from './loadReplay.js';
import type { GameLogEntry } from '../types.js';

function makeEntry(overrides: Partial<GameLogEntry> = {}): GameLogEntry {
  return {
    id: overrides.id ?? 'entry-1',
    timestamp: overrides.timestamp ?? '2026-03-18T12:00:00.000Z',
    type: overrides.type ?? 'SYSTEM',
    content: overrides.content ?? 'hello',
    ...overrides,
  };
}

test('loadReplayEntries reads legacy JSON array logs', () => {
  const logDir = path.join(process.cwd(), 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  const filePath = path.join(logDir, `test-replay-array-${process.pid}-${Date.now()}.json`);
  const entries = [
    makeEntry(),
    makeEntry({ id: 'entry-2', type: 'CHAT', player: 'Alice', content: 'hi' }),
  ];

  try {
    fs.writeFileSync(filePath, JSON.stringify(entries, null, 2));
    assert.deepEqual(loadReplayEntries(filePath), entries);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

test('loadReplayEntries reads JSONL replay logs', () => {
  const logDir = path.join(process.cwd(), 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  const filePath = path.join(logDir, `test-replay-jsonl-${process.pid}-${Date.now()}.jsonl`);
  const entries = [
    makeEntry(),
    makeEntry({ id: 'entry-2', type: 'CHAT', player: 'Bob', content: 'streaming' }),
  ];

  try {
    fs.writeFileSync(filePath, `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`);
    assert.deepEqual(loadReplayEntries(filePath), entries);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

test('resolveReplayPath finds latest replay across jsonl and json logs', () => {
  const logDir = path.join(process.cwd(), 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  const legacyPath = path.join(logDir, 'game-2026-03-18T10-00-00-000Z.json');
  const jsonlPath = path.join(logDir, 'game-2026-03-18T10-00-01-000Z.jsonl');

  try {
    fs.writeFileSync(legacyPath, '[]\n');
    fs.writeFileSync(jsonlPath, '');
    assert.equal(resolveReplayPath('latest'), jsonlPath);
    assert.equal(resolveReplayPath(path.basename(jsonlPath)), jsonlPath);
    assert.equal(resolveReplayPath(path.basename(legacyPath).replace(/\.json$/, '')), legacyPath);
  } finally {
    fs.rmSync(legacyPath, { force: true });
    fs.rmSync(jsonlPath, { force: true });
  }
});
