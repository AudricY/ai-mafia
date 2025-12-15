import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { logger } from '../logger.js';
import type { GameLogEntry, Role } from '../types.js';

type PovMode = 'ALL' | 'PUBLIC' | { player: string };
type ViewMode = 'LOG' | 'NOTEBOOKS';

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
    case 'mafia_roleblocker':
    case 'bomb':
      return 'redBright';
    case 'villager':
      return 'green';
    case 'mason':
      return 'greenBright';
    case 'cop':
      return 'blue';
    case 'tracker':
      return 'blueBright';
    case 'doctor':
      return 'cyan';
    case 'jailkeeper':
      return 'cyanBright';
    case 'vigilante':
      return 'magenta';
    case 'roleblocker':
      return 'yellow';
    case 'framer':
      return 'yellowBright';
    case 'janitor':
      return 'gray';
    case 'forger':
    case 'jester':
      return 'magentaBright';
    case 'executioner':
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
  const [view, setView] = useState<ViewMode>('LOG');
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
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

  // Reconstruct notebooks from THOUGHT entries with kind='note'
  const notebooks = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const e of entries) {
      if (e.type === 'THOUGHT' && e.player) {
        const kind = getMetadataString(e, 'kind');
        if (kind === 'note' || e.content.startsWith('NOTE: ')) {
          const noteText = e.content.startsWith('NOTE: ') ? e.content.slice(6) : e.content;
          if (!result[e.player]) {
            result[e.player] = [];
          }
          result[e.player]!.push(noteText);
        }
      }
    }
    return result;
  }, [entries]);

  const deadPlayers = useMemo(() => {
    const dead = new Set<string>();
    for (const e of entries) {
      if (e.type === 'DEATH' && e.player) dead.add(e.player);
    }
    return dead;
  }, [entries]);

  const isAlive = useMemo(() => {
    return (player: string) => !deadPlayers.has(player);
  }, [deadPlayers]);

  // Initialize selected player when switching to notebooks view
  useEffect(() => {
    if (view === 'NOTEBOOKS' && !selectedPlayer && props.players.length > 0) {
      setSelectedPlayer(props.players[0]!);
    }
  }, [view, selectedPlayer, props.players]);

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      exit();
      return;
    }

    if (view === 'NOTEBOOKS') {
      // Notebooks view controls
      if (key.upArrow && selectedPlayer) {
        const idx = props.players.indexOf(selectedPlayer);
        if (idx > 0) {
          setSelectedPlayer(props.players[idx - 1]!);
          setScrollFromBottomRows(0);
        } else {
          // Scroll notebook content
          setScrollFromBottomRows(v => v + 1);
        }
        return;
      }
      if (key.downArrow && selectedPlayer) {
        const idx = props.players.indexOf(selectedPlayer);
        if (idx < props.players.length - 1) {
          setSelectedPlayer(props.players[idx + 1]!);
          setScrollFromBottomRows(0);
        } else {
          // Scroll notebook content
          setScrollFromBottomRows(v => Math.max(0, v - 1));
        }
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
        setScrollFromBottomRows(Number.POSITIVE_INFINITY);
        return;
      }
      if (input === 'g') {
        setScrollFromBottomRows(0);
        return;
      }
      if (input === 'n') {
        setView('LOG');
        setScrollFromBottomRows(0);
        return;
      }
      return;
    }

    // Log view controls
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

    if (input === 'n') {
      setView('NOTEBOOKS');
      // Reset scroll when switching views
      setScrollFromBottomRows(0);
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
    // Types that are inherently public even if metadata is missing.
    // NOTE: SYSTEM entries must explicitly opt into public visibility; otherwise they may leak private info.
    const publicTypes = new Set<GameLogEntry['type']>(['CHAT', 'VOTE', 'DEATH', 'WIN']);

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
        if (publicTypes.has(e.type)) return true;
        if (e.type === 'SYSTEM') return visibility !== 'private' && visibility !== 'faction';
        return visibility === 'public';
      }

      // Player POV
      if (publicTypes.has(e.type)) return true;
      if (e.type === 'SYSTEM' && visibility !== 'private' && visibility !== 'faction') return true;
      if (visibility === 'public') return true;

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

  // Notebook content for selected player
  const selectedNotebook = useMemo(() => {
    if (!selectedPlayer || !notebooks[selectedPlayer]) return '';
    return notebooks[selectedPlayer]!.join('\n');
  }, [selectedPlayer, notebooks]);

  const notebookMetrics = useMemo(() => {
    if (!selectedNotebook) return [];
    const lines = selectedNotebook.split('\n');
    const playerListWidth = 20;
    const notebookWidth = Math.max(10, dimensions.columns - playerListWidth - 4 /* borders/padding */);
    return lines.map(line => ({
      line,
      rows: estimateWrappedLines(line, notebookWidth),
    }));
  }, [selectedNotebook, dimensions.columns]);

  const notebookTotalRows = useMemo(() => notebookMetrics.reduce((acc, m) => acc + m.rows, 0), [notebookMetrics]);
  const notebookMaxScroll = useMemo(() => Math.max(0, notebookTotalRows - logContentRows), [notebookTotalRows, logContentRows]);

  useEffect(() => {
    setScrollFromBottomRows(v => Math.min(notebookMaxScroll, Number.isFinite(v) ? v : notebookMaxScroll));
  }, [notebookMaxScroll]);

  const notebookClampedScroll = Math.min(scrollFromBottomRows, notebookMaxScroll);

  const notebookLines = useMemo(() => {
    if (notebookMetrics.length === 0) return [];
    const endRowExclusive = Math.max(0, notebookTotalRows - notebookClampedScroll);
    const startRowInclusive = Math.max(0, endRowExclusive - logContentRows);
    const picked: string[] = [];
    let cursor = 0;
    for (const m of notebookMetrics) {
      const nextCursor = cursor + m.rows;
      const overlaps = nextCursor > startRowInclusive && cursor < endRowExclusive;
      if (overlaps) picked.push(m.line);
      cursor = nextCursor;
      if (cursor >= endRowExclusive) break;
    }
    return picked.length > 0 ? picked : [notebookMetrics[notebookMetrics.length - 1]?.line ?? ''];
  }, [notebookClampedScroll, logContentRows, notebookMetrics, notebookTotalRows]);

  if (view === 'NOTEBOOKS') {
    return (
      <Box flexDirection="column" width={dimensions.columns} height={dimensions.rows} overflow="hidden">
        <Box flexShrink={0}>
          <Text bold>AI Mafia</Text>
          <Text>  </Text>
          <Text color="gray">View:</Text>
          <Text> Notebooks</Text>
          {selectedPlayer ? (
            <>
              <Text>  </Text>
              <Text color="gray">Player:</Text>
              <Text> {selectedPlayer}</Text>
              <Text> </Text>
              {isAlive(selectedPlayer) ? <Text color="green">(alive)</Text> : <Text color="red">(dead)</Text>}
              {playerRoles[selectedPlayer] ? (
                <>
                  <Text> </Text>
                  <Text color={roleColor(playerRoles[selectedPlayer])}>({playerRoles[selectedPlayer]})</Text>
                </>
              ) : null}
            </>
          ) : null}
        </Box>
        <Box>
          <Text color="gray">Keys:</Text>
          <Text> </Text>
          <Text>n switch to Log</Text>
          <Text color="gray"> | </Text>
          <Text>↑/↓ select player</Text>
          <Text color="gray"> | </Text>
          <Text>↑/↓ scroll notebook</Text>
          <Text color="gray"> | </Text>
          <Text>q/esc quit</Text>
        </Box>
        <Box flexDirection="row" flexGrow={1} height={logBoxHeight}>
          {/* Player list */}
          <Box
            borderStyle="round"
            width={20}
            flexDirection="column"
            paddingX={1}
            overflow="hidden"
            flexShrink={0}
          >
            {props.players.map(player => {
              const isSelected = player === selectedPlayer;
              const role = playerRoles[player];
              const noteCount = notebooks[player]?.length ?? 0;
              const alive = isAlive(player);
              return (
                <Text key={player} wrap="wrap">
                  {isSelected ? <Text color="cyan" bold>{'> '}</Text> : <Text>  </Text>}
                  <Text color={!alive ? 'gray' : isSelected ? 'cyan' : undefined}>{player}</Text>
                  {!alive ? <Text color="red"> (dead)</Text> : null}
                  {role ? <Text color={roleColor(role)}> ({role})</Text> : null}
                  <Text color="gray"> ({noteCount})</Text>
                </Text>
              );
            })}
          </Box>
          {/* Notebook content */}
          <Box
            borderStyle="round"
            flexDirection="column"
            paddingX={1}
            flexGrow={1}
            overflow="hidden"
            marginLeft={1}
          >
            {selectedPlayer && selectedNotebook ? (
              notebookLines.map((line, idx) => (
                <Text key={idx} wrap="wrap">
                  <Text>{line}</Text>
                </Text>
              ))
            ) : (
              <Text color="gray">No notebook entries for this player</Text>
            )}
          </Box>
        </Box>
      </Box>
    );
  }

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
        <Text>n notebooks</Text>
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
