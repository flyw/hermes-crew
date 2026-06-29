const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 5000;

// Running Process Registry & Termination Support
const runningProcesses = [];

function registerRunningProcess({ projectId, cardId, child }) {
  if (!child || !child.pid) return;
  const item = { pid: child.pid, projectId: projectId || 'proj-default', cardId, child, logs: '', listeners: [] };
  runningProcesses.push(item);

  if (child.stdout) {
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      item.logs += text;
      item.listeners.forEach(res => {
        try { res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`); } catch(e){}
      });
    });
  }
  if (child.stderr) {
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      item.logs += text;
      item.listeners.forEach(res => {
        try { res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`); } catch(e){}
      });
    });
  }

  const cleanup = () => {
    item.listeners.forEach(res => {
      try { res.write(`data: ${JSON.stringify({ done: true })}\n\n`); res.end(); } catch(e){}
    });
    item.listeners = [];
    const idx = runningProcesses.findIndex(p => p.pid === child.pid);
    if (idx !== -1) runningProcesses.splice(idx, 1);
    processAgentExecutionQueue();
  };
  child.on('close', cleanup);
  child.on('error', cleanup);
}

// Dynamic path configuration (avoids hardcoding user home paths)
const DEFAULT_HERMES_PATH = path.join(os.homedir(), '.local/bin/hermes');
const DEFAULT_HERMES_CONFIG_DIR = path.join(os.homedir(), '.hermes');
const CONFIG_FILE = path.join(__dirname, 'config.json');

function resolveHome(filepath) {
  if (filepath && (filepath.startsWith('~/') || filepath === '~')) {
    return filepath.replace('~', os.homedir());
  }
  return filepath;
}

function readConfig() {
  let config = {
    hermesPath: DEFAULT_HERMES_PATH,
    hermesConfigDir: DEFAULT_HERMES_CONFIG_DIR,
    maxConcurrentAgents: 3
  };
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      config = { ...config, ...saved };
    }
  } catch (err) {
    console.error('Error reading config file:', err);
  }
  if (!config.hermesPath) config.hermesPath = DEFAULT_HERMES_PATH;
  if (!config.hermesConfigDir) config.hermesConfigDir = DEFAULT_HERMES_CONFIG_DIR;
  if (!config.maxConcurrentAgents || isNaN(config.maxConcurrentAgents)) config.maxConcurrentAgents = 3;
  return config;
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving config file:', err);
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Registry File Paths
const HISTORY_FILE = path.join(__dirname, 'history.json');
const PROJECTS_FILE = path.join(__dirname, 'projects.json');

// --- Helper Functions ---

// Read chat history from file
function readHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error reading history file:', err);
  }
  return [];
}

// Write chat history to file
function saveHistory(history) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving history file:', err);
  }
}

// Read projects registry
function readProjects() {
  try {
    if (fs.existsSync(PROJECTS_FILE)) {
      return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error reading projects file:', err);
  }
  return [];
}

// Write projects registry
function saveProjects(projects) {
  try {
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving projects file:', err);
  }
}

// Helper to get active project and its kanban file path
function getProjectAndKanban(projectId) {
  const projects = readProjects();
  
  // Fallback to default if projectId is invalid or missing
  let project = projects.find(p => p.id === projectId);
  if (!project) {
    project = projects.find(p => p.id === 'proj-default') || projects[0];
  }
  
  if (!project) {
    // If no project registry exists at all, initialize default
    project = {
      id: 'proj-default',
      name: 'Default Workspace',
      path: __dirname
    };
    saveProjects([project]);
  }

  const kanbanPath = path.join(project.path, 'kanban.json');
  let kanban = { columns: [], cards: [], agents: [] };

  if (fs.existsSync(kanbanPath)) {
    try {
      kanban = JSON.parse(fs.readFileSync(kanbanPath, 'utf8'));
    } catch (err) {
      console.error(`Error reading kanban for project ${project.name}:`, err);
    }
  } else {
    // Initialize default kanban layout
    const analystId = 'agent-analyst';
    const coderId = 'agent-coder';

    kanban = {
      agents: [
        {
          id: analystId,
          name: "Analyst Agent",
          prompt: "You are a senior task analyst. Analyze the following task: write down its feasibility, potential risks, and outline a step-by-step implementation plan.\n\nOnce completed, please decide where to route this card. If it looks feasible and ready for code execution, add \"[MOVE_TO: Execution]\" at the end of your response. If it contains major risks or is incomplete, add \"[MOVE_TO: Inbox]\"."
        },
        {
          id: coderId,
          name: "Coder Agent",
          prompt: "You are an expert developer. Implement the task described in this card. Provide the complete code or step-by-step guidance.\n\nOnce done, add \"[MOVE_TO: Done]\" at the end of your response."
        }
      ],
      columns: [
        {
          id: "col-1",
          name: "Inbox",
          agentEnabled: false,
          agentId: null,
          agentPrompt: ""
        },
        {
          id: "col-2",
          name: "Analysis",
          agentEnabled: true,
          agentId: analystId,
          agentPrompt: "Analyze the task requirements, conduct a feasibility assessment, identify potential risks, and outline a step-by-step implementation plan. When ready for implementation output [MOVE_TO: Execution]."
        },
        {
          id: "col-3",
          name: "Execution",
          agentEnabled: true,
          agentId: coderId,
          agentPrompt: "Execute the software development implementation task inside the workspace directory. Write or update code files and verify functionality. When completed output [MOVE_TO: Done]."
        },
        {
          id: "col-4",
          name: "Done",
          agentEnabled: false,
          agentId: null,
          agentPrompt: ""
        }
      ],
      cards: [
        {
          id: "card-1",
          columnId: "col-1",
          title: "Welcome to your board",
          description: `This is your default Kanban card for project "${project.name}". Drag it to columns to invoke Hermes Agent inside this directory: ${project.path}`,
          isProcessing: false,
          agentSummary: "",
          comments: [],
          sessionId: null
        }
      ]
    };
    
    // Ensure project directory exists
    try {
      fs.mkdirSync(project.path, { recursive: true });
      fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');
    } catch (err) {
      console.error(`Error initializing project directory/kanban at ${project.path}:`, err);
    }
  }

  // Backwards compatibility safety check
  let needsWrite = false;

  if (!kanban.scope) {
    kanban.scope = {
      vision: "Build an autonomous collaborative workspace driven by multi-agent synergy.",
      mission: "Streamline project task execution through continuous AI planning and automated Kanban operations.",
      need: "High-level automation, real-time agent discussion consensus, and structured task breakdown.",
      want: "Interactive meeting room moderation, auto-recruiting agent roles, and sub-card relationship tracking.",
      targetScope: "Full feature release including Project Planning Chat, Meeting Room column moderation, and subcard linkage.",
      lastUpdated: new Date().toISOString()
    };
    needsWrite = true;
  }

  if (!kanban.agents || kanban.agents.length === 0) {
    const analystId = 'agent-analyst';
    const coderId = 'agent-coder';
    kanban.agents = [
      {
        id: analystId,
        name: "Analyst Agent",
        prompt: "You are a senior task analyst. Analyze the following task: write down its feasibility, potential risks, and outline a step-by-step implementation plan.\n\nOnce completed, please decide where to route this card. If it looks feasible and ready for code execution, add \"[MOVE_TO: Execution]\" at the end of your response. If it contains major risks or is incomplete, add \"[MOVE_TO: Inbox]\"."
      },
      {
        id: coderId,
        name: "Coder Agent",
        prompt: "You are an expert developer. Implement the task described in this card. Provide the complete code or step-by-step guidance.\n\nOnce done, add \"[MOVE_TO: Done]\" at the end of your response."
      }
    ];
    
    // Auto-bind existing columns if they match names
    kanban.columns.forEach(col => {
      if (col.name.toLowerCase() === 'analysis') {
        col.agentId = analystId;
        col.agentEnabled = true;
      } else if (col.name.toLowerCase() === 'execution') {
        col.agentId = coderId;
        col.agentEnabled = true;
      }
    });

    needsWrite = true;
  }

  // Ensure Meeting Administrator is NOT in agents list (refactored to column prompt)
  if (kanban.agents.find(a => a.id === 'agent-meeting-admin')) {
    kanban.agents = kanban.agents.filter(a => a.id !== 'agent-meeting-admin');
    needsWrite = true;
  }

  // Ensure Meeting Room column exists
  const meetingColPrompt = 'You are moderating the Meeting Room discussion. Review all participating team agent comments and card details. Evaluate whether a clear consensus or actionable outcome has been reached. If yes, summarize the final conclusion clearly and output [MEETING_STATUS: CONCLUDED] and [MOVE_TO: Target Column]. If no, specify what key points remain unresolved, guide the next discussion focus, and output [MEETING_STATUS: CONTINUE].';

  let existingMeetingCol = kanban.columns.find(c => c.isMeetingRoom || c.name === 'Meeting Room');
  if (!existingMeetingCol) {
    const meetingCol = {
      id: 'col-meeting',
      name: 'Meeting Room',
      agentEnabled: true,
      agentId: null,
      agentPrompt: meetingColPrompt,
      isMeetingRoom: true
    };
    const inboxIdx = kanban.columns.findIndex(c => c.id === 'col-1' || c.name.toLowerCase() === 'inbox');
    if (inboxIdx !== -1) {
      kanban.columns.splice(inboxIdx + 1, 0, meetingCol);
    } else {
      kanban.columns.unshift(meetingCol);
    }
    needsWrite = true;
  } else {
    if (existingMeetingCol.name !== 'Meeting Room') {
      existingMeetingCol.name = 'Meeting Room';
      needsWrite = true;
    }
    if (!existingMeetingCol.agentPrompt) {
      existingMeetingCol.agentPrompt = meetingColPrompt;
      needsWrite = true;
    }
    if (existingMeetingCol.agentId === 'agent-meeting-admin') {
      existingMeetingCol.agentId = null;
      needsWrite = true;
    }
  }
  
  kanban.columns.forEach(col => {
    if (col.agentId === undefined) {
      col.agentId = null;
      needsWrite = true;
    }
    if (col.name.toLowerCase() === 'analysis' && !col.agentPrompt) {
      col.agentPrompt = "Analyze the task requirements, conduct a feasibility assessment, identify potential risks, and outline a step-by-step implementation plan. When ready for implementation output [MOVE_TO: Execution].";
      needsWrite = true;
    } else if (col.name.toLowerCase() === 'execution' && !col.agentPrompt) {
      col.agentPrompt = "Execute the software development implementation task inside the workspace directory. Write or update code files and verify functionality. When completed output [MOVE_TO: Done].";
      needsWrite = true;
    }
  });

  if (!kanban.cards) kanban.cards = [];
  kanban.cards.forEach(card => {
    if (card.owner === undefined) {
      card.owner = 'unassigned';
      needsWrite = true;
    }
    if (card.watchers === undefined) {
      card.watchers = [];
      needsWrite = true;
    }
    if (card.subCardIds === undefined) {
      card.subCardIds = [];
      needsWrite = true;
    }
    if (card.parentCardId === undefined) {
      card.parentCardId = null;
      needsWrite = true;
    }
    if (card.meetingRounds === undefined) {
      card.meetingRounds = 0;
      needsWrite = true;
    }
    if (card.maxBudget === undefined) {
      card.maxBudget = 10;
      needsWrite = true;
    }
  });

  if (needsWrite) {
    try {
      fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');
    } catch (err) {
      console.error('Error rewriting kanban.json for backwards compatibility:', err);
    }
  }

  return { project, kanban, kanbanPath };
}

// Clean Hermes outputs and extract session ID
function cleanOutputAndSession(stdout, stderr) {
  let cleanStdout = stdout;
  let cleanStderr = stderr;
  let sessionId = null;

  const matchStdout = stdout.match(/session_id:\s*([^\s\n]+)/i);
  if (matchStdout) {
    sessionId = matchStdout[1];
    cleanStdout = cleanStdout.replace(/session_id:\s*[^\s\n]+/gi, '');
  }

  const matchStderr = stderr.match(/session_id:\s*([^\s\n]+)/i);
  if (matchStderr) {
    sessionId = matchStderr[1];
    cleanStderr = cleanStderr.replace(/session_id:\s*[^\s\n]+/gi, '');
  }

  cleanStdout = cleanStdout.replace(/^↻ Resumed session.*?\n/im, '');
  cleanStderr = cleanStderr.replace(/^↻ Resumed session.*?\n/im, '');

  return {
    output: cleanStdout.trim(),
    error: cleanStderr.trim(),
    sessionId
  };
}

// --- Configuration APIs ---

// GET: Get current paths and status
app.get('/api/config', (req, res) => {
  const config = readConfig();
  const resolvedPath = resolveHome(config.hermesPath);
  const resolvedConfigDir = resolveHome(config.hermesConfigDir);
  
  let hermesPathExists = false;
  try {
    if (config.hermesPath === 'hermes') {
      hermesPathExists = true;
    } else {
      hermesPathExists = fs.existsSync(resolvedPath);
    }
  } catch (e) {}
  
  let hermesConfigDirExists = false;
  try {
    hermesConfigDirExists = fs.existsSync(resolvedConfigDir);
  } catch (e) {}
  
  res.json({
    hermesPath: config.hermesPath,
    resolvedHermesPath: resolvedPath,
    hermesPathExists,
    hermesConfigDir: config.hermesConfigDir,
    resolvedHermesConfigDir: resolvedConfigDir,
    hermesConfigDirExists,
    maxConcurrentAgents: config.maxConcurrentAgents || 3
  });
});

// POST: Update paths & config
app.post('/api/config', (req, res) => {
  const { hermesPath, hermesConfigDir, maxConcurrentAgents } = req.body;
  const currentConfig = readConfig();
  const newConfig = {
    ...currentConfig,
    hermesPath: hermesPath || currentConfig.hermesPath,
    hermesConfigDir: hermesConfigDir || currentConfig.hermesConfigDir,
    maxConcurrentAgents: maxConcurrentAgents !== undefined ? parseInt(maxConcurrentAgents, 10) : (currentConfig.maxConcurrentAgents || 3)
  };
  saveConfig(newConfig);
  processAgentExecutionQueue();
  res.json({ success: true, config: newConfig });
});

// --- Chat Assistant APIs ---

// GET: Get history list
app.get('/api/history', (req, res) => {
  const { projectId } = req.query;
  const history = readHistory();
  if (projectId) {
    const filtered = history.filter(item => !item.projectId || item.projectId === projectId);
    return res.json(filtered);
  }
  res.json(history);
});

// GET: Run task as streaming output (SSE)
app.get('/api/run-stream', (req, res) => {
  const { prompt, sessionId, projectId } = req.query;
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const { project } = getProjectAndKanban(projectId);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  console.log(`Starting hermes chat. Prompt: "${prompt}", Session: "${sessionId || 'New'}"`);

  const config = readConfig();
  const hermesPath = resolveHome(config.hermesPath);
  const args = ['chat', '-q', prompt, '--yolo', '--accept-hooks'];
  
  if (sessionId && sessionId !== 'null' && sessionId !== 'undefined') {
    args.push('--resume', sessionId);
  }

  const child = spawn(hermesPath, args, {
    cwd: project.path,
    env: { ...process.env, PAGER: 'cat', PYTHONUNBUFFERED: '1' }
  });
  registerRunningProcess({ projectId: project.id, child });

  let stdoutBuffer = '';
  let stderrBuffer = '';
  let fullOutput = '';
  let fullError = '';
  let activeSessionId = sessionId || null;

  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    let lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop();
    
    for (let line of lines) {
      if (line.startsWith('↻ Resumed session')) continue;
      if (line.startsWith('session_id:')) {
        const id = line.split(':')[1].trim();
        activeSessionId = id;
        res.write(`data: ${JSON.stringify({ type: 'session_id', sessionId: id })}\n\n`);
        continue;
      }
      const content = line + '\n';
      fullOutput += content;
      res.write(`data: ${JSON.stringify({ type: 'stdout', chunk: content })}\n\n`);
    }
  });

  child.stderr.on('data', (chunk) => {
    stderrBuffer += chunk.toString();
    let lines = stderrBuffer.split('\n');
    stderrBuffer = lines.pop();
    
    for (let line of lines) {
      if (line.startsWith('↻ Resumed session')) continue;
      if (line.startsWith('session_id:')) {
        const id = line.split(':')[1].trim();
        activeSessionId = id;
        res.write(`data: ${JSON.stringify({ type: 'session_id', sessionId: id })}\n\n`);
        continue;
      }
      const content = line + '\n';
      fullError += content;
      res.write(`data: ${JSON.stringify({ type: 'stderr', chunk: content })}\n\n`);
    }
  });

  child.on('close', (code) => {
    if (stdoutBuffer) {
      if (!stdoutBuffer.startsWith('↻ Resumed session') && !stdoutBuffer.startsWith('session_id:')) {
        fullOutput += stdoutBuffer;
        res.write(`data: ${JSON.stringify({ type: 'stdout', chunk: stdoutBuffer })}\n\n`);
      } else if (stdoutBuffer.startsWith('session_id:')) {
        const id = stdoutBuffer.split(':')[1].trim();
        activeSessionId = id;
        res.write(`data: ${JSON.stringify({ type: 'session_id', sessionId: id })}\n\n`);
      }
    }

    if (stderrBuffer) {
      if (!stderrBuffer.startsWith('↻ Resumed session') && !stderrBuffer.startsWith('session_id:')) {
        fullError += stderrBuffer;
        res.write(`data: ${JSON.stringify({ type: 'stderr', chunk: stderrBuffer })}\n\n`);
      } else if (stderrBuffer.startsWith('session_id:')) {
        const id = stderrBuffer.split(':')[1].trim();
        activeSessionId = id;
        res.write(`data: ${JSON.stringify({ type: 'session_id', sessionId: id })}\n\n`);
      }
    }

    const { kanban: freshKanban, kanbanPath: freshKanbanPath } = getProjectAndKanban(project.id);
    const cleanedOutput = processAgentDirectives(freshKanban, null, fullOutput.trim());
    fs.writeFileSync(freshKanbanPath, JSON.stringify(freshKanban, null, 2), 'utf8');

    const history = readHistory();
    const historyItem = {
      id: Date.now().toString(),
      projectId: project.id,
      prompt,
      output: cleanedOutput,
      error: fullError.trim(),
      code,
      sessionId: activeSessionId,
      timestamp: new Date().toISOString()
    };
    history.unshift(historyItem);
    saveHistory(history.slice(0, 50));

    res.write(`data: ${JSON.stringify({ type: 'close', code, historyItem })}\n\n`);
    res.end();
  });

  child.on('error', (err) => {
    console.error('Failed to start hermes agent:', err);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.end();
  });
});

