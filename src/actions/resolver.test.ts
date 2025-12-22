import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNightActions } from './resolver.js';
import type { NightActionIntent } from './types.js';
import type { Role } from '../types.js';

// --- Helpers ---

const block = (actor: string, target: string): NightActionIntent => ({ kind: 'block', actor, target });
const kill = (actor: string, target: string, source: 'mafia' | 'vigilante' = 'mafia'): NightActionIntent => ({ kind: 'kill', actor, target, source });
const investigate = (actor: string, target: string): NightActionIntent => ({ kind: 'investigate', actor, target });
const save = (actor: string, target: string): NightActionIntent => ({ kind: 'save', actor, target });
const track = (actor: string, target: string): NightActionIntent => ({ kind: 'track', actor, target });
const jail = (actor: string, target: string): NightActionIntent => ({ kind: 'jail', actor, target });
const frame = (actor: string, target: string): NightActionIntent => ({ kind: 'frame', actor, target });
const clean = (actor: string, target: string): NightActionIntent => ({ kind: 'clean', actor, target });
const forge = (actor: string, target: string, fakeRole: Role): NightActionIntent => ({ kind: 'forge', actor, target, fakeRole });

function resolve(rolesByPlayer: Record<string, Role>, actions: NightActionIntent[]) {
  const resolved = resolveNightActions({ actions, rolesByPlayer, alivePlayers: Object.keys(rolesByPlayer) });
  return {
    ...resolved,
    isBlocked: (p: string) => resolved.blockedPlayers.has(p),
    isSaved: (p: string) => resolved.savedPlayers.has(p),
    didDie: (p: string) => resolved.deaths.has(p),
    invOf: (target: string) => resolved.investigations.find(i => i.target === target)?.result,
    tracked: (actor: string) => resolved.trackerResults.find(r => r.actor === actor)?.visited,
    revealOf: (p: string) => resolved.deathRevealOverrides.find(o => o.player === p)?.revealedRole,
  };
}

// --- Tests ---

test('resolveNightActions: roleblock prevents non-block actions', () => {
  const { isBlocked, isSaved, didDie } = resolve(
    { Alice: 'roleblocker', Bob: 'doctor', Carol: 'mafia', Dave: 'villager' },
    [block('Alice', 'Bob'), save('Bob', 'Dave'), kill('Carol', 'Dave')]
  );

  assert.ok(isBlocked('Bob'));
  assert.ok(!isSaved('Dave'));
  assert.ok(didDie('Dave'));
});

test('resolveNightActions: doctor save prevents both mafia and vigilante kills', () => {
  const { isSaved, didDie, kills } = resolve(
    { Doc: 'doctor', Maf: 'mafia', Vig: 'vigilante', Town: 'villager' },
    [save('Doc', 'Town'), kill('Maf', 'Town'), kill('Vig', 'Town', 'vigilante')]
  );

  assert.ok(isSaved('Town'));
  assert.equal(didDie('Town'), false);
  assert.equal(kills.filter(k => k.saved).length, 2);
});

test('resolveNightActions: cop sees mafia as MAFIA and godfather as INNOCENT', () => {
  const { invOf } = resolve(
    { Cop: 'cop', Maf: 'mafia', Gf: 'godfather', MafRb: 'mafia_roleblocker', Town: 'villager' },
    [investigate('Cop', 'Maf'), investigate('Cop', 'Gf'), investigate('Cop', 'MafRb'), investigate('Cop', 'Town')]
  );

  assert.equal(invOf('Maf'), 'MAFIA');
  assert.equal(invOf('Gf'), 'INNOCENT');
  assert.equal(invOf('MafRb'), 'MAFIA');
  assert.equal(invOf('Town'), 'INNOCENT');
});

test('resolveNightActions: prevents mafia-on-mafia deaths defensively', () => {
  const { didDie } = resolve(
    { Maf1: 'mafia', Maf2: 'godfather', Town: 'villager' },
    [kill('Maf2', 'Maf1')]
  );
  assert.equal(didDie('Maf1'), false);
});

