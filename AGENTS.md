# Agent Developer Guide

## Core Architecture
- **Stack**: Node.js, TypeScript, Vercel AI SDK (`ai`, `@ai-sdk/openai`).
- **Config**: Game rules and players defined in `game-config.yaml`. Parsed via `zod`.
- **State**: In-memory `GameState` object passed through the game loop.
- **Logging**: Structured JSON logs in `logs/` directory.

## Key Files
- `src/config.ts`: Zod schemas for `GameConfig`.
- `src/game.ts`: Main game loop (Day/Night cycles).
- `src/agent.ts`: Wrapper around `generateText` for player actions.
- `src/logger.ts`: Centralized structured logging.

## Conventions
- **Async/Await**: Use for all AI calls.
- **Error Handling**: Fail fast on invalid config. Graceful degradation on AI failures (retry/skip).
- **Types**: Strict TypeScript usage. No `any`.
