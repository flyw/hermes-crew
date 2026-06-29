document.addEventListener('DOMContentLoaded', () => {
  console.log('[Kanban Init] DOMContentLoaded event fired. Starting initialization...');
  
  // Project Workspace state (declared top-level for early access)
  let currentProjectId = localStorage.getItem('kanban_current_project') || 'proj-default';

  // --- View switcher ---
  const tabKanban = document.getElementById('tab-kanban');
  const tabConfig = document.getElementById('tab-config');
  const viewKanban = document.getElementById('view-kanban');
  const viewConfig = document.getElementById('view-config');

  if (tabKanban) {
    tabKanban.addEventListener('click', () => {
      tabKanban.classList.add('active');
      if (tabConfig) tabConfig.classList.remove('active');
      if (viewKanban) {
        viewKanban.classList.add('active');
        viewKanban.classList.remove('hidden');
      }
      if (viewConfig) {
        viewConfig.classList.remove('active');
        viewConfig.classList.add('hidden');
      }
      startKanbanPolling();
      fetchProjects().then(() => {
        fetchKanbanBoard();
      });
    });
  }

  if (tabConfig) {
    tabConfig.addEventListener('click', () => {
      tabConfig.classList.add('active');
      if (tabKanban) tabKanban.classList.remove('active');
      if (viewConfig) {
        viewConfig.classList.add('active');
        viewConfig.classList.remove('hidden');
      }
      if (viewKanban) {
        viewKanban.classList.remove('active');
        viewKanban.classList.add('hidden');
      }
      stopKanbanPolling();
      loadConfig();
    });
  }

  // --- Chat Assistant Workspace Logic ---
  const promptInput = document.getElementById('prompt-input');
  const submitBtn = document.getElementById('submit-btn');
  const newBtn = document.getElementById('new-task-btn');
  const clearBtn = document.getElementById('clear-history-btn');
  const streamToggle = document.getElementById('stream-toggle');
  
  const chatMessages = document.getElementById('chat-messages');
  const welcomeContainer = document.getElementById('welcome-container');
  const historyList = document.getElementById('history-list');

  const execStatus = document.getElementById('execution-status');
  const statusText = execStatus ? execStatus.querySelector('.badge-text') : null;
  const spinnerIcon = execStatus ? execStatus.querySelector('.spinner-icon') : null;

  const sessionBadge = document.getElementById('session-badge');
  const resetSessionBtn = document.getElementById('reset-session-btn');

  const sidebar = document.querySelector('.sidebar');
  const sidebarToggle = document.getElementById('sidebar-toggle');
  const sidebarOverlay = document.getElementById('sidebar-overlay');

  let activeEventSource = null;
  let timerInterval = null;
  let startTime = 0;
  let currentOutputText = '';
  let currentSessionId = null;
  let activeHistory = [];

  marked.use({ gfm: true, breaks: true });

  // Auto-resize prompt textarea
  promptInput.addEventListener('input', () => {
    promptInput.style.height = 'auto';
    promptInput.style.height = (promptInput.scrollHeight) + 'px';
  });

  promptInput.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      executeTask();
    }
  });

  loadHistory();
  submitBtn.addEventListener('click', executeTask);

  newBtn.addEventListener('click', () => {
    resetSession();
    clearChatThread();
    promptInput.focus();
    closeSidebarOnMobile();
  });

  resetSessionBtn.addEventListener('click', () => {
    resetSession();
    clearChatThread();
    promptInput.focus();
  });

  clearBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all history?')) {
      try {
        const response = await fetch('/api/history', { method: 'DELETE' });
        if (response.ok) {
          loadHistory();
          resetSession();
          clearChatThread();
        }
      } catch (err) {
        console.error('Failed to clear history:', err);
      }
    }
  });

  // Presets
  document.querySelectorAll('[data-prompt]').forEach(tag => {
    tag.addEventListener('click', () => {
      promptInput.value = tag.getAttribute('data-prompt');
      promptInput.style.height = 'auto';
      promptInput.style.height = (promptInput.scrollHeight) + 'px';
      promptInput.focus();
    });
  });

  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
      if (sidebar) sidebar.classList.toggle('open');
      if (sidebarOverlay) sidebarOverlay.classList.toggle('open');
    });
  }

  sidebarOverlay.addEventListener('click', closeSidebarOnMobile);

  function closeSidebarOnMobile() {
    if (sidebar && sidebarOverlay) {
      sidebar.classList.remove('open');
      sidebarOverlay.classList.remove('open');
    }
  }

  function resetSession() {
    currentSessionId = null;
    sessionBadge.textContent = 'New Session';
    sessionBadge.style.color = 'var(--primary)';
  }

  function setSessionId(id) {
    if (id) {
      currentSessionId = id;
      const shortId = id.length > 15 ? id.substring(id.length - 8) : id;
      sessionBadge.textContent = `Active (${shortId})`;
      sessionBadge.style.color = 'var(--secondary)';
      sessionBadge.title = `Full Session ID: ${id}`;
    } else {
      resetSession();
    }
  }

  function clearChatThread() {
    const bubbles = chatMessages.querySelectorAll('.message');
    bubbles.forEach(b => b.remove());
    welcomeContainer.classList.remove('hidden');
    if (timerInterval) clearInterval(timerInterval);
  }

  function setStatus(status) {
    if (!execStatus) return;
    execStatus.className = 'execution-badge';
    execStatus.classList.remove('hidden');
    spinnerIcon.classList.add('hidden');

    switch (status) {
      case 'idle':
        execStatus.classList.add('status-idle', 'hidden');
        submitBtn.disabled = false;
        break;
      case 'running':
        execStatus.classList.add('status-running');
        statusText.textContent = 'Running';
        spinnerIcon.classList.remove('hidden');
        submitBtn.disabled = true;
        break;
      case 'success':
        execStatus.classList.add('status-success');
        statusText.textContent = 'Success';
        submitBtn.disabled = false;
        setTimeout(() => execStatus.classList.add('hidden'), 3000);
        break;
      case 'failed':
        execStatus.classList.add('status-failed');
        statusText.textContent = 'Failed';
        submitBtn.disabled = false;
        break;
    }
  }

  function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  async function executeTask() {
    const prompt = promptInput.value.trim();
    if (!prompt) return;

    promptInput.value = '';
    promptInput.style.height = 'auto';
    welcomeContainer.classList.add('hidden');

    appendUserMessage(prompt);
    const agentBubble = appendAgentPlaceholder();
    scrollToBottom();

    setStatus('running');
    closeSidebarOnMobile();

    const stopBtn = document.getElementById('stop-btn');
    if (submitBtn) submitBtn.classList.add('hidden');
    if (stopBtn) stopBtn.classList.remove('hidden');

    const useStreaming = streamToggle.checked;

    if (useStreaming) {
      streamExecution(prompt, agentBubble);
    } else {
      await standardExecution(prompt, agentBubble);
    }
  }

  function appendUserMessage(text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message user';
    msgDiv.innerHTML = `
      <div class="message-label">You</div>
      <div class="message-bubble">${escapeHtml(text)}</div>
    `;
    chatMessages.appendChild(msgDiv);
  }

  function appendAgentPlaceholder() {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message agent';
    msgDiv.id = 'msg-current';
    msgDiv.innerHTML = `
      <div class="message-label">Hermes Agent</div>
      <div class="message-bubble">
        <div class="console-stream"><span class="text-muted">Awaiting response...</span></div>
        <div class="bubble-error hidden">
          <div class="error-title" style="color:var(--error);font-size:0.75rem;font-weight:700;margin-bottom:6px;">Stderr Log:</div>
          <pre></pre>
        </div>
        <div class="message-meta hidden">
          <div class="message-meta-left">
            <span class="meta-time">Elapsed: 0s</span>
            <span class="separator">•</span>
            <span class="meta-code">Exit Code: -</span>
          </div>
          <button class="icon-text-btn copy-bubble-btn">Copy</button>
        </div>
      </div>
    `;
    chatMessages.appendChild(msgDiv);
    return msgDiv;
  }

  function streamExecution(prompt, agentBubble) {
    if (activeEventSource) activeEventSource.close();

    let url = `/api/run-stream?prompt=${encodeURIComponent(prompt)}&projectId=${encodeURIComponent(currentProjectId)}`;
    if (currentSessionId) {
      url += `&sessionId=${encodeURIComponent(currentSessionId)}`;
    }

    const streamContainer = agentBubble.querySelector('.console-stream');
    const errorContainer = agentBubble.querySelector('.bubble-error');
    const errorText = errorContainer.querySelector('pre');
    const metaContainer = agentBubble.querySelector('.message-meta');
    const metaTime = metaContainer.querySelector('.meta-time');
    const metaCode = metaContainer.querySelector('.meta-code');
    const copyBtn = metaContainer.querySelector('.copy-bubble-btn');

    activeEventSource = new EventSource(url);
    currentOutputText = '';
    let stderrBuffer = '';
    
    startTime = Date.now();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      metaTime.textContent = `Elapsed: ${elapsed}s`;
    }, 1000);

    metaContainer.classList.remove('hidden');

    activeEventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'session_id') {
        setSessionId(data.sessionId);
      }
      else if (data.type === 'stdout') {
        if (currentOutputText === '') {
          streamContainer.innerHTML = '';
        }
        currentOutputText += data.chunk;
        streamContainer.innerHTML = marked.parse(currentOutputText);
        
        streamContainer.querySelectorAll('pre code').forEach((el) => {
          if (!el.dataset.highlighted) {
            hljs.highlightElement(el);
            el.dataset.highlighted = 'true';
          }
        });
        scrollToBottom();
      }
      else if (data.type === 'stderr') {
        stderrBuffer += data.chunk;
        errorContainer.classList.remove('hidden');
        errorText.textContent = stderrBuffer;
        scrollToBottom();
      }
      else if (data.type === 'close') {
        activeEventSource.close();
        if (timerInterval) clearInterval(timerInterval);
        
        metaCode.textContent = `Exit Code: ${data.code}`;
        setStatus(data.code === 0 ? 'success' : 'failed');
        
        if (data.historyItem && data.historyItem.sessionId) {
          setSessionId(data.historyItem.sessionId);
        }

        const finalOutput = currentOutputText;
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(finalOutput).then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => copyBtn.textContent = 'Copy', 2000);
          });
        });

        agentBubble.removeAttribute('id');
        loadHistory();
      }
      else if (data.type === 'error') {
        activeEventSource.close();
        if (timerInterval) clearInterval(timerInterval);
        setStatus('failed');
        errorContainer.classList.remove('hidden');
        errorText.textContent = `Execution Error: ${data.error}`;
      }
      resetChatButtons();
    };
  }

  async function standardExecution(prompt, agentBubble) {
    const streamContainer = agentBubble.querySelector('.console-stream');
    const errorContainer = agentBubble.querySelector('.bubble-error');
    const errorText = errorContainer.querySelector('pre');
    const metaContainer = agentBubble.querySelector('.message-meta');
    const metaTime = metaContainer.querySelector('.meta-time');
    const metaCode = metaContainer.querySelector('.meta-code');
    const copyBtn = metaContainer.querySelector('.copy-bubble-btn');

    startTime = Date.now();
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      metaTime.textContent = `Elapsed: ${elapsed}s`;
    }, 1000);

    metaContainer.classList.remove('hidden');

    try {
      const response = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, sessionId: currentSessionId, projectId: currentProjectId })
      });

      const data = await response.json();
      if (timerInterval) clearInterval(timerInterval);

      if (response.ok && data.success) {
        currentOutputText = data.output;
        streamContainer.innerHTML = marked.parse(currentOutputText);
        
        streamContainer.querySelectorAll('pre code').forEach((el) => {
          hljs.highlightElement(el);
        });

        metaCode.textContent = `Exit Code: ${data.code}`;
        
        if (data.sessionId) setSessionId(data.sessionId);
        if (data.error) {
          errorContainer.classList.remove('hidden');
          errorText.textContent = data.error;
        }

        copyBtn.addEventListener('click', () => {
          navigator.clipboard.writeText(currentOutputText).then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => copyBtn.textContent = 'Copy', 2000);
          });
        });

        setStatus('success');
      } else {
        setStatus('failed');
        errorContainer.classList.remove('hidden');
        errorText.textContent = data.error || data.stderr || 'Task execution failed.';
      }
      agentBubble.removeAttribute('id');
      loadHistory();
    } catch (err) {
      if (timerInterval) clearInterval(timerInterval);
      setStatus('failed');
      errorContainer.classList.remove('hidden');
      errorText.textContent = `Network Error: ${err.message}`;
      agentBubble.removeAttribute('id');
    } finally {
      resetChatButtons();
    }
  }

  function resetChatButtons() {
    const stopBtn = document.getElementById('stop-btn');
    if (submitBtn) submitBtn.classList.remove('hidden');
    if (stopBtn) stopBtn.classList.add('hidden');
  }

  const globalStopBtn = document.getElementById('stop-btn');
  if (globalStopBtn) {
    globalStopBtn.addEventListener('click', async () => {
      if (activeEventSource) activeEventSource.close();
      if (timerInterval) clearInterval(timerInterval);
      setStatus('idle');
      resetChatButtons();
      try {
        await fetch('/api/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: currentProjectId })
        });
      } catch (err) {
        console.error('Failed to stop execution:', err);
      }
    });
  }

  async function loadHistory() {
    if (!currentProjectId) return;
    try {
      const response = await fetch(`/api/history?projectId=${encodeURIComponent(currentProjectId)}`);
      if (!response.ok) return;
      activeHistory = await response.json();
      renderSidebarHistory();
    } catch (err) {
      console.error('Failed to load history list:', err);
    }
  }

  function renderSidebarHistory() {
    if (activeHistory.length === 0) {
      historyList.innerHTML = '<div class="empty-history">No sessions yet</div>';
      return;
    }

    const sessionsMap = {};
    activeHistory.forEach(item => {
      const sId = item.sessionId || `one-off-${item.id}`;
      if (!sessionsMap[sId]) sessionsMap[sId] = [];
      sessionsMap[sId].push(item);
    });

    historyList.innerHTML = '';
    
    const sortedSessions = Object.keys(sessionsMap).map(sId => {
      const items = sessionsMap[sId];
      items.sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
      return {
        sessionId: sId,
        items: items,
        latestTimestamp: new Date(items[items.length - 1].timestamp)
      };
    }).sort((a, b) => b.latestTimestamp - a.latestTimestamp);

    sortedSessions.forEach(session => {
      const firstItem = session.items[0];
      const latestItem = session.items[session.items.length - 1];
      const div = document.createElement('div');
      div.className = 'history-item';
      
      if (currentSessionId && session.sessionId === currentSessionId) {
        div.classList.add('active');
      }

      const dateStr = new Date(latestItem.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const isSuccess = latestItem.code === 0;

      div.innerHTML = `
        <div class="history-item-header">
          <span class="history-time">${dateStr}</span>
          <span class="history-status ${isSuccess ? 'success' : 'error'}"></span>
        </div>
        <div class="history-prompt" title="${escapeHtml(firstItem.prompt)}">${escapeHtml(firstItem.prompt)}</div>
        <button class="delete-session-btn" title="Delete Session">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      `;

      div.addEventListener('click', () => {
        document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
        div.classList.add('active');
        loadSessionDialogue(session.sessionId, session.items);
        closeSidebarOnMobile();
      });

      const deleteBtn = div.querySelector('.delete-session-btn');
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('Are you sure you want to delete this session?')) {
          try {
            const response = await fetch(`/api/session/${encodeURIComponent(session.sessionId)}`, { method: 'DELETE' });
            if (response.ok) {
              if (currentSessionId === session.sessionId) {
                resetSession();
                clearChatThread();
              }
              loadHistory();
            }
          } catch (err) {
            console.error('Error deleting session:', err);
          }
        }
      });

      historyList.appendChild(div);
    });
  }

  function loadSessionDialogue(sId, items) {
    clearChatThread();
    welcomeContainer.classList.add('hidden');
    
    if (sId && !sId.startsWith('one-off-')) {
      setSessionId(sId);
    } else {
      resetSession();
    }

    items.forEach(item => {
      appendUserMessage(item.prompt);

      const agentDiv = document.createElement('div');
      agentDiv.className = 'message agent';
      const hasError = item.error && item.error.trim().length > 0;
      
      agentDiv.innerHTML = `
        <div class="message-label">Hermes Agent</div>
        <div class="message-bubble">
          <div class="console-stream">${marked.parse(item.output)}</div>
          <div class="bubble-error ${hasError ? '' : 'hidden'}">
            <div class="error-title" style="color:var(--error);font-size:0.75rem;font-weight:700;margin-bottom:6px;">Stderr Log:</div>
            <pre>${escapeHtml(item.error || '')}</pre>
          </div>
          <div class="message-meta">
            <div class="message-meta-left">
              <span class="meta-time">Timestamp: ${new Date(item.timestamp).toLocaleTimeString()}</span>
              <span class="separator">•</span>
              <span class="meta-code">Exit Code: ${item.code}</span>
            </div>
            <button class="icon-text-btn copy-bubble-btn">Copy</button>
          </div>
        </div>
      `;

      agentDiv.querySelectorAll('pre code').forEach((el) => {
        hljs.highlightElement(el);
      });

      const copyBtn = agentDiv.querySelector('.copy-bubble-btn');
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(item.output).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => copyBtn.textContent = 'Copy', 2000);
        });
      });

      chatMessages.appendChild(agentDiv);
    });
    scrollToBottom();
  }


  // ==========================================================================
  // KANBAN BOARD SYSTEM LOGIC
  // ==========================================================================

  let kanbanColumns = [];
  let kanbanCards = [];
  let kanbanPollInterval = null;
  let activeDetailCardId = null;
  let cardModalJustOpened = false;
  let workspaceAgents = [];
  
  // Project Workspace state
  let projectsList = [];

  // DOM Modals & Triggers
  const columnModal = document.getElementById('column-modal');
  const cardModal = document.getElementById('card-modal');
  const projectModal = document.getElementById('project-modal');
  const cardCreateModal = document.getElementById('card-create-modal');
  const agentsManagerModal = document.getElementById('agents-manager-modal');
  const addColumnBtn = document.getElementById('add-column-btn');

  // Project selector controls
  const projectSelect = document.getElementById('project-select');
  const projectAddBtn = document.getElementById('project-add-btn');
  const modalProjName = document.getElementById('modal-proj-name');
  const modalProjPath = document.getElementById('modal-proj-path');
  const modalProjSaveBtn = document.getElementById('modal-proj-save-btn');

  // Wire Modal Closers
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close-modal');
      closeModal(modalId);
    });
  });

  // Global closeModal helper
  function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
    if (id === 'card-modal') {
      activeDetailCardId = null;
    }
  }

  function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
  }

  // --- Project Management API Calls ---

  async function fetchProjects() {
    try {
      const response = await fetch('/api/projects');
      if (!response.ok) return;
      projectsList = await response.json();

      // Render projects dropdown options
      projectSelect.innerHTML = '';
      projectsList.forEach(proj => {
        const option = document.createElement('option');
        option.value = proj.id;
        option.textContent = proj.name;
        if (proj.id === currentProjectId) {
          option.selected = true;
        }
        projectSelect.appendChild(option);
      });

      // Verification: Make sure currentProjectId is registered
      const activeProjExists = projectsList.some(p => p.id === currentProjectId);
      if (!activeProjExists && projectsList.length > 0) {
        currentProjectId = projectsList[0].id;
        localStorage.setItem('kanban_current_project', currentProjectId);
        projectSelect.value = currentProjectId;
      }
    } catch (err) {
      console.error('Failed to fetch projects registry:', err);
    }
  }

  // --- Agent Management API Calls ---

  async function fetchWorkspaceAgents() {
    if (!currentProjectId) return;
    try {
      const response = await fetch(`/api/kanban/agents?projectId=${encodeURIComponent(currentProjectId)}`);
      if (!response.ok) return;
      workspaceAgents = await response.json();

      // Populate Card Details modal owner dropdown only if options changed
      const cardOwnerSelect = document.getElementById('modal-card-owner-select');
      if (cardOwnerSelect && cardOwnerSelect.children.length <= 2) {
        cardOwnerSelect.innerHTML = `
          <option value="unassigned">Unassigned</option>
          <option value="user">User</option>
        `;
        workspaceAgents.forEach(agent => {
          const option = document.createElement('option');
          option.value = agent.id;
          option.textContent = agent.name;
          cardOwnerSelect.appendChild(option);
        });
      }
    } catch (err) {
      console.error('Failed to fetch workspace agents:', err);
    }
  }

  // --- Project Scope API Calls ---
  let projectScopeData = {};

  async function fetchProjectScope() {
    if (!currentProjectId) return;
    try {
      const res = await fetch(`/api/kanban/scope?projectId=${encodeURIComponent(currentProjectId)}`);
      if (!res.ok) return;
      projectScopeData = await res.json();
      renderProjectScope();
    } catch (err) {
      console.error('Failed to fetch project scope:', err);
    }
  }

  function renderProjectScope() {
    const v = document.getElementById('scope-vision-text');
    const m = document.getElementById('scope-mission-text');
    const n = document.getElementById('scope-need-text');
    const w = document.getElementById('scope-want-text');
    const t = document.getElementById('scope-target-text');
    const lu = document.getElementById('scope-last-updated');

    if (v) v.textContent = projectScopeData.vision || '(Not defined yet)';
    if (m) m.textContent = projectScopeData.mission || '(Not defined yet)';
    if (n) n.textContent = projectScopeData.need || '(Not defined yet)';
    if (w) w.textContent = projectScopeData.want || '(Not defined yet)';
    if (t) t.textContent = projectScopeData.targetScope || '(Not defined yet)';
    if (lu && projectScopeData.lastUpdated) {
      lu.textContent = 'Updated ' + new Date(projectScopeData.lastUpdated).toLocaleTimeString();
    }
  }

  // Scope UI Event Listeners
  const scopeToggleBtn = document.getElementById('scope-toggle-btn');
  const scopeContentGrid = document.getElementById('scope-content-grid');
  const scopeEditBtn = document.getElementById('scope-edit-btn');
  const scopeAutoBtn = document.getElementById('scope-auto-btn');
  const modalScopeSaveBtn = document.getElementById('modal-scope-save-btn');

  if (scopeToggleBtn && scopeContentGrid) {
    scopeToggleBtn.addEventListener('click', () => {
      scopeContentGrid.classList.toggle('collapsed');
      scopeToggleBtn.textContent = scopeContentGrid.classList.contains('collapsed') ? '▲' : '▼';
    });
  }

  if (scopeEditBtn) {
    scopeEditBtn.addEventListener('click', () => {
      document.getElementById('modal-scope-vision').value = projectScopeData.vision || '';
      document.getElementById('modal-scope-mission').value = projectScopeData.mission || '';
      document.getElementById('modal-scope-need').value = projectScopeData.need || '';
      document.getElementById('modal-scope-want').value = projectScopeData.want || '';
      document.getElementById('modal-scope-target').value = projectScopeData.targetScope || '';
      openModal('scope-modal');
    });
  }

  if (modalScopeSaveBtn) {
    modalScopeSaveBtn.addEventListener('click', async () => {
      const vision = document.getElementById('modal-scope-vision').value.trim();
      const mission = document.getElementById('modal-scope-mission').value.trim();
      const need = document.getElementById('modal-scope-need').value.trim();
      const want = document.getElementById('modal-scope-want').value.trim();
      const targetScope = document.getElementById('modal-scope-target').value.trim();

      try {
        const res = await fetch(`/api/kanban/scope?projectId=${encodeURIComponent(currentProjectId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vision, mission, need, want, targetScope })
        });
        if (res.ok) {
          projectScopeData = await res.json();
          renderProjectScope();
          closeModal('scope-modal');
        }
      } catch (err) {
        console.error('Error saving project scope:', err);
      }
    });
  }

  if (scopeAutoBtn) {
    scopeAutoBtn.addEventListener('click', async () => {
      scopeAutoBtn.disabled = true;
      scopeAutoBtn.textContent = '⏳ AI Synthesizing...';
      try {
        const res = await fetch(`/api/kanban/scope/auto-update?projectId=${encodeURIComponent(currentProjectId)}`, {
          method: 'POST'
        });
        if (res.ok) {
          const data = await res.json();
          projectScopeData = data.scope;
          renderProjectScope();
        } else {
          alert('Failed to auto-update scope with AI.');
        }
      } catch (err) {
        console.error('Error auto-updating scope:', err);
      } finally {
        scopeAutoBtn.disabled = false;
        scopeAutoBtn.textContent = '🤖 AI Auto-Update Scope';
      }
    });
  }

  // --- Embedded Project Planner Chat Drawer Logic ---
  const projectChatToggleBtn = document.getElementById('project-chat-toggle-btn');
  const projectPlannerChatDrawer = document.getElementById('project-planner-chat-drawer');
  const plannerChatCloseBtn = document.getElementById('planner-chat-close-btn');
  const plannerChatMessages = document.getElementById('planner-chat-messages');
  const plannerChatInput = document.getElementById('planner-chat-input');
  const plannerChatSendBtn = document.getElementById('planner-chat-send-btn');
  const plannerPresetScope = document.getElementById('planner-preset-scope');
  const plannerPresetRecruit = document.getElementById('planner-preset-recruit');

  let currentPlannerSessionId = null;

  if (projectChatToggleBtn && projectPlannerChatDrawer) {
    projectChatToggleBtn.addEventListener('click', () => {
      projectPlannerChatDrawer.classList.toggle('hidden');
    });
  }

  if (plannerChatCloseBtn && projectPlannerChatDrawer) {
    plannerChatCloseBtn.addEventListener('click', () => {
      projectPlannerChatDrawer.classList.add('hidden');
    });
  }

  if (plannerPresetScope && plannerChatInput) {
    plannerPresetScope.addEventListener('click', () => {
      plannerChatInput.value = "Please analyze our current project scope and suggest updates for Vision, Mission, Need, Want, or Target Scope.";
      plannerChatInput.focus();
    });
  }

  if (plannerPresetRecruit && plannerChatInput) {
    plannerPresetRecruit.addEventListener('click', () => {
      plannerChatInput.value = "Analyze our project requirements and recommend appropriate specialized Agent roles to recruit for our team using [CREATE_AGENT: Role Name | System Prompt].";
      plannerChatInput.focus();
    });
  }

  async function sendPlannerMessage() {
    const text = plannerChatInput.value.trim();
    if (!text || !currentProjectId) return;

    plannerChatInput.value = '';

    // Append user bubble
    const userBubble = document.createElement('div');
    userBubble.className = 'planner-message user';
    userBubble.textContent = text;
    plannerChatMessages.appendChild(userBubble);

    // Append agent loading bubble
    const agentBubble = document.createElement('div');
    agentBubble.className = 'planner-message agent';
    agentBubble.innerHTML = '<span class="pulse-dot"></span> <em>Architect thinking...</em>';
    plannerChatMessages.appendChild(agentBubble);
    plannerChatMessages.scrollTop = plannerChatMessages.scrollHeight;

    // Build Architect system prompt context
    const activeProj = projectsList.find(p => p.id === currentProjectId) || { name: 'Current Project' };
    const teamRolesStr = workspaceAgents.map(a => `- **${a.name}**: ${a.prompt}`).join('\n');

    const fullPrompt = `
[SYSTEM INSTRUCTION: PROJECT ARCHITECT & TEAM RECRUITER AGENT]
You are the Senior Project Architect & Team Recruiter AI for the project workspace: "${activeProj.name}".
Your primary responsibilities are:
1. Help the user plan, analyze, and refine project Management Terms: Vision, Mission, Need, Want, and Target Scope.
2. Analyze project technical requirements and recruit appropriate team role agents into the workspace.

[CURRENT PROJECT SCOPE]
Vision: ${projectScopeData.vision || ''}
Mission: ${projectScopeData.mission || ''}
Need: ${projectScopeData.need || ''}
Want: ${projectScopeData.want || ''}
Target Scope: ${projectScopeData.targetScope || ''}

[CURRENT TEAM ROLES IN WORKSPACE]
${teamRolesStr}

[DIRECTIVE TAG INSTRUCTIONS]
If you agree with the user to update any project management term, you MUST output the corresponding directive tag:
- [SET_VISION: New Vision text]
- [SET_MISSION: New Mission text]
- [SET_NEED: New Need text]
- [SET_WANT: New Want text]
- [SET_TARGET_SCOPE: New Target Scope text]

If you recommend or recruit new team agent roles, you MUST output:
- [CREATE_AGENT: Role Name | System Prompt Defining Role Persona and Instructions]

[USER MESSAGE]
${text}
`;

    const plannerChatStopBtn = document.getElementById('planner-chat-stop-btn');
    if (plannerChatSendBtn) plannerChatSendBtn.classList.add('hidden');
    if (plannerChatStopBtn) plannerChatStopBtn.classList.remove('hidden');

    let url = `/api/run-stream?prompt=${encodeURIComponent(fullPrompt)}&projectId=${encodeURIComponent(currentProjectId)}`;
    if (currentPlannerSessionId) {
      url += `&sessionId=${encodeURIComponent(currentPlannerSessionId)}`;
    }

    if (window.activePlannerEventSource) window.activePlannerEventSource.close();
    const plannerEventSource = new EventSource(url);
    window.activePlannerEventSource = plannerEventSource;

    let plannerOutputText = '';

    plannerEventSource.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'session_id') {
        currentPlannerSessionId = data.sessionId;
      } else if (data.type === 'stdout') {
        if (plannerOutputText === '') agentBubble.innerHTML = '';
        plannerOutputText += data.chunk;
        agentBubble.innerHTML = marked.parse(plannerOutputText);
        plannerChatMessages.scrollTop = plannerChatMessages.scrollHeight;
      } else if (data.type === 'close') {
        plannerEventSource.close();
        window.activePlannerEventSource = null;
        if (plannerChatSendBtn) plannerChatSendBtn.classList.remove('hidden');
        if (plannerChatStopBtn) plannerChatStopBtn.classList.add('hidden');
        await fetchKanbanBoard();
        await fetchWorkspaceAgents();
        await fetchProjectScope();
      } else if (data.type === 'error') {
        plannerEventSource.close();
        window.activePlannerEventSource = null;
        agentBubble.innerHTML = `<span style="color:var(--error);">Error: ${escapeHtml(data.error)}</span>`;
        if (plannerChatSendBtn) plannerChatSendBtn.classList.remove('hidden');
        if (plannerChatStopBtn) plannerChatStopBtn.classList.add('hidden');
      }
    };
  }

  const plannerChatStopBtn = document.getElementById('planner-chat-stop-btn');
  if (plannerChatStopBtn) {
    plannerChatStopBtn.addEventListener('click', async () => {
      if (window.activePlannerEventSource) {
        window.activePlannerEventSource.close();
        window.activePlannerEventSource = null;
      }
      if (plannerChatSendBtn) plannerChatSendBtn.classList.remove('hidden');
      if (plannerChatStopBtn) plannerChatStopBtn.classList.add('hidden');
      try {
        await fetch('/api/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: currentProjectId })
        });
      } catch (err) {
        console.error('Failed to stop planner execution:', err);
      }
    });
  }

  if (plannerChatSendBtn) {
    plannerChatSendBtn.addEventListener('click', sendPlannerMessage);
  }

  if (plannerChatInput) {
    plannerChatInput.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendPlannerMessage();
      }
    });
  }

  // --- Full-Page Workspace Chat Subview Switching Logic ---
  const openFullChatBtn = document.getElementById('open-full-chat-btn');
  const backToBoardBtn = document.getElementById('back-to-board-btn');
  const kanbanBoardSubview = document.getElementById('kanban-board-subview');
  const kanbanChatSubview = document.getElementById('kanban-chat-subview');

  if (openFullChatBtn) {
    openFullChatBtn.addEventListener('click', () => {
      if (kanbanBoardSubview && kanbanChatSubview) {
        kanbanBoardSubview.classList.add('hidden');
        kanbanChatSubview.classList.remove('hidden');
        loadHistory();
      }
    });
  }

  if (backToBoardBtn) {
    backToBoardBtn.addEventListener('click', () => {
      if (kanbanBoardSubview && kanbanChatSubview) {
        kanbanChatSubview.classList.add('hidden');
        kanbanBoardSubview.classList.remove('hidden');
      }
    });
  }

  // Project selection change handler
  projectSelect.addEventListener('change', (e) => {
    currentProjectId = e.target.value;
    currentPlannerSessionId = null;
    currentWsSessionId = null;
    if (wsChatSessionBadge) wsChatSessionBadge.textContent = 'New Session';
    localStorage.setItem('kanban_current_project', currentProjectId);
    console.log(`Switching workspace project to: ${currentProjectId}`);
    
    // Clear card modal details if switching
    closeModal('card-modal');
    closeModal('column-modal');
    
    fetchProjectScope();
    lastKanbanFingerprint = '';
    fetchKanbanBoard(true);
  });

  // Open Project Modal
  projectAddBtn.addEventListener('click', () => {
    modalProjName.value = '';
    modalProjPath.value = '';
    openModal('project-modal');
  });

  // Save new Project Workspace
  modalProjSaveBtn.addEventListener('click', async () => {
    const name = modalProjName.value.trim();
    const path = modalProjPath.value.trim();

    if (!name || !path) {
      return alert('Project name and directory path are required.');
    }

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, path })
      });

      const data = await response.json();

      if (response.ok) {
        closeModal('project-modal');
        currentProjectId = data.id;
        localStorage.setItem('kanban_current_project', currentProjectId);
        
        await fetchProjects();
        await fetchKanbanBoard();
      } else {
        alert(`Error: ${data.error || 'Failed to create project'}`);
      }
    } catch (err) {
      console.error('Error creating project:', err);
      alert('Failed to register project due to network error.');
    }
  });

  // Project Edit modal controls
  const projectEditBtn = document.getElementById('project-edit-btn');
  const modalEditProjId = document.getElementById('modal-edit-proj-id');
  const modalEditProjName = document.getElementById('modal-edit-proj-name');
  const modalEditProjPath = document.getElementById('modal-edit-proj-path');
  const modalEditProjSaveBtn = document.getElementById('modal-edit-proj-save-btn');
  const modalEditProjDeleteBtn = document.getElementById('modal-edit-proj-delete-btn');

  projectEditBtn.addEventListener('click', () => {
    const activeProj = projectsList.find(p => p.id === currentProjectId);
    if (!activeProj) return;

    modalEditProjId.value = activeProj.id;
    modalEditProjName.value = activeProj.name;
    modalEditProjPath.value = activeProj.path;

    if (activeProj.id === 'proj-default') {
      modalEditProjDeleteBtn.style.display = 'none';
    } else {
      modalEditProjDeleteBtn.style.display = 'block';
    }

    openModal('project-edit-modal');
  });

  modalEditProjSaveBtn.addEventListener('click', async () => {
    const id = modalEditProjId.value;
    const name = modalEditProjName.value.trim();
    const path = modalEditProjPath.value.trim();

    if (!name || !path) {
      return alert('Project name and directory path are required.');
    }

    try {
      const response = await fetch(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, path })
      });

      const data = await response.json();

      if (response.ok) {
        closeModal('project-edit-modal');
        await fetchProjects();
        await fetchKanbanBoard();
      } else {
        alert(`Error: ${data.error || 'Failed to update project'}`);
      }
    } catch (err) {
      console.error('Error updating project:', err);
      alert('Failed to update project due to network error.');
    }
  });

  modalEditProjDeleteBtn.addEventListener('click', async () => {
    const id = modalEditProjId.value;
    if (confirm('Are you sure you want to remove this project from the registry? Custom files inside its directory will not be deleted.')) {
      try {
        const response = await fetch(`/api/projects/${id}`, {
          method: 'DELETE'
        });
        if (response.ok) {
          closeModal('project-edit-modal');
          currentProjectId = 'proj-default';
          localStorage.setItem('kanban_current_project', currentProjectId);
          await fetchProjects();
          await fetchKanbanBoard();
        } else {
          const data = await response.json();
          alert(`Error: ${data.error || 'Failed to delete project'}`);
        }
      } catch (err) {
        console.error('Error deleting project:', err);
      }
    }
  });

  // --- Kanban Database Calls (scoped by currentProjectId) ---
  let lastKanbanFingerprint = '';
  let showActiveOnly = false;

  async function fetchKanbanBoard(force = false) {
    if (!currentProjectId) return;
    try {
      await fetchWorkspaceAgents();
      await fetchProjectScope();
      const response = await fetch(`/api/kanban?projectId=${encodeURIComponent(currentProjectId)}`);
      if (!response.ok) return;
      const data = await response.json();
      
      const newColumns = data.columns || [];
      const newCards = data.cards || [];
      const newFingerprint = JSON.stringify({ columns: newColumns, cards: newCards });
      const hasChanged = (newFingerprint !== lastKanbanFingerprint);

      if (hasChanged || force) {
        lastKanbanFingerprint = newFingerprint;
        kanbanColumns = newColumns;
        kanbanCards = newCards;
        
        renderKanbanBoard();
        
        // If card detail modal is open, re-render it to show progress in real-time
        if (activeDetailCardId) {
          const activeCard = kanbanCards.find(c => c.id === activeDetailCardId);
          if (activeCard) {
            renderCardDetails(activeCard);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch Kanban board:', err);
    }
  }

  function startKanbanPolling() {
    stopKanbanPolling();
    // Poll board status for the active project
    kanbanPollInterval = setInterval(fetchKanbanBoard, 3000);
  }

  function stopKanbanPolling() {
    if (kanbanPollInterval) {
      clearInterval(kanbanPollInterval);
      kanbanPollInterval = null;
    }
  }

  // Add Column Button handler
  addColumnBtn.addEventListener('click', () => {
    modalColId.value = '';
    modalColName.value = '';
    modalColAgentEnabled.checked = false;
    modalColPrompt.value = '';
    modalColPromptContainer.classList.add('hidden');
    document.getElementById('column-modal-title').textContent = 'Create New Column';
    document.getElementById('modal-col-delete-btn').style.display = 'none';
    openModal('column-modal');
  });

  // --- Render Kanban Board UI ---

  function renderKanbanBoard() {
    const board = document.getElementById('kanban-board');
    
    // Capture existing column scroll positions before rebuilding
    const scrollPosMap = {};
    document.querySelectorAll('.kanban-cards-container').forEach(cnt => {
      const colId = cnt.getAttribute('data-column-id');
      if (colId) scrollPosMap[colId] = cnt.scrollTop;
    });

    board.innerHTML = '';

    kanbanColumns.forEach(column => {
      const colDiv = document.createElement('div');
      const isMeeting = column.isMeetingRoom || column.name === 'Meeting Room' || column.name.toLowerCase().includes('meeting');
      colDiv.className = 'kanban-column' + (isMeeting ? ' meeting-column' : '');
      colDiv.id = column.id;
      colDiv.draggable = true;

      colDiv.addEventListener('dragstart', (e) => {
        if (e.target.closest('.kanban-cards-container')) {
          return;
        }
        colDiv.classList.add('dragging-column');
        e.dataTransfer.setData('text/column-id', column.id);
        e.stopPropagation();
      });

      colDiv.addEventListener('dragend', () => {
        colDiv.classList.remove('dragging-column');
      });
      
      // Filter cards for this column
      const colCards = kanbanCards.filter(card => card.columnId === column.id && (!showActiveOnly || card.isProcessing || card.isQueued));

      colDiv.innerHTML = `
        <div class="kanban-column-header">
          <div class="column-title-group">
            <h3>${escapeHtml(column.name)}</h3>
            ${column.agentEnabled ? '<span class="column-agent-badge">Agent</span>' : ''}
          </div>
          <div class="column-header-actions">
            <button class="col-settings-btn" title="Configure Group">⚙️</button>
          </div>
        </div>
        <div class="kanban-cards-container" data-column-id="${column.id}">
          <!-- Cards go here -->
        </div>
        <div class="add-card-btn-container">
          <button class="add-card-btn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            <span>Add Card</span>
          </button>
        </div>
      `;

      // Render Cards in Container
      const cardsContainer = colDiv.querySelector('.kanban-cards-container');
      
      colCards.forEach(card => {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'kanban-card';
        cardDiv.draggable = true;
        cardDiv.id = card.id;

        const commentsCount = card.comments ? card.comments.length : 0;
        let processingHtml = '';
        if (card.isProcessing) {
          processingHtml = `<span class="card-processing-badge"><span class="pulse-dot"></span><span>Running...</span></span>`;
        } else if (card.isQueued) {
          processingHtml = `<span class="card-queued-badge"><span class="pulse-dot-amber"></span><span>⏳ Queued...</span></span>`;
        }

        const summaryHtml = card.agentSummary
          ? `<div class="kanban-card-summary ${card.agentSummary.toLowerCase().startsWith('error') ? 'error' : ''}">
              <span class="summary-label">Result:</span>
              <span class="summary-text">${escapeHtml(card.agentSummary)}</span>
             </div>`
          : '';

        const budgetBadge = (isMeeting || (card.meetingRounds && card.meetingRounds > 0))
          ? `<span style="font-size:0.7rem; color:var(--warning); margin-left:6px;">💬 ${card.meetingRounds || 0}/${card.maxBudget || 10}</span>`
          : '';
        const subcardBadge = (card.subCardIds && card.subCardIds.length > 0)
          ? `<span style="font-size:0.7rem; color:var(--primary); margin-left:6px;">📌 ${card.subCardIds.length}</span>`
          : '';

        // Dropdown move choices (touch support)
        let moveOptionsHtml = `<option value="" disabled selected>Move...</option>`;
        kanbanColumns.forEach(c => {
          if (c.id !== column.id) {
            moveOptionsHtml += `<option value="${c.id}">${c.name}</option>`;
          }
        });

        let ownerName = 'Unassigned';
        if (card.owner === 'user') ownerName = 'User';
        else if (card.owner && workspaceAgents) {
          const ag = workspaceAgents.find(a => a.id === card.owner);
          if (ag) ownerName = ag.name;
        }

        const isRunningOrQueued = card.isProcessing || card.isQueued;
        const execBtnHtml = isRunningOrQueued
          ? `<button class="grid-card-exec-btn grid-stop-btn" title="Stop Execution">⏹️</button>`
          : `<button class="grid-card-exec-btn grid-start-btn" title="Start Task Execution">▶️</button>`;

        cardDiv.innerHTML = `
          <div class="grid-card-actions">
            ${execBtnHtml}
            <div class="mobile-card-move-wrapper" title="Move Card to Column">
              <span class="mobile-card-move-icon">🔄</span>
              <select class="mobile-card-move-select" data-card-id="${card.id}">
                ${moveOptionsHtml}
              </select>
            </div>
          </div>
          <div class="kanban-card-title" style="padding-right: 48px;">${escapeHtml(card.title)}</div>
          <div class="kanban-card-desc">${escapeHtml(card.description || 'No description.')}</div>
          ${summaryHtml}
          <div class="kanban-card-footer">
            <span class="card-footer-comments">💬 ${commentsCount}${budgetBadge}${subcardBadge}</span>
            <span class="card-footer-status">${processingHtml}</span>
          </div>
        `;

        const gridExecBtn = cardDiv.querySelector('.grid-card-exec-btn');
        if (gridExecBtn) {
          gridExecBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (isRunningOrQueued) {
              try {
                gridExecBtn.disabled = true;
                await fetch('/api/stop', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ projectId: currentProjectId, cardId: card.id })
                });
                fetchKanbanBoard();
              } catch (err) { console.error('Failed to stop task:', err); }
            } else {
              try {
                gridExecBtn.disabled = true;
                await fetch(`/api/kanban/cards/${card.id}/restart?projectId=${encodeURIComponent(currentProjectId)}`, {
                  method: 'POST'
                });
                fetchKanbanBoard();
              } catch (err) { console.error('Failed to start task:', err); }
            }
          });
        }

        // Click to open details
        cardDiv.addEventListener('click', (e) => {
          if (e.target.classList.contains('mobile-card-move-select') || e.target.closest('.grid-card-actions')) return;
          openCardDetailModal(card);
        });

        // Wire mobile move dropdown
        const moveSelect = cardDiv.querySelector('.mobile-card-move-select');
        moveSelect.addEventListener('change', async (e) => {
          const targetColId = e.target.value;
          if (targetColId) {
            await moveCard(card.id, targetColId);
          }
        });

        // HTML5 Drag Event Listeners
        cardDiv.addEventListener('dragstart', (e) => {
          cardDiv.classList.add('dragging');
          e.dataTransfer.setData('text/plain', card.id);
          e.dataTransfer.setData('text/card-id', card.id);
        });

        cardDiv.addEventListener('dragend', () => {
          cardDiv.classList.remove('dragging');
        });

        cardsContainer.appendChild(cardDiv);
      });

      // Column dragover/leave/drop handlers (for column reordering)
      colDiv.addEventListener('dragover', (e) => {
        if (e.dataTransfer.types.includes('text/column-id')) {
          e.preventDefault();
          colDiv.classList.add('dragover');
        }
      });

      colDiv.addEventListener('dragleave', () => {
        colDiv.classList.remove('dragover');
      });

      colDiv.addEventListener('drop', async (e) => {
        const draggedColId = e.dataTransfer.getData('text/column-id');
        if (draggedColId && draggedColId !== column.id) {
          e.preventDefault();
          colDiv.classList.remove('dragover');
          
          // Reorder array
          const colIds = kanbanColumns.map(c => c.id);
          const fromIndex = colIds.indexOf(draggedColId);
          const toIndex = colIds.indexOf(column.id);
          
          colIds.splice(toIndex, 0, colIds.splice(fromIndex, 1)[0]);
          await reorderColumns(colIds);
        }
      });

      // Cards drop targets (highlight column only when card is dragged over cards container)
      cardsContainer.addEventListener('dragover', (e) => {
        if (e.dataTransfer.types.includes('text/card-id') || e.dataTransfer.types.includes('text/plain')) {
          e.preventDefault();
          colDiv.classList.add('dragover');
        }
      });

      cardsContainer.addEventListener('dragleave', () => {
        colDiv.classList.remove('dragover');
      });

      cardsContainer.addEventListener('drop', async (e) => {
        const cardId = e.dataTransfer.getData('text/card-id') || e.dataTransfer.getData('text/plain');
        if (cardId) {
          e.preventDefault();
          colDiv.classList.remove('dragover');
          await moveCard(cardId, column.id);
        }
      });

      // Header actions (Column Config)
      colDiv.querySelector('.col-settings-btn').addEventListener('click', () => {
        openColumnConfigModal(column);
      });

      // Bottom action (Add Card)
      colDiv.querySelector('.add-card-btn').addEventListener('click', () => {
        modalCreateCardColId.value = column.id;
        modalCreateCardTitle.value = '';
        modalCreateCardDesc.value = '';
        openModal('card-create-modal');
      });

      board.appendChild(colDiv);
    });

    // Restore column scroll positions after rebuilding
    document.querySelectorAll('.kanban-cards-container').forEach(cnt => {
      const colId = cnt.getAttribute('data-column-id');
      if (colId && scrollPosMap[colId] !== undefined) {
        cnt.scrollTop = scrollPosMap[colId];
      }
    });
  }

  // Move Card API helper
  async function moveCard(cardId, targetColumnId) {
    try {
      const response = await fetch(`/api/kanban/cards/${cardId}/move?projectId=${encodeURIComponent(currentProjectId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnId: targetColumnId })
      });
      if (response.ok) {
        fetchKanbanBoard();
      }
    } catch (err) {
      console.error('Error moving card:', err);
    }
  }

  // Reorder Columns API helper
  async function reorderColumns(columnIds) {
    try {
      const response = await fetch(`/api/kanban/columns/reorder?projectId=${encodeURIComponent(currentProjectId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnIds })
      });
      if (response.ok) {
        fetchKanbanBoard();
      }
    } catch (err) {
      console.error('Error reordering columns:', err);
    }
  }

  // --- Column Settings Modal Logic ---

  const modalColId = document.getElementById('modal-col-id');
  const modalColName = document.getElementById('modal-col-name');
  const modalColAgentEnabled = document.getElementById('modal-col-agent-enabled');
  const modalColPrompt = document.getElementById('modal-col-prompt');
  const modalColPromptContainer = document.getElementById('modal-col-prompt-container');
  const modalColSaveBtn = document.getElementById('modal-col-save-btn');
  const modalColDeleteBtn = document.getElementById('modal-col-delete-btn');

  // Toggle prompt template field
  modalColAgentEnabled.addEventListener('change', () => {
    if (modalColAgentEnabled.checked) {
      modalColPromptContainer.classList.remove('hidden');
    } else {
      modalColPromptContainer.classList.add('hidden');
    }
  });

  function openColumnConfigModal(column) {
    document.getElementById('column-modal-title').textContent = 'Column Configuration';
    document.getElementById('modal-col-delete-btn').style.display = 'block';

    modalColId.value = column.id;
    modalColName.value = column.name;
    modalColAgentEnabled.checked = column.agentEnabled;
    modalColPrompt.value = column.agentPrompt || '';

    if (column.agentEnabled) {
      modalColPromptContainer.classList.remove('hidden');
    } else {
      modalColPromptContainer.classList.add('hidden');
    }

    openModal('column-modal');
  }

  modalColSaveBtn.addEventListener('click', async () => {
    const id = modalColId.value;
    const name = modalColName.value.trim();
    const agentEnabled = modalColAgentEnabled.checked;
    const agentPrompt = modalColPrompt.value.trim();

    if (!name) return alert('Column name is required');

    try {
      const url = id 
        ? `/api/kanban/columns/${id}?projectId=${encodeURIComponent(currentProjectId)}`
        : `/api/kanban/columns?projectId=${encodeURIComponent(currentProjectId)}`;
      const method = id ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, agentEnabled, agentPrompt })
      });
      if (response.ok) {
        closeModal('column-modal');
        fetchKanbanBoard();
      }
    } catch (err) {
      console.error('Error saving column config:', err);
    }
  });

  modalColDeleteBtn.addEventListener('click', async () => {
    const id = modalColId.value;
    if (confirm('Are you sure you want to delete this column? Cards in this column will be moved to the first column.')) {
      try {
        const response = await fetch(`/api/kanban/columns/${id}?projectId=${encodeURIComponent(currentProjectId)}`, {
          method: 'DELETE'
        });
        if (response.ok) {
          closeModal('column-modal');
          fetchKanbanBoard();
        }
      } catch (err) {
        console.error('Error deleting column:', err);
      }
    }
  });

  // --- Card Detail Modal Logic ---
  const cardModalBox = document.querySelector('.card-detail-modal');
  const modalColIdField = document.getElementById('modal-card-id-label');
  const modalCardIdLabel = document.getElementById('modal-card-id-label');
  const modalCardTitleText = document.getElementById('modal-card-title-text');
  const modalCardDescInput = document.getElementById('modal-card-desc-input');
  const cardModalProcessingIndicator = document.getElementById('card-modal-processing-indicator');
  const modalCardCommentsList = document.getElementById('modal-card-comments-list');
  const modalNewCommentInput = document.getElementById('modal-new-comment-input');
  const modalAddCommentBtn = document.getElementById('modal-add-comment-btn');
  const modalCardColumnSelect = document.getElementById('modal-card-column-select');
  const modalCardSessionBadge = document.getElementById('modal-card-session-badge');
  const modalCardDeleteBtn = document.getElementById('modal-card-delete-btn');
  const modalCardStopExecutionBtn = document.getElementById('modal-card-stop-execution-btn');

  if (modalCardStopExecutionBtn) {
    modalCardStopExecutionBtn.addEventListener('click', async () => {
      if (!activeDetailCardId || !currentProjectId) return;
      try {
        await fetch('/api/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: currentProjectId, cardId: activeDetailCardId })
        });
        await fetchKanbanBoard();
      } catch (err) {
        console.error('Failed to stop card execution:', err);
      }
    });
  }

  // Card Modal 3D Flip Stream Controls
  const modalCardFlipStreamBtn = document.getElementById('modal-card-flip-stream-btn');
  const modalStreamBackBtn = document.getElementById('modal-stream-back-btn');
  const modalStreamStopBtn = document.getElementById('modal-stream-stop-btn');
  const modalCardStreamText = document.getElementById('modal-card-stream-text');
  let modalStreamEventSource = null;

  const startModalLiveStream = () => {
    if (!activeDetailCardId) return;
    if (cardModalBox) cardModalBox.classList.add('show-stream');
    if (modalStreamEventSource) modalStreamEventSource.close();
    if (modalCardStreamText) modalCardStreamText.textContent = 'Connecting agent live stream...\n';

    modalStreamEventSource = new EventSource(`/api/kanban/cards/${activeDetailCardId}/stream`);
    modalStreamEventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.chunk) {
          if (modalCardStreamText.textContent.includes('Connecting')) {
            modalCardStreamText.textContent = '';
          }
          modalCardStreamText.textContent += data.chunk;
          const container = modalCardStreamText.parentElement;
          if (container) container.scrollTop = container.scrollHeight;
        }
        if (data.done) {
          if (modalStreamEventSource) {
            modalStreamEventSource.close();
            modalStreamEventSource = null;
          }
        }
      } catch(err) {
        console.error('Error parsing modal stream chunk:', err);
      }
    };
    modalStreamEventSource.onerror = () => {
      if (modalCardStreamText && modalCardStreamText.textContent.includes('Connecting')) {
        modalCardStreamText.textContent = 'No active live stream running. (Click "Restart Task" to launch execution stream)';
      }
      if (modalStreamEventSource) {
        modalStreamEventSource.close();
        modalStreamEventSource = null;
      }
    };
  };

  if (modalCardFlipStreamBtn) {
    modalCardFlipStreamBtn.addEventListener('click', () => {
      startModalLiveStream();
    });
  }

  if (cardModalProcessingIndicator) {
    cardModalProcessingIndicator.style.cursor = 'pointer';
    cardModalProcessingIndicator.addEventListener('click', (e) => {
      if (e.target.id === 'modal-card-stop-execution-btn') return;
      startModalLiveStream();
    });
  }

  if (modalStreamBackBtn) {
    modalStreamBackBtn.addEventListener('click', () => {
      if (modalStreamEventSource) {
        modalStreamEventSource.close();
        modalStreamEventSource = null;
      }
      if (cardModalBox) cardModalBox.classList.remove('show-stream');
    });
  }

  const modalCardRestartTaskBtn = document.getElementById('modal-card-restart-task-btn');
  const modalStreamRestartBtn = document.getElementById('modal-stream-restart-btn');

  const restartActiveCardTask = async (btnEl) => {
    if (!activeDetailCardId || !currentProjectId) return;
    try {
      if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Restarting...'; }
      await fetch(`/api/kanban/cards/${activeDetailCardId}/restart?projectId=${encodeURIComponent(currentProjectId)}`, {
        method: 'POST'
      });
      startModalLiveStream();
      await fetchKanbanBoard();
    } catch(err) {
      console.error('Error restarting card task:', err);
    } finally {
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = '🔄 Restart Task'; }
    }
  };

  if (modalCardRestartTaskBtn) {
    modalCardRestartTaskBtn.addEventListener('click', () => restartActiveCardTask(modalCardRestartTaskBtn));
  }
  if (modalStreamRestartBtn) {
    modalStreamRestartBtn.addEventListener('click', () => restartActiveCardTask(modalStreamRestartBtn));
  }

  if (modalStreamStopBtn) {
    modalStreamStopBtn.addEventListener('click', async () => {
      if (!activeDetailCardId || !currentProjectId) return;
      try {
        modalStreamStopBtn.disabled = true;
        modalStreamStopBtn.textContent = 'Stopping...';
        await fetch('/api/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: currentProjectId, cardId: activeDetailCardId })
        });
        if (modalCardStreamText) modalCardStreamText.textContent += '\n\n⏹️ Task execution stopped by user.\n';
        fetchKanbanBoard();
      } catch(err) {
        console.error('Error stopping card task in modal:', err);
      } finally {
        modalStreamStopBtn.disabled = false;
        modalStreamStopBtn.textContent = '⏹️ Stop Execution';
      }
    });
  }

  // Card Owner & Watchers Bindings
  const modalCardOwnerSelect = document.getElementById('modal-card-owner-select');
  const modalCardWatchersList = document.getElementById('modal-card-watchers-list');

  function openCardDetailModal(card) {
    activeDetailCardId = card.id;
    cardModalJustOpened = true;
    if (cardModalBox) cardModalBox.classList.remove('show-stream');
    renderCardDetails(card);
    openModal('card-modal');
  }

  function renderCardDetails(card) {
    modalCardIdLabel.textContent = card.id.toUpperCase();
    modalCardTitleText.textContent = card.title;
    modalCardDescInput.value = card.description || '';
    modalCardSessionBadge.textContent = card.sessionId || 'None';

    const statusSpan = cardModalProcessingIndicator ? cardModalProcessingIndicator.querySelector('span:not(.pulse-dot)') : null;
    if (card.isProcessing) {
      cardModalProcessingIndicator.classList.remove('hidden');
      if (statusSpan) statusSpan.textContent = 'Agent is currently executing this card...';
    } else if (card.isQueued || (card.agentSummary && card.agentSummary.includes('Queued'))) {
      cardModalProcessingIndicator.classList.remove('hidden');
      if (statusSpan) statusSpan.textContent = '⏳ Task is queued in execution pipeline (waiting for slot)...';
    } else {
      cardModalProcessingIndicator.classList.add('hidden');
    }

    // Set Owner selection
    modalCardOwnerSelect.value = card.owner || 'unassigned';

    // Populate Watchers list
    modalCardWatchersList.innerHTML = '';
    workspaceAgents.forEach(agent => {
      const itemDiv = document.createElement('div');
      itemDiv.style.display = 'flex';
      itemDiv.style.alignItems = 'center';
      itemDiv.style.gap = '8px';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = agent.id;
      checkbox.checked = card.watchers && card.watchers.includes(agent.id);

      const label = document.createElement('span');
      label.style.fontSize = '0.85rem';
      label.style.color = '#fff';
      label.textContent = agent.name;

      checkbox.addEventListener('change', async () => {
        const currentWatchers = Array.from(modalCardWatchersList.querySelectorAll('input[type="checkbox"]:checked'))
          .map(cb => cb.value);
        await updateCardFields(card.id, { watchers: currentWatchers });
      });

      itemDiv.appendChild(checkbox);
      itemDiv.appendChild(label);
      modalCardWatchersList.appendChild(itemDiv);
    });

    // Populate Meeting Budget Status
    const budgetStatusSpan = document.getElementById('modal-card-budget-status');
    if (budgetStatusSpan) {
      budgetStatusSpan.textContent = `${card.meetingRounds || 0} / ${card.maxBudget || 10} rounds`;
    }

    // Render Parent Card Link
    const parentLinkContainer = document.getElementById('modal-card-parent-link');
    if (parentLinkContainer) {
      if (card.parentCardId) {
        const parentCard = kanbanCards.find(c => c.id === card.parentCardId);
        parentLinkContainer.innerHTML = `<span style="color:var(--text-muted);">Parent:</span> <a href="#" id="parent-card-click-link" style="color:var(--secondary); font-weight:600; text-decoration:underline;">${parentCard ? escapeHtml(parentCard.title) : card.parentCardId}</a>`;
        const pLink = document.getElementById('parent-card-click-link');
        if (pLink) {
          pLink.addEventListener('click', (e) => {
            e.preventDefault();
            if (parentCard) openCardDetailModal(parentCard);
          });
        }
      } else {
        parentLinkContainer.innerHTML = '<span style="color:var(--text-muted); font-size:0.78rem;">None (Standalone Task)</span>';
      }
    }

    // Render Subcards List
    const subcardsContainer = document.getElementById('modal-card-subcards-list');
    if (subcardsContainer) {
      subcardsContainer.innerHTML = '';
      if (card.subCardIds && card.subCardIds.length > 0) {
        card.subCardIds.forEach(subId => {
          const subCard = kanbanCards.find(c => c.id === subId);
          const itemDiv = document.createElement('div');
          itemDiv.className = 'subcard-link-item';
          const subCol = subCard ? kanbanColumns.find(col => col.id === subCard.columnId) : null;
          itemDiv.innerHTML = `<span>📌 ${subCard ? escapeHtml(subCard.title) : subId}</span><span style="font-size:0.7rem; color:var(--text-muted);">${subCol ? subCol.name : ''}</span>`;
          itemDiv.addEventListener('click', () => {
            if (subCard) openCardDetailModal(subCard);
          });
          subcardsContainer.appendChild(itemDiv);
        });
      } else {
        subcardsContainer.innerHTML = '<div style="font-size:0.78rem; color:var(--text-muted);">No sub-tasks yet.</div>';
      }
    }

    // Load columns dropdown list
    modalCardColumnSelect.innerHTML = '';
    kanbanColumns.forEach(col => {
      const option = document.createElement('option');
      option.value = col.id;
      option.textContent = col.name;
      if (col.id === card.columnId) {
        option.selected = true;
      }
      modalCardColumnSelect.appendChild(option);
    });

    // Render Comments (Incremental DOM diffing approach)
    const emptyState = modalCardCommentsList.querySelector('.text-muted');
    const renderedBubbles = modalCardCommentsList.querySelectorAll('.comment-bubble');

    if (cardModalJustOpened || emptyState || !card.comments || card.comments.length === 0 || card.comments.length < renderedBubbles.length) {
      // Full re-render
      modalCardCommentsList.innerHTML = '';
      if (!card.comments || card.comments.length === 0) {
        modalCardCommentsList.innerHTML = '<div class="text-muted" style="font-size:0.85rem;text-align:center;padding:20px;">No comments or agent replies yet.</div>';
      } else {
        card.comments.forEach(comment => {
          appendCommentBubble(comment);
        });
        modalCardCommentsList.scrollTop = modalCardCommentsList.scrollHeight;
      }
    } else if (card.comments.length > renderedBubbles.length) {
      // Incremental render of only new comments
      const newComments = card.comments.slice(renderedBubbles.length);
      newComments.forEach(comment => {
        appendCommentBubble(comment);
      });
      modalCardCommentsList.scrollTop = modalCardCommentsList.scrollHeight;
    }
    // If card.comments.length === renderedBubbles.length, we do absolutely nothing!
    cardModalJustOpened = false;
    initMentionAutocomplete();
  }

  // Budget Reset & Add Subcard Button Listeners
  const resetBudgetBtn = document.getElementById('modal-card-reset-budget-btn');
  if (resetBudgetBtn) {
    resetBudgetBtn.addEventListener('click', async () => {
      if (activeDetailCardId) {
        await updateCardFields(activeDetailCardId, { meetingRounds: 0 });
        fetchKanbanBoard();
      }
    });
  }

  const reassignBtn = document.getElementById('modal-card-reassign-btn');
  if (reassignBtn) {
    reassignBtn.addEventListener('click', async () => {
      if (!activeDetailCardId) return;
      try {
        reassignBtn.disabled = true;
        reassignBtn.textContent = "⏳ Analyzing...";
        await fetch(`/api/kanban/cards/${activeDetailCardId}/reevaluate?projectId=${encodeURIComponent(currentProjectId)}`, {
          method: 'POST'
        });
        await fetchKanbanBoard();
      } catch (err) {
        console.error('Error re-evaluating roles:', err);
      } finally {
        reassignBtn.disabled = false;
        reassignBtn.textContent = "🤖 Auto-Assign Roles";
      }
    });
  }

  const addSubcardBtn = document.getElementById('modal-card-add-subcard-btn');
  if (addSubcardBtn) {
    addSubcardBtn.addEventListener('click', async () => {
      if (!activeDetailCardId) return;
      const title = prompt("Enter sub-task title:");
      if (!title || !title.trim()) return;
      const description = prompt("Enter sub-task description (optional):") || "";
      try {
        const response = await fetch(`/api/kanban/cards/${activeDetailCardId}/subcards?projectId=${encodeURIComponent(currentProjectId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), description: description.trim() })
        });
        if (response.ok) {
          fetchKanbanBoard();
        }
      } catch (err) {
        console.error('Error creating subcard:', err);
      }
    });
  }

  // Helper to append a single comment bubble
  function appendCommentBubble(comment) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'comment-bubble';
    
    const timestampStr = new Date(comment.timestamp).toLocaleString();
    const isAgent = comment.author.includes('Agent');
    const authorStyle = isAgent ? 'color: var(--secondary); font-weight: 700;' : 'color: var(--text-secondary);';
    
    itemDiv.innerHTML = `
      <div class="comment-header">
        <span class="comment-author" style="${authorStyle}">${escapeHtml(comment.author)}</span>
        <span class="comment-time">${timestampStr}</span>
      </div>
      <div class="comment-text">${marked.parse(comment.text)}</div>
    `;
    
    itemDiv.querySelectorAll('pre code').forEach(el => {
      hljs.highlightElement(el);
    });

    modalCardCommentsList.appendChild(itemDiv);
  }

  // Save Card title changes on blur/enter
  modalCardTitleText.addEventListener('blur', async () => {
    const newTitle = modalCardTitleText.textContent.trim();
    if (!newTitle) return;
    await updateCardFields(activeDetailCardId, { title: newTitle });
  });

  modalCardTitleText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      modalCardTitleText.blur();
    }
  });

  // Save Card description changes on blur
  modalCardDescInput.addEventListener('blur', async () => {
    const newDesc = modalCardDescInput.value.trim();
    await updateCardFields(activeDetailCardId, { description: newDesc });
  });

  async function updateCardFields(cardId, fields) {
    if (!cardId) return;
    try {
      const response = await fetch(`/api/kanban/cards/${cardId}?projectId=${encodeURIComponent(currentProjectId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
      });
      if (response.ok) {
        fetchKanbanBoard();
      }
    } catch (err) {
      console.error('Error updating card fields:', err);
    }
  }

  // Handle manual column select move from details
  modalCardColumnSelect.addEventListener('change', async (e) => {
    const targetColId = e.target.value;
    if (activeDetailCardId && targetColId) {
      await moveCard(activeDetailCardId, targetColId);
    }
  });

  // Add Manual Comment button
  modalAddCommentBtn.addEventListener('click', async () => {
    const text = modalNewCommentInput.value.trim();
    if (!text || !activeDetailCardId) return;

    try {
      const response = await fetch(`/api/kanban/cards/${activeDetailCardId}/comments?projectId=${encodeURIComponent(currentProjectId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: 'User',
          text: text
        })
      });
      if (response.ok) {
        modalNewCommentInput.value = '';
        fetchKanbanBoard();
      }
    } catch (err) {
      console.error('Error posting comment:', err);
    }
  });

  // Handle Card Owner Change
  modalCardOwnerSelect.addEventListener('change', async (e) => {
    const owner = e.target.value;
    if (activeDetailCardId) {
      await updateCardFields(activeDetailCardId, { owner });
      fetchKanbanBoard();
    }
  });

  // Archive / Delete Card
  modalCardDeleteBtn.addEventListener('click', async () => {
    if (activeDetailCardId && confirm('Are you sure you want to delete/archive this card?')) {
      try {
        const response = await fetch(`/api/kanban/cards/${activeDetailCardId}?projectId=${encodeURIComponent(currentProjectId)}`, {
          method: 'DELETE'
        });
        if (response.ok) {
          closeModal('card-modal');
          fetchKanbanBoard();
        }
      } catch (err) {
        console.error('Error deleting card:', err);
      }
    }
  });


  // Card Create Modal Controls
  const modalCreateCardColId = document.getElementById('modal-create-card-col-id');
  const modalCreateCardTitle = document.getElementById('modal-create-card-title');
  const modalCreateCardDesc = document.getElementById('modal-create-card-desc');
  const modalCreateCardSaveBtn = document.getElementById('modal-create-card-save-btn');

  modalCreateCardSaveBtn.addEventListener('click', async () => {
    const columnId = modalCreateCardColId.value;
    const title = modalCreateCardTitle.value.trim();
    const description = modalCreateCardDesc.value.trim();

    if (!title) {
      return alert('Card title is required.');
    }

    try {
      const response = await fetch(`/api/kanban/cards?projectId=${encodeURIComponent(currentProjectId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnId, title, description })
      });
      if (response.ok) {
        closeModal('card-create-modal');
        fetchKanbanBoard();
      } else {
        alert('Failed to create card');
      }
    } catch (err) {
      console.error('Error creating card:', err);
    }
  });


  // Workspace Agents Manager Controls
  const toggleTaskFilterBtn = document.getElementById('toggle-task-filter-btn');
  if (toggleTaskFilterBtn) {
    toggleTaskFilterBtn.addEventListener('click', () => {
      showActiveOnly = !showActiveOnly;
      if (showActiveOnly) {
        toggleTaskFilterBtn.innerHTML = '<span>⚡ Showing: Active Tasks</span>';
        toggleTaskFilterBtn.style.background = 'rgba(245, 158, 11, 0.2)';
        toggleTaskFilterBtn.style.borderColor = 'rgba(245, 158, 11, 0.4)';
        toggleTaskFilterBtn.style.color = '#fbbf24';
      } else {
        toggleTaskFilterBtn.innerHTML = '<span>📋 Showing: All Tasks</span>';
        toggleTaskFilterBtn.style.background = 'rgba(255, 255, 255, 0.05)';
        toggleTaskFilterBtn.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        toggleTaskFilterBtn.style.color = '';
      }
      renderKanbanBoard();
    });
  }

  const manageAgentsBtn = document.getElementById('manage-agents-btn');
  const agentsManagerList = document.getElementById('agents-manager-list');
  const agentsManagerNewBtn = document.getElementById('agents-manager-new-btn');
  
  const modalAgentId = document.getElementById('modal-agent-id');
  const modalAgentName = document.getElementById('modal-agent-name');
  const modalAgentPrompt = document.getElementById('modal-agent-prompt');
  const modalAgentSaveBtn = document.getElementById('modal-agent-save-btn');
  const modalAgentDeleteBtn = document.getElementById('modal-agent-delete-btn');
  const agentEditorTitle = document.getElementById('agent-editor-title');

  let activeAgentId = null;

  manageAgentsBtn.addEventListener('click', async () => {
    console.log('[Kanban Roles] Roles button clicked. Fetching agents...');
    try {
      await fetchWorkspaceAgents();
      console.log('[Kanban Roles] Workspace agents fetched:', workspaceAgents);
      
      renderAgentsManagerList();
      
      // Select first agent or reset editor
      if (workspaceAgents.length > 0) {
        selectAgentForEditing(workspaceAgents[0]);
      } else {
        resetAgentEditor();
      }
      
      openModal('agents-manager-modal');
      console.log('[Kanban Roles] Roles manager modal opened successfully!');
    } catch (err) {
      console.error('[Kanban Roles] Error rendering roles manager modal:', err);
      alert('Failed to open Agent Roles manager modal: ' + err.message);
    }
  });

  function renderAgentsManagerList() {
    agentsManagerList.innerHTML = '';
    
    if (workspaceAgents.length === 0) {
      agentsManagerList.innerHTML = '<div class="text-muted" style="text-align:center;padding:20px;">No Agent roles defined.</div>';
      return;
    }

    workspaceAgents.forEach(agent => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'agent-manager-item';
      if (activeAgentId === agent.id) {
        itemDiv.classList.add('active');
      }

      itemDiv.innerHTML = `
        <div class="agent-manager-item-name">${escapeHtml(agent.name)}</div>
        <div class="agent-manager-item-desc" title="${escapeHtml(agent.prompt)}">${escapeHtml(agent.prompt)}</div>
      `;

      itemDiv.addEventListener('click', () => {
        selectAgentForEditing(agent);
      });

      agentsManagerList.appendChild(itemDiv);
    });
  }

  function selectAgentForEditing(agent) {
    activeAgentId = agent.id;
    modalAgentId.value = agent.id;
    modalAgentName.value = agent.name;
    modalAgentPrompt.value = agent.prompt;
    
    agentEditorTitle.textContent = 'Edit Role Configuration';
    modalAgentDeleteBtn.style.display = 'block';

    // Highlight active in list
    document.querySelectorAll('.agent-manager-item').forEach(el => el.classList.remove('active'));
    renderAgentsManagerList(); // Redraw to set active class
  }

  function resetAgentEditor() {
    activeAgentId = null;
    modalAgentId.value = '';
    modalAgentName.value = '';
    modalAgentPrompt.value = '';
    
    agentEditorTitle.textContent = 'Create New Agent Role';
    modalAgentDeleteBtn.style.display = 'none';

    document.querySelectorAll('.agent-manager-item').forEach(el => el.classList.remove('active'));
  }

  agentsManagerNewBtn.addEventListener('click', () => {
    resetAgentEditor();
  });

  modalAgentSaveBtn.addEventListener('click', async () => {
    const id = modalAgentId.value;
    const name = modalAgentName.value.trim();
    const prompt = modalAgentPrompt.value.trim();

    if (!name || !prompt) {
      return alert('Agent name and role prompt definition are required.');
    }

    try {
      const url = id 
        ? `/api/kanban/agents/${id}?projectId=${encodeURIComponent(currentProjectId)}`
        : `/api/kanban/agents?projectId=${encodeURIComponent(currentProjectId)}`;
      const method = id ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, prompt })
      });

      const data = await response.json();

      if (response.ok) {
        await fetchWorkspaceAgents();
        
        if (!id) {
          // Select newly created agent
          selectAgentForEditing(data);
        } else {
          // Keep selection
          const updatedAgent = workspaceAgents.find(a => a.id === id);
          if (updatedAgent) selectAgentForEditing(updatedAgent);
        }
        
        fetchKanbanBoard(); // Refresh board lists/selectors
      } else {
        alert(`Error: ${data.error || 'Failed to save agent role'}`);
      }
    } catch (err) {
      console.error('Error saving agent role:', err);
    }
  });

  modalAgentDeleteBtn.addEventListener('click', async () => {
    const id = modalAgentId.value;
    if (!id) return;

    if (confirm('Are you sure you want to delete this Agent role? Columns assigned to this agent will be set to manual.')) {
      try {
        const response = await fetch(`/api/kanban/agents/${id}?projectId=${encodeURIComponent(currentProjectId)}`, {
          method: 'DELETE'
        });

        if (response.ok) {
          await fetchWorkspaceAgents();
          resetAgentEditor();
          fetchKanbanBoard();
        } else {
          const data = await response.json();
          alert(`Error: ${data.error || 'Failed to delete agent role'}`);
        }
      } catch (err) {
        console.error('Error deleting agent role:', err);
      }
    }
  });
  // --- Mention Autocomplete System ---
  let activeAutocompleteTextarea = null;
  let autocompleteMenu = null;
  let filteredAgents = [];
  let selectedIndex = 0;
  let mentionStartIndex = -1;

  function initMentionAutocomplete() {
    // Create the menu element if it doesn't exist
    if (!autocompleteMenu) {
      autocompleteMenu = document.createElement('div');
      autocompleteMenu.className = 'mention-autocomplete hidden';
      document.body.appendChild(autocompleteMenu);
    }

    // Attach listeners to all inputs we want to support mentions in
    const inputsToBind = [
      document.getElementById('modal-new-comment-input'),
      document.getElementById('modal-create-card-desc'),
      document.getElementById('modal-create-card-title'),
      document.getElementById('modal-card-desc-input')
    ];

    inputsToBind.forEach(input => {
      if (!input) return;
      
      // Clean up previous event listeners if any
      input.removeEventListener('input', handleMentionInput);
      input.removeEventListener('keydown', handleMentionKeyDown);
      input.removeEventListener('blur', handleMentionBlur);

      input.addEventListener('input', handleMentionInput);
      input.addEventListener('keydown', handleMentionKeyDown);
      input.addEventListener('blur', handleMentionBlur);
    });
  }

  function handleMentionInput(e) {
    const textarea = e.target;
    const value = textarea.value;
    const caretPos = textarea.selectionStart;

    // Find the last '@' before the caret
    const lastAtIdx = value.lastIndexOf('@', caretPos - 1);
    
    // If '@' exists and there's no space between it and the caret
    if (lastAtIdx !== -1 && !/\s/.test(value.substring(lastAtIdx, caretPos))) {
      activeAutocompleteTextarea = textarea;
      mentionStartIndex = lastAtIdx;
      
      const query = value.substring(lastAtIdx + 1, caretPos).toLowerCase();
      
      // Filter workspace agents
      filteredAgents = workspaceAgents.filter(agent => 
        agent.name.toLowerCase().includes(query)
      );

      if (filteredAgents.length > 0) {
        showAutocompleteMenu(textarea);
      } else {
        hideAutocompleteMenu();
      }
    } else {
      hideAutocompleteMenu();
    }
  }

  function showAutocompleteMenu(textarea) {
    autocompleteMenu.innerHTML = '';
    selectedIndex = 0;

    filteredAgents.forEach((agent, index) => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'mention-autocomplete-item';
      if (index === selectedIndex) {
        itemDiv.classList.add('active');
      }

      itemDiv.innerHTML = `
        <span style="font-size: 1.1rem;">🤖</span>
        <span>${escapeHtml(agent.name)}</span>
      `;

      itemDiv.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent blur
        selectAgentMention(agent);
      });

      autocompleteMenu.appendChild(itemDiv);
    });

    // Position menu below the textarea
    const rect = textarea.getBoundingClientRect();
    autocompleteMenu.style.left = `${rect.left + window.scrollX}px`;
    autocompleteMenu.style.top = `${rect.bottom + window.scrollY + 4}px`;
    autocompleteMenu.style.width = `${Math.max(220, rect.width)}px`;
    
    autocompleteMenu.classList.remove('hidden');
  }

  function hideAutocompleteMenu() {
    if (autocompleteMenu) {
      autocompleteMenu.classList.add('hidden');
    }
    activeAutocompleteTextarea = null;
    mentionStartIndex = -1;
  }

  function selectAgentMention(agent) {
    if (!activeAutocompleteTextarea) return;

    const textarea = activeAutocompleteTextarea;
    const value = textarea.value;
    const caretPos = textarea.selectionStart;

    const beforeMention = value.substring(0, mentionStartIndex);
    const afterMention = value.substring(caretPos);
    
    // Insert mention with space at the end
    textarea.value = beforeMention + `@${agent.name} ` + afterMention;
    
    // Set caret position after the mention
    const newCaretPos = mentionStartIndex + agent.name.length + 2; // @ + name + space
    textarea.setSelectionRange(newCaretPos, newCaretPos);
    
    // Trigger input event to resize textarea or update state
    textarea.dispatchEvent(new Event('input'));
    
    hideAutocompleteMenu();
    textarea.focus();
  }

  function handleMentionKeyDown(e) {
    if (autocompleteMenu && !autocompleteMenu.classList.contains('hidden')) {
      const items = autocompleteMenu.querySelectorAll('.mention-autocomplete-item');

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % filteredAgents.length;
        updateActiveItem(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + filteredAgents.length) % filteredAgents.length;
        updateActiveItem(items);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredAgents[selectedIndex]) {
          selectAgentMention(filteredAgents[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        hideAutocompleteMenu();
      }
    }
  }

  function updateActiveItem(items) {
    items.forEach((item, index) => {
      if (index === selectedIndex) {
        item.classList.add('active');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('active');
      }
    });
  }

  function handleMentionBlur() {
    // Hide menu on blur
    setTimeout(() => {
      hideAutocompleteMenu();
    }, 150);
  }


  // --- Helper utility ---

  function escapeHtml(unsafe) {
    if (unsafe === undefined || unsafe === null) return '';
    return String(unsafe)
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
  }

  // --- Config Settings Logic ---
  
  function loadConfig() {
    const pathStatus = document.getElementById('status-hermes-path');
    const dirStatus = document.getElementById('status-hermes-config-dir');
    
    if (pathStatus) {
      pathStatus.textContent = 'Checking...';
      pathStatus.className = 'status-indicator checking';
    }
    if (dirStatus) {
      dirStatus.textContent = 'Checking...';
      dirStatus.className = 'status-indicator checking';
    }

    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        const pathInput = document.getElementById('input-hermes-path');
        const dirInput = document.getElementById('input-hermes-config-dir');
        if (pathInput) pathInput.value = data.hermesPath || '';
        if (dirInput) dirInput.value = data.hermesConfigDir || '';
        
        const maxAgentInput = document.getElementById('input-max-concurrent-agents');
        if (maxAgentInput) maxAgentInput.value = data.maxConcurrentAgents || 3;
        
        if (pathStatus) {
          if (data.hermesPathExists) {
            pathStatus.textContent = 'Found';
            pathStatus.className = 'status-indicator success';
          } else {
            pathStatus.textContent = 'Not Found';
            pathStatus.className = 'status-indicator danger';
          }
        }
        
        if (dirStatus) {
          if (data.hermesConfigDirExists) {
            dirStatus.textContent = 'Found';
            dirStatus.className = 'status-indicator success';
          } else {
            dirStatus.textContent = 'Not Found';
            dirStatus.className = 'status-indicator danger';
          }
        }
      })
      .catch(err => {
        console.error('Failed to load config:', err);
        if (pathStatus) {
          pathStatus.textContent = 'Error';
          pathStatus.className = 'status-indicator danger';
        }
        if (dirStatus) {
          dirStatus.textContent = 'Error';
          dirStatus.className = 'status-indicator danger';
        }
      });
  }

  function saveConfig() {
    const hermesPath = document.getElementById('input-hermes-path').value.trim();
    const hermesConfigDir = document.getElementById('input-hermes-config-dir').value.trim();
    const maxAgentInput = document.getElementById('input-max-concurrent-agents');
    const maxConcurrentAgents = maxAgentInput ? (parseInt(maxAgentInput.value, 10) || 3) : 3;
    
    if (!hermesPath || !hermesConfigDir) {
      alert('Please fill out all configuration fields.');
      return;
    }

    fetch('/api/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ hermesPath, hermesConfigDir, maxConcurrentAgents })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        alert('Settings saved successfully!');
        loadConfig(); // Refresh status indicators
      } else {
        alert('Failed to save settings: ' + data.error);
      }
    })
    .catch(err => {
      console.error('Failed to save config:', err);
      alert('Error saving settings: ' + err);
    });
  }

  const saveConfigBtn = document.getElementById('save-config-btn');
  if (saveConfigBtn) {
    saveConfigBtn.addEventListener('click', saveConfig);
  }

  // Initial startup execution
  startKanbanPolling();
  fetchProjects().then(() => {
    fetchKanbanBoard();
    loadHistory();
  });

  console.log('[Kanban Init] Initialization finished successfully!');
});