test('resolveNightActions: blockable blocks with priority', () => {
  const { isBlocked, isSaved } = resolve(
    { Jail: 'jailkeeper', Rb: 'roleblocker', MafRb: 'mafia_roleblocker', Doc: 'doctor', Town: 'villager' },
    [jail('Jail', 'Rb'), block('Rb', 'MafRb'), block('MafRb', 'Doc'), save('Doc', 'Town')]
  );

  assert.ok(isBlocked('Rb'));
  assert.ok(isBlocked('Doc'));
  assert.ok(!isBlocked('MafRb'));
  assert.ok(!isSaved('Town'));
});

test('resolveNightActions: mafia roleblocker blocks roleblocker, roleblocker blocks someone', () => {
  const { isBlocked } = resolve(
    { Rb: 'roleblocker', MafRb: 'mafia_roleblocker', Someone: 'villager' },
    [block('MafRb', 'Rb'), block('Rb', 'Someone')]
  );

  assert.ok(isBlocked('Rb'));
  assert.ok(!isBlocked('Someone'));
  assert.ok(!isBlocked('MafRb'));
});

test('resolveNightActions: tracker sees successful visits only', () => {
  const { tracked } = resolve(
    { Tracker: 'tracker', Cop: 'cop', Rb: 'roleblocker', Doc: 'doctor', Town: 'villager' },
    [track('Tracker', 'Cop'), block('Rb', 'Cop'), investigate('Cop', 'Town')]
  );
  assert.equal(tracked('Tracker'), null);
});

test('resolveNightActions: tracker sees successful visit', () => {
  const { tracked } = resolve(
    { Tracker: 'tracker', Doc: 'doctor', Town: 'villager' },
    [track('Tracker', 'Doc'), save('Doc', 'Town')]
  );
  assert.equal(tracked('Tracker'), 'Town');
});

test('resolveNightActions: framer makes target appear MAFIA', () => {
  const { invOf } = resolve(
    { Cop: 'cop', Framer: 'framer', Town: 'villager' },
    [frame('Framer', 'Town'), investigate('Cop', 'Town')]
  );
  assert.equal(invOf('Town'), 'MAFIA');
});

test('resolveNightActions: bomb retaliation kills attacker', () => {
  const { didDie, bombRetaliations } = resolve(
    { Bomb: 'bomb', Maf: 'mafia', Town: 'villager' },
    [kill('Maf', 'Bomb')]
  );
  assert.ok(didDie('Bomb'));
  assert.ok(didDie('Maf'));
  assert.ok(bombRetaliations.has('Maf'));
});

test('resolveNightActions: janitor hides role reveal', () => {
  const { didDie, revealOf } = resolve(
    { Janitor: 'janitor', Maf: 'mafia', Town: 'villager' },
    [kill('Maf', 'Town'), clean('Janitor', 'Town')]
  );
  assert.ok(didDie('Town'));
  assert.equal(revealOf('Town'), null);
});

test('resolveNightActions: forger replaces role reveal', () => {
  const { didDie, revealOf } = resolve(
    { Forger: 'forger', Maf: 'mafia', Town: 'villager' },
    [kill('Maf', 'Town'), forge('Forger', 'Town', 'cop')]
  );
  assert.ok(didDie('Town'));
  assert.equal(revealOf('Town'), 'cop');
});

test('resolveNightActions: forger takes precedence over janitor', () => {
  const { revealOf } = resolve(
    { Janitor: 'janitor', Forger: 'forger', Maf: 'mafia', Town: 'villager' },
    [kill('Maf', 'Town'), clean('Janitor', 'Town'), forge('Forger', 'Town', 'doctor')]
  );
  assert.equal(revealOf('Town'), 'doctor');
});

test('resolveNightActions: tracker behavior stable with canonical action ordering', () => {
  const roles: Record<string, Role> = { Tracker: 'tracker', Cop: 'cop', Doc: 'doctor', Town: 'villager' };
  const { tracked: t1 } = resolve(roles, [investigate('Cop', 'Town'), save('Doc', 'Town'), track('Tracker', 'Cop')]);
  assert.equal(t1('Tracker'), 'Town');

  const { tracked: t2 } = resolve(roles, [track('Tracker', 'Cop'), save('Doc', 'Town'), investigate('Cop', 'Town')]);
  assert.equal(t2('Tracker'), 'Town');
});

