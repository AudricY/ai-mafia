# AGENTS.md — AI Mafia

Multi-agent social deduction game where LLM-powered players play Mafia autonomously. Every player is an AI agent backed by configurable models via Vercel AI SDK + AI Gateway.

## Stack

- **Runtime**: Node.js >= 20, TypeScript (strict), pnpm
- **AI**: Vercel AI SDK (`ai`) + `@ai-sdk/openai` (routes through AI Gateway, not OpenAI directly)
- **UI**: React 19 + Ink 6 (terminal rendering)
- **Config**: YAML parsed with `zod` validation
- **Tests**: `node:test` + `node:assert/strict`

## Commands

| Command | What it does |
|---|---|
| `pnpm install` | Install deps |
| `pnpm start` | Run a live game (needs `AI_GATEWAY_API_KEY` in `.env`) |
| `pnpm start:dry-run` | Full game loop, no API calls, no `.env` needed |
| `pnpm start -- --replay [latest\|filename]` | Replay a saved game from `logs/` |
| `pnpm dev` | Watch mode |
| `pnpm dev:dry-run` | Watch + dry-run |
| `pnpm build` | Compile to `dist/` |
| `pnpm check` | Type-check only (`tsc --noEmit`) |
| `pnpm test` | Run all tests |

## Game Rules

See [game_logic.md](game_logic.md) for complete rules, roles, night resolution order, and day phase mechanics.

## Architecture

```
src/
├── index.ts              # Entry point, CLI arg parsing
├── config.ts             # Zod schemas, loads game-config.yaml
├── engine/gameEngine.ts  # Main loop: Night → Discussion → Voting → repeat
├── phases/               # Phase implementations (night, dayDiscussion, dayVoting, postGame)
├── actions/              # Night action intents (types.ts) + deterministic resolver
├── roleModules/          # Per-role action collectors (one file per role)
├── agent.ts              # LLM player wrapper (generateText, memory windows, faction memory)
├── agentIo.ts            # Timeout/retry/fallback harness for agent calls
├── roles.ts              # Role definitions, team assignments, prompt formatters
├── publicLedger.ts       # Shared game state visible to all players
├── events/               # Event bus connecting engine ↔ logger ↔ UI
├── ui/                   # React/Ink terminal UI (App.tsx, runUi.tsx)
├── replay/               # Replay system (loadReplay.ts)
├── logger.ts             # Structured JSON logging
├── game.ts               # Backwards-compatible facade over gameEngine
└── types.ts              # Core types (Role, GameState, Player, etc.)
```

**Game loop**: `gameEngine.ts` orchestrates rounds. Each round: night phase collects actions from role modules → `resolver.ts` resolves them deterministically → day discussion (budget-limited messages) → day voting → win-condition check.

**Agent system**: `agent.ts` wraps Vercel AI SDK's `generateText()`. Each agent has public + private memory notebooks. Mafia share faction memory. Dry-run mode uses FNV-1a hashing for deterministic action selection.

**Night resolution**: Deterministic — see [game_logic.md](game_logic.md#night-resolution-order) for the full priority chain.

## Configuration

`game-config.yaml` — Zod-validated. Key knobs:

- `players[].model`: AI Gateway format (`provider/model`, e.g. `openai/gpt-5.2`)
- `players[].temperature`: Per-player temperature override
- `roles`: Explicit map (player→role) or use `role_counts`/`role_pool` for randomization
- `role_seed`, `player_order_seed`: For deterministic runs
- `role_setup_visibility`: `exact` | `pool` | `all` — what players know about roles in play
- `enable_faction_memory`: Mafia share memory summaries
- `discussion_open_*`: Message budget tuning (floor, cap, per-player scaling)

## Environment

`.env` at repo root:
```
AI_GATEWAY_API_KEY=vck_...
```

Only required for live games. Dry-run needs nothing.

## Adding a New Role

1. Add the role to the `Role` union in `src/types.ts`
2. Add a `RoleDefinition` entry in `src/roles.ts`
3. Create `src/roleModules/<role>.ts` exporting a `collectAction` function
4. Register the collector in `src/roleRegistry.ts`
5. If the role has special resolution logic, update `src/actions/resolver.ts`
6. Add test cases to `src/actions/resolver.test.ts`

## Conventions

- **Async/Await** for all AI calls
- **Strict TypeScript** — no `any`
- **Fail fast** on invalid config; graceful degradation on AI failures (retry/skip)
- **Tests**: Use `node:test` + `node:assert/strict`. Test files live next to source as `*.test.ts`
- **Roles are modular**: each role's night behavior is isolated in `roleModules/`

## Continuous Documentation

**Always update docs as you work.** When you discover gotchas, workarounds, useful commands, error patterns, or non-obvious architecture context — write it down immediately. Don't let knowledge die in a conversation.

- Small, broad notes → `AGENTS.md`
- Workflow-specific → `docs/workflows/`
- Package-specific README within that package