// POST: Run task (regular POST endpoint returning JSON)
app.post('/api/run', (req, res) => {
  const { prompt, sessionId, projectId } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const { project } = getProjectAndKanban(projectId);
  console.log(`Starting hermes chat via POST for project ${project.name}. Prompt: "${prompt}", Session: "${sessionId || 'New'}"`);

  const config = readConfig();
  const hermesPath = resolveHome(config.hermesPath);
  const args = ['chat', '-q', prompt, '--yolo', '--accept-hooks'];
  
  if (sessionId && sessionId !== 'null' && sessionId !== 'undefined') {
    args.push('--resume', sessionId);
  }

  const child = spawn(hermesPath, args, {
    cwd: project.path,
    env: { ...process.env, PAGER: 'cat', PYTHONUNBUFFERED: '1' }
  });
  registerRunningProcess({ projectId: project.id, child });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  child.on('close', (code) => {
    const cleaned = cleanOutputAndSession(stdout, stderr);
    const finalSessionId = cleaned.sessionId || sessionId;

    // Process directives (CREATE_AGENT, SET_VISION, etc.)
    const { kanban: freshKanban, kanbanPath: freshKanbanPath } = getProjectAndKanban(projectId);
    const cleanedOutput = processAgentDirectives(freshKanban, null, cleaned.output);
    fs.writeFileSync(freshKanbanPath, JSON.stringify(freshKanban, null, 2), 'utf8');

    const history = readHistory();
    const historyItem = {
      id: Date.now().toString(),
      projectId: project.id,
      prompt,
      output: cleanedOutput,
      error: cleaned.error,
      code,
      sessionId: finalSessionId,
      timestamp: new Date().toISOString()
    };
    history.unshift(historyItem);
    saveHistory(history.slice(0, 50));

    res.json({
      success: code === 0,
      code,
      output: cleanedOutput,
      error: cleaned.error,
      sessionId: finalSessionId,
      historyItem
    });
  });

  child.on('error', (err) => {
    res.status(500).json({
      success: false,
      error: err.message
    });
  });
});

