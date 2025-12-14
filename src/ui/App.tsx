import React, { useEffect, useMemo, useRef, useState } from 'react';
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

function entryToPlainText(entry: GameLogEntry): string {
  const role = getMetadataRole(entry);
  const time = formatTime(entry.timestamp);
  const type = entry.type;
  const player = entry.player;

  const prefix = player ? `[${time}] [${type}] <${player}${role ? `:${role}` : ''}>: ` : `[${time}] [${type}]: `;
  return `${prefix}${entry.content}`;
}

function estimateWrappedLines(text: string, width: number): number {
  if (width <= 0) return 0;
  // Ink can wrap on word boundaries; we approximate by character width.
  // This is only used to decide how many tail entries to render.
  const parts = text.split('\n');
  let lines = 0;
  for (const p of parts) {
    const len = p.length;
    lines += Math.max(1, Math.ceil(len / width));
  }
  return lines;
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
  const [scrollFromBottomRows, setScrollFromBottomRows] = useState(0);
  const prevTotalRowsRef = useRef<number>(0);

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

    // Scroll controls (works in the pinned-header view).
    if (key.upArrow) {
      setScrollFromBottomRows(v => v + 1);
      return;
    }
    if (key.downArrow) {
      setScrollFromBottomRows(v => Math.max(0, v - 1));
      return;
    }
    if (key.pageUp) {
      setScrollFromBottomRows(v => v + Math.max(1, Math.floor(logContentRows * 0.9)));
      return;
    }
    if (key.pageDown) {
      setScrollFromBottomRows(v => Math.max(0, v - Math.max(1, Math.floor(logContentRows * 0.9))));
      return;
    }
    if (input === 'G') {
      // Jump to oldest (top).
      setScrollFromBottomRows(Number.POSITIVE_INFINITY);
      return;
    }
    if (input === 'g') {
      // Jump to newest (bottom / follow).
      setScrollFromBottomRows(0);
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

  // Keep the header pinned by ensuring the log area never exceeds the terminal height.
  // With wrapping enabled, a single entry can span multiple terminal rows, so we estimate
  // row usage and only render the tail that fits.
  const headerRows = 2;
  const logBoxHeight = Math.max(3, dimensions.rows - headerRows);
  const logContentRows = Math.max(1, logBoxHeight - 2); // border top/bottom
  const logContentWidth = Math.max(10, dimensions.columns - 2 /* border */ - 2 /* paddingX */);

  const metrics = useMemo(() => {
    return visibleEntries.map(e => ({
      entry: e,
      rows: estimateWrappedLines(entryToPlainText(e), logContentWidth),
    }));
  }, [visibleEntries, logContentWidth]);

  const totalRows = useMemo(() => metrics.reduce((acc, m) => acc + m.rows, 0), [metrics]);
  const maxScrollFromBottom = useMemo(() => Math.max(0, totalRows - logContentRows), [logContentRows, totalRows]);

  useEffect(() => {
    // Keep the viewport stable if new rows appear while the user is scrolled up.
    const prev = prevTotalRowsRef.current;
    if (prev !== 0 && totalRows > prev) {
      const delta = totalRows - prev;
      setScrollFromBottomRows(v => (v > 0 ? v + delta : 0));
    }
    prevTotalRowsRef.current = totalRows;
  }, [totalRows]);

  useEffect(() => {
    // Clamp on resize / filter changes.
    setScrollFromBottomRows(v => Math.min(maxScrollFromBottom, Number.isFinite(v) ? v : maxScrollFromBottom));
  }, [maxScrollFromBottom]);

  const clampedScrollFromBottom = Math.min(scrollFromBottomRows, maxScrollFromBottom);

  const lines = useMemo(() => {
    if (metrics.length === 0) return [];

    // We treat the log as a long list of "rows" (wrapped lines).
    const endRowExclusive = Math.max(0, totalRows - clampedScrollFromBottom);
    const startRowInclusive = Math.max(0, endRowExclusive - logContentRows);

    const picked: GameLogEntry[] = [];
    let cursor = 0;
    for (const m of metrics) {
      const nextCursor = cursor + m.rows;
      const overlaps = nextCursor > startRowInclusive && cursor < endRowExclusive;
      if (overlaps) picked.push(m.entry);
      cursor = nextCursor;
      if (cursor >= endRowExclusive) break;
    }

    // Always show at least one entry if any exist (helps when a single entry is huge).
    if (picked.length === 0) return [metrics[metrics.length - 1]!.entry];
    return picked;
  }, [clampedScrollFromBottom, logContentRows, metrics, totalRows]);

  return (
    <Box flexDirection="column" width={dimensions.columns} height={dimensions.rows} overflow="hidden">
      <Box flexShrink={0}>
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
        <Text>↑/↓ scroll</Text>
        <Text color="gray"> | </Text>
        <Text>pgUp/pgDn</Text>
        <Text color="gray"> | </Text>
        <Text>G top / g bottom</Text>
        <Text color="gray"> | </Text>
        <Text>p/] next POV</Text>
        <Text color="gray"> | </Text>
        <Text>[ prev POV</Text>
        <Text color="gray"> | </Text>
        <Text>q/esc quit</Text>
      </Box>
      <Box
        borderStyle="round"
        flexDirection="column"
        paddingX={1}
        height={logBoxHeight}
        overflow="hidden"
        flexGrow={1}
      >
        {lines.map(e => {
          const role = getMetadataRole(e);
          const time = formatTime(e.timestamp);
          const c = typeColor(e.type);
          const rc = roleColor(role);
          return (
            <Text key={e.id} wrap="wrap">
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
