import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { logger } from '../logger.js';
import type { GameLogEntry, Role } from '../types.js';
import { buildPublicLedger, formatPublicLedger } from '../publicLedger.js';
import { isMafiaRole } from '../utils.js';

type PovMode = 'ALL' | 'PUBLIC' | { player: string };
type ViewMode = 'LOG' | 'NOTEBOOKS' | 'LEDGER';

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

type ColoredSpan = { text: string; color?: string; bold?: boolean };
type ColoredLine = ColoredSpan[];

function tokenizeEntry(entry: GameLogEntry): ColoredSpan[] {
  const role = getMetadataRole(entry);
  const time = formatTime(entry.timestamp);
  const c = typeColor(entry.type);
  const rc = roleColor(role);

  const spans: ColoredSpan[] = [];
  spans.push({ text: `[${time}]`, color: 'gray' });
  spans.push({ text: ' ' });
  spans.push({ text: `[${entry.type}]`, color: c });

  if (entry.player) {
    spans.push({ text: ' ' });
    spans.push({ text: `<${entry.player}`, color: 'yellow' });
    if (role) {
      spans.push({ text: `:${role}`, color: rc });
    }
    spans.push({ text: '>', color: 'yellow' });
  }

  spans.push({ text: `: ${entry.content}` });
  return spans;
}

function wrapSpans(spans: ColoredSpan[], width: number): ColoredLine[] {
  if (width <= 0) return [];
  
  const lines: ColoredLine[] = [];
  let currentLine: ColoredLine = [];
  let currentWidth = 0;

  // Split spans into words/whitespace tokens
  const tokens: ColoredSpan[] = [];
  for (const span of spans) {
    const parts = span.text.split(/(\s+)/);
    for (const part of parts) {
      if (part === '') continue;
      tokens.push({ ...span, text: part });
    }
  }

  for (const token of tokens) {
    const isWhitespace = token.text.trim().length === 0 && !token.text.includes('\n');
    const hasNewline = token.text.includes('\n');

    if (hasNewline) {
      const parts = token.text.split('\n');
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) {
          lines.push(currentLine);
          currentLine = [];
          currentWidth = 0;
        }
        const p = parts[i]!;
        if (p.length > 0) {
          // Wrap the part if it's too long
          let remaining = p;
          while (remaining.length > 0) {
            const chunk = remaining.slice(0, width - currentWidth);
            if (chunk.length === 0) {
              lines.push(currentLine);
              currentLine = [];
              currentWidth = 0;
              continue;
            }
            currentLine.push({ ...token, text: chunk });
            currentWidth += chunk.length;
            remaining = remaining.slice(chunk.length);
            if (currentWidth >= width && remaining.length > 0) {
              lines.push(currentLine);
              currentLine = [];
              currentWidth = 0;
            }
          }
        }
      }
      continue;
    }

    if (currentWidth + token.text.length > width) {
      if (isWhitespace) {
        // Skip trailing whitespace that doesn't fit
        lines.push(currentLine);
        currentLine = [];
        currentWidth = 0;
      } else if (token.text.length > width) {
        // Force break long word
        let remaining = token.text;
        if (currentWidth > 0) {
          lines.push(currentLine);
          currentLine = [];
          currentWidth = 0;
        }
        while (remaining.length > width) {
          lines.push([{ ...token, text: remaining.slice(0, width) }]);
          remaining = remaining.slice(width);
        }
        currentLine.push({ ...token, text: remaining });
        currentWidth = remaining.length;
      } else {
        // Normal wrap
        lines.push(currentLine);
        currentLine = [{ ...token }];
        currentWidth = token.text.length;
      }
    } else {
      currentLine.push({ ...token });
      currentWidth += token.text.length;
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [[]];
}

function estimateWrappedLines(text: string, width: number): number {
  if (width <= 0) return 0;
  // This is now only used for header and notebook/ledger which we'll also update
  return wrapSpans([{ text }], width).length;
}

export interface AppProps {
  players: string[];
  initialEntries?: GameLogEntry[];
  live?: boolean;
  title?: string;
  models?: Record<string, string>;
}

