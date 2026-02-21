# Game Configuration

All game setup lives in `game-config.yaml` (Zod-validated by `src/config.ts`).

## Minimal config

```yaml
system_prompt: |
  You are a player in a game of Mafia.

players:
  - name: "Alice"
    model: "openai/gpt-5.2"
  - name: "Bob"
    model: "xai/grok-4.1-fast-reasoning"
  # ... (minimum ~5 players for a meaningful game)

role_counts:
  godfather: 1
  mafia: 1
  cop: 1
  doctor: 1
  villager: 2
```

## Role assignment modes

**Explicit** — map each player to a role:
```yaml
roles:
  Alice: godfather
  Bob: cop
  # ...
```

**Random from counts** — engine assigns randomly:
```yaml
role_counts:
  godfather: 1
  cop: 1
  villager: 3
role_seed: 42  # optional, for reproducibility
```

**Random from pool** — define possible roles, engine picks:
```yaml
role_pool:
  - godfather
  - cop
  - villager
```

## Model format

Models use AI Gateway routing: `provider/model`

Examples: `openai/gpt-5.2`, `anthropic/claude-sonnet-4.5`, `xai/grok-4.1-fast-reasoning`, `google/gemini-3-pro-preview`, `deepseek/deepseek-v3.2-thinking`

## Key tuning parameters

| Parameter | Default | Purpose |
|---|---|---|
| `role_setup_visibility` | `exact` | What players know about roles: `exact`, `pool`, or `all` |
| `enable_faction_memory` | — | Mafia agents share memory summaries |
| `log_thoughts` | — | Log agent internal reasoning |
| `memory_window_size` | — | How many messages agents remember |
| `discussion_open_floor` | 8 | Min messages per discussion |
| `discussion_open_cap` | 60 | Max messages per discussion |
| `discussion_open_per_player_base` | 1.2 | Base messages per alive player |
| `discussion_open_per_player_round_bonus` | 1.0 | Extra messages per player per round |

## Validation

Config is validated at startup by Zod schemas in `src/config.ts`. Invalid config fails fast with descriptive errors.
