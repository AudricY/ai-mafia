# 🕵️ AI Mafia

> An autonomous social deduction game powered by Language Models.

AI Mafia simulates a full game of Mafia (Werewolf) where **every player is an AI agent**. Powered by the Vercel AI SDK, agents discuss, deduce, deceive, and eliminate each other in a battle of wits.

Designed to demonstrate agentic behavior, role-playing capabilities, and complex multi-agent interaction.

## ✨ Features

- **Autonomous Agents**: 7+ AI players with distinct personalities and hidden roles.
- **Complex Mechanics**: Full Day/Night cycle, voting systems, and specialized roles (Cop, Doctor, Vigilante, Godfather, etc.).
- **Vercel AI SDK Integration**: Built on top of the modern AI engineering stack.
- **Flexible Engine**: Configurable rules, roles, and models via YAML.
- **TUI & Logs**: Watch the drama unfold in a terminal UI or analyze structured JSON logs later.

## 🚀 Quick Start

1.  **Install dependencies**
    ```bash
    pnpm install
    ```

2.  **Configure API Key**
    Create a `.env` file and add your Vercel AI Gateway key:
    ```bash
    AI_GATEWAY_API_KEY=your_key_here
    ```

3.  **Run the Simulation**
    ```bash
    pnpm start
    ```

## 🏗️ Architecture

- **`src/engine`**: Core game loop and state machine.
- **`src/agent.ts`**: AI abstraction layer handling prompt construction and tool use.
- **`src/phases`**: Modular logic for Night, Discussion, and Voting phases.
- **`src/config.ts`**: Zod-validated configuration system.

For deep technical details, developer guides, and architectural decisions, see **[AGENTS.md](./AGENTS.md)**.

## 📄 License

ISC
