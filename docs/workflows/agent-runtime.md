# Agent Runtime

`src/agent.ts` builds prompts and calls the Vercel AI SDK through AI Gateway. `src/agentIo.ts` owns timeouts, retries, and fallbacks. Use async/await for every AI call and degrade gracefully after transport or model failures.

## Public/private boundary

Public day-discussion prompts may use a player's private notebook for strategy, but notebook content is not admissible as public evidence. Never include mafia `Faction shared summary` or `Faction recent events` in public speech generation; reserve them for faction chat, mafia council planning, and other private reasoning paths.

Public prompts require a player to state a read or explain why a question matters before asking it. They should also encourage disclosure of private information when it would materially change the best elimination or prevent a likely miselimination.

## Failure behavior

When a public discussion call exhausts retries, emit:

```text
I hit a response error and cannot answer this turn.
```

Do not silently convert this failure to `SKIP`; the table must be able to distinguish an API failure from a deliberate pass.

## Provider compatibility

As probed on March 11, 2026, `zai/glm-5` and `moonshotai/kimi-k2.5` through AI Gateway were unreliable for fully structured freeform turns. `generateObject()` / `Output.object()` worked for decision- and plan-style schemas, but Kimi failed on the game's `{ public, note }` shape. Keep `generateText()` plus JSON-salvage fallbacks for discussion turns unless a new probe confirms changed SDK/provider behavior.