test('resolveNightActions: mutual blocking - roleblocker blocks mafia roleblocker and vice versa', () => {
  const { isBlocked } = resolve(
    { Rb: 'roleblocker', MafRb: 'mafia_roleblocker', Someone: 'villager' },
    [block('Rb', 'MafRb'), block('MafRb', 'Rb')]
  );
  assert.ok(isBlocked('Rb'));
  assert.ok(isBlocked('MafRb'));
});

test('resolveNightActions: circular blocking chain', () => {
  const { isBlocked } = resolve(
    { Rb1: 'roleblocker', Rb2: 'roleblocker', Rb3: 'roleblocker', Someone: 'villager' },
    [block('Rb1', 'Rb2'), block('Rb2', 'Rb3'), block('Rb3', 'Rb1')]
  );
  assert.ok(isBlocked('Rb1'));
  assert.ok(isBlocked('Rb2'));
  assert.ok(isBlocked('Rb3'));
});

test('resolveNightActions: jailkeeper blocks and protects target', () => {
  const { isBlocked, didDie, kills } = resolve(
    { Jail: 'jailkeeper', Maf: 'mafia', Town: 'villager' },
    [jail('Jail', 'Town'), kill('Maf', 'Town')]
  );
  assert.ok(isBlocked('Town'));
  assert.ok(kills.find(k => k.target === 'Town')?.saved);
  assert.ok(!didDie('Town'));
});

test('resolveNightActions: blocked jailkeeper cannot jail', () => {
  const { isBlocked, didDie } = resolve(
    { Jail: 'jailkeeper', Rb: 'roleblocker', Maf: 'mafia', Town: 'villager' },
    [block('Rb', 'Jail'), jail('Jail', 'Town'), kill('Maf', 'Town')]
  );
  assert.ok(isBlocked('Jail'));
  assert.ok(!isBlocked('Town'));
  assert.ok(didDie('Town'));
});

test('resolveNightActions: multiple blockers target same player', () => {
  const { isBlocked } = resolve(
    { Rb1: 'roleblocker', Rb2: 'roleblocker', MafRb: 'mafia_roleblocker', Doc: 'doctor' },
    [block('Rb1', 'Doc'), block('Rb2', 'Doc'), block('MafRb', 'Doc')]
  );
  assert.ok(isBlocked('Doc'));
});

test('resolveNightActions: blocked framer does not frame', () => {
  const { isBlocked, invOf } = resolve(
    { Cop: 'cop', Framer: 'framer', Rb: 'roleblocker', Town: 'villager' },
    [block('Rb', 'Framer'), frame('Framer', 'Town'), investigate('Cop', 'Town')]
  );
  assert.ok(isBlocked('Framer'));
  assert.equal(invOf('Town'), 'INNOCENT');
});

test('resolveNightActions: blocked janitor does not clean', () => {
  const { isBlocked, didDie, revealOf } = resolve(
    { Janitor: 'janitor', Maf: 'mafia', Rb: 'roleblocker', Town: 'villager' },
    [block('Rb', 'Janitor'), kill('Maf', 'Town'), clean('Janitor', 'Town')]
  );
  assert.ok(isBlocked('Janitor'));
  assert.ok(didDie('Town'));
  assert.equal(revealOf('Town'), undefined);
});

test('resolveNightActions: blocked forger does not forge', () => {
  const { isBlocked, didDie, revealOf } = resolve(
    { Forger: 'forger', Maf: 'mafia', Rb: 'roleblocker', Town: 'villager' },
    [block('Rb', 'Forger'), kill('Maf', 'Town'), forge('Forger', 'Town', 'cop')]
  );
  assert.ok(isBlocked('Forger'));
  assert.ok(didDie('Town'));
  assert.equal(revealOf('Town'), undefined);
});

test('resolveNightActions: blocked tracker does not track', () => {
  const { isBlocked, tracked } = resolve(
    { Tracker: 'tracker', Cop: 'cop', Rb: 'roleblocker', Town: 'villager' },
    [block('Rb', 'Tracker'), track('Tracker', 'Cop'), investigate('Cop', 'Town')]
  );
  assert.ok(isBlocked('Tracker'));
  assert.equal(tracked('Tracker'), undefined);
});

