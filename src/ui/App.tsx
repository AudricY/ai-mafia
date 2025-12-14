import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { logger } from '../logger.js';
import type { GameLogEntry, Role } from '../types.js';

type PovMode = 'ALL' | 'PUBLIC' | { player: string };

function isMafiaRole(role: Role | undefined): boolean {
  return role === 'mafia' || role === 'godfather';
}

function formatTime(iso: string): string {
  const t = iso.split('T')[1];
  if (!t) return iso;
  return t.split('.')[0] ?? t;
}

function typeColor(type: GameLogEntry['type']): string | undefined {
  switch (type) {
    case 'SYSTEM':
      return 'gray';
    case 'ACTION':
      return 'yellow';
    case 'VOTE':
      return 'blue';
    case 'DEATH':
      return 'red';
    case 'WIN':
      return 'green';
    case 'THOUGHT':
      return 'gray';
    case 'FACTION_CHAT':
      return 'red';
    case 'CHAT':
    default:
      return undefined;
  }
}

function roleColor(role: Role | undefined): string | undefined {
  switch (role) {
    case 'mafia':
    case 'godfather':
      return 'red';
    case 'villager':
      return 'green';
    case 'cop':
      return 'blue';
    case 'doctor':
      return 'cyan';
    case 'vigilante':
      return 'magenta';
    case 'roleblocker':
      return 'yellow';
    case 'god':
      return 'white';
    default:
      return undefined;
  }
}

function getMetadataString(entry: GameLogEntry, key: string): string | undefined {
  const v = entry.metadata?.[key as keyof typeof entry.metadata];
  return typeof v === 'string' ? v : undefined;
}

function getMetadataRole(entry: GameLogEntry): Role | undefined {
  const v = entry.metadata?.role;
  return typeof v === 'string' ? (v as Role) : undefined;
}

export function App(props: { players: string[] }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState(() => ({
    columns: stdout.columns ?? 80,
    rows: stdout.rows ?? 24,
  }));

  const [showThoughts, setShowThoughts] = useState(true);
  const [pov, setPov] = useState<PovMode>('ALL');
  const [entries, setEntries] = useState<GameLogEntry[]>(() => logger.getLogs());
  const [playerRoles, setPlayerRoles] = useState<Record<string, Role>>({});

  const povOrder: PovMode[] = useMemo(() => {
    const players = props.players.map(p => ({ player: p } as const));
    return ['ALL', 'PUBLIC', ...players];
  }, [props.players]);

  useEffect(() => {
    const onResize = () => {
      setDimensions({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
    };
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  useEffect(() => {
    // Seed roles map from existing history.
    const next: Record<string, Role> = {};
    for (const e of entries) {
      const role = getMetadataRole(e);
      const actor = e.player ?? getMetadataString(e, 'player');
      if (actor && role) next[actor] = role;
    }
    setPlayerRoles(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsub = logger.subscribe((e) => {
      setEntries(prev => {
        const next = [...prev, e];
        // Keep bounded scrollback for performance.
        return next.length > 5000 ? next.slice(-5000) : next;
      });

      const role = getMetadataRole(e);
      const actor = e.player ?? getMetadataString(e, 'player');
      if (actor && role) {
        setPlayerRoles(prev => (prev[actor] === role ? prev : { ...prev, [actor]: role }));
      }
    });

    return () => {
      unsub();
    };
  }, []);

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      exit();
      return;
    }

    if (input === 't') {
      setShowThoughts(v => !v);
      return;
    }

    if (input === 'p' || input === ']') {
      setPov(current => {
        const idx = povOrder.findIndex(m => JSON.stringify(m) === JSON.stringify(current));
        return povOrder[(idx + 1) % povOrder.length] ?? 'ALL';
      });
      return;
    }

    if (input === '[') {
      setPov(current => {
        const idx = povOrder.findIndex(m => JSON.stringify(m) === JSON.stringify(current));
        return povOrder[(idx - 1 + povOrder.length) % povOrder.length] ?? 'ALL';
      });
      return;
    }
  });

  const visibleEntries = useMemo(() => {
    const publicTypes = new Set<GameLogEntry['type']>(['SYSTEM', 'CHAT', 'VOTE', 'DEATH', 'WIN']);

    const povPlayer = typeof pov === 'object' ? pov.player : null;
    const povRole = povPlayer ? playerRoles[povPlayer] : undefined;

    return entries.filter(e => {
      if (!showThoughts && e.type === 'THOUGHT') return false;

      const visibility = getMetadataString(e, 'visibility');
      const faction = getMetadataString(e, 'faction');

      if (pov === 'ALL') {
        return true;
      }

      if (pov === 'PUBLIC') {
        return visibility === 'public' || publicTypes.has(e.type);
      }

      // Player POV
      if (visibility === 'public' || publicTypes.has(e.type)) return true;

      if (e.type === 'THOUGHT') return e.player === povPlayer;

      if (visibility === 'private') return e.player === povPlayer;

      if (visibility === 'faction') {
        if (faction === 'mafia' && isMafiaRole(povRole)) return true;
        return false;
      }

      // Default: hide unknown visibility in POV modes.
      return false;
    });
  }, [entries, playerRoles, pov, showThoughts]);

  const headerPov = useMemo(() => {
    if (pov === 'ALL') return 'ALL';
    if (pov === 'PUBLIC') return 'PUBLIC';
    const r = playerRoles[pov.player];
    return r ? `${pov.player} (${r})` : pov.player;
  }, [pov, playerRoles]);

  // Try to fit to terminal height.
  const headerLines = 3;
  const maxLines = Math.max(5, dimensions.rows - headerLines);
  const lines = visibleEntries.slice(-maxLines);

  return (
    <Box flexDirection="column" width={dimensions.columns}>
      <Box>
        <Text bold>AI Mafia</Text>
        <Text>  </Text>
        <Text color="gray">POV:</Text>
        <Text> {headerPov}</Text>
        <Text>  </Text>
        <Text color="gray">Thoughts:</Text>
        <Text> {showThoughts ? 'on' : 'off'}</Text>
      </Box>
      <Box>
        <Text color="gray">Keys:</Text>
        <Text> </Text>
        <Text>t toggle thoughts</Text>
        <Text color="gray"> | </Text>
        <Text>p/] next POV</Text>
        <Text color="gray"> | </Text>
        <Text>[ prev POV</Text>
        <Text color="gray"> | </Text>
        <Text>q/esc quit</Text>
      </Box>
      <Box borderStyle="round" flexDirection="column" paddingX={1}>
        {lines.map(e => {
          const role = getMetadataRole(e);
          const time = formatTime(e.timestamp);
          const c = typeColor(e.type);
          const rc = roleColor(role);
          return (
            <Text key={e.id} wrap="truncate-end">
              <Text color="gray">[{time}]</Text> <Text color={c}>{`[${e.type}]`}</Text>
              {e.player ? (
                <>
                  <Text> </Text>
                  <Text color="yellow">{`<${e.player}`}</Text>
                  {role ? <Text color={rc}>{`:${role}`}</Text> : null}
                  <Text color="yellow">&gt;</Text>
                </>
              ) : null}
              <Text>: </Text>
              <Text>{e.content}</Text>
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}
