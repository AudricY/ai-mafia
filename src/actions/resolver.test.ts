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
    MafRb: 'mafia_roleblocker',
    Town: 'villager',
  };

  const actions: NightActionIntent[] = [
    { kind: 'investigate', actor: 'Cop', target: 'Maf' },
    { kind: 'investigate', actor: 'Cop', target: 'Gf' },
    { kind: 'investigate', actor: 'Cop', target: 'MafRb' },
    { kind: 'investigate', actor: 'Cop', target: 'Town' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  const byTarget = new Map(resolved.investigations.map(r => [r.target, r.result] as const));
  assert.equal(byTarget.get('Maf'), 'MAFIA');
  assert.equal(byTarget.get('Gf'), 'INNOCENT');
  assert.equal(byTarget.get('MafRb'), 'MAFIA');
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

test('resolveNightActions: mafia roleblocker blocks roleblocker, roleblocker blocks someone', () => {
  const rolesByPlayer: Record<string, Role> = {
    Rb: 'roleblocker',
    MafRb: 'mafia_roleblocker',
    Someone: 'villager',
  };

  // Mafia roleblocker blocks roleblocker, roleblocker blocks someone
  // Expected: Blocks resolve simultaneously. Roleblocker is blocked, so their block on Someone doesn't apply.
  // Someone is NOT blocked.
  const actions: NightActionIntent[] = [
    { kind: 'block', actor: 'MafRb', target: 'Rb' },
    { kind: 'block', actor: 'Rb', target: 'Someone' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(resolved.blockedPlayers.has('Rb')); // Roleblocker is blocked by mafia roleblocker
  assert.ok(!resolved.blockedPlayers.has('Someone')); // Someone is NOT blocked (roleblocker was blocked)
  assert.ok(!resolved.blockedPlayers.has('MafRb')); // Mafia roleblocker is not blocked
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

test('resolveNightActions: tracker behavior stable with canonical action ordering', () => {
  const rolesByPlayer: Record<string, Role> = {
    Tracker: 'tracker',
    Cop: 'cop',
    Doc: 'doctor',
    Town: 'villager',
  };

  // Tracker tracks Cop, Cop investigates Town, Doc saves Town
  // With canonical ordering (jails/blocks first, then mafia actions, then town actions):
  // Expected: Tracker sees Cop visited Town (investigation is the first successful action)
  const actions: NightActionIntent[] = [
    // Town actions in canonical order: investigate, save
    { kind: 'investigate', actor: 'Cop', target: 'Town' },
    { kind: 'save', actor: 'Doc', target: 'Town' },
    { kind: 'track', actor: 'Tracker', target: 'Cop' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  const trackerResult = resolved.trackerResults.find(r => r.actor === 'Tracker');
  assert.ok(trackerResult);
  assert.equal(trackerResult?.visited, 'Town'); // Tracker sees Cop's investigation visit

  // Verify that reordering actions (as might happen with async collection) doesn't change result
  // as long as we maintain canonical ordering in roleRegistry
  const actionsReordered: NightActionIntent[] = [
    { kind: 'track', actor: 'Tracker', target: 'Cop' },
    { kind: 'save', actor: 'Doc', target: 'Town' },
    { kind: 'investigate', actor: 'Cop', target: 'Town' },
  ];

  const resolvedReordered = resolveNightActions({ actions: actionsReordered, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  const trackerResultReordered = resolvedReordered.trackerResults.find(r => r.actor === 'Tracker');
  assert.ok(trackerResultReordered);
  // Tracker should still see the same visit (first successful action by tracked player)
  assert.equal(trackerResultReordered?.visited, 'Town');
});

test('resolveNightActions: mutual blocking - roleblocker blocks mafia roleblocker and vice versa', () => {
  const rolesByPlayer: Record<string, Role> = {
    Rb: 'roleblocker',
    MafRb: 'mafia_roleblocker',
    Someone: 'villager',
  };

  // Both blockers block each other
  // Expected: Both are blocked, neither's block applies
  const actions: NightActionIntent[] = [
    { kind: 'block', actor: 'Rb', target: 'MafRb' },
    { kind: 'block', actor: 'MafRb', target: 'Rb' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(resolved.blockedPlayers.has('Rb')); // Roleblocker is blocked
  assert.ok(resolved.blockedPlayers.has('MafRb')); // Mafia roleblocker is blocked
});

test('resolveNightActions: circular blocking chain', () => {
  const rolesByPlayer: Record<string, Role> = {
    Rb1: 'roleblocker',
    Rb2: 'roleblocker',
    Rb3: 'roleblocker',
    Someone: 'villager',
  };

  // Circular chain: Rb1 blocks Rb2, Rb2 blocks Rb3, Rb3 blocks Rb1
  // Expected: All are blocked (fixed-point iteration handles this)
  const actions: NightActionIntent[] = [
    { kind: 'block', actor: 'Rb1', target: 'Rb2' },
    { kind: 'block', actor: 'Rb2', target: 'Rb3' },
    { kind: 'block', actor: 'Rb3', target: 'Rb1' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(resolved.blockedPlayers.has('Rb1'));
  assert.ok(resolved.blockedPlayers.has('Rb2'));
  assert.ok(resolved.blockedPlayers.has('Rb3'));
});

test('resolveNightActions: jailkeeper blocks and protects target', () => {
  const rolesByPlayer: Record<string, Role> = {
    Jail: 'jailkeeper',
    Maf: 'mafia',
    Town: 'villager',
  };

  // Jailkeeper jails Town, Mafia tries to kill Town
  // Expected: Town is blocked and protected, kill fails
  const actions: NightActionIntent[] = [
    { kind: 'jail', actor: 'Jail', target: 'Town' },
    { kind: 'kill', actor: 'Maf', target: 'Town', source: 'mafia' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(resolved.blockedPlayers.has('Town')); // Town is jailed (blocked)
  const kill = resolved.kills.find(k => k.target === 'Town');
  assert.ok(kill);
  assert.ok(kill.saved); // Town is saved by jail
  assert.ok(!resolved.deaths.has('Town')); // Town doesn't die
});

test('resolveNightActions: blocked jailkeeper cannot jail', () => {
  const rolesByPlayer: Record<string, Role> = {
    Jail: 'jailkeeper',
    Rb: 'roleblocker',
    Maf: 'mafia',
    Town: 'villager',
  };

  // Roleblocker blocks jailkeeper, jailkeeper tries to jail Town, Mafia kills Town
  // Expected: Jailkeeper is blocked, Town is not protected, Town dies
  const actions: NightActionIntent[] = [
    { kind: 'block', actor: 'Rb', target: 'Jail' },
    { kind: 'jail', actor: 'Jail', target: 'Town' },
    { kind: 'kill', actor: 'Maf', target: 'Town', source: 'mafia' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(resolved.blockedPlayers.has('Jail')); // Jailkeeper is blocked
  assert.ok(!resolved.blockedPlayers.has('Town')); // Town is not jailed
  assert.ok(resolved.deaths.has('Town')); // Town dies
});

test('resolveNightActions: multiple blockers target same player', () => {
  const rolesByPlayer: Record<string, Role> = {
    Rb1: 'roleblocker',
    Rb2: 'roleblocker',
    MafRb: 'mafia_roleblocker',
    Doc: 'doctor',
  };

  // Multiple blockers all target doctor
  // Expected: Doctor is blocked (only need one successful block)
  const actions: NightActionIntent[] = [
    { kind: 'block', actor: 'Rb1', target: 'Doc' },
    { kind: 'block', actor: 'Rb2', target: 'Doc' },
    { kind: 'block', actor: 'MafRb', target: 'Doc' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(resolved.blockedPlayers.has('Doc')); // Doctor is blocked
});

test('resolveNightActions: blocked framer does not frame', () => {
  const rolesByPlayer: Record<string, Role> = {
    Cop: 'cop',
    Framer: 'framer',
    Rb: 'roleblocker',
    Town: 'villager',
  };

  // Roleblocker blocks framer, framer tries to frame Town, cop investigates Town
  // Expected: Framer is blocked, Town is not framed, cop sees INNOCENT
  const actions: NightActionIntent[] = [
    { kind: 'block', actor: 'Rb', target: 'Framer' },
    { kind: 'frame', actor: 'Framer', target: 'Town' },
    { kind: 'investigate', actor: 'Cop', target: 'Town' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(resolved.blockedPlayers.has('Framer'));
  const inv = resolved.investigations.find(i => i.target === 'Town');
  assert.ok(inv);
  assert.equal(inv?.result, 'INNOCENT'); // Not framed because framer was blocked
});

test('resolveNightActions: blocked janitor does not clean', () => {
  const rolesByPlayer: Record<string, Role> = {
    Janitor: 'janitor',
    Maf: 'mafia',
    Rb: 'roleblocker',
    Town: 'villager',
  };

  // Roleblocker blocks janitor, mafia kills Town, janitor tries to clean
  // Expected: Janitor is blocked, no death reveal override
  const actions: NightActionIntent[] = [
    { kind: 'block', actor: 'Rb', target: 'Janitor' },
    { kind: 'kill', actor: 'Maf', target: 'Town', source: 'mafia' },
    { kind: 'clean', actor: 'Janitor', target: 'Town' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(resolved.blockedPlayers.has('Janitor'));
  assert.ok(resolved.deaths.has('Town'));
  const override = resolved.deathRevealOverrides.find(o => o.player === 'Town');
  assert.equal(override, undefined); // No override because janitor was blocked
});

test('resolveNightActions: blocked forger does not forge', () => {
  const rolesByPlayer: Record<string, Role> = {
    Forger: 'forger',
    Maf: 'mafia',
    Rb: 'roleblocker',
    Town: 'villager',
  };

  // Roleblocker blocks forger, mafia kills Town, forger tries to forge
  // Expected: Forger is blocked, no death reveal override
  const actions: NightActionIntent[] = [
    { kind: 'block', actor: 'Rb', target: 'Forger' },
    { kind: 'kill', actor: 'Maf', target: 'Town', source: 'mafia' },
    { kind: 'forge', actor: 'Forger', target: 'Town', fakeRole: 'cop' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(resolved.blockedPlayers.has('Forger'));
  assert.ok(resolved.deaths.has('Town'));
  const override = resolved.deathRevealOverrides.find(o => o.player === 'Town');
  assert.equal(override, undefined); // No override because forger was blocked
});

test('resolveNightActions: blocked tracker does not track', () => {
  const rolesByPlayer: Record<string, Role> = {
    Tracker: 'tracker',
    Cop: 'cop',
    Rb: 'roleblocker',
    Town: 'villager',
  };

  // Roleblocker blocks tracker, tracker tries to track cop, cop investigates Town
  // Expected: Tracker is blocked, no tracker result
  const actions: NightActionIntent[] = [
    { kind: 'block', actor: 'Rb', target: 'Tracker' },
    { kind: 'track', actor: 'Tracker', target: 'Cop' },
    { kind: 'investigate', actor: 'Cop', target: 'Town' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(resolved.blockedPlayers.has('Tracker'));
  const trackerResult = resolved.trackerResults.find(r => r.actor === 'Tracker');
  // Tracker result should exist but visited should be null (or result shouldn't exist at all)
  // Actually, looking at the code, blocked trackers don't add results, so this should be undefined
  assert.equal(trackerResult, undefined);
});

test('resolveNightActions: vigilante kill blocked and saved', () => {
  const rolesByPlayer: Record<string, Role> = {
    Vig: 'vigilante',
    Doc: 'doctor',
    Rb: 'roleblocker',
    Maf: 'mafia',
    Town: 'villager',
  };

  // Roleblocker blocks vigilante, doctor saves Town, vigilante tries to kill Town
  // Expected: Vigilante is blocked, kill doesn't happen
  const actions: NightActionIntent[] = [
    { kind: 'block', actor: 'Rb', target: 'Vig' },
    { kind: 'save', actor: 'Doc', target: 'Town' },
    { kind: 'kill', actor: 'Vig', target: 'Town', source: 'vigilante' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(resolved.blockedPlayers.has('Vig'));
  const kill = resolved.kills.find(k => k.actor === 'Vig');
  assert.ok(kill);
  assert.ok(kill.blocked);
  assert.ok(!resolved.deaths.has('Town'));
});

test('resolveNightActions: vigilante kill saved by doctor', () => {
  const rolesByPlayer: Record<string, Role> = {
    Vig: 'vigilante',
    Doc: 'doctor',
    Town: 'villager',
  };

  // Vigilante kills Town, doctor saves Town
  // Expected: Kill happens but Town is saved
  const actions: NightActionIntent[] = [
    { kind: 'save', actor: 'Doc', target: 'Town' },
    { kind: 'kill', actor: 'Vig', target: 'Town', source: 'vigilante' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  const kill = resolved.kills.find(k => k.actor === 'Vig');
  assert.ok(kill);
  assert.ok(!kill.blocked);
  assert.ok(kill.saved);
  assert.ok(!resolved.deaths.has('Town'));
});

test('resolveNightActions: bomb retaliation on vigilante', () => {
  const rolesByPlayer: Record<string, Role> = {
    Bomb: 'bomb',
    Vig: 'vigilante',
    Town: 'villager',
  };

  // Vigilante kills Bomb
  // Expected: Both Bomb and Vig die
  const actions: NightActionIntent[] = [
    { kind: 'kill', actor: 'Vig', target: 'Bomb', source: 'vigilante' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(resolved.deaths.has('Bomb'));
  assert.ok(resolved.deaths.has('Vig'));
  assert.ok(resolved.bombRetaliations.has('Vig'));
});

test('resolveNightActions: bomb killed but saved - no retaliation', () => {
  const rolesByPlayer: Record<string, Role> = {
    Bomb: 'bomb',
    Doc: 'doctor',
    Maf: 'mafia',
  };

  // Mafia kills Bomb, doctor saves Bomb
  // Expected: Bomb is saved, no retaliation
  const actions: NightActionIntent[] = [
    { kind: 'save', actor: 'Doc', target: 'Bomb' },
    { kind: 'kill', actor: 'Maf', target: 'Bomb', source: 'mafia' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(!resolved.deaths.has('Bomb')); // Bomb is saved
  assert.ok(!resolved.deaths.has('Maf')); // No retaliation
  assert.ok(!resolved.bombRetaliations.has('Maf'));
});

test('resolveNightActions: blocked mafia killer - kill fails', () => {
  const rolesByPlayer: Record<string, Role> = {
    Maf: 'mafia',
    Rb: 'roleblocker',
    Town: 'villager',
  };

  // Roleblocker blocks mafia, mafia tries to kill Town
  // Expected: Mafia is blocked, kill fails
  const actions: NightActionIntent[] = [
    { kind: 'block', actor: 'Rb', target: 'Maf' },
    { kind: 'kill', actor: 'Maf', target: 'Town', source: 'mafia' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(resolved.blockedPlayers.has('Maf'));
  const kill = resolved.kills.find(k => k.actor === 'Maf');
  assert.ok(kill);
  assert.ok(kill.blocked);
  assert.ok(!resolved.deaths.has('Town'));
});

test('resolveNightActions: tracker sees block visit', () => {
  const rolesByPlayer: Record<string, Role> = {
    Tracker: 'tracker',
    Rb: 'roleblocker',
    Doc: 'doctor',
  };

  // Tracker tracks roleblocker, roleblocker blocks doctor
  // Expected: Tracker sees roleblocker visited doctor
  const actions: NightActionIntent[] = [
    { kind: 'track', actor: 'Tracker', target: 'Rb' },
    { kind: 'block', actor: 'Rb', target: 'Doc' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  const trackerResult = resolved.trackerResults.find(r => r.actor === 'Tracker');
  assert.ok(trackerResult);
  assert.equal(trackerResult?.visited, 'Doc');
});

test('resolveNightActions: tracker sees jail visit', () => {
  const rolesByPlayer: Record<string, Role> = {
    Tracker: 'tracker',
    Jail: 'jailkeeper',
    Town: 'villager',
  };

  // Tracker tracks jailkeeper, jailkeeper jails Town
  // Expected: Tracker sees jailkeeper visited Town
  const actions: NightActionIntent[] = [
    { kind: 'track', actor: 'Tracker', target: 'Jail' },
    { kind: 'jail', actor: 'Jail', target: 'Town' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  const trackerResult = resolved.trackerResults.find(r => r.actor === 'Tracker');
  assert.ok(trackerResult);
  assert.equal(trackerResult?.visited, 'Town');
});

test('resolveNightActions: tracker sees frame visit', () => {
  const rolesByPlayer: Record<string, Role> = {
    Tracker: 'tracker',
    Framer: 'framer',
    Town: 'villager',
  };

  // Tracker tracks framer, framer frames Town
  // Expected: Tracker sees framer visited Town
  const actions: NightActionIntent[] = [
    { kind: 'track', actor: 'Tracker', target: 'Framer' },
    { kind: 'frame', actor: 'Framer', target: 'Town' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  const trackerResult = resolved.trackerResults.find(r => r.actor === 'Tracker');
  assert.ok(trackerResult);
  assert.equal(trackerResult?.visited, 'Town');
});

test('resolveNightActions: tracker sees kill visit', () => {
  const rolesByPlayer: Record<string, Role> = {
    Tracker: 'tracker',
    Maf: 'mafia',
    Town: 'villager',
  };

  // Tracker tracks mafia, mafia kills Town
  // Expected: Tracker sees mafia visited Town
  const actions: NightActionIntent[] = [
    { kind: 'track', actor: 'Tracker', target: 'Maf' },
    { kind: 'kill', actor: 'Maf', target: 'Town', source: 'mafia' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  const trackerResult = resolved.trackerResults.find(r => r.actor === 'Tracker');
  assert.ok(trackerResult);
  assert.equal(trackerResult?.visited, 'Town');
});

test('resolveNightActions: tracker sees first successful action only', () => {
  const rolesByPlayer: Record<string, Role> = {
    Tracker: 'tracker',
    Cop: 'cop',
    Doc: 'doctor',
    Town1: 'villager',
    Town2: 'villager',
  };

  // Tracker tracks cop, cop investigates Town1, cop investigates Town2 (multiple actions)
  // Expected: Tracker sees first successful action (investigation of Town1)
  const actions: NightActionIntent[] = [
    { kind: 'track', actor: 'Tracker', target: 'Cop' },
    { kind: 'investigate', actor: 'Cop', target: 'Town1' },
    { kind: 'investigate', actor: 'Cop', target: 'Town2' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  const trackerResult = resolved.trackerResults.find(r => r.actor === 'Tracker');
  assert.ok(trackerResult);
  assert.equal(trackerResult?.visited, 'Town1'); // First action counts
});

test('resolveNightActions: death reveal override only on successful mafia kill', () => {
  const rolesByPlayer: Record<string, Role> = {
    Forger: 'forger',
    Vig: 'vigilante',
    Town: 'villager',
  };

  // Vigilante kills Town, forger tries to forge
  // Expected: No death reveal override (only applies to mafia kills)
  const actions: NightActionIntent[] = [
    { kind: 'kill', actor: 'Vig', target: 'Town', source: 'vigilante' },
    { kind: 'forge', actor: 'Forger', target: 'Town', fakeRole: 'cop' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(resolved.deaths.has('Town'));
  const override = resolved.deathRevealOverrides.find(o => o.player === 'Town');
  assert.equal(override, undefined); // No override for non-mafia kills
});

test('resolveNightActions: death reveal override only on actual death', () => {
  const rolesByPlayer: Record<string, Role> = {
    Forger: 'forger',
    Maf: 'mafia',
    Doc: 'doctor',
    Town: 'villager',
  };

  // Mafia kills Town, doctor saves Town, forger tries to forge
  // Expected: No death reveal override (Town didn't die)
  const actions: NightActionIntent[] = [
    { kind: 'save', actor: 'Doc', target: 'Town' },
    { kind: 'kill', actor: 'Maf', target: 'Town', source: 'mafia' },
    { kind: 'forge', actor: 'Forger', target: 'Town', fakeRole: 'cop' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(!resolved.deaths.has('Town')); // Town is saved
  const override = resolved.deathRevealOverrides.find(o => o.player === 'Town');
  assert.equal(override, undefined); // No override if target didn't die
});

test('resolveNightActions: multiple doctors save same target', () => {
  const rolesByPlayer: Record<string, Role> = {
    Doc1: 'doctor',
    Doc2: 'doctor',
    Maf: 'mafia',
    Town: 'villager',
  };

  // Two doctors both save Town, mafia kills Town
  // Expected: Town is saved (only need one save)
  const actions: NightActionIntent[] = [
    { kind: 'save', actor: 'Doc1', target: 'Town' },
    { kind: 'save', actor: 'Doc2', target: 'Town' },
    { kind: 'kill', actor: 'Maf', target: 'Town', source: 'mafia' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(resolved.savedPlayers.has('Town'));
  assert.ok(!resolved.deaths.has('Town'));
});

test('resolveNightActions: multiple cops investigate same target', () => {
  const rolesByPlayer: Record<string, Role> = {
    Cop1: 'cop',
    Cop2: 'cop',
    Town: 'villager',
  };

  // Two cops both investigate Town
  // Expected: Both investigations succeed, both see INNOCENT
  const actions: NightActionIntent[] = [
    { kind: 'investigate', actor: 'Cop1', target: 'Town' },
    { kind: 'investigate', actor: 'Cop2', target: 'Town' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  const inv1 = resolved.investigations.find(i => i.actor === 'Cop1');
  const inv2 = resolved.investigations.find(i => i.actor === 'Cop2');
  assert.ok(inv1);
  assert.ok(inv2);
  assert.equal(inv1?.result, 'INNOCENT');
  assert.equal(inv2?.result, 'INNOCENT');
});

test('resolveNightActions: empty actions list', () => {
  const rolesByPlayer: Record<string, Role> = {
    Town: 'villager',
  };

  // No actions
  // Expected: No deaths, no blocks, etc.
  const actions: NightActionIntent[] = [];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.equal(resolved.deaths.size, 0);
  assert.equal(resolved.blockedPlayers.size, 0);
  assert.equal(resolved.kills.length, 0);
  assert.equal(resolved.investigations.length, 0);
});

test('resolveNightActions: complex multi-role interaction', () => {
  const rolesByPlayer: Record<string, Role> = {
    Jail: 'jailkeeper',
    Rb: 'roleblocker',
    MafRb: 'mafia_roleblocker',
    Cop: 'cop',
    Doc: 'doctor',
    Framer: 'framer',
    Maf: 'mafia',
    Town: 'villager',
  };

  // Complex scenario:
  // - Jailkeeper jails roleblocker
  // - Roleblocker (blocked) tries to block mafia roleblocker
  // - Mafia roleblocker blocks cop
  // - Cop (blocked) tries to investigate Town
  // - Framer frames Town
  // - Doctor saves Town
  // - Mafia kills Town
  // Expected: Roleblocker jailed, cop blocked, Town framed but saved, no death
  const actions: NightActionIntent[] = [
    { kind: 'jail', actor: 'Jail', target: 'Rb' },
    { kind: 'block', actor: 'Rb', target: 'MafRb' },
    { kind: 'block', actor: 'MafRb', target: 'Cop' },
    { kind: 'investigate', actor: 'Cop', target: 'Town' },
    { kind: 'frame', actor: 'Framer', target: 'Town' },
    { kind: 'save', actor: 'Doc', target: 'Town' },
    { kind: 'kill', actor: 'Maf', target: 'Town', source: 'mafia' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(resolved.blockedPlayers.has('Rb')); // Jailed
  assert.ok(resolved.blockedPlayers.has('Cop')); // Blocked by mafia roleblocker
  assert.ok(!resolved.blockedPlayers.has('MafRb')); // Not blocked (roleblocker was jailed)
  assert.equal(resolved.investigations.length, 0); // Cop was blocked
  assert.ok(resolved.savedPlayers.has('Town')); // Saved by doctor
  assert.ok(!resolved.deaths.has('Town')); // Not killed
});

test('resolveNightActions: all mafia roles appear MAFIA to cop except godfather', () => {
  const rolesByPlayer: Record<string, Role> = {
    Cop: 'cop',
    Maf: 'mafia',
    Gf: 'godfather',
    MafRb: 'mafia_roleblocker',
    Framer: 'framer',
    Janitor: 'janitor',
    Forger: 'forger',
  };

  // Cop investigates all mafia roles
  // Expected: All appear MAFIA except godfather (INNOCENT)
  const actions: NightActionIntent[] = [
    { kind: 'investigate', actor: 'Cop', target: 'Maf' },
    { kind: 'investigate', actor: 'Cop', target: 'Gf' },
    { kind: 'investigate', actor: 'Cop', target: 'MafRb' },
    { kind: 'investigate', actor: 'Cop', target: 'Framer' },
    { kind: 'investigate', actor: 'Cop', target: 'Janitor' },
    { kind: 'investigate', actor: 'Cop', target: 'Forger' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  const byTarget = new Map(resolved.investigations.map(r => [r.target, r.result] as const));
  assert.equal(byTarget.get('Maf'), 'MAFIA');
  assert.equal(byTarget.get('Gf'), 'INNOCENT'); // Godfather appears innocent
  assert.equal(byTarget.get('MafRb'), 'MAFIA');
  assert.equal(byTarget.get('Framer'), 'MAFIA');
  assert.equal(byTarget.get('Janitor'), 'MAFIA');
  assert.equal(byTarget.get('Forger'), 'MAFIA');
});

test('resolveNightActions: framer makes godfather appear MAFIA', () => {
  const rolesByPlayer: Record<string, Role> = {
    Cop: 'cop',
    Framer: 'framer',
    Gf: 'godfather',
  };

  // Framer frames godfather, cop investigates godfather
  // Expected: Cop sees MAFIA (framer overrides godfather's innocent appearance)
  const actions: NightActionIntent[] = [
    { kind: 'frame', actor: 'Framer', target: 'Gf' },
    { kind: 'investigate', actor: 'Cop', target: 'Gf' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  const inv = resolved.investigations.find(i => i.target === 'Gf');
  assert.ok(inv);
  assert.equal(inv?.result, 'MAFIA'); // Framer overrides godfather
});

test('resolveNightActions: blocked cop does not investigate', () => {
  const rolesByPlayer: Record<string, Role> = {
    Cop: 'cop',
    Rb: 'roleblocker',
    Maf: 'mafia',
  };

  // Roleblocker blocks cop, cop tries to investigate mafia
  // Expected: Cop is blocked, no investigation result
  const actions: NightActionIntent[] = [
    { kind: 'block', actor: 'Rb', target: 'Cop' },
    { kind: 'investigate', actor: 'Cop', target: 'Maf' },
  ];

  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  assert.ok(resolved.blockedPlayers.has('Cop'));
  assert.equal(resolved.investigations.length, 0); // No investigation
});