// POST: Stop / Terminate running processes for a project
app.post('/api/stop', (req, res) => {
  const { projectId, cardId } = req.body;
  const targetProjId = projectId || 'proj-default';
  
  let stoppedCount = 0;
  for (let i = runningProcesses.length - 1; i >= 0; i--) {
    const item = runningProcesses[i];
    const matchesCard = cardId ? item.cardId === cardId : true;
    const matchesProj = item.projectId === targetProjId;
    if (matchesProj && matchesCard) {
      try {
        item.child.kill('SIGTERM');
        setTimeout(() => { try { item.child.kill('SIGKILL'); } catch (e) {} }, 500);
      } catch (err) {
        console.error(`Failed to kill process PID ${item.pid}:`, err);
      }
      runningProcesses.splice(i, 1);
      stoppedCount++;
    }
  }

  // Also clear queue items for stopped cards
  for (let i = agentExecutionQueue.length - 1; i >= 0; i--) {
    const item = agentExecutionQueue[i];
    const matchesCard = cardId ? item.cardId === cardId : true;
    const matchesProj = item.projectId === targetProjId;
    if (matchesProj && matchesCard) {
      agentExecutionQueue.splice(i, 1);
    }
  }

  // Clear isProcessing & isQueued flags on cards for this project
  const { kanban, kanbanPath } = getProjectAndKanban(targetProjId);
  let updated = false;
  kanban.cards.forEach(c => {
    if ((c.isProcessing || c.isQueued) && (!cardId || c.id === cardId)) {
      c.isProcessing = false;
      c.isQueued = false;
      c.agentSummary = 'Execution terminated by user.';
      updated = true;
    }
  });
  if (updated) {
    fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');
  }

  processAgentExecutionQueue();

  console.log(`[HermesCrew] Stopped ${stoppedCount} running processes for project ${targetProjId}`);
  res.json({ success: true, stoppedCount });
});

// GET: Stream card execution logs in real-time
app.get('/api/kanban/cards/:id/stream', (req, res) => {
  const { id } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const activeProc = runningProcesses.find(p => p.cardId === id);
  if (activeProc) {
    if (activeProc.logs) {
      res.write(`data: ${JSON.stringify({ chunk: activeProc.logs })}\n\n`);
    }
    activeProc.listeners.push(res);
    req.on('close', () => {
      const idx = activeProc.listeners.indexOf(res);
      if (idx !== -1) activeProc.listeners.splice(idx, 1);
    });
  } else {
    const inQueue = agentExecutionQueue.find(q => q.cardId === id);
    if (inQueue) {
      const queuePos = agentExecutionQueue.indexOf(inQueue) + 1;
      res.write(`data: ${JSON.stringify({ chunk: `⏳ Task is queued in execution pipeline (Position #${queuePos}). Waiting for available process slot...\n`, done: false })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ chunk: 'No active background process running for this card.\n[Tip: Click "Restart Task" or "Auto-Assign Roles" to launch execution stream]', done: true })}\n\n`);
      res.end();
    }
  }
});

// DELETE: Delete a specific session by ID
app.delete('/api/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required' });
  }

  console.log(`Deleting session: ${sessionId}`);
  const history = readHistory();
  const filtered = history.filter(item => {
    const sId = item.sessionId || `one-off-${item.id}`;
    return sId !== sessionId;
  });

  saveHistory(filtered);
  res.json({ success: true, message: `Session ${sessionId} deleted` });
});

// DELETE: Clear execution history
app.delete('/api/history', (req, res) => {
  saveHistory([]);
  res.json({ success: true, message: 'History cleared' });
});

// --- Projects API ---

// GET: List all projects
app.get('/api/projects', (req, res) => {
  const projects = readProjects();
  res.json(projects);
});

// POST: Create/Register new project
app.post('/api/projects', (req, res) => {
  const { name, path: projectPath } = req.body;
  if (!name || !projectPath) {
    return res.status(400).json({ error: 'Project name and path are required' });
  }

  const resolvedPath = path.resolve(projectPath);
  console.log(`Registering project "${name}" at folder: ${resolvedPath}`);

  // Ensure target folder exists
  if (!fs.existsSync(resolvedPath)) {
    try {
      fs.mkdirSync(resolvedPath, { recursive: true });
    } catch (err) {
      return res.status(500).json({ error: `Failed to create folder: ${err.message}` });
    }
  }

  const projects = readProjects();
  
  // Prevent duplicate paths
  const existing = projects.find(p => p.path === resolvedPath);
  if (existing) {
    return res.status(400).json({ error: `Project already registered at this path: ${existing.name}` });
  }

  const newProject = {
    id: 'proj-' + Date.now(),
    name: name.trim(),
    path: resolvedPath
  };

  projects.push(newProject);
  saveProjects(projects);

  // Trigger default board initialization
  getProjectAndKanban(newProject.id);

  res.json(newProject);
});

// DELETE: De-register a project (does not delete directory)
app.delete('/api/projects/:id', (req, res) => {
  const { id } = req.params;
  if (id === 'proj-default') {
    return res.status(400).json({ error: 'Cannot delete the default project workspace' });
  }

  let projects = readProjects();
  projects = projects.filter(p => p.id !== id);
  saveProjects(projects);
  res.json({ success: true, message: 'Project registry removed' });
});

// PUT: Edit project workspace path or name
app.put('/api/projects/:id', (req, res) => {
  const { id } = req.params;
  const { name, path: projectPath } = req.body;
  if (!name || !projectPath) {
    return res.status(400).json({ error: 'Project name and path are required' });
  }

  const resolvedPath = path.resolve(projectPath);
  let projects = readProjects();
  const project = projects.find(p => p.id === id);
  if (!project) {
    return res.status(404).json({ error: 'Project workspace not found' });
  }

  // If path changed, verify it doesn't conflict with another project
  if (resolvedPath !== project.path) {
    const conflict = projects.find(p => p.path === resolvedPath && p.id !== id);
    if (conflict) {
      return res.status(400).json({ error: `Another project is already registered at this path: ${conflict.name}` });
    }

    // Try to create the new folder if it doesn't exist
    if (!fs.existsSync(resolvedPath)) {
      try {
        fs.mkdirSync(resolvedPath, { recursive: true });
      } catch (err) {
        return res.status(500).json({ error: `Failed to create folder: ${err.message}` });
      }
    }
  }

  project.name = name.trim();
  project.path = resolvedPath;
  saveProjects(projects);

  // Initialize/validate kanban.json at the new path
  getProjectAndKanban(id);

  res.json(project);
});

// --- Kanban Board APIs ---

// GET: Full board data for a project
app.get('/api/kanban', (req, res) => {
  const { projectId } = req.query;
  processAgentExecutionQueue();
  const { kanban, kanbanPath } = getProjectAndKanban(projectId);

  let dirty = false;
  if (kanban.cards) {
    kanban.cards.forEach(card => {
      const isActuallyRunning = runningProcesses.some(p => p.cardId === card.id);
      const isQueued = agentExecutionQueue.some(q => q.cardId === card.id);

      if (card.isProcessing !== isActuallyRunning) {
        card.isProcessing = isActuallyRunning;
        dirty = true;
      }
      if (card.isQueued !== isQueued) {
        card.isQueued = isQueued;
        dirty = true;
      }
      if (!isActuallyRunning && !isQueued && card.agentSummary && card.agentSummary.includes('Queued')) {
        card.agentSummary = '';
        dirty = true;
      }
    });
  }
  if (dirty) {
    fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');
  }

  res.json(kanban);
});

// POST: Add new column/group
app.post('/api/kanban/columns', (req, res) => {
  const { projectId } = req.query;
  const { name, agentEnabled, agentPrompt, agentId } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Column name is required' });
  }

  const { kanban, kanbanPath } = getProjectAndKanban(projectId);
  const newColumn = {
    id: 'col-' + Date.now(),
    name,
    agentEnabled: agentEnabled || false,
    agentId: agentId || null,
    agentPrompt: agentPrompt || ''
  };
  kanban.columns.push(newColumn);
  fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');
  res.json(newColumn);
});

// POST: Reorder columns
app.post('/api/kanban/columns/reorder', (req, res) => {
  const { projectId } = req.query;
  const { columnIds } = req.body;
  if (!columnIds || !Array.isArray(columnIds)) {
    return res.status(400).json({ error: 'columnIds array is required' });
  }

  const { kanban, kanbanPath } = getProjectAndKanban(projectId);
  
  // Sort columns array based on the ordered columnIds
  const reorderedColumns = [];
  columnIds.forEach(colId => {
    const col = kanban.columns.find(c => c.id === colId);
    if (col) {
      reorderedColumns.push(col);
    }
  });

  // Append any columns that weren't included in the columnIds list (safety check)
  kanban.columns.forEach(col => {
    if (!reorderedColumns.some(c => c.id === col.id)) {
      reorderedColumns.push(col);
    }
  });

  kanban.columns = reorderedColumns;
  fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');
  res.json({ success: true, columns: kanban.columns });
});

// PUT: Edit column configuration
app.put('/api/kanban/columns/:id', (req, res) => {
  const { id } = req.params;
  const { projectId } = req.query;
  const { name, agentEnabled, agentPrompt, agentId } = req.body;

  const { kanban, kanbanPath } = getProjectAndKanban(projectId);
  const column = kanban.columns.find(c => c.id === id);
  if (!column) {
    return res.status(404).json({ error: 'Column not found' });
  }

  if (name !== undefined) column.name = name;
  if (agentEnabled !== undefined) column.agentEnabled = agentEnabled;
  if (agentPrompt !== undefined) column.agentPrompt = agentPrompt;
  if (agentId !== undefined) column.agentId = agentId;

  fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');
  res.json(column);
});

// DELETE: Delete column
app.delete('/api/kanban/columns/:id', (req, res) => {
  const { id } = req.params;
  const { projectId } = req.query;
  const { kanban, kanbanPath } = getProjectAndKanban(projectId);
  
  // Remove column
  kanban.columns = kanban.columns.filter(c => c.id !== id);
  
  // Re-route any cards in that column to the first column
  const fallbackCol = kanban.columns[0];
  if (fallbackCol) {
    kanban.cards.forEach(card => {
      if (card.columnId === id) {
        card.columnId = fallbackCol.id;
      }
    });
  } else {
    kanban.cards = kanban.cards.filter(card => card.columnId !== id);
  }

  fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');
  res.json({ success: true, message: 'Column deleted' });
});

// POST: Create card
app.post('/api/kanban/cards', (req, res) => {
  const { projectId } = req.query;
  const { columnId, title, description, owner, watchers } = req.body;
  if (!columnId || !title) {
    return res.status(400).json({ error: 'Column ID and title are required' });
  }

  const { kanban, kanbanPath } = getProjectAndKanban(projectId);
  const newCard = {
    id: 'card-' + Date.now(),
    columnId,
    title,
    description: description || '',
    owner: owner || 'unassigned',
    watchers: watchers || [],
    isProcessing: false,
    agentSummary: "",
    comments: [],
    sessionId: null
  };

  kanban.cards.push(newCard);
  fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');

  // Check for @ mentions on card creation (title or description)
  let checkMentionTriggered = false;
  const searchText = `${title} ${description || ''}`;
  if (kanban.agents && kanban.agents.length > 0) {
    const mentionedAgent = kanban.agents.find(agent => {
      const mentionPattern = new RegExp(`@${escapeRegExp(agent.name)}`, 'i');
      return mentionPattern.test(searchText);
    });
    if (mentionedAgent) {
      checkMentionTriggered = true;
      console.log(`[HermesCrew - creation mention] Mentioned Agent: "${mentionedAgent.name}" on Card: "${title}"`);
      setTimeout(() => {
        triggerAgentForCardDirect(newCard.id, mentionedAgent.id, projectId, `[Task Created with @ Mention]`);
      }, 500);
    }
  }

  // If created directly in an active agent column and no manual @ trigger occurred, trigger the normal auto agent workflow!
  if (!checkMentionTriggered) {
    const targetCol = kanban.columns.find(c => c.id === columnId);
    if (targetCol && targetCol.agentEnabled) {
      triggerAgentForCard(newCard.id, columnId, projectId);
    }
  }

  res.json(newCard);
});

