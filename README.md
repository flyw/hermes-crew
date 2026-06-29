# 🚢 HermesCrew

> **HermesCrew** is a modern, collaborative multi-agent software engineering platform and autonomous execution engine. It integrates real-time conversational AI, autonomous task assignment, agent council meeting rooms, and prompt-orchestrated Kanban boards into your local software development lifecycle (SDLC).

---

## 🌟 Key Capabilities & Features

### 🏢 Integrated Workspace Chat & Real-Time Streaming
* ⚡ **SSE Token Streaming**: Real-time server-sent events (SSE) stream AI responses token-by-token with zero buffering.
* 🎯 **Project Planner Chat**: Dedicated Senior Project Architect & Team Recruiter AI embedded within every Kanban workspace to dynamically analyze requirements and recruit specialized agents.
* ⏹️ **Execution Abort & Control**: Instant process termination (`POST /api/stop`) via visible `⏹️ Stop` buttons across all chat and card modal interfaces.

### 📋 Agent-Enabled Kanban & Autonomous Routing
* 🧠 **Autonomous Task Assignment**: Unassigned cards automatically trigger Coordinator analysis to evaluate team role personas and assign ownership via `[ASSIGN_TO: Role Name]`.
* ⛓️ **Autonomous Subtask Breakdown**: Agents autonomously decompose complex, multi-step engineering tasks into connected sub-cards using directive tags (`[CREATE_SUBCARD: Title | Description]`).
* 🔄 **Directives-Based Handshakes**: Seamless cross-column workflow transitions via directive tags (`[MOVE_TO: Column Name]`).

### 🤝 Agent Meeting Room (Council & Governance)
* 🏛️ **Virtual Conference Room**: Automated multi-agent discussions where specialized team roles (Analyst, Coder, Log Analyst, DSP Researcher, Data Scientist, etc.) debate implementation proposals.
* ⚖️ **Budget & Consensus Governance**: Configurable round budgets (default 10 rounds) moderated by a Meeting Administrator prompt.

### 🎯 Project Governance & Scope Terms
* 📐 **Management Terms Alignment**: High-level alignment panel for `Vision`, `Mission`, `Need`, `Want`, and `Target Scope`.

---

## 🛠️ Getting Started

### Prerequisites
* **Node.js**: Version 18 or higher.
* **Hermes CLI**: Installed locally (default path: `~/.local/bin/hermes`).

### Installation & Run

1. Clone the repository:
   ```bash
   git clone https://github.com/flyw/hermes-crew.git
   cd hermes-crew
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the application:
   ```bash
   npm run dev
   ```

4. Open your browser:
   ```
   http://localhost:5000
   ```

---

## 📂 Project Structure

```
hermes-crew/
├── public/                # Frontend Web Application (HTML, CSS, JS)
│   ├── index.html         # Workspace Chat & Agent Kanban Dashboard
│   ├── style.css          # Modern dark-themed CSS design system
│   └── app.js             # Client-side UI, SSE stream handlers & IPC logic
├── server.js              # Express Backend (Process registry, CLI runner, APIs)
├── package.json           # Node project manifest
├── kanban.json            # Kanban board database registry
├── projects.json          # Workspace projects registry
└── history.json           # Chat conversation logs
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