export function App({ players, initialEntries = [], live = true, title, models }: AppProps) {
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
  const [entries, setEntries] = useState<GameLogEntry[]>(() =>
    initialEntries.length > 0 ? initialEntries : logger.getLogs()
  );
  const [playerRoles, setPlayerRoles] = useState<Record<string, Role>>({});
  const [scrollFromBottomRows, setScrollFromBottomRows] = useState(0);
  const prevTotalRowsRef = useRef<number>(0);

  const povOrder: PovMode[] = useMemo(() => {
    const pList = players.map(p => ({ player: p } as const));
    return ['ALL', 'PUBLIC', ...pList];
  }, [players]);

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
  }, [entries]); // In replay mode, entries might be provided once. In live mode, they are initially logger.getLogs().

  useEffect(() => {
    if (!live) return;

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
    if (view === 'NOTEBOOKS' && !selectedPlayer && players.length > 0) {
      setSelectedPlayer(players[0]!);
    }
  }, [view, selectedPlayer, players]);

  useInput((input, key) => {
    if (view === 'LEDGER') {
      // Ledger view controls
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
        setScrollFromBottomRows(Number.POSITIVE_INFINITY);
        return;
      }
      if (input === 'g') {
        setScrollFromBottomRows(0);
        return;
      }
      if (input === 'n') {
        setView('NOTEBOOKS');
        setScrollFromBottomRows(0);
        return;
      }
      if (input === 'l') {
        setView('LOG');
        setScrollFromBottomRows(0);
        return;
      }
      return;
    }

    if (view === 'NOTEBOOKS') {
      // Notebooks view controls
      if (key.upArrow && selectedPlayer) {
        const idx = players.indexOf(selectedPlayer);
        if (idx > 0) {
          setSelectedPlayer(players[idx - 1]!);
          setScrollFromBottomRows(0);
        } else {
          // Scroll notebook content
          setScrollFromBottomRows(v => v + 1);
        }
        return;
      }
      if (key.downArrow && selectedPlayer) {
        const idx = players.indexOf(selectedPlayer);
        if (idx < players.length - 1) {
          setSelectedPlayer(players[idx + 1]!);
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
      if (input === 'l') {
        setView('LEDGER');
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

    if (input === 'l') {
      setView('LEDGER');
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
    const m = models?.[pov.player];
    const parts = [pov.player];
    if (r) parts.push(`(${r})`);
    if (m) parts.push(`[${m}]`);
    return parts.join(' ');
  }, [pov, playerRoles, models]);

  // Keep the header pinned by ensuring the log area never exceeds the terminal height.
  // With wrapping enabled, a single entry can span multiple terminal rows, so we estimate
  // row usage and only render the tail that fits.
  const headerLine1 = `${title ?? 'AI Mafia'}  POV: ${headerPov}  Thoughts: ${showThoughts ? 'on' : 'off'}`;
  const headerLine2 = `Keys: t toggle thoughts | n notes | l ledger | ↑/↓ scroll | pgUp/pgDn | G top / g bottom | p/] next POV | [ prev POV | Ctrl+C quit`;
  const headerRows = useMemo(() => {
    return estimateWrappedLines(headerLine1, dimensions.columns) + estimateWrappedLines(headerLine2, dimensions.columns);
  }, [headerLine1, headerLine2, dimensions.columns]);

  const logBoxHeight = Math.max(3, dimensions.rows - headerRows);
  const logContentRows = Math.max(1, logBoxHeight - 2); // border top/bottom
  const logContentWidth = Math.max(10, dimensions.columns - 2 /* border */ - 2 /* paddingX */);

  const metrics = useMemo(() => {
    return visibleEntries.map(e => {
      const wrapped = wrapSpans(tokenizeEntry(e), logContentWidth);
      return {
        entry: e,
        rows: wrapped.length,
        lines: wrapped,
      };
    });
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

  const visibleRows = useMemo(() => {
    if (metrics.length === 0) return [];

    const endRowExclusive = Math.max(0, totalRows - clampedScrollFromBottom);
    const startRowInclusive = Math.max(0, endRowExclusive - logContentRows);

    const rows: ColoredLine[] = [];
    let cursor = 0;
    for (const m of metrics) {
      const nextCursor = cursor + m.rows;
      if (nextCursor > startRowInclusive && cursor < endRowExclusive) {
        // This entry is at least partially visible
        for (let i = 0; i < m.rows; i++) {
          const rowIdx = cursor + i;
          if (rowIdx >= startRowInclusive && rowIdx < endRowExclusive) {
            rows.push(m.lines[i]!);
          }
        }
      }
      cursor = nextCursor;
      if (cursor >= endRowExclusive) break;
    }

    return rows;
  }, [clampedScrollFromBottom, logContentRows, metrics, totalRows]);

  // Notebook content for selected player
  const selectedNotebook = useMemo(() => {
    if (!selectedPlayer || !notebooks[selectedPlayer]) return '';
    return notebooks[selectedPlayer]!.join('\n');
  }, [selectedPlayer, notebooks]);

  const notebookMetrics = useMemo(() => {
    if (!selectedNotebook) return [];
    const lines = selectedNotebook.split('\n');
    const playerListWidth = 30;
    const notebookWidth = Math.max(10, dimensions.columns - playerListWidth - 4 /* borders/padding */);
    return lines.flatMap(line => {
      const wrapped = wrapSpans([{ text: line }], notebookWidth);
      return wrapped.map(w => ({
        line, // original line
        rows: 1,
        wrapped: w,
      }));
    });
  }, [selectedNotebook, dimensions.columns]);

  const notebookTotalRows = useMemo(() => notebookMetrics.length, [notebookMetrics]);
  const notebookMaxScroll = useMemo(() => Math.max(0, notebookTotalRows - logContentRows), [notebookTotalRows, logContentRows]);

  useEffect(() => {
    setScrollFromBottomRows(v => Math.min(notebookMaxScroll, Number.isFinite(v) ? v : notebookMaxScroll));
  }, [notebookMaxScroll]);

  const notebookClampedScroll = Math.min(scrollFromBottomRows, notebookMaxScroll);

  const notebookRows = useMemo(() => {
    if (notebookMetrics.length === 0) return [];
    const endRowExclusive = Math.max(0, notebookTotalRows - notebookClampedScroll);
    const startRowInclusive = Math.max(0, endRowExclusive - logContentRows);
    
    const rows: ColoredLine[] = [];
    for (let i = startRowInclusive; i < endRowExclusive; i++) {
      if (notebookMetrics[i]) {
        rows.push(notebookMetrics[i]!.wrapped);
      }
    }
    return rows;
  }, [notebookClampedScroll, logContentRows, notebookMetrics, notebookTotalRows]);

  // Ledger content
  const ledgerText = useMemo(() => {
    const ledger = buildPublicLedger(entries);
    return formatPublicLedger(ledger);
  }, [entries]);

  const ledgerLines = useMemo(() => {
    if (!ledgerText) return [];
    return ledgerText.split('\n');
  }, [ledgerText]);

  const ledgerMetrics = useMemo(() => {
    return ledgerLines.flatMap(line => {
      const wrapped = wrapSpans([{ text: line }], logContentWidth);
      return wrapped.map(w => ({
        line,
        rows: 1,
        wrapped: w,
      }));
    });
  }, [ledgerLines, logContentWidth]);

  const ledgerTotalRows = useMemo(() => ledgerMetrics.length, [ledgerMetrics]);
  const ledgerMaxScroll = useMemo(() => Math.max(0, ledgerTotalRows - logContentRows), [ledgerTotalRows, logContentRows]);

  useEffect(() => {
    if (view === 'LEDGER') {
      setScrollFromBottomRows(v => Math.min(ledgerMaxScroll, Number.isFinite(v) ? v : ledgerMaxScroll));
    }
  }, [ledgerMaxScroll, view]);

  const ledgerClampedScroll = Math.min(scrollFromBottomRows, ledgerMaxScroll);

  const ledgerRows = useMemo(() => {
    if (ledgerMetrics.length === 0) return [];
    const endRowExclusive = Math.max(0, ledgerTotalRows - ledgerClampedScroll);
    const startRowInclusive = Math.max(0, endRowExclusive - logContentRows);
    
    const rows: ColoredLine[] = [];
    for (let i = startRowInclusive; i < endRowExclusive; i++) {
      if (ledgerMetrics[i]) {
        rows.push(ledgerMetrics[i]!.wrapped);
      }
    }
    return rows;
  }, [ledgerClampedScroll, logContentRows, ledgerMetrics, ledgerTotalRows]);

  if (view === 'LEDGER') {
    return (
      <Box flexDirection="column" width={dimensions.columns} height={dimensions.rows} overflow="hidden">
        <Box flexShrink={0}>
          <Text bold>{title ?? 'AI Mafia'}</Text>
          <Text>  </Text>
          <Text color="gray">View:</Text>
          <Text> Ledger</Text>
        </Box>
        <Box>
          <Text color="gray">Keys:</Text>
          <Text> </Text>
          <Text>n switch to Notes</Text>
          <Text color="gray"> | </Text>
          <Text>l switch to Log</Text>
          <Text color="gray"> | </Text>
          <Text>↑/↓ scroll</Text>
          <Text color="gray"> | </Text>
          <Text>Ctrl+C quit</Text>
        </Box>
        <Box
          borderStyle="round"
          flexDirection="column"
          paddingX={1}
          height={logBoxHeight}
          overflow="hidden"
          flexGrow={1}
        >
          <Box flexDirection="column">
            {ledgerRows.length > 0 ? (
              ledgerRows.map((row, idx) => (
                <Text key={idx}>
                  {row.map((span, sidx) => (
                    <Text key={sidx} color={span.color} bold={span.bold}>
                      {span.text}
                    </Text>
                  ))}
                </Text>
              ))
            ) : (
              <Text color="gray">No ledger data yet</Text>
            )}
          </Box>
        </Box>
      </Box>
    );
  }

  if (view === 'NOTEBOOKS') {
    return (
      <Box flexDirection="column" width={dimensions.columns} height={dimensions.rows} overflow="hidden">
        <Box flexShrink={0}>
          <Text bold>{title ?? 'AI Mafia'}</Text>
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
              {models?.[selectedPlayer] ? (
                <>
                  <Text> </Text>
                  <Text color="gray">{models[selectedPlayer]}</Text>
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
          <Text>l switch to Ledger</Text>
          <Text color="gray"> | </Text>
          <Text>↑/↓ select player</Text>
          <Text color="gray"> | </Text>
          <Text>↑/↓ scroll notebook</Text>
          <Text color="gray"> | </Text>
          <Text>Ctrl+C quit</Text>
        </Box>
        <Box flexDirection="row" flexGrow={1} height={logBoxHeight}>
          {/* Player list */}
          <Box
            borderStyle="round"
            width={30}
            flexDirection="column"
            paddingX={1}
            overflow="hidden"
            flexShrink={0}
          >
            {players.map(player => {
              const isSelected = player === selectedPlayer;
              const role = playerRoles[player];
              const noteCount = notebooks[player]?.length ?? 0;
              const alive = isAlive(player);
              const modelShort = models?.[player]?.split('/')[1];
              return (
                <Text key={player} wrap="wrap">
                  {isSelected ? <Text color="cyan" bold>{'> '}</Text> : <Text>  </Text>}
                  <Text color={!alive ? 'gray' : isSelected ? 'cyan' : undefined}>{player}</Text>
                  {!alive ? <Text color="red"> (dead)</Text> : null}
                  {role ? <Text color={roleColor(role)}> ({role})</Text> : null}
                  {modelShort ? <Text color="gray"> {modelShort}</Text> : null}
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
            <Box flexDirection="column">
              {selectedPlayer && selectedNotebook ? (
                notebookRows.map((row, idx) => (
                  <Text key={idx}>
                    {row.map((span, sidx) => (
                      <Text key={sidx} color={span.color} bold={span.bold}>
                        {span.text}
                      </Text>
                    ))}
                  </Text>
                ))
              ) : (
                <Text color="gray">No notebook entries for this player</Text>
              )}
            </Box>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={dimensions.columns} height={dimensions.rows} overflow="hidden">
      <Box flexShrink={0}>
        <Text bold>{title ?? 'AI Mafia'}</Text>
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
        <Text>n notes</Text>
        <Text color="gray"> | </Text>
        <Text>l ledger</Text>
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
          <Text>Ctrl+C quit</Text>
        </Box>
      <Box
        borderStyle="round"
        flexDirection="column"
        paddingX={1}
        height={logBoxHeight}
        overflow="hidden"
        flexGrow={1}
      >
        <Box flexDirection="column">
          {visibleRows.map((line, idx) => (
            <Text key={idx}>
              {line.map((span, sidx) => (
                <Text key={sidx} color={span.color} bold={span.bold}>
                  {span.text}
                </Text>
              ))}
            </Text>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