// PUT: Update card (title, description, owner, watchers, maxBudget, meetingRounds)
app.put('/api/kanban/cards/:id', (req, res) => {
  const { id } = req.params;
  const { projectId } = req.query;
  const { title, description, owner, watchers, maxBudget, meetingRounds } = req.body;

  const { kanban, kanbanPath } = getProjectAndKanban(projectId);
  const card = kanban.cards.find(c => c.id === id);
  if (!card) {
    return res.status(404).json({ error: 'Card not found' });
  }

  if (title !== undefined) card.title = title;
  if (description !== undefined) card.description = description;
  if (owner !== undefined) card.owner = owner;
  if (watchers !== undefined) card.watchers = watchers;
  if (maxBudget !== undefined) card.maxBudget = parseInt(maxBudget, 10) || 10;
  if (meetingRounds !== undefined) card.meetingRounds = parseInt(meetingRounds, 10) || 0;

  fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');
  res.json(card);
});

// POST: Create subcard under parent card
app.post('/api/kanban/cards/:id/subcards', (req, res) => {
  const { id } = req.params;
  const { projectId } = req.query;
  const { title, description } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Subcard title is required' });
  }

  const { kanban, kanbanPath } = getProjectAndKanban(projectId);
  const parentCard = kanban.cards.find(c => c.id === id);
  if (!parentCard) {
    return res.status(404).json({ error: 'Parent card not found' });
  }

  const subCardId = 'card-' + Date.now();
  const subCard = {
    id: subCardId,
    columnId: parentCard.columnId,
    title,
    description: description || '',
    owner: 'unassigned',
    watchers: [],
    isProcessing: false,
    agentSummary: "",
    comments: [
      {
        id: 'comment-' + Date.now(),
        author: 'System (Link)',
        text: `📌 Created as sub-task of parent card: "${parentCard.title}" (${parentCard.id})`,
        timestamp: new Date().toISOString()
      }
    ],
    sessionId: null,
    subCardIds: [],
    parentCardId: parentCard.id,
    meetingRounds: 0,
    maxBudget: 10
  };

  if (!parentCard.subCardIds) parentCard.subCardIds = [];
  parentCard.subCardIds.push(subCardId);
  if (!parentCard.comments) parentCard.comments = [];
  parentCard.comments.push({
    id: 'comment-' + Date.now() + '-link',
    author: 'System (Link)',
    text: `📌 Task split into sub-task: "${subCard.title}" (${subCard.id})`,
    timestamp: new Date().toISOString()
  });

  kanban.cards.push(subCard);
  fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');
  res.json({ parentCard, subCard });
});

// DELETE: Delete card
app.delete('/api/kanban/cards/:id', (req, res) => {
  const { id } = req.params;
  const { projectId } = req.query;
  const { kanban, kanbanPath } = getProjectAndKanban(projectId);
  
  kanban.cards = kanban.cards.filter(c => c.id !== id);
  fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');
  res.json({ success: true, message: 'Card deleted' });
});

// POST: Move card between columns
app.post('/api/kanban/cards/:id/move', (req, res) => {
  const { id } = req.params;
  const { projectId } = req.query;
  const { columnId } = req.body;

  const { kanban, kanbanPath } = getProjectAndKanban(projectId);
  const card = kanban.cards.find(c => c.id === id);
  if (!card) {
    return res.status(404).json({ error: 'Card not found' });
  }

  const oldColumnId = card.columnId;
  card.columnId = columnId;

  const targetCol = kanban.columns.find(col => col.id === columnId);

  // If dragged into Meeting Room column, reset meeting rounds budget!
  if (targetCol && (targetCol.isMeetingRoom || targetCol.name === 'Meeting Room' || targetCol.name.toLowerCase().includes('meeting'))) {
    card.meetingRounds = 0;
  }

  fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');

  // If target column has agent enabled and column actually changed, trigger
  if (oldColumnId !== columnId) {
    if (targetCol && targetCol.agentEnabled) {
      triggerAgentForCard(id, columnId, projectId);
    }
  }

  res.json({ success: true, card });
});

// --- Project Scope Endpoints ---

// GET: Get project scope
app.get('/api/kanban/scope', (req, res) => {
  const { projectId } = req.query;
  const { kanban } = getProjectAndKanban(projectId);
  res.json(kanban.scope || {});
});

// PUT: Update project scope
app.put('/api/kanban/scope', (req, res) => {
  const { projectId } = req.query;
  const { vision, mission, need, want, targetScope } = req.body;
  const { kanban, kanbanPath } = getProjectAndKanban(projectId);

  kanban.scope = {
    vision: vision !== undefined ? vision : (kanban.scope ? kanban.scope.vision : ""),
    mission: mission !== undefined ? mission : (kanban.scope ? kanban.scope.mission : ""),
    need: need !== undefined ? need : (kanban.scope ? kanban.scope.need : ""),
    want: want !== undefined ? want : (kanban.scope ? kanban.scope.want : ""),
    targetScope: targetScope !== undefined ? targetScope : (kanban.scope ? kanban.scope.targetScope : ""),
    lastUpdated: new Date().toISOString()
  };

  fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');
  res.json(kanban.scope);
});

// POST: Auto-update project scope with AI analysis
app.post('/api/kanban/scope/auto-update', (req, res) => {
  const { projectId } = req.query;
  const { project, kanban, kanbanPath } = getProjectAndKanban(projectId);

  const cardsSummary = kanban.cards.map(c => `- [${c.title}]: ${c.description} (Status: ${c.columnId})`).join('\n');
  const prompt = `
You are a Senior Project Management AI Consultant. Analyze the following project cards and details, and synthesize/update the project's key PM terms.
Project Name: ${project.name}

Current Cards in Board:
${cardsSummary}

Please respond strictly in valid JSON format with the following keys (do not wrap in markdown codeblocks if possible, or provide raw JSON):
{
  "vision": "A clear, inspiring long-term vision statement",
  "mission": "Core mission statement detailing how to achieve the vision",
  "need": "Key problem statement / essential needs addressed",
  "want": "Desired feature capabilities / customer wants",
  "targetScope": "Summary of active milestone scope and goals"
}
`;

  const config = readConfig();
  const hermesPath = resolveHome(config.hermesPath);
  const args = ['chat', '-q', prompt, '--yolo', '--accept-hooks', '-Q'];

  const child = spawn(hermesPath, args, {
    cwd: project.path,
    env: { ...process.env, PAGER: 'cat' }
  });

  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });

  child.on('close', (code) => {
    try {
      const jsonMatch = stdout.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const { kanban: freshKanban, kanbanPath: freshKanbanPath } = getProjectAndKanban(projectId);
        freshKanban.scope = {
          vision: parsed.vision || freshKanban.scope.vision,
          mission: parsed.mission || freshKanban.scope.mission,
          need: parsed.need || freshKanban.scope.need,
          want: parsed.want || freshKanban.scope.want,
          targetScope: parsed.targetScope || freshKanban.scope.targetScope,
          lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(freshKanbanPath, JSON.stringify(freshKanban, null, 2), 'utf8');
        return res.json({ success: true, scope: freshKanban.scope });
      }
    } catch (err) {
      console.error("Failed to parse AI scope output:", err);
    }
    res.status(500).json({ error: "Failed to parse AI output for scope synthesis" });
  });

  child.on('error', (err) => {
    res.status(500).json({ error: err.message });
  });
});

// POST: Add comment manually
app.post('/api/kanban/cards/:id/comments', (req, res) => {
  const { id } = req.params;
  const { projectId } = req.query;
  const { author, text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Comment text is required' });
  }

  const { kanban, kanbanPath } = getProjectAndKanban(projectId);
  const card = kanban.cards.find(c => c.id === id);
  if (!card) {
    return res.status(404).json({ error: 'Card not found' });
  }

  const newComment = {
    id: 'comment-' + Date.now(),
    author: author || 'User',
    text,
    timestamp: new Date().toISOString()
  };

  if (!card.comments) card.comments = [];
  card.comments.push(newComment);
  fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');

  // Check for @ mentions or trigger card owner continuation
  const column = kanban.columns.find(col => col.id === card.columnId);
  let handledMention = false;

  if (kanban.agents && kanban.agents.length > 0) {
    const mentionedAgent = kanban.agents.find(agent => {
      const mentionPattern = new RegExp(`@${escapeRegExp(agent.name)}`, 'i');
      return mentionPattern.test(text);
    });
    if (mentionedAgent) {
      handledMention = true;
      console.log(`[HermesCrew - comment mention] Mentioned Agent: "${mentionedAgent.name}" on Card: "${card.title}"`);
      setTimeout(() => {
        triggerAgentForCardDirect(id, mentionedAgent.id, projectId, `[User @ Mentioned Command]:\n${text}`);
      }, 500);
    }
  }

  if (!handledMention && column && column.agentEnabled && card.owner !== 'user') {
    console.log(`[HermesCrew - comment trigger] Continuing execution for Card: "${card.title}" after user comment.`);
    setTimeout(() => {
      triggerAgentForCard(id, card.columnId, projectId);
    }, 500);
  }

  res.json(newComment);
});

