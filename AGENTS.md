# AI Mafia

Autonomous Mafia played by LLM agents. Node.js 22.13+, strict TypeScript, pnpm, Vercel AI SDK + AI Gateway, React/Ink, YAML/Zod, and `node:test`.

## Read first

- [README.md](README.md): setup and common commands
- [docs/architecture.md](docs/architecture.md): code map and game flow
- [game_logic.md](game_logic.md): authoritative rules and resolution order
- [docs/workflows/game-configuration.md](docs/workflows/game-configuration.md): configuration
- [docs/workflows/adding-a-role.md](docs/workflows/adding-a-role.md): role changes
- [docs/workflows/testing.md](docs/workflows/testing.md): tests
- [docs/workflows/agent-runtime.md](docs/workflows/agent-runtime.md): prompts, privacy, provider fallbacks
- [docs/workflows/logging-and-replay.md](docs/workflows/logging-and-replay.md): log and replay contracts

## Agent behaviour

- self drive git commits
- Use async/await, strict types, and no `any`.
- Add colocated `*.test.ts` coverage for behavior changes; run `pnpm check && pnpm test`.
- Put durable discoveries in the relevant focused doc, not this file.
