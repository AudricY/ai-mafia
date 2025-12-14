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

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
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

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
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

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
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
  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.equal(resolved.deaths.size, 0);
});

test('resolveNightActions: blockable blocks with priority', () => {
  const rolesByPlayer: Record<string, Role> = {
    Jail: 'jailkeeper',
    Rb: 'roleblocker',
    MafRb: 'mafia_roleblocker',
    Doc: 'doctor',
    Town: 'villager',
  };

  // Jailkeeper blocks roleblocker, roleblocker blocks mafia_roleblocker, mafia_roleblocker tries to block doctor
  // Expected: Jailkeeper's block applies (highest priority), roleblocker is blocked so their block doesn't apply,
  // mafia_roleblocker is not blocked so their block applies, doctor is blocked
  const actions: NightActionIntent[] = [
    { kind: 'jail', actor: 'Jail', target: 'Rb' },
    { kind: 'block', actor: 'Rb', target: 'MafRb' },
    { kind: 'block', actor: 'MafRb', target: 'Doc' },
    { kind: 'save', actor: 'Doc', target: 'Town' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(resolved.blockedPlayers.has('Rb')); // Roleblocker is jailed
  assert.ok(resolved.blockedPlayers.has('Doc')); // Doctor is blocked by mafia_roleblocker
  assert.ok(!resolved.blockedPlayers.has('MafRb')); // Mafia roleblocker is NOT blocked (roleblocker was blocked)
  assert.ok(!resolved.savedPlayers.has('Town')); // Doctor was blocked, so no save
});

test('resolveNightActions: tracker sees successful visits only', () => {
  const rolesByPlayer: Record<string, Role> = {
    Tracker: 'tracker',
    Cop: 'cop',
    Rb: 'roleblocker',
    Doc: 'doctor',
    Town: 'villager',
  };

  // Tracker tracks Cop, Cop investigates Town, but Cop is blocked
  // Expected: Tracker sees no visit (Cop was blocked)
  const actions: NightActionIntent[] = [
    { kind: 'track', actor: 'Tracker', target: 'Cop' },
    { kind: 'block', actor: 'Rb', target: 'Cop' },
    { kind: 'investigate', actor: 'Cop', target: 'Town' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  const trackerResult = resolved.trackerResults.find(r => r.actor === 'Tracker');
  assert.ok(trackerResult);
  assert.equal(trackerResult?.visited, null); // No visit because Cop was blocked
});

test('resolveNightActions: tracker sees successful visit', () => {
  const rolesByPlayer: Record<string, Role> = {
    Tracker: 'tracker',
    Doc: 'doctor',
    Town: 'villager',
  };

  // Tracker tracks Doctor, Doctor saves Town
  // Expected: Tracker sees Doctor visited Town
  const actions: NightActionIntent[] = [
    { kind: 'track', actor: 'Tracker', target: 'Doc' },
    { kind: 'save', actor: 'Doc', target: 'Town' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  const trackerResult = resolved.trackerResults.find(r => r.actor === 'Tracker');
  assert.ok(trackerResult);
  assert.equal(trackerResult?.visited, 'Town');
});

test('resolveNightActions: framer makes target appear MAFIA', () => {
  const rolesByPlayer: Record<string, Role> = {
    Cop: 'cop',
    Framer: 'framer',
    Town: 'villager',
  };

  // Framer frames Town, Cop investigates Town
  // Expected: Cop sees Town as MAFIA (even though Town is actually villager)
  const actions: NightActionIntent[] = [
    { kind: 'frame', actor: 'Framer', target: 'Town' },
    { kind: 'investigate', actor: 'Cop', target: 'Town' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  const inv = resolved.investigations.find(i => i.target === 'Town');
  assert.ok(inv);
  assert.equal(inv?.result, 'MAFIA');
});

test('resolveNightActions: bomb retaliation kills attacker', () => {
  const rolesByPlayer: Record<string, Role> = {
    Bomb: 'bomb',
    Maf: 'mafia',
    Town: 'villager',
  };

  // Mafia kills Bomb
  // Expected: Both Bomb and Maf die
  const actions: NightActionIntent[] = [
    { kind: 'kill', actor: 'Maf', target: 'Bomb', source: 'mafia' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(resolved.deaths.has('Bomb'));
  assert.ok(resolved.deaths.has('Maf'));
  assert.ok(resolved.bombRetaliations.has('Maf'));
});

test('resolveNightActions: janitor hides role reveal', () => {
  const rolesByPlayer: Record<string, Role> = {
    Janitor: 'janitor',
    Maf: 'mafia',
    Town: 'villager',
  };

  // Mafia kills Town, Janitor cleans it
  // Expected: Death reveal override with null (unknown)
  const actions: NightActionIntent[] = [
    { kind: 'kill', actor: 'Maf', target: 'Town', source: 'mafia' },
    { kind: 'clean', actor: 'Janitor', target: 'Town' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(resolved.deaths.has('Town'));
  const override = resolved.deathRevealOverrides.find(o => o.player === 'Town');
  assert.ok(override);
  assert.equal(override?.revealedRole, null);
});

test('resolveNightActions: forger replaces role reveal', () => {
  const rolesByPlayer: Record<string, Role> = {
    Forger: 'forger',
    Maf: 'mafia',
    Town: 'villager',
  };

  // Mafia kills Town, Forger forges it as "cop"
  // Expected: Death reveal override with "cop"
  const actions: NightActionIntent[] = [
    { kind: 'kill', actor: 'Maf', target: 'Town', source: 'mafia' },
    { kind: 'forge', actor: 'Forger', target: 'Town', fakeRole: 'cop' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(resolved.deaths.has('Town'));
  const override = resolved.deathRevealOverrides.find(o => o.player === 'Town');
  assert.ok(override);
  assert.equal(override?.revealedRole, 'cop');
});

test('resolveNightActions: forger takes precedence over janitor', () => {
  const rolesByPlayer: Record<string, Role> = {
    Janitor: 'janitor',
    Forger: 'forger',
    Maf: 'mafia',
    Town: 'villager',
  };

  // Both Janitor and Forger target the same kill
  // Expected: Forger's fake role is used (forger takes precedence)
  const actions: NightActionIntent[] = [
    { kind: 'kill', actor: 'Maf', target: 'Town', source: 'mafia' },
    { kind: 'clean', actor: 'Janitor', target: 'Town' },
    { kind: 'forge', actor: 'Forger', target: 'Town', fakeRole: 'doctor' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  const override = resolved.deathRevealOverrides.find(o => o.player === 'Town');
  assert.ok(override);
  assert.equal(override?.revealedRole, 'doctor'); // Forger takes precedence
});

