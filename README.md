# AI Mafia

> An autonomous social deduction game powered by Language Models.

AI Mafia simulates a full game of Mafia (or Werewolf, etc.) where **every player is an AI agent**. Powered by the Vercel AI SDK, agents discuss, deduce, deceive, and eliminate each other in a battle of wits.

<video src="assets/demo.mp4" controls="controls" style="max-width: 100%;">
</video>

Designed to demonstrate agentic behavior, role-playing capabilities, and complex multi-agent interaction.

## Features

- **Autonomous Agents**: Multiple AI players with distinct personalities and hidden roles.
- **Complex Mechanics**: Full Day/Night cycle, voting systems, and specialized roles (Cop, Doctor, Vigilante, Godfather, etc.).
- **Flexible Engine**: Configurable rules, roles, and models via YAML.
- **TUI & Replays**: Watch the drama unfold in a terminal UI, analyze JSON logs, or re-watch any game with the replay system.

## Quick Start

1.  **Install dependencies**
    ```bash
    pnpm install
    ```

2.  **Run with Agents (Requires API Key)**
    Create a `.env` file with your Vercel AI Gateway key:
    ```bash
    AI_GATEWAY_API_KEY=your_key_here
    ```
    ```bash
    pnpm start
    ```

3.  **Run Dry-Run (No API Key Required)**
    Exercise the full game loop without calling any LLMs:
    ```bash
    pnpm start:dry-run
    ```

4.  **Replay a Game**
    Re-watch any game from the `logs/` directory:
    ```bash
    pnpm start --replay [latest|filename]
    ```

## Architecture Overview

- **`src/engine`**: Core game loop and state machine.
- **`src/agent.ts`**: AI abstraction layer handling prompt construction and tool use.
- **`src/phases`**: Modular logic for Night, Discussion, and Voting phases.
- **`src/config.ts`**: Zod-validated configuration system.

## Notes
- As of end 2025, xai/grok-4.1-fast-reasoning has a good amount of intelligence for the game and a very reasonable cost, making it a great choice for the players. Try the smarter frontier models like openai/gpt-5.2 for higher level gameplay.

## License

MIT