// POST: Re-evaluate card owner and stakeholders/watchers
app.post('/api/kanban/cards/:id/reevaluate', (req, res) => {
  const { id } = req.params;
  const { projectId } = req.query;

  const { project, kanban, kanbanPath } = getProjectAndKanban(projectId);
  const card = kanban.cards.find(c => c.id === id);
  if (!card) {
    return res.status(404).json({ error: 'Card not found' });
  }

  card.isProcessing = true;
  fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');

  const teamAgents = kanban.agents || [];
  const teamDetails = teamAgents.map(a => `- **${a.name}**: ${a.prompt}`).join('\n');
  const commentsHistory = card.comments && card.comments.length > 0
    ? card.comments.map(c => `- ${c.author}: ${c.text}`).join('\n')
    : '(No comments yet)';

  const prompt = `
[SYSTEM INSTRUCTION: AUTONOMOUS ROLE ASSIGNMENT & STAKEHOLDER RE-EVALUATION]
You are Senior Hermes Coordinator. Evaluate the card below against all available workspace team role agents to determine optimal ownership and stakeholders.

AVAILABLE TEAM ROLE AGENTS IN WORKSPACE:
${teamDetails}

[CARD DETAILS]
Title: ${card.title}
Description: ${card.description}

[CARD COMMENTS & DISCUSSION HISTORY]
${commentsHistory}

[YOUR TASK STEPS]
1. Analyze the technical and domain requirements of this card against the team role agents listed above.
2. Select the single best qualified agent to be the primary Owner. Output [ASSIGN_TO: Agent Name].
3. Select all relevant team role agents that should watch / be involved in this card as Stakeholders. Output [SET_WATCHERS: Agent Name 1, Agent Name 2].
4. Provide a brief breakdown explaining why these roles were assigned.
`;

  const config = readConfig();
  const hermesPath = resolveHome(config.hermesPath);
  const args = ['chat', '-q', prompt, '--yolo', '--accept-hooks'];

  if (card.sessionId) {
    args.push('--resume', card.sessionId);
  }

  const child = spawn(hermesPath, args, {
    cwd: project.path,
    env: { ...process.env, PAGER: 'cat', PYTHONUNBUFFERED: '1' }
  });
  registerRunningProcess({ projectId: project.id, cardId: card.id, child });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  child.on('close', (code, signal) => {
    if (signal) {
      console.log(`[HermesCrew] Reevaluate process for card ${id} was terminated by signal ${signal}. Skipping completion logic.`);
      return;
    }
    const { kanban: freshKanban, kanbanPath: freshKanbanPath } = getProjectAndKanban(projectId);
    const freshCard = freshKanban.cards.find(c => c.id === id);
    if (!freshCard) return;

    let cleaned = stdout.replace(/session_id:\s*[^\s\n]+/gi, '').replace(/^↻ Resumed session.*?\n/im, '').trim();

    let targetAssignment = null;
    const assignMatch = cleaned.match(/\[ASSIGN_TO:\s*([^\]]+)\]/i);
    if (assignMatch) {
      targetAssignment = assignMatch[1].replace(/\s+/g, ' ').trim();
      cleaned = cleaned.replace(/\[ASSIGN_TO:\s*[^\]]+\]/gi, '').trim();
    }

    let targetWatchersStr = null;
    const watchersMatch = cleaned.match(/\[SET_WATCHERS:\s*([^\]]+)\]/i);
    if (watchersMatch) {
      targetWatchersStr = watchersMatch[1].replace(/\s+/g, ' ').trim();
      cleaned = cleaned.replace(/\[SET_WATCHERS:\s*[^\]]+\]/gi, '').trim();
    }

    cleaned = processAgentDirectives(freshKanban, freshCard, cleaned);

    if (!freshCard.comments) freshCard.comments = [];
    freshCard.comments.push({
      id: 'comment-' + Date.now(),
      author: 'Hermes Coordinator',
      text: cleaned || 'Re-evaluated team roles and stakeholders for this card.',
      timestamp: new Date().toISOString()
    });

    if (targetAssignment) {
      const targetAgent = freshKanban.agents ? freshKanban.agents.find(a => a.name.toLowerCase() === targetAssignment.toLowerCase()) : null;
      if (targetAgent) freshCard.owner = targetAgent.id;
    }

    if (targetWatchersStr) {
      const names = targetWatchersStr.split(/[,|]/).map(n => n.replace(/\s+/g, ' ').trim().toLowerCase());
      const matchedIds = [];
      if (freshKanban.agents) {
        freshKanban.agents.forEach(a => {
          if (names.some(n => n === a.name.toLowerCase() || a.name.toLowerCase().includes(n))) {
            matchedIds.push(a.id);
          }
        });
      }
      freshCard.watchers = matchedIds;
    }

    freshCard.isProcessing = false;
    fs.writeFileSync(freshKanbanPath, JSON.stringify(freshKanban, null, 2), 'utf8');

    // Trigger immediate execution by assigned owner/column agent
    const currentCol = freshKanban.columns.find(c => c.id === freshCard.columnId);
    if (currentCol && currentCol.agentEnabled && freshCard.owner !== 'user') {
      console.log(`[HermesCrew] Role re-evaluation complete. Triggering immediate execution for Card "${freshCard.title}"...`);
      setTimeout(() => {
        triggerAgentForCard(id, freshCard.columnId, projectId);
      }, 500);
    }
  });

  res.json({ success: true, message: 'Role re-evaluation started.' });
});

// POST: Restart / Re-run card execution
app.post('/api/kanban/cards/:id/restart', (req, res) => {
  const { id } = req.params;
  const { projectId } = req.query;
  const targetProjId = projectId || 'proj-default';

  // Kill existing running process for this card if active
  for (let i = runningProcesses.length - 1; i >= 0; i--) {
    const item = runningProcesses[i];
    if (item.cardId === id) {
      try {
        item.child.kill('SIGTERM');
        setTimeout(() => { try { item.child.kill('SIGKILL'); } catch (e) {} }, 500);
      } catch (err) {}
      runningProcesses.splice(i, 1);
    }
  }

  // Clear from queue if already queued
  for (let i = agentExecutionQueue.length - 1; i >= 0; i--) {
    if (agentExecutionQueue[i].cardId === id) {
      agentExecutionQueue.splice(i, 1);
    }
  }

  const { kanban, kanbanPath } = getProjectAndKanban(targetProjId);
  const card = kanban.cards.find(c => c.id === id);
  if (!card) {
    return res.status(404).json({ error: 'Card not found' });
  }

  card.isProcessing = true;
  fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');

  console.log(`[HermesCrew] Restarting execution for Card "${card.title}" (${card.id})...`);
  setTimeout(() => {
    triggerAgentForCard(id, card.columnId, targetProjId);
  }, 300);

  res.json({ success: true, message: 'Card task execution restarted.' });
});

// --- Agent CRUD Routes ---

// GET: Get defined agents
app.get('/api/kanban/agents', (req, res) => {
  const { projectId } = req.query;
  const { kanban } = getProjectAndKanban(projectId);
  res.json(kanban.agents || []);
});

// POST: Add new agent role
app.post('/api/kanban/agents', (req, res) => {
  const { projectId } = req.query;
  const { name, prompt } = req.body;
  if (!name || !prompt) {
    return res.status(400).json({ error: 'Agent name and prompt are required' });
  }

  const { kanban, kanbanPath } = getProjectAndKanban(projectId);
  if (!kanban.agents) kanban.agents = [];

  const newAgent = {
    id: 'agent-' + Date.now(),
    name: name.trim(),
    prompt: prompt.trim()
  };
  
  kanban.agents.push(newAgent);
  fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');
  res.json(newAgent);
});

// PUT: Update agent role
app.put('/api/kanban/agents/:id', (req, res) => {
  const { id } = req.params;
  const { projectId } = req.query;
  const { name, prompt } = req.body;

  const { kanban, kanbanPath } = getProjectAndKanban(projectId);
  if (!kanban.agents) kanban.agents = [];

  const agent = kanban.agents.find(a => a.id === id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent role not found' });
  }

  if (name !== undefined) agent.name = name.trim();
  if (prompt !== undefined) agent.prompt = prompt.trim();

  fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');
  res.json(agent);
});

// DELETE: Delete agent role
app.delete('/api/kanban/agents/:id', (req, res) => {
  const { id } = req.params;
  const { projectId } = req.query;

  const { kanban, kanbanPath } = getProjectAndKanban(projectId);
  if (!kanban.agents) kanban.agents = [];

  kanban.agents = kanban.agents.filter(a => a.id !== id);

  // Clean up columns bound to this agent
  kanban.columns.forEach(col => {
    if (col.agentId === id) {
      col.agentId = null;
      col.agentEnabled = false;
    }
  });

  fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');
  res.json({ success: true });
});

// POST: Trigger manual execution of a specific agent on a card
app.post('/api/kanban/cards/:id/trigger', (req, res) => {
  const { id } = req.params;
  const { projectId } = req.query;
  const { agentId, instructions } = req.body;

  if (!agentId) {
    return res.status(400).json({ error: 'agentId is required' });
  }

  const { kanban } = getProjectAndKanban(projectId);
  const card = kanban.cards.find(c => c.id === id);
  if (!card) {
    return res.status(404).json({ error: 'Card not found' });
  }

  const agent = kanban.agents.find(a => a.id === agentId);
  if (!agent) {
    return res.status(404).json({ error: 'Agent role not found in this workspace' });
  }

  if (card.isProcessing) {
    return res.status(400).json({ error: 'Card is already being processed by another Agent' });
  }

  // Trigger asynchronously in the background
  triggerAgentForCardDirect(id, agentId, projectId, instructions);

  res.json({ success: true, message: `Manual trigger started for agent: ${agent.name}` });
});

