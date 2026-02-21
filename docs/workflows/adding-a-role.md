# Adding a New Role

## Steps

1. **Define the type** — Add the role name to the `Role` union in `src/types.ts`

2. **Add role metadata** — Add a `RoleDefinition` entry in `src/roles.ts` with team, summary, abilities, and notes

3. **Create action collector** — Add `src/roleModules/<role>.ts` exporting a `collectAction(player, gameState)` function that returns a `NightActionIntent` (see `src/actions/types.ts` for the intent schema)

4. **Register the collector** — Wire it into `src/roleRegistry.ts` so the engine calls it during night phase

5. **Update the resolver** — If the role has non-standard resolution logic (e.g., special kill interactions, investigation immunity), update `src/actions/resolver.ts`

6. **Add tests** — Add resolution test cases in `src/actions/resolver.test.ts` covering the role's interactions with existing roles (blocks, saves, kills)

7. **Add to config** — The role can now be used in `game-config.yaml` under `roles`, `role_counts`, or `role_pool`

## Reference implementations

- **Simple night action**: `src/roleModules/cop.ts` (investigate → get result)
- **Kill action**: `src/roleModules/vigilante.ts` (optional kill)
- **Block action**: `src/roleModules/roleblocker.ts` (prevent target's action)
- **Mafia coordinated action**: `src/roleModules/mafiaCouncil.ts` (faction-wide kill coordination)
- **Passive role**: Bomb has no collector — resolution logic lives entirely in `resolver.ts`
