# Logging and Replay

`src/logger.ts` persists logs incrementally so live games can be observed safely:

- Structured events append to `logs/game-*.jsonl`.
- Human-readable events append to `logs/transcript-*.txt`.
- Each transcript event occupies one physical line, making `tail -f` stable.
- Transcript lines are fully tagged, for example `[PUBLIC][CHAT][Alice] ...`, `[PRIVATE][SYSTEM] ...`, and `[FACTION][FACTION_CHAT][Bob] ...`.

Do not revert transcripts to ambiguous `Alice: ...` prefixes or allow embedded newlines: colons in player speech and multiline content otherwise create false speaker changes.

`src/replay/loadReplay.ts` accepts current JSONL logs and legacy `game-*.json` array snapshots. Preserve both formats unless a migration explicitly removes legacy support.

Replay the latest or a named log with:

```bash
pnpm start -- --replay [latest|filename]
```
