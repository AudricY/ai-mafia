# Game Logic & Rules

## Win Conditions

| Team | Condition |
|---|---|
| **Town** | Eliminate all Mafia-aligned players |
| **Mafia** | Equal or outnumber Town |
| **Jester** | Get eliminated by day vote (co-win, game continues) |
| **Executioner** | Get assigned target eliminated by day vote (co-win, game continues). If target dies at night, Executioner becomes Jester |

## Roles

### Town

| Role | Night Action | Notes |
|---|---|---|
| **Villager** | None | Relies on discussion and voting |
| **Cop** | Investigate one player → MAFIA or INNOCENT | Godfather reads INNOCENT. Framed targets read MAFIA |
| **Doctor** | Protect one player from night kills | Can self-target. Prevents both Mafia and Vigilante kills |
| **Vigilante** | Shoot one player, or hold fire (`nobody`) | Can accidentally kill Town |
| **Roleblocker** | Block one player's night action | Cannot self-target. Priority 2 |
| **Tracker** | Track one player → learn who they visited | Only sees successful visits. Blocked/idle targets show "no visit" |
| **Jailkeeper** | Jail one player: protect + block them | Cannot self-target. Highest block priority (3) |
| **Mason** | None | Knows other Masons at game start (confirmed Town to each other) |
| **Bomb** | None (passive) | If killed at night, the killer also dies |

### Mafia

All Mafia members share a private night chat to coordinate. Godfather is the default shooter; if Godfather dies, another Mafia member takes over.

| Role | Night Action | Notes |
|---|---|---|
| **Godfather** | Leads Mafia kill | Investigation immune: reads INNOCENT to Cop |
| **Mafia** | Participates in kill coordination | Basic Mafia member |
| **Mafia Roleblocker** | Block one player's night action | Priority 1 (lowest among blockers) |
| **Framer** | Frame one player | Target reads MAFIA to Cop that night only |
| **Janitor** | Clean a Mafia kill victim | Victim's role shown as "unknown" publicly |
| **Forger** | Forge a Mafia kill victim's role | Victim's role shown as the forged role. Takes precedence over Janitor |

### Neutral

| Role | Night Action | Win Condition |
|---|---|---|
| **Jester** | None | Get voted out during the day |
| **Executioner** | None | Get assigned target voted out. Becomes Jester if target dies at night |

## Night Resolution Order

All actions are collected simultaneously, then resolved deterministically:

1. **Blocks & Jails** — Chain resolution with cycle detection. Priority: Jailkeeper (3) > Town Roleblocker (2) > Mafia Roleblocker (1). Mutual blocks = both fail. Jailed players are both blocked and protected.
2. **Saves** — Blocked doctors don't save.
3. **Frames** — Blocked framers don't frame.
4. **Investigations** — Blocked cops don't investigate. Framing and Godfather immunity applied.
5. **Kills** — Blocked shooters don't kill. Saved targets survive. Mafia cannot kill Mafia-aligned players.
6. **Deaths computed**
7. **Bomb retaliation** — If a Bomb dies, the player who killed them also dies.
8. **Tracker results** — Blocked trackers see nothing. Only successful visits are reported.
9. **Death reveal overrides** — Forger (fake role) takes precedence over Janitor (hidden role).

## Day Phase

Three sub-phases, all turn-based round-robin:

### 1. Question Round
Each alive player gets one turn to ask a targeted question to a specific player. Players can `SKIP` if they have nothing to ask.

### 2. Open Discussion
Round-robin continues. Budget-limited: message count scales with alive players and round progression (configurable via `discussion_open_*` params). Ends when budget is exhausted or all alive players skip consecutively (silence).

### 3. Pre-vote Statements
Each alive player gets one final turn to state their #1 suspect and reasoning before voting.

### Skip-Discussion Voting
During any discussion sub-phase, players can include `VOTE_SKIP_DISCUSSION` on its own line to vote for ending discussion early. `UNVOTE_SKIP_DISCUSSION` retracts. If a strict majority votes to skip, discussion ends immediately and voting begins. Vote tokens are stripped from the public message.

## Voting

- All alive players vote concurrently: choose a player to eliminate, or `skip`.
- **Plurality wins** — player with the most votes is eliminated and their role is revealed.
- **Tie or majority skip** — no elimination.
- Jester/Executioner co-wins are checked immediately after a day elimination.
