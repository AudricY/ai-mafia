# AI Mafia: Game Logic & Rules

This document describes the rules, roles, and flow of the AI Mafia game simulation.

## 🎯 Objective
The game is a battle between the **Town** (majority) and the **Mafia** (minority).
- **Town Win Condition**: Eliminate all Mafia members.
- **Mafia Win Condition**: Equal or outnumber the Town members.

## 🎭 Roles

### Mafia Team
The Mafia work together to eliminate the town. They have a private chat at night.
- **Godfather**: The leader of the Mafia.
    - *Ability*: **Investigation Immunity**. Appears "Innocent" if investigated by the Cop.
    - *Action*: Leads the Mafia night kill.
- **Mafia**: A regular member of the Mafia team.
    - *Ability*: Participates in the night chat and vote. Becomes the shooter if the Godfather dies.

### Town Team
The Town must deduce who the Mafia are based on discussion and their abilities.
- **Cop**
    - *Action*: **Investigate**. Each night, choose a player to learn if they are "Mafia" or "Innocent". (Note: The Godfather tricks the Cop!).
- **Doctor**
    - *Action*: **Heal/Save**. Each night, choose a player to protect. If that player is attacked, they survive.
- **Vigilante**
    - *Action*: **Shoot**. Each night, can choose to kill a suspect. Be careful not to shoot an innocent townie!
- **Roleblocker**
    - *Action*: **Block**. Each night, choose a player to distract. That player's ability (Kill, Save, Investigate) will fail for that night.
- **Villager**
    - *Action*: **None**. Must rely on their wit, observation, and persuasion during the day.

## 🔄 Game Cycle

The game proceeds in rounds, alternating between **Night** and **Day**.

### 🌑 Night Phase
This is when special actions happen in secret.
1.  **Mafia Chat**: The Mafia team discusses their target privately.
2.  **Roleblocker Action**: The Roleblocker chooses someone to block.
3.  **Mafia Kill**: The Mafia chooses a victim. (If the shooter was blocked, the kill fails).
4.  **Town Actions**:
    - Cop investigates. (Fails if blocked).
    - Doctor protects. (Fails if blocked).
    - Vigilante shoots. (Fails if blocked).
5.  **Resolution**: The game calculates who died (unless saved) and reveals the deaths to everyone at dawn.

### ☀️ Day Phase
This is when everyone meets to discuss the events.
1.  **Announcement**: Deaths from the night are revealed.
2.  **Discussion**:
    - Players speak in turns.
    - This is a dynamic conversation: players can choose to **SKIP** their turn if they have nothing to say.
    - **Skip-Discussion Vote**: At any time during discussion, players can vote to skip the discussion phase and proceed directly to voting. To vote, include `VOTE_SKIP_DISCUSSION` on its own line in your message. To retract your vote, include `UNVOTE_SKIP_DISCUSSION` on its own line. If a strict majority (more than half) of alive players vote to skip, discussion ends immediately and voting begins. The vote command is removed from your public message; any other text you write is still spoken.
    - Discussion ends when everyone is silent, the "patience limit" (message cap) is reached, or a majority votes to skip discussion.
3.  **Voting**:
    - Every player votes to **Eliminate** someone or **Skip** voting.
    - If a player receives the majority of votes, they are executed and their role is revealed.
    - If there is a tie or majority 'Skip', no one dies.

## 🏁 Ending
The game repeats Night and Day phases until one team meets their win condition.