// Helper: Process directives in agent output (subcards, recruiting agents)
function processAgentDirectives(freshKanban, freshCard, text) {
  let cleaned = text;

  // 1. Process CREATE_SUBCARD directives (only applicable if attached to a card)
  const subcardRegex = /\[CREATE_SUBCARD:\s*([^\]]+)\]/gi;
  if (freshCard) {
    if (!freshCard._createdSubcards) freshCard._createdSubcards = [];
    let subMatch;
    while ((subMatch = subcardRegex.exec(text)) !== null) {
      const content = subMatch[1];
      const parts = content.split(/[|｜]/);
      const subTitle = parts[0].trim();
      const subDesc = parts[1] ? parts[1].trim() : '';
      if (subTitle) {
        const subCardId = 'card-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        const subCard = {
          id: subCardId,
          columnId: freshCard.columnId,
          title: subTitle,
          description: subDesc,
          isProcessing: false,
          agentSummary: '',
          comments: [
            {
              id: 'comment-' + Date.now(),
              author: 'System (Link)',
              text: `📌 Created as sub-task of parent card: "${freshCard.title}" (${freshCard.id})`,
              timestamp: new Date().toISOString()
            }
          ],
          sessionId: null,
          owner: freshCard.owner ? freshCard.owner : 'unassigned',
          watchers: freshCard.watchers ? [...freshCard.watchers] : [],
          subCardIds: [],
          parentCardId: freshCard.id,
          meetingRounds: 0,
          maxBudget: 10
        };
        if (!freshCard.subCardIds) freshCard.subCardIds = [];
        freshCard.subCardIds.push(subCardId);
        freshKanban.cards.push(subCard);
        freshCard._createdSubcards.push({ id: subCardId, columnId: subCard.columnId, title: subTitle });
        
        if (!freshCard.comments) freshCard.comments = [];
        freshCard.comments.push({
          id: 'comment-' + Date.now() + '-link',
          author: 'System (Link)',
          text: `📌 Task split into sub-task: "${subCard.title}" (${subCard.id})`,
          timestamp: new Date().toISOString()
        });
        console.log(`[HermesCrew Directives] Created subcard "${subTitle}" for parent "${freshCard.title}"`);
      }
    }
    cleaned = cleaned.replace(subcardRegex, '').trim();
  } else {
    cleaned = cleaned.replace(subcardRegex, '').trim();
  }

  // 2. Process CREATE_AGENT directives
  const agentRegex = /\[CREATE_AGENT:\s*([^\]]+)\]/gi;
  let agMatch;
  while ((agMatch = agentRegex.exec(text)) !== null) {
    const content = agMatch[1];
    const parts = content.split(/[|｜]/);
    const agName = parts[0].trim();
    const agPrompt = parts[1] ? parts[1].trim() : `You are ${agName}.`;
    if (agName) {
      const existing = freshKanban.agents ? freshKanban.agents.find(a => a.name.toLowerCase() === agName.toLowerCase()) : null;
      if (!existing) {
        const newAgId = 'agent-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        if (!freshKanban.agents) freshKanban.agents = [];
        freshKanban.agents.push({
          id: newAgId,
          name: agName,
          prompt: agPrompt
        });
        if (freshCard) {
          if (!freshCard.comments) freshCard.comments = [];
          freshCard.comments.push({
            id: 'comment-' + Date.now() + '-ag',
            author: 'System (Recruiting)',
            text: `🤖 Recruited new team agent role: **${agName}**`,
            timestamp: new Date().toISOString()
          });
        }
        console.log(`[HermesCrew Directives] Recruited new agent "${agName}"`);
      }
    }
  }
  cleaned = cleaned.replace(agentRegex, '').trim();


  // 3. Process Scope update directives
  const scopeTypes = [
    { tag: 'SET_VISION', key: 'vision', label: 'Vision' },
    { tag: 'SET_MISSION', key: 'mission', label: 'Mission' },
    { tag: 'SET_NEED', key: 'need', label: 'Need' },
    { tag: 'SET_WANT', key: 'want', label: 'Want' },
    { tag: 'SET_TARGET_SCOPE', key: 'targetScope', label: 'Target Scope' }
  ];
  if (!freshKanban.scope) freshKanban.scope = {};
  let scopeUpdated = false;

  scopeTypes.forEach(st => {
    const reg = new RegExp(`\\[${st.tag}:\\s*([^\\]]+)\\]`, 'gi');
    let m;
    while ((m = reg.exec(text)) !== null) {
      const val = m[1].trim();
      if (val) {
        freshKanban.scope[st.key] = val;
        scopeUpdated = true;
        if (freshCard && freshCard.comments) {
          freshCard.comments.push({
            id: 'comment-' + Date.now() + '-sc',
            author: 'System (Scope)',
            text: `🎯 Updated project **${st.label}**: "${val}"`,
            timestamp: new Date().toISOString()
          });
        }
      }
    }
    cleaned = cleaned.replace(reg, '').trim();
  });
  if (scopeUpdated) {
    freshKanban.scope.lastUpdated = new Date().toISOString();
  }

  return cleaned;
}

// --- Autonomous Agent Pipeline Executor ---

// Direct execution function for manual card runs
function triggerAgentForCardDirect(cardId, agentId, projectId, instructions = '') {
  const { project, kanban, kanbanPath } = getProjectAndKanban(projectId);
  const card = kanban.cards.find(c => c.id === cardId);
  const agent = kanban.agents.find(a => a.id === agentId);

  if (!card || !agent) {
    return;
  }

  console.log(`[HermesCrew - ${project.name}] Direct execution for Card: "${card.title}" using Agent: "${agent.name}"`);

  // Set card processing status
  card.isProcessing = true;
  fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');

  // Compile prompt context
  const columnsList = kanban.columns.map(c => `"${c.name}"`).join(', ');
  
  const commentsHistory = card.comments && card.comments.length > 0
    ? card.comments.map(c => `- ${c.author} (${new Date(c.timestamp).toLocaleString()}): ${c.text}`).join('\n')
    : '(No prior conversation comments on this card)';

  const prompt = `
[AGENT ROLE SYSTEM INSTRUCTION: ${agent.name}]
${agent.prompt}

${instructions ? `[USER DIRECT COMMAND FOR THIS RUN]\n${instructions}\n` : ''}

[CARD DETAILS]
Title: ${card.title}
Description: ${card.description}

[CARD COMMENTS & DISCUSSION HISTORY]
${commentsHistory}

[TRANSITION DIRECTIVES]
You are processing this Kanban card as an autonomous agent. 
If you decide that the task is complete, requires next-level execution, or needs to route to a different column, you must output the following tag at the very end of your response:
[MOVE_TO: Column Name]

The available columns you can move this card to are: ${columnsList}
Please match the spelling exactly.
`;

  const config = readConfig();
  const hermesPath = resolveHome(config.hermesPath);
  const args = ['chat', '-q', prompt, '--yolo', '--accept-hooks'];
  
  if (card.sessionId) {
    args.push('--resume', card.sessionId);
  }

  const child = spawn(hermesPath, args, {
    cwd: project.path,
    env: { ...process.env, PAGER: 'cat' }
  });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  child.on('close', (code, signal) => {
    if (signal) {
      console.log(`[HermesCrew - ${project.name}] Direct Agent process for card ${cardId} was terminated by signal ${signal}. Skipping completion logic.`);
      return;
    }
    console.log(`[HermesCrew - ${project.name}] Direct Agent finished for card ${cardId}. Exit Code: ${code}`);

    const { kanban: freshKanban, kanbanPath: freshKanbanPath } = getProjectAndKanban(projectId);
    const freshCard = freshKanban.cards.find(c => c.id === cardId);
    if (!freshCard) return;

    let cleanedOutput = stdout;
    let cleanStderr = stderr;
    let newSessionId = freshCard.sessionId;

    const matchStdout = stdout.match(/session_id:\s*([^\s\n]+)/i);
    const matchStderr = stderr.match(/session_id:\s*([^\s\n]+)/i);
    if (matchStdout) {
      newSessionId = matchStdout[1];
      cleanedOutput = cleanedOutput.replace(/session_id:\s*[^\s\n]+/gi, '');
    }
    if (matchStderr) {
      newSessionId = matchStderr[1];
      cleanStderr = cleanStderr.replace(/session_id:\s*[^\s\n]+/gi, '');
    }

    cleanedOutput = cleanedOutput.replace(/^↻ Resumed session.*?\n/im, '').trim();
    cleanStderr = cleanStderr.replace(/^↻ Resumed session.*?\n/im, '').trim();

    let targetColName = null;
    const moveMatch = cleanedOutput.match(/\[MOVE_TO:\s*([^\]]+)\]/i);
    if (moveMatch) {
      targetColName = moveMatch[1].replace(/\s+/g, ' ').trim();
      cleanedOutput = cleanedOutput.replace(/\[MOVE_TO:\s*[^\]]+\]/gi, '').trim();
    }

    cleanedOutput = processAgentDirectives(freshKanban, freshCard, cleanedOutput);

    if (!freshCard.comments) freshCard.comments = [];
    
    if (!cleanedOutput && code !== 0) {
      cleanedOutput = `Hermes Agent execution failed with exit code ${code}.\nError details:\n${cleanStderr}`;
    }

    freshCard.comments.push({
      id: 'comment-' + Date.now(),
      author: `Hermes Agent (${agent.name})`,
      text: cleanedOutput || 'Agent completed task processing with no return message.',
      timestamp: new Date().toISOString()
    });

    if (cleanedOutput) {
      let summaryText = cleanedOutput
        .replace(/[#*`>_\-\[\]]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (summaryText.length > 120) {
        summaryText = summaryText.substring(0, 120) + '...';
      }
      freshCard.agentSummary = summaryText;
    } else {
      freshCard.agentSummary = code !== 0 ? 'Execution failed.' : 'No output returned.';
    }

    freshCard.isProcessing = false;
    freshCard.sessionId = newSessionId;

    let triggeredNextColumnId = null;
    if (targetColName) {
      const matchCol = freshKanban.columns.find(c => c.name.toLowerCase() === targetColName.toLowerCase());
      if (matchCol) {
        console.log(`[HermesCrew - ${project.name}] Transitioning Card "${freshCard.title}" to "${matchCol.name}"`);
        freshCard.columnId = matchCol.id;
        triggeredNextColumnId = matchCol.id;
      }
    }

    fs.writeFileSync(freshKanbanPath, JSON.stringify(freshKanban, null, 2), 'utf8');

    // Chain execution if column has agent enabled and changed
    if (triggeredNextColumnId) {
      const targetCol = freshKanban.columns.find(c => c.id === triggeredNextColumnId);
      if (targetCol && targetCol.agentEnabled) {
        setTimeout(() => {
          triggerAgentForCard(cardId, triggeredNextColumnId, projectId, 1);
        }, 1000);
      }
    }
  });

  child.on('error', (err) => {
    console.error(`[HermesCrew - ${project.name}] Spawn error for direct agent card ${cardId}:`, err);
    const { kanban: freshKanban, kanbanPath: freshKanbanPath } = getProjectAndKanban(projectId);
    const freshCard = freshKanban.cards.find(c => c.id === cardId);
    if (freshCard) {
      freshCard.isProcessing = false;
      freshCard.agentSummary = `Error: ${err.message}`;
      if (!freshCard.comments) freshCard.comments = [];
      freshCard.comments.push({
        id: 'comment-' + Date.now(),
        author: 'System (Error)',
        text: `Failed to trigger direct agent process: ${err.message}`,
        timestamp: new Date().toISOString()
      });
      fs.writeFileSync(freshKanbanPath, JSON.stringify(freshKanban, null, 2), 'utf8');
    }
  });
}

// --- Agent Concurrency Queue Manager ---
const agentExecutionQueue = [];

function triggerAgentForCard(cardId, columnId, projectId, transitionChainCount = 0) {
  const targetProjId = projectId || 'proj-default';
  const { kanban, kanbanPath } = getProjectAndKanban(targetProjId);
  const card = kanban.cards.find(c => c.id === cardId);
  const column = kanban.columns.find(col => col.id === columnId);

  if (!card || !column || !column.agentEnabled || card.owner === 'user') {
    return;
  }

  const isRunning = runningProcesses.some(p => p.cardId === cardId);
  const existsInQueue = agentExecutionQueue.some(item => item.cardId === cardId);

  if (isRunning) {
    console.log(`[Queue Manager] Card ${cardId} is already executing. Skipping duplicate request.`);
    return;
  }

  if (!existsInQueue) {
    card.isProcessing = false;
    card.isQueued = true;
    card.agentSummary = '⏳ Queued for execution...';
    fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');

    agentExecutionQueue.push({ cardId, columnId, projectId: targetProjId, transitionChainCount });
    console.log(`[Queue Manager] Queued Card "${card.title}" (${cardId}). Current Queue Length: ${agentExecutionQueue.length}`);
  }

  processAgentExecutionQueue();
}