test('resolveNightActions: vigilante kill blocked and saved', () => {
  const { isBlocked, didDie, kills } = resolve(
    { Vig: 'vigilante', Doc: 'doctor', Rb: 'roleblocker', Maf: 'mafia', Town: 'villager' },
    [block('Rb', 'Vig'), save('Doc', 'Town'), kill('Vig', 'Town', 'vigilante')]
  );
  assert.ok(isBlocked('Vig'));
  assert.ok(kills.find(k => k.actor === 'Vig')?.blocked);
  assert.ok(!didDie('Town'));
});

test('resolveNightActions: vigilante kill saved by doctor', () => {
  const { didDie, kills } = resolve(
    { Vig: 'vigilante', Doc: 'doctor', Town: 'villager' },
    [save('Doc', 'Town'), kill('Vig', 'Town', 'vigilante')]
  );
  const vKill = kills.find(k => k.actor === 'Vig');
  assert.ok(vKill && !vKill.blocked && vKill.saved);
  assert.ok(!didDie('Town'));
});

test('resolveNightActions: bomb retaliation on vigilante', () => {
  const { didDie, bombRetaliations } = resolve(
    { Bomb: 'bomb', Vig: 'vigilante', Town: 'villager' },
    [kill('Vig', 'Bomb', 'vigilante')]
  );
  assert.ok(didDie('Bomb'));
  assert.ok(didDie('Vig'));
  assert.ok(bombRetaliations.has('Vig'));
});

test('resolveNightActions: bomb killed but saved - no retaliation', () => {
  const { didDie, bombRetaliations } = resolve(
    { Bomb: 'bomb', Doc: 'doctor', Maf: 'mafia' },
    [save('Doc', 'Bomb'), kill('Maf', 'Bomb')]
  );
  assert.ok(!didDie('Bomb'));
  assert.ok(!didDie('Maf'));
  assert.ok(!bombRetaliations.has('Maf'));
});

test('resolveNightActions: blocked mafia killer - kill fails', () => {
  const { isBlocked, didDie, kills } = resolve(
    { Maf: 'mafia', Rb: 'roleblocker', Town: 'villager' },
    [block('Rb', 'Maf'), kill('Maf', 'Town')]
  );
  assert.ok(isBlocked('Maf'));
  assert.ok(kills.find(k => k.actor === 'Maf')?.blocked);
  assert.ok(!didDie('Town'));
});

test('resolveNightActions: tracker sees block visit', () => {
  const { tracked } = resolve(
    { Tracker: 'tracker', Rb: 'roleblocker', Doc: 'doctor' },
    [track('Tracker', 'Rb'), block('Rb', 'Doc')]
  );
  assert.equal(tracked('Tracker'), 'Doc');
});

test('resolveNightActions: tracker sees jail visit', () => {
  const { tracked } = resolve(
    { Tracker: 'tracker', Jail: 'jailkeeper', Town: 'villager' },
    [track('Tracker', 'Jail'), jail('Jail', 'Town')]
  );
  assert.equal(tracked('Tracker'), 'Town');
});

test('resolveNightActions: tracker sees frame visit', () => {
  const { tracked } = resolve(
    { Tracker: 'tracker', Framer: 'framer', Town: 'villager' },
    [track('Tracker', 'Framer'), frame('Framer', 'Town')]
  );
  assert.equal(tracked('Tracker'), 'Town');
});

test('resolveNightActions: tracker sees kill visit', () => {
  const { tracked } = resolve(
    { Tracker: 'tracker', Maf: 'mafia', Town: 'villager' },
    [track('Tracker', 'Maf'), kill('Maf', 'Town')]
  );
  assert.equal(tracked('Tracker'), 'Town');
});

test('resolveNightActions: tracker sees first successful action only', () => {
  const { tracked } = resolve(
    { Tracker: 'tracker', Cop: 'cop', Doc: 'doctor', Town1: 'villager', Town2: 'villager' },
    [track('Tracker', 'Cop'), investigate('Cop', 'Town1'), investigate('Cop', 'Town2')]
  );
  assert.equal(tracked('Tracker'), 'Town1');
});

test('resolveNightActions: death reveal override only on successful mafia kill', () => {
  const { didDie, revealOf } = resolve(
    { Forger: 'forger', Vig: 'vigilante', Town: 'villager' },
    [kill('Vig', 'Town', 'vigilante'), forge('Forger', 'Town', 'cop')]
  );
  assert.ok(didDie('Town'));
  assert.equal(revealOf('Town'), undefined);
});

