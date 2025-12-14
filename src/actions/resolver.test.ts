import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNightActions } from './resolver.js';
import type { NightActionIntent } from './types.js';
import type { Role } from '../types.js';

test('resolveNightActions: roleblock prevents non-block actions', () => {
  const rolesByPlayer: Record<string, Role> = {
    Alice: 'roleblocker',
    Bob: 'doctor',
    Carol: 'mafia',
    Dave: 'villager',
  };

  const actions: NightActionIntent[] = [
    { kind: 'block', actor: 'Alice', target: 'Bob' },
    { kind: 'save', actor: 'Bob', target: 'Dave' },
    { kind: 'kill', actor: 'Carol', target: 'Dave', source: 'mafia' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer });
  assert.ok(resolved.blockedPlayers.has('Bob'));
  assert.ok(!resolved.savedPlayers.has('Dave'));
  assert.ok(resolved.deaths.has('Dave'));
});

test('resolveNightActions: doctor save prevents both mafia and vigilante kills', () => {
  const rolesByPlayer: Record<string, Role> = {
    Doc: 'doctor',
    Maf: 'mafia',
    Vig: 'vigilante',
    Town: 'villager',
  };

  const actions: NightActionIntent[] = [
    { kind: 'save', actor: 'Doc', target: 'Town' },
    { kind: 'kill', actor: 'Maf', target: 'Town', source: 'mafia' },
    { kind: 'kill', actor: 'Vig', target: 'Town', source: 'vigilante' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer });
  assert.ok(resolved.savedPlayers.has('Town'));
  assert.equal(resolved.deaths.size, 0);
  assert.equal(resolved.kills.filter(k => k.saved).length, 2);
});

test('resolveNightActions: cop sees mafia as MAFIA and godfather as INNOCENT', () => {
  const rolesByPlayer: Record<string, Role> = {
    Cop: 'cop',
    Maf: 'mafia',
    Gf: 'godfather',
    Town: 'villager',
  };

  const actions: NightActionIntent[] = [
    { kind: 'investigate', actor: 'Cop', target: 'Maf' },
    { kind: 'investigate', actor: 'Cop', target: 'Gf' },
    { kind: 'investigate', actor: 'Cop', target: 'Town' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer });
  const byTarget = new Map(resolved.investigations.map(r => [r.target, r.result] as const));
  assert.equal(byTarget.get('Maf'), 'MAFIA');
  assert.equal(byTarget.get('Gf'), 'INNOCENT');
  assert.equal(byTarget.get('Town'), 'INNOCENT');
});

test('resolveNightActions: prevents mafia-on-mafia deaths defensively', () => {
  const rolesByPlayer: Record<string, Role> = {
    Maf1: 'mafia',
    Maf2: 'godfather',
    Town: 'villager',
  };

  const actions: NightActionIntent[] = [{ kind: 'kill', actor: 'Maf2', target: 'Maf1', source: 'mafia' }];
  const resolved = resolveNightActions({ actions, rolesByPlayer });
  assert.equal(resolved.deaths.size, 0);
});

