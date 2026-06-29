# 🚢 HermesCrew

> **HermesCrew** is a collaborative multi-agent software development workspace and execution engine. It combines a direct conversational chat interface with an agent-orchestrated Kanban board, allowing autonomous AI agents to collaborate, write code, run tasks, and manage workflows directly within your local project directories.

---

## 🌟 Core Features

* 💬 **Interactive Chat Workspace**: Direct, real-time conversation with the agent. Brainstorm ideas, troubleshoot errors, and run tasks in the context of your local directories.
* 📋 **Agent-Enabled Kanban Board**: Model your software development life cycle (SDLC) visually. Map columns on the board to specialized, prompt-configured AI agents (e.g., Inbox ➔ Analysis ➔ Execution ➔ QA ➔ Done).
* ⚙️ **Autonomous Handshakes & Routing**: Agents can programmatically route cards across columns by appending directives (e.g., `[MOVE_TO: Execution]`). Watch cards move, run, and update automatically.
* 📂 **Multi-Project Management**: Manage and switch between different local workspace directories from a single central web dashboard.
* 💻 **Local CLI Integration**: Interacts directly with your local system through the `hermes` CLI runner, giving agents the ability to write code, run tests, and examine files.

---

## 🚀 Upcoming Roadmap

We are transforming HermesCrew into an autonomous virtual software agency. Future releases will introduce:

1. 🎯 **Project Mission & Governance Constraints**
   * Define explicit project inputs: `goals`, `needs`, `wants`, and `missions`.
   * Enforce these high-level guidelines to restrict and validate agent behavior during implementation.
2. ⛓️ **Autonomous Subtask Breakdown**
   * Give lead agents the authority to break down complex tasks into nested subtask structures.
   * Coordinate subtask execution automatically, track dependencies, and guarantee target delivery.
3. 🤝 **Agent Meeting Room (Council)**
   * A virtual conference room where multiple specialized agents (e.g., Product Manager, Architect, Coder, QA) debate implementation details, discuss requirements, and build consensus before execution.

---

## 🛠️ Getting Started

### Prerequisites

* **Node.js**: Version 18 or higher.
* **Hermes CLI**: Ensure the `hermes` executable is installed locally (default path: `/home/yuan/.local/bin/hermes` or configured in the environment).

### Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/your-username/hermes-crew.git
   cd hermes-crew
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and navigate to:
   ```
   http://localhost:5000
   ```

---

## 📂 Project Structure

```
hermes-crew/
├── public/                # Frontend Web Application (HTML, CSS, JS)
│   ├── index.html         # Main dashboard layout (Chat & Kanban tabs)
│   ├── style.css          # Sleek modern dark-themed styling
│   └── app.js             # Client-side UI & polling logic
├── server.js              # Express Backend (executes processes, logs, API)
├── package.json           # Node project manifest
├── kanban.json            # Active kanban board state registry
├── projects.json          # Workspace projects registry
└── history.json           # Chat conversations registry
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
