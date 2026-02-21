# Testing

## Run all tests

```bash
pnpm test
```

Uses Node.js built-in `node:test` runner with `tsx` for TypeScript. Test files are co-located with source as `*.test.ts`.

## Existing test coverage

- `src/actions/resolver.test.ts` — Night action resolution: roleblocks, saves, kills, investigations, framing, bomb retaliation, jailkeeper interactions
- `src/engine/dryRunGame.test.ts` — Full game integration test (runs a complete game in dry-run mode, asserts it reaches completion)
- `src/phases/dayDiscussionPhase.test.ts` — Day discussion phase logic

## Writing tests

- Import from `node:test` (`describe`, `it`) and `node:assert/strict`
- Place test files next to the module they test: `src/<dir>/<module>.test.ts`
- For action resolution tests, construct `NightActionIntent[]` arrays and assert on `ResolvedAction[]` output
- For integration tests, use dry-run mode (`process.env.AI_MAFIA_DRY_RUN = '1'`) to avoid API calls

## Dry-run integration test

The integration test in `dryRunGame.test.ts` runs a full game without LLM calls. Use this as a smoke test after engine changes:

```bash
pnpm test -- --test-name-pattern="dry run"
```
