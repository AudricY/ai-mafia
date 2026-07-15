# Architecture

## Stack

- Node.js 22.13+, strict TypeScript, pnpm
- Vercel AI SDK (`ai`) and `@ai-sdk/openai`, routed through AI Gateway
- React 19 and Ink 7 terminal UI
- YAML configuration validated with Zod
- `node:test` and `node:assert/strict`

## Code map

| Path | Responsibility |
|---|---|
| `src/index.ts` | Entry point and CLI parsing |
| `src/config.ts` | Configuration schema and loading |
| `src/engine/gameEngine.ts` | Main game loop |
| `src/phases/` | Night, discussion, voting, and post-game phases |
| `src/actions/` | Night intents and deterministic resolution |
| `src/roleModules/`, `src/roleRegistry.ts` | Per-role collectors and registration |
| `src/agent.ts`, `src/agentIo.ts` | LLM player, memory, timeout, retry, and fallback behavior |
| `src/roles.ts`, `src/types.ts` | Role metadata and core types |
| `src/publicLedger.ts` | Shared player-visible state |
| `src/events/` | Engine/logger/UI event bus |
| `src/ui/` | React/Ink UI |
| `src/logger.ts`, `src/replay/` | Persistence and replay loading |
| `src/game.ts` | Backward-compatible engine facade |

## Runtime flow

`gameEngine.ts` repeats night action collection and deterministic resolution, day discussion, day voting, and win-condition checks. Each agent maintains public and private notebooks; mafia may also share faction memory. Dry-run mode replaces API calls with deterministic FNV-1a-based choices.

See [game_logic.md](../game_logic.md) for rules and night priority, and the focused workflow docs for changes to configuration, roles, agent behavior, logging, or tests.
