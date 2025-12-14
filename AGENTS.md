# Agent Developer Guide

## Core Architecture
- **Stack**: Node.js, TypeScript, Vercel AI SDK (`ai`).
- **Config**: Game rules and players defined in `game-config.yaml`. Parsed via `zod`.
- **State**: In-memory `GameState` object passed through the game loop.
- **Logging**: Structured JSON logs in `logs/` directory.
- **Rules**: See [game_logic.md](game_logic.md) for a plain English description of roles and mechanics.

## Key Files
- `src/config.ts`: Zod schemas for `GameConfig`.
- `src/game.ts`: Main game loop (Day/Night cycles).
- `src/agent.ts`: Wrapper around `generateText` for player actions.
- `src/logger.ts`: Centralized structured logging.

## Setup (AI Gateway)
- **Environment**: create a `.env` file in the repo root with:
  - `AI_GATEWAY_API_KEY=...`
- **Models**: all model ids in `game-config.yaml` must use **AI Gateway** `provider/model` format.
  - Examples: `openai/gpt-4o`, `anthropic/claude-sonnet-4.5`, `deepseek/deepseek-v3.2-thinking`
- **Node**: Node.js >= 20 (required by transitive deps in `ai`)
- **Run**:
  - `corepack enable` (recommended)
  - `pnpm install`
  - `pnpm start`

## Dry-run mode (development)
Use dry-run to exercise the full game loop **without running any agents** (no API keys required).

- `pnpm start:dry-run`


## Repo Documentation Rule
- **Do not create `README.md`**: all repo context, setup, and conventions must live in `AGENTS.md`.

## Conventions
- **Async/Await**: Use for all AI calls.
- **Error Handling**: Fail fast on invalid config. Graceful degradation on AI failures (retry/skip).
- **Types**: Strict TypeScript usage. No `any`.