function processAgentExecutionQueue() {
  const config = readConfig();
  const maxConcurrent = config.maxConcurrentAgents || 3;

  // Clean up any queue items that might be deleted/invalid
  while (agentExecutionQueue.length > 0) {
    const activeCardProcessesCount = runningProcesses.filter(p => p.cardId).length;
    if (activeCardProcessesCount >= maxConcurrent) {
      break;
    }
    const nextTask = agentExecutionQueue.shift();
    console.log(`[Queue Dispatcher] Dequeuing and executing Card ${nextTask.cardId}...`);
    runAgentForCardNow(nextTask.cardId, nextTask.columnId, nextTask.projectId, nextTask.transitionChainCount);
  }
}

function runAgentForCardNow(cardId, columnId, projectId, transitionChainCount = 0) {
  // Prevent infinite loops
  if (transitionChainCount > 3) {
    console.log(`[HermesCrew] Max transition depth reached for card ${cardId}. Halting.`);
    
    const { kanban, kanbanPath } = getProjectAndKanban(projectId);
    const card = kanban.cards.find(c => c.id === cardId);
    if (card) {
      card.isProcessing = false;
      card.agentSummary = "Autonomous workflow halted: Max transition chain depth of 3 exceeded.";
      if (!card.comments) card.comments = [];
      card.comments.push({
        id: 'comment-' + Date.now(),
        author: 'System (Limit)',
        text: 'Agent auto-processing was halted to prevent infinite loops (max transition depth of 3 columns exceeded).',
        timestamp: new Date().toISOString()
      });
      fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');
    }
    return;
  }

  const { project, kanban, kanbanPath } = getProjectAndKanban(projectId);
  const card = kanban.cards.find(c => c.id === cardId);
  const column = kanban.columns.find(col => col.id === columnId);

  if (!card || !column || !column.agentEnabled) {
    return;
  }

  const isMeetingRoomCol = column.isMeetingRoom || column.name === 'Meeting Room' || column.name.toLowerCase().includes('meeting');

  if (isMeetingRoomCol) {
    if (card.meetingRounds === undefined) card.meetingRounds = 0;
    if (card.maxBudget === undefined) card.maxBudget = 10;

    if (card.meetingRounds >= card.maxBudget) {
      console.log(`[HermesCrew - Meeting Room] Card "${card.title}" reached max budget (${card.maxBudget} rounds). Halting meeting.`);
      card.isProcessing = false;
      const inboxCol = kanban.columns.find(c => c.id === 'col-1' || c.name.toLowerCase() === 'inbox') || kanban.columns[0];
      if (inboxCol) card.columnId = inboxCol.id;
      if (!card.comments) card.comments = [];
      card.comments.push({
        id: 'comment-' + Date.now(),
        author: 'Meeting Administrator',
        text: `🛑 **Meeting Budget Exceeded**: Discussion reached max budget of ${card.maxBudget} rounds without reaching full consensus. Card moved to **${inboxCol ? inboxCol.name : 'Inbox'}**. To resume, drag this card back into the Meeting Room to reset the budget to 10 rounds.`,
        timestamp: new Date().toISOString()
      });
      fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');
      return;
    }

    card.meetingRounds += 1;
    fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');
  }

  // Determine owner & bound agent behavior
  const owner = card.owner || 'unassigned';
  const watchers = card.watchers || [];

  let agentPrompt = '';
  let agentName = '';
  let isDiscussion = false;
  let watchingAgents = [];
  let boundAgent = null;
  let isAutoAssignTask = false;

  if (owner !== 'user' && owner !== 'unassigned') {
    boundAgent = kanban.agents ? kanban.agents.find(a => a.id === owner) : null;
  }

  if (owner === 'user') {
    console.log(`[HermesCrew - ${project.name}] Card "${card.title}" belongs to User. Skipping auto execution.`);
    return;
  } else if (boundAgent) {
    agentPrompt = boundAgent.prompt;
    agentName = boundAgent.name;
  } else if (owner === 'unassigned') {
    watchingAgents = kanban.agents ? kanban.agents.filter(a => watchers.includes(a.id)) : [];
    if (watchingAgents.length > 0) {
      isDiscussion = true;
      agentName = 'Agents Discussion';
    } else {
      isAutoAssignTask = true;
      agentName = 'Hermes Coordinator';
    }
  }

  console.log(`[HermesCrew - ${project.name}] Activating agent execution (${agentName}) for Card: "${card.title}" inside Column: "${column.name}" (Meeting: ${isMeetingRoomCol})`);

  // Set card processing status
  card.isProcessing = true;
  fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');

  // Compile prompt context
  const columnsList = kanban.columns.map(c => `"${c.name}"`).join(', ');
  
  const commentsHistory = card.comments && card.comments.length > 0
    ? card.comments.map(c => `- ${c.author} (${new Date(c.timestamp).toLocaleString()}): ${c.text}`).join('\n')
    : '(No prior conversation comments on this card)';

  let prompt = '';
  if (isMeetingRoomCol) {
    const teamAgents = kanban.agents || [];
    const teamDetails = teamAgents.map(a => `- **${a.name}**: ${a.prompt}`).join('\n');
    const moderatorGuidelines = column.agentPrompt || "Evaluate whether a clear consensus or actionable outcome has been reached.";

    prompt = `
[SYSTEM INSTRUCTION: MEETING ROOM MULTI-AGENT DISCUSSION (ROUND ${card.meetingRounds} / ${card.maxBudget})]
You are hosting an automated multi-agent meeting in the Meeting Room.
Participating Team Role Agents:
${teamDetails}

[MEETING ROOM MODERATOR GUIDELINES (COLUMN PROMPT)]
${moderatorGuidelines}

[PROJECT SCOPE CONTEXT]
Vision: ${kanban.scope ? kanban.scope.vision : ''}
Mission: ${kanban.scope ? kanban.scope.mission : ''}
Target Scope: ${kanban.scope ? kanban.scope.targetScope : ''}

[CARD DETAILS]
Title: ${card.title}
Description: ${card.description}

[CARD COMMENTS & DISCUSSION HISTORY]
${commentsHistory}

[MEETING FLOW FOR THIS ROUND]
1. Each relevant Team Role Agent discusses the requirements, addresses comments, or proposes code/architecture approaches.
2. If the task is too complex, any agent can explicitly split it into sub-cards by outputting:
   [CREATE_SUBCARD: Subcard Title | Subcard Description]
3. If new specialized team members are required, recruit them by outputting:
   [CREATE_AGENT: Role Name | Role System Prompt]
4. Finally, follow the Meeting Room Moderator Guidelines above to evaluate all inputs and conclude this round's discussion with ONE of the following status tags at the very end:
   - If consensus / solution IS reached:
     [MEETING_STATUS: CONCLUDED]
     [MOVE_TO: Target Column Name] (e.g. Execution or Analysis or Done)
   - If discussion is still ongoing and needs another round:
     [MEETING_STATUS: CONTINUE]

(Available columns: ${columnsList})
`;
  } else if (isDiscussion) {
    const watchersDetails = watchingAgents.map(a => `- **${a.name}**:\n  Instructions: ${a.prompt}`).join('\n\n');
    const watchersNamesList = watchingAgents.map(a => `"${a.name}"`).join(', ');

    prompt = `
[SYSTEM INSTRUCTION: JOINT AGENTS WORKSPACE DISCUSSION]
The card below is currently **Unassigned**. The following stakeholder Agents are watching/involved in this card:
${watchersDetails}

[CURRENT KANBAN COLUMN CONTEXT & INSTRUCTIONS]
This discussion is triggered because the card has entered the column: "${column.name}".
Column context guidelines:
${column.agentPrompt || '(No specific column guidelines)'}

[CARD DETAILS]
Title: ${card.title}
Description: ${card.description}

[CARD COMMENTS & DISCUSSION HISTORY]
${commentsHistory}

[DISCUSSION TASK]
You must simulate a short, collaborative discussion between these watching agents (${watchersNamesList}) to determine:
1. Who should take ownership of this card? (Must be one of the watching agents, or "User" if it requires manual human intervention).
2. What are the immediate next steps?
3. Which column should the card be routed to?

Write out the discussion transcripts in a natural conversational flow, for example:
- **Analyst Agent**: "I think..."
- **Coder Agent**: "Agreed, I will take it because..."

At the very end of the discussion, you MUST output the following tags to instruct the system:
[ASSIGN_TO: Agent Name or User]
[MOVE_TO: Column Name]

(The available columns are: ${columnsList})
Please match the agent names and column names exactly.
`;
  } else if (isAutoAssignTask) {
    const teamAgents = kanban.agents || [];
    const teamDetails = teamAgents.map(a => `- **${a.name}**: ${a.prompt}`).join('\n');

    prompt = `
[SYSTEM INSTRUCTION: AUTONOMOUS TASK ASSIGNMENT & EXECUTION PHASE: "${column.name}"]
This card is currently **Unassigned**. As Senior Hermes Coordinator, perform task analysis, owner assignment, and execution.

AVAILABLE TEAM ROLE AGENTS IN WORKSPACE:
${teamDetails}

[CURRENT PHASE COLUMN CONTEXT]
Phase: "${column.name}"
Guidelines: ${column.agentPrompt || '(No specific column guidelines)'}

[CARD DETAILS]
Title: ${card.title}
Description: ${card.description}

[CARD COMMENTS & DISCUSSION HISTORY]
${commentsHistory}

[YOUR TASK STEPS]
1. Analyze the card requirements against the team role agents listed above, and select the best qualified agent to own this task. Output [ASSIGN_TO: Agent Name].
2. Perform the required work, execution, implementation, or data analysis for column phase "${column.name}". Resolve multi-step subtasks internally within your own workflow execution whenever possible.
3. Subcard creation guidelines (STRICT NECESSITY ONLY): Do NOT create sub-cards for routine multi-step work. ONLY output [CREATE_SUBCARD: Subcard Title | Subcard Description] if a subtask is genuinely too massive and strictly requires independent parallel tracking by separate team roles.
4. When your work is complete or ready for the next phase, output [MOVE_TO: Target Column Name] (e.g. [MOVE_TO: Done] or next target column).

Available transition columns: ${columnsList}
`;
  } else {
    prompt = `
[AGENT ROLE SYSTEM INSTRUCTION: ${agentName}]
${agentPrompt}

[CURRENT PHASE COLUMN CONTEXT & INSTRUCTIONS]
You are running within the Kanban Column phase: "${column.name}".
Phase guidelines:
${column.agentPrompt || '(No specific column guidelines)'}

[CARD DETAILS]
Title: ${card.title}
Description: ${card.description}

[CARD COMMENTS & DISCUSSION HISTORY]
${commentsHistory}

[TRANSITION DIRECTIVES & WORKFLOW COMPLETION]
You are processing this Kanban card as an autonomous agent.
1. Perform the required task processing, implementation, code writing, or analysis for phase "${column.name}". Process multi-step subtasks directly inside your own execution workflow.
2. Subcard creation guidelines (STRICT NECESSITY ONLY): Do NOT create sub-cards for standard work steps. ONLY output [CREATE_SUBCARD: Subcard Title | Subcard Description] if a task is extraordinarily complex and strictly requires delegating to a separate asynchronous card.
3. When your work on this card is finished or ready to move to another stage, you MUST output the following tag at the very end of your response:
[MOVE_TO: Column Name] (For example: [MOVE_TO: Done] when completed).

The available columns you can move this card to are: ${columnsList}
Please match the spelling exactly.
`;
  }

  const config = readConfig();
  const hermesPath = resolveHome(config.hermesPath);
  const args = ['chat', '-q', prompt, '--yolo', '--accept-hooks'];
  
  if (card.sessionId) {
    args.push('--resume', card.sessionId);
  }

  const child = spawn(hermesPath, args, {
    cwd: project.path,
    env: { ...process.env, PAGER: 'cat', PYTHONUNBUFFERED: '1' }
  });
  registerRunningProcess({ projectId: project.id, cardId: card.id, child });

  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  child.on('close', (code, signal) => {
    if (signal) {
      console.log(`[HermesCrew - ${project.name}] Agent process for card ${cardId} was terminated by signal ${signal}. Skipping completion logic.`);
      return;
    }
    console.log(`[HermesCrew - ${project.name}] Agent finished for card ${cardId}. Exit Code: ${code}`);

    const { kanban: freshKanban, kanbanPath: freshKanbanPath } = getProjectAndKanban(projectId);
    const freshCard = freshKanban.cards.find(c => c.id === cardId);
    if (!freshCard) return;

    let cleanedOutput = stdout;
    let cleanStderr = stderr;
    let newSessionId = freshCard.sessionId;

    const matchStdout = stdout.match(/session_id:\s*([^\s\n]+)/i);
    const matchStderr = stderr.match(/session_id:\s*([^\s\n]+)/i);
    if (matchStdout) {
      newSessionId = matchStdout[1];
      cleanedOutput = cleanedOutput.replace(/session_id:\s*[^\s\n]+/gi, '');
    }
    if (matchStderr) {
      newSessionId = matchStderr[1];
      cleanStderr = cleanStderr.replace(/session_id:\s*[^\s\n]+/gi, '');
    }

    cleanedOutput = cleanedOutput.replace(/^↻ Resumed session.*?\n/im, '').trim();
    cleanStderr = cleanStderr.replace(/^↻ Resumed session.*?\n/im, '').trim();

    let meetingStatus = null;
    const meetingMatch = cleanedOutput.match(/\[MEETING_STATUS:\s*([^\]]+)\]/i);
    if (meetingMatch) {
      meetingStatus = meetingMatch[1].trim().toUpperCase();
      cleanedOutput = cleanedOutput.replace(/\[MEETING_STATUS:\s*[^\]]+\]/gi, '').trim();
    }

    // Check for assignment tag [ASSIGN_TO: Agent Name or User]
    let targetAssignment = null;
    const assignMatch = cleanedOutput.match(/\[ASSIGN_TO:\s*([^\]]+)\]/i);
    if (assignMatch) {
      targetAssignment = assignMatch[1].replace(/\s+/g, ' ').trim();
      cleanedOutput = cleanedOutput.replace(/\[ASSIGN_TO:\s*[^\]]+\]/gi, '').trim();
    }

    // Check for transition tag [MOVE_TO: Column Name]
    let targetColName = null;
    const moveMatch = cleanedOutput.match(/\[MOVE_TO:\s*([^\]]+)\]/i);
    if (moveMatch) {
      targetColName = moveMatch[1].replace(/\s+/g, ' ').trim();
      cleanedOutput = cleanedOutput.replace(/\[MOVE_TO:\s*[^\]]+\]/gi, '').trim();
    }

    cleanedOutput = processAgentDirectives(freshKanban, freshCard, cleanedOutput);
    const createdSubcards = freshCard._createdSubcards || [];
    delete freshCard._createdSubcards;

    if (createdSubcards.length > 0) {
      console.log(`[HermesCrew] Card "${freshCard.title}" created ${createdSubcards.length} sub-tasks. Holding parent card in phase "${column.name}".`);
      targetColName = null;
    }

    if (!freshCard.comments) freshCard.comments = [];
    
    if (!cleanedOutput && code !== 0) {
      cleanedOutput = `Hermes Agent execution failed with exit code ${code}.\nError details:\n${cleanStderr}`;
    }

    freshCard.comments.push({
      id: 'comment-' + Date.now(),
      author: isMeetingRoomCol ? 'Meeting Room Discussion' : (isDiscussion ? 'Agents Discussion' : `Hermes Agent (${agentName})`),
      text: cleanedOutput || 'Agent completed task processing with no return message.',
      timestamp: new Date().toISOString()
    });

    if (cleanedOutput) {
      let summaryText = cleanedOutput
        .replace(/[#*`>_\-\[\]]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (summaryText.length > 120) {
        summaryText = summaryText.substring(0, 120) + '...';
      }
      freshCard.agentSummary = summaryText;
    } else {
      freshCard.agentSummary = code !== 0 ? 'Execution failed.' : 'No output returned.';
    }

    // Check for watchers tag [SET_WATCHERS: Agent1, Agent2]
    let targetWatchersStr = null;
    const watchersMatch = cleanedOutput.match(/\[SET_WATCHERS:\s*([^\]]+)\]/i);
    if (watchersMatch) {
      targetWatchersStr = watchersMatch[1].replace(/\s+/g, ' ').trim();
      cleanedOutput = cleanedOutput.replace(/\[SET_WATCHERS:\s*[^\]]+\]/gi, '').trim();
    }

    // Apply assignment if found
    if (targetAssignment) {
      if (targetAssignment.toLowerCase() === 'user') {
        freshCard.owner = 'user';
        console.log(`[HermesCrew] Assignment update: Assigned Card "${freshCard.title}" to User.`);
      } else {
        const targetAgent = freshKanban.agents ? freshKanban.agents.find(a => a.name.toLowerCase() === targetAssignment.toLowerCase()) : null;
        if (targetAgent) {
          freshCard.owner = targetAgent.id;
          console.log(`[HermesCrew] Assignment update: Assigned Card "${freshCard.title}" to Agent "${targetAgent.name}".`);
        } else {
          console.log(`[HermesCrew] Assignment update target agent "${targetAssignment}" not found.`);
        }
      }
    }

    // Apply watchers if found
    if (targetWatchersStr) {
      const names = targetWatchersStr.split(/[,|]/).map(n => n.replace(/\s+/g, ' ').trim().toLowerCase());
      const matchedIds = [];
      if (freshKanban.agents) {
        freshKanban.agents.forEach(a => {
          if (names.some(n => n === a.name.toLowerCase() || a.name.toLowerCase().includes(n))) {
            matchedIds.push(a.id);
          }
        });
      }
      freshCard.watchers = matchedIds;
      console.log(`[HermesCrew] Watchers update: Set ${matchedIds.length} watching agents for Card "${freshCard.title}".`);
    }

    freshCard.isProcessing = false;
    freshCard.sessionId = newSessionId;

    let triggeredNextColumnId = null;
    if (targetColName) {
      const matchCol = freshKanban.columns.find(c => c.name.toLowerCase() === targetColName.toLowerCase());
      if (matchCol) {
        console.log(`[HermesCrew - ${project.name}] Transitioning Card "${freshCard.title}" to "${matchCol.name}"`);
        freshCard.columnId = matchCol.id;
        triggeredNextColumnId = matchCol.id;
      } else {
        console.log(`[HermesCrew - ${project.name}] Transition target column "${targetColName}" not found.`);
      }
    }

    fs.writeFileSync(freshKanbanPath, JSON.stringify(freshKanban, null, 2), 'utf8');

    // Automatically trigger autonomous execution for newly created sub-cards
    if (createdSubcards.length > 0) {
      createdSubcards.forEach((sub, idx) => {
        setTimeout(() => {
          console.log(`[HermesCrew] Triggering autonomous execution for sub-card "${sub.title}" (${sub.id}) in column "${sub.columnId}"...`);
          triggerAgentForCard(sub.id, sub.columnId, projectId, 0);
        }, (idx + 1) * 1000);
      });
    }

    if (isMeetingRoomCol && meetingStatus === 'CONTINUE' && !triggeredNextColumnId) {
      if (freshCard.meetingRounds < freshCard.maxBudget) {
        console.log(`[Meeting Room] Discussion for "${freshCard.title}" round ${freshCard.meetingRounds} finished with CONTINUE. Scheduling round ${freshCard.meetingRounds + 1}...`);
        setTimeout(() => {
          triggerAgentForCard(cardId, columnId, projectId, 0);
        }, 1500);
      } else {
        freshCard.isProcessing = false;
        const inboxCol = freshKanban.columns.find(c => c.id === 'col-1' || c.name.toLowerCase() === 'inbox') || freshKanban.columns[0];
        if (inboxCol) freshCard.columnId = inboxCol.id;
        freshCard.comments.push({
          id: 'comment-' + Date.now(),
          author: 'Meeting Administrator',
          text: `🛑 **Meeting Budget Exceeded**: Max budget of ${freshCard.maxBudget} rounds reached. Card moved to **${inboxCol ? inboxCol.name : 'Inbox'}**.`,
          timestamp: new Date().toISOString()
        });
        fs.writeFileSync(freshKanbanPath, JSON.stringify(freshKanban, null, 2), 'utf8');
      }
    } else if (triggeredNextColumnId && triggeredNextColumnId !== columnId) {
      triggerAgentForCard(cardId, triggeredNextColumnId, projectId, transitionChainCount + 1);
    }
  });

  child.on('error', (err) => {
    console.error(`[HermesCrew - ${project.name}] Spawn error for card ${cardId}:`, err);
    const { kanban: freshKanban, kanbanPath: freshKanbanPath } = getProjectAndKanban(projectId);
    const freshCard = freshKanban.cards.find(c => c.id === cardId);
    if (freshCard) {
      freshCard.isProcessing = false;
      freshCard.agentSummary = `Error: ${err.message}`;
      if (!freshCard.comments) freshCard.comments = [];
      freshCard.comments.push({
        id: 'comment-' + Date.now(),
        author: 'System (Error)',
        text: `Failed to trigger agent process: ${err.message}`,
        timestamp: new Date().toISOString()
      });
      fs.writeFileSync(freshKanbanPath, JSON.stringify(freshKanban, null, 2), 'utf8');
    }
  });
}

// Start Server
app.listen(PORT, () => {
  console.log(`Hermes Kanban server running at http://localhost:${PORT}`);
});

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