test('resolveNightActions: death reveal override only on actual death', () => {
  const { didDie, revealOf } = resolve(
    { Forger: 'forger', Maf: 'mafia', Doc: 'doctor', Town: 'villager' },
    [save('Doc', 'Town'), kill('Maf', 'Town'), forge('Forger', 'Town', 'cop')]
  );
  assert.ok(!didDie('Town'));
  assert.equal(revealOf('Town'), undefined);
});

test('resolveNightActions: multiple doctors save same target', () => {
  const { isSaved, didDie } = resolve(
    { Doc1: 'doctor', Doc2: 'doctor', Maf: 'mafia', Town: 'villager' },
    [save('Doc1', 'Town'), save('Doc2', 'Town'), kill('Maf', 'Town')]
  );
  assert.ok(isSaved('Town'));
  assert.ok(!didDie('Town'));
});

test('resolveNightActions: multiple cops investigate same target', () => {
  const { investigations } = resolve(
    { Cop1: 'cop', Cop2: 'cop', Town: 'villager' },
    [investigate('Cop1', 'Town'), investigate('Cop2', 'Town')]
  );
  assert.equal(investigations.find(i => i.actor === 'Cop1')?.result, 'INNOCENT');
  assert.equal(investigations.find(i => i.actor === 'Cop2')?.result, 'INNOCENT');
});

test('resolveNightActions: empty actions list', () => {
  const { deaths, blockedPlayers, kills, investigations } = resolve({ Town: 'villager' }, []);
  assert.equal(deaths.size, 0);
  assert.equal(blockedPlayers.size, 0);
  assert.equal(kills.length, 0);
  assert.equal(investigations.length, 0);
});

test('resolveNightActions: complex multi-role interaction', () => {
  const { isBlocked, investigations, isSaved, didDie } = resolve(
    { Jail: 'jailkeeper', Rb: 'roleblocker', MafRb: 'mafia_roleblocker', Cop: 'cop', Doc: 'doctor', Framer: 'framer', Maf: 'mafia', Town: 'villager' },
    [jail('Jail', 'Rb'), block('Rb', 'MafRb'), block('MafRb', 'Cop'), investigate('Cop', 'Town'), frame('Framer', 'Town'), save('Doc', 'Town'), kill('Maf', 'Town')]
  );

  assert.ok(isBlocked('Rb'));
  assert.ok(isBlocked('Cop'));
  assert.ok(!isBlocked('MafRb'));
  assert.equal(investigations.length, 0);
  assert.ok(isSaved('Town'));
  assert.ok(!didDie('Town'));
});

test('resolveNightActions: all mafia roles appear MAFIA to cop except godfather', () => {
  const { invOf } = resolve(
    { Cop: 'cop', Maf: 'mafia', Gf: 'godfather', MafRb: 'mafia_roleblocker', Framer: 'framer', Janitor: 'janitor', Forger: 'forger' },
    [investigate('Cop', 'Maf'), investigate('Cop', 'Gf'), investigate('Cop', 'MafRb'), investigate('Cop', 'Framer'), investigate('Cop', 'Janitor'), investigate('Cop', 'Forger')]
  );

  assert.equal(invOf('Maf'), 'MAFIA');
  assert.equal(invOf('Gf'), 'INNOCENT');
  assert.equal(invOf('MafRb'), 'MAFIA');
  assert.equal(invOf('Framer'), 'MAFIA');
  assert.equal(invOf('Janitor'), 'MAFIA');
  assert.equal(invOf('Forger'), 'MAFIA');
});

test('resolveNightActions: framer makes godfather appear MAFIA', () => {
  const { invOf } = resolve(
    { Cop: 'cop', Framer: 'framer', Gf: 'godfather' },
    [frame('Framer', 'Gf'), investigate('Cop', 'Gf')]
  );
  assert.equal(invOf('Gf'), 'MAFIA');
});

test('resolveNightActions: blocked cop does not investigate', () => {
  const { isBlocked, investigations } = resolve(
    { Cop: 'cop', Rb: 'roleblocker', Maf: 'mafia' },
    [block('Rb', 'Cop'), investigate('Cop', 'Maf')]
  );
  assert.ok(isBlocked('Cop'));
  assert.equal(investigations.length, 0);
});
