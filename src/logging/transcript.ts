import type { GameLogEntry } from '../types.js';

const LEGACY_PUBLIC_TYPES = new Set<GameLogEntry['type']>([
  'SYSTEM',
  'CHAT',
  'VOTE',
  'DEATH',
  'WIN',
]);

function normalizeTranscriptContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

function formatTaggedLine(type: GameLogEntry['type'], player: string | undefined, content: string): string {
  const playerTag = player ? `[${player}]` : '';
  const spacer = content.length > 0 ? ' ' : '';
  return `[${type}]${playerTag}${spacer}${content}`.trimEnd();
}

export function isPublicTranscriptEntry(entry: GameLogEntry): boolean {
  if (entry.type === 'THOUGHT' || entry.type === 'FACTION_CHAT') {
    return false;
  }

  const visibility = entry.metadata?.visibility;
  if (visibility === 'private' || visibility === 'faction') {
    return false;
  }

  if (visibility === 'public') {
    return true;
  }

  return LEGACY_PUBLIC_TYPES.has(entry.type);
}

export function formatPublicTranscriptLine(entry: GameLogEntry): string | null {
  if (!isPublicTranscriptEntry(entry)) {
    return null;
  }

  const content = normalizeTranscriptContent(entry.content);

  if (entry.type === 'SYSTEM') {
    return formatTaggedLine('SYSTEM', undefined, content);
  }

  if (entry.type === 'CHAT') {
    return formatTaggedLine('CHAT', entry.player, content);
  }

  if (entry.type === 'VOTE') {
    return formatTaggedLine('VOTE', entry.player, content);
  }

  if (entry.type === 'DEATH') {
    return formatTaggedLine('DEATH', entry.player, content);
  }

  if (entry.type === 'WIN') {
    return formatTaggedLine('WIN', undefined, content);
  }

  return formatTaggedLine(entry.type, entry.player, content);
}
