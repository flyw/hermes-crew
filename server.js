const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

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
          agentPrompt: ""
        },
        {
          id: "col-3",
          name: "Execution",
          agentEnabled: true,
          agentId: coderId,
          agentPrompt: ""
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
  
  kanban.columns.forEach(col => {
    if (col.agentId === undefined) {
      col.agentId = null;
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

// --- Chat Assistant APIs ---

// GET: Get history list
app.get('/api/history', (req, res) => {
  const history = readHistory();
  res.json(history);
});

// GET: Run task as streaming output (SSE)
app.get('/api/run-stream', (req, res) => {
  const { prompt, sessionId } = req.query;
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  console.log(`Starting hermes chat. Prompt: "${prompt}", Session: "${sessionId || 'New'}"`);

  const hermesPath = '/home/yuan/.local/bin/hermes';
  const args = ['chat', '-q', prompt, '--yolo', '--accept-hooks', '-Q'];
  
  if (sessionId && sessionId !== 'null' && sessionId !== 'undefined') {
    args.push('--resume', sessionId);
  }

  const child = spawn(hermesPath, args, {
    env: { ...process.env, PAGER: 'cat' }
  });

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

    const history = readHistory();
    const historyItem = {
      id: Date.now().toString(),
      prompt,
      output: fullOutput.trim(),
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
  const { prompt, sessionId } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  console.log(`Starting hermes chat via POST. Prompt: "${prompt}", Session: "${sessionId || 'New'}"`);

  const hermesPath = '/home/yuan/.local/bin/hermes';
  const args = ['chat', '-q', prompt, '--yolo', '--accept-hooks', '-Q'];
  
  if (sessionId) {
    args.push('--resume', sessionId);
  }

  const child = spawn(hermesPath, args, {
    env: { ...process.env, PAGER: 'cat' }
  });

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

    const history = readHistory();
    const historyItem = {
      id: Date.now().toString(),
      prompt,
      output: cleaned.output,
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
      output: cleaned.output,
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
  const { kanban } = getProjectAndKanban(projectId);
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

// PUT: Update card (title, description, owner, watchers)
app.put('/api/kanban/cards/:id', (req, res) => {
  const { id } = req.params;
  const { projectId } = req.query;
  const { title, description, owner, watchers } = req.body;

  const { kanban, kanbanPath } = getProjectAndKanban(projectId);
  const card = kanban.cards.find(c => c.id === id);
  if (!card) {
    return res.status(404).json({ error: 'Card not found' });
  }

  if (title !== undefined) card.title = title;
  if (description !== undefined) card.description = description;
  if (owner !== undefined) card.owner = owner;
  if (watchers !== undefined) card.watchers = watchers;

  fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');
  res.json(card);
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
  fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');

  // If target column has agent enabled and column actually changed, trigger
  if (oldColumnId !== columnId) {
    const targetCol = kanban.columns.find(col => col.id === columnId);
    if (targetCol && targetCol.agentEnabled) {
      triggerAgentForCard(id, columnId, projectId);
    }
  }

  res.json({ success: true, card });
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

  // Check for @ mentions of agents
  if (kanban.agents && kanban.agents.length > 0) {
    const mentionedAgent = kanban.agents.find(agent => {
      const mentionPattern = new RegExp(`@${escapeRegExp(agent.name)}`, 'i');
      return mentionPattern.test(text);
    });
    if (mentionedAgent) {
      console.log(`[HermesCrew - comment mention] Mentioned Agent: "${mentionedAgent.name}" on Card: "${card.title}"`);
      // Trigger execution asynchronously
      setTimeout(() => {
        triggerAgentForCardDirect(id, mentionedAgent.id, projectId, `[User @ Mentioned Command]:\n${text}`);
      }, 500);
    }
  }

  res.json(newComment);
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

  const hermesPath = '/home/yuan/.local/bin/hermes';
  const args = ['chat', '-q', prompt, '--yolo', '--accept-hooks', '-Q'];
  
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

  child.on('close', (code) => {
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
      targetColName = moveMatch[1].trim();
      cleanedOutput = cleanedOutput.replace(/\[MOVE_TO:\s*[^\]]+\]/gi, '').trim();
    }

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

function triggerAgentForCard(cardId, columnId, projectId, transitionChainCount = 0) {
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

  // Determine owner & watchers behavior
  const owner = card.owner || 'unassigned';
  const watchers = card.watchers || [];

  let agentPrompt = '';
  let agentName = '';
  let isDiscussion = false;
  let watchingAgents = [];

  if (owner === 'user') {
    console.log(`[HermesCrew - ${project.name}] Card "${card.title}" belongs to User. Skipping auto execution.`);
    return;
  } else if (owner === 'unassigned') {
    watchingAgents = kanban.agents ? kanban.agents.filter(a => watchers.includes(a.id)) : [];
    if (watchingAgents.length === 0) {
      console.log(`[HermesCrew - ${project.name}] Card "${card.title}" is Unassigned and has no watching agents. Skipping auto execution.`);
      return;
    }
    isDiscussion = true;
    agentName = 'Agents Discussion';
  } else {
    const boundAgent = kanban.agents ? kanban.agents.find(a => a.id === owner) : null;
    if (!boundAgent) {
      console.log(`[HermesCrew - ${project.name}] Card owner agent "${owner}" not found. Skipping auto execution.`);
      return;
    }
    agentPrompt = boundAgent.prompt;
    agentName = boundAgent.name;
  }

  console.log(`[HermesCrew - ${project.name}] Activating agent execution for Card: "${card.title}" inside Column: "${column.name}" (Type: ${isDiscussion ? 'Joint Discussion' : agentName})`);

  // Set card processing status
  card.isProcessing = true;
  fs.writeFileSync(kanbanPath, JSON.stringify(kanban, null, 2), 'utf8');

  // Compile prompt context
  const columnsList = kanban.columns.map(c => `"${c.name}"`).join(', ');
  
  const commentsHistory = card.comments && card.comments.length > 0
    ? card.comments.map(c => `- ${c.author} (${new Date(c.timestamp).toLocaleString()}): ${c.text}`).join('\n')
    : '(No prior conversation comments on this card)';

  let prompt = '';
  if (isDiscussion) {
    const watchersDetails = watchingAgents.map(a => `- **${a.name}**:\n  Instructions: ${a.prompt}`).join('\n\n');
    const watchersNamesList = watchingAgents.map(a => `"${a.name}"`).join(', ');

    prompt = `
[SYSTEM INSTRUCTION: JOINT AGENTS WORKSPACE DISCUSSION]
The card below is currently **Unassigned (待领取)**. The following stakeholder Agents are watching/involved in this card:
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

[TRANSITION DIRECTIVES]
You are processing this Kanban card as an autonomous agent. 
If you decide that the task is complete, requires next-level execution, or needs to route to a different column, you must output the following tag at the very end of your response:
[MOVE_TO: Column Name]

The available columns you can move this card to are: ${columnsList}
Please match the spelling exactly. If you wish to keep it in the current column "${column.name}", do not output the [MOVE_TO: ...] tag.
`;
  }

  const hermesPath = '/home/yuan/.local/bin/hermes';
  const args = ['chat', '-q', prompt, '--yolo', '--accept-hooks', '-Q'];
  
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

  child.on('close', (code) => {
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

    // Check for assignment tag [ASSIGN_TO: Agent Name or User]
    let targetAssignment = null;
    const assignMatch = cleanedOutput.match(/\[ASSIGN_TO:\s*([^\]]+)\]/i);
    if (assignMatch) {
      targetAssignment = assignMatch[1].trim();
      cleanedOutput = cleanedOutput.replace(/\[ASSIGN_TO:\s*[^\]]+\]/gi, '').trim();
    }

    // Check for transition tag [MOVE_TO: Column Name]
    let targetColName = null;
    const moveMatch = cleanedOutput.match(/\[MOVE_TO:\s*([^\]]+)\]/i);
    if (moveMatch) {
      targetColName = moveMatch[1].trim();
      cleanedOutput = cleanedOutput.replace(/\[MOVE_TO:\s*[^\]]+\]/gi, '').trim();
    }

    if (!freshCard.comments) freshCard.comments = [];
    
    if (!cleanedOutput && code !== 0) {
      cleanedOutput = `Hermes Agent execution failed with exit code ${code}.\nError details:\n${cleanStderr}`;
    }

    freshCard.comments.push({
      id: 'comment-' + Date.now(),
      author: isDiscussion ? 'Agents Discussion' : `Hermes Agent (${agentName})`,
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

    // Apply assignment if found
    if (targetAssignment) {
      if (targetAssignment.toLowerCase() === 'user' || targetAssignment.toLowerCase() === '用户') {
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

    // Recursive trigger if transitioned
    if (triggeredNextColumnId && triggeredNextColumnId !== columnId) {
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
