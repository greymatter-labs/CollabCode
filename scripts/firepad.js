(function() {
  // Variables
  let editor = null;
  let session = null;
  let currentUser = null;
  let usersRef = null;
  let sessionRef = null;
  let lastRunRef = null;
  let problemSource = {};
  let problemMeta = {};
  let problemPanelOpen = null;
  let problemPromptHydrateKey = '';
  let languageModes = {};
  let currentSessionCode = null;
  let previousUsers = {};
  let isInitialized = false;
  let isEndingSession = false;
  let isNewSession = false;
  let activeFileId = null;
  let activeFileMeta = null;
  let snapshotSaveTimer = null;
  let suppressSnapshotSave = false;
  let joinedNotificationShown = false;
  
  // Language mode configurations
  const languageConfig = {
    javascript: { mode: 'ace/mode/javascript', ext: 'js' },
    python: { mode: 'ace/mode/python', ext: 'py' },
    java: { mode: 'ace/mode/java', ext: 'java' },
    c_cpp: { mode: 'ace/mode/c_cpp', ext: 'cpp' },
    csharp: { mode: 'ace/mode/csharp', ext: 'cs' },
    php: { mode: 'ace/mode/php', ext: 'php' },
    ruby: { mode: 'ace/mode/ruby', ext: 'rb' },
    go: { mode: 'ace/mode/golang', ext: 'go' },
    rust: { mode: 'ace/mode/rust', ext: 'rs' },
    typescript: { mode: 'ace/mode/typescript', ext: 'ts' },
    swift: { mode: 'ace/mode/swift', ext: 'swift' },
    kotlin: { mode: 'ace/mode/kotlin', ext: 'kt' },
    scala: { mode: 'ace/mode/scala', ext: 'scala' },
    r: { mode: 'ace/mode/r', ext: 'r' },
    perl: { mode: 'ace/mode/perl', ext: 'pl' },
    lua: { mode: 'ace/mode/lua', ext: 'lua' },
    haskell: { mode: 'ace/mode/haskell', ext: 'hs' },
    elixir: { mode: 'ace/mode/elixir', ext: 'ex' },
    dart: { mode: 'ace/mode/dart', ext: 'dart' },
    html: { mode: 'ace/mode/html', ext: 'html' },
    css: { mode: 'ace/mode/css', ext: 'css' },
    sql: { mode: 'ace/mode/sql', ext: 'sql' },
    json: { mode: 'ace/mode/json', ext: 'json' },
    yaml: { mode: 'ace/mode/yaml', ext: 'yaml' },
    xml: { mode: 'ace/mode/xml', ext: 'xml' },
    markdown: { mode: 'ace/mode/markdown', ext: 'md' }
  };

  // Get default code for each language
  const getDefaultCode = (language) => {
    if (typeof window.SimpleTemplates !== 'undefined' && window.SimpleTemplates[language]) {
      return window.SimpleTemplates[language];
    }
    // Fallback
    return '// Welcome to Collaborative Code Editor!\n// Start coding here...';
  };

  function createIcon(symbolId, sizeClass = 'ic-14') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('ic');
    String(sizeClass).split(/\s+/).filter(Boolean).forEach(className => svg.classList.add(className));

    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#${symbolId}`);
    svg.appendChild(use);
    return svg;
  }

  function setRunButtonIdle(runBtn) {
    if (!runBtn) return;
    runBtn.replaceChildren(createIcon('i-play'), document.createTextNode('Run'));
  }

  // Initialize the application (called from app.js)
  window.initializeSession = function(options) {
    // CRITICAL: Prevent multiple initializations
    if (isInitialized) {
      console.warn('⚠️ Session already initialized, blocking re-initialization');
      return;
    }
    isInitialized = true;
    
    const { userName, userEmail, sessionCode, isNew, isAdmin } = options;
    
    console.log('=== INITIALIZING SESSION (ONCE) ===');
    console.log('User:', userName, 'Code:', sessionCode, 'New:', isNew, 'Admin:', isAdmin);
    
    currentSessionCode = sessionCode;
    isNewSession = !!isNew;
    currentUser = {
      name: userName,
      displayName: formatPresenceDisplayName(userName, userEmail, isAdmin),
      id: 'user_' + Math.random().toString(36).substr(2, 9),
      color: generateUserColor(),
      isAdmin: isAdmin,
      role: isAdmin ? 'interviewer' : 'candidate'
    };
    
    // Initialize components
    initializeEditor();
    initializeFirebase(isNew);
    setupEventListenersOnce();
    
    // Update UI based on role
    const endSessionBtn = document.getElementById('end-session-btn');
    const resetSessionBtn = document.getElementById('reset-session-btn');
    
    if (isAdmin) {
      console.log('Admin user detected - showing End Interview button');
      setupSessionInfo();
      
      // Admin keeps the button visible (it's visible by default now)
      if (endSessionBtn) {
        console.log('End Interview button is visible for admin');
      }
      if (resetSessionBtn) {
        resetSessionBtn.style.display = 'inline-block';
      }
    } else {
      console.log('Non-admin user - hiding End Interview button');
      // Hide button for non-admin users
      if (endSessionBtn) {
        endSessionBtn.style.display = 'none';
      }
      if (resetSessionBtn) {
        resetSessionBtn.style.display = 'none';
      }
    }
  }

  // Initialize ACE Editor
  function initializeEditor() {
    // Prevent duplicate editor creation
    if (editor) {
      console.warn('Editor already exists');
      return;
    }
    
    console.log('Creating ACE editor...');
    editor = ace.edit("firepad-container");
    editor.setTheme("ace/theme/monokai");
    
    session = editor.getSession();
    session.setUseWrapMode(true);
    session.setUseWorker(false);
    session.setMode("ace/mode/javascript");
    
    // Enable autocomplete and ensure editor is interactive
    editor.setOptions({
      enableBasicAutocompletion: true,
      enableSnippets: true,
      enableLiveAutocompletion: false, // Disable to prevent issues
      fontSize: "14px",
      showPrintMargin: false,
      readOnly: false,
      highlightActiveLine: true,
      animatedScroll: true,
      behavioursEnabled: true
    });

    // Ensure editor is not read-only
    editor.setReadOnly(false);
    editor.renderer.setShowGutter(true);
    editor.focus();

    // Update cursor position
    editor.on('changeSelection', updateCursorPosition);
    editor.on('change', scheduleActiveSnapshotSave);
    editor.container.addEventListener('pointerdown', function() {
      if (activeFileMeta && isWritableWorkspaceFile(activeFileMeta)) {
        applyEditorAccessForFile(activeFileMeta);
      }
    });
    editor.container.addEventListener('focusin', function() {
      if (activeFileMeta && isWritableWorkspaceFile(activeFileMeta)) {
        applyEditorAccessForFile(activeFileMeta);
      }
    });
    
    console.log('Editor initialized - ReadOnly:', editor.getReadOnly());
  }

  // Initialize Firebase-backed workspace
  function initializeFirebase(isNew) {
    if (window.CollabWorkspace && window.CollabWorkspace.destroy) {
      window.CollabWorkspace.destroy();
    }
    
    // Clear any existing Firebase listeners
    if (sessionRef) {
      sessionRef.off();
    }
    if (usersRef) {
      usersRef.off();
    }
    if (lastRunRef) {
      lastRunRef.off();
      lastRunRef = null;
    }
    
    // For non-admins joining, verify session exists first
    if (!isNew && !currentUser.isAdmin) {
      const sessionCheck = firebase.database().ref('sessions').child(currentSessionCode);
      sessionCheck.once('value').then(function(snapshot) {
        const data = snapshot.val();
        if (!data || !data.created || !data.createdBy) {
          console.error('Invalid session - not created by admin');
          alert('Invalid session code. This session does not exist.');
          window.location.replace(window.location.pathname + window.location.search);
          return;
        }
      });
    }
    
    // Create new Firebase references
    const ref = firebase.database().ref('sessions').child(currentSessionCode);
    sessionRef = ref;
    usersRef = ref.child('users');
    lastRunRef = ref.child('lastRun');
    
    // If creating a new session (admin only), mark it as active
    if (isNew && currentUser.isAdmin) {
      sessionRef.once('value').then(function(snapshot) {
        const sessionData = snapshot.val() || {};
        const updates = {};

        if (!sessionData.created) updates.created = firebase.database.ServerValue.TIMESTAMP;
        if (!sessionData.createdBy) updates.createdBy = currentUser.name;
        if (!sessionData.status) updates.status = 'active';

        if (Object.keys(updates).length) {
          return sessionRef.update(updates);
        }
        return null;
      }).then(function() {
        console.log('Session metadata ready in Firebase:', currentSessionCode);
      }).catch(function(error) {
        console.warn('Could not update session metadata:', error);
      });
    }

    console.log('Creating workspace-backed editor instance...');
    console.log('User info:', { 
      id: currentUser.id, 
      name: currentUser.name, 
      isAdmin: currentUser.isAdmin 
    });
    
    try {
      // Ensure editor is editable for all users
      editor.setReadOnly(false);

      if (!window.CollabWorkspace || !window.CollabWorkspace.init) {
        throw new Error('Workspace editor module did not load');
      }

      window.CollabWorkspace.init({
        sessionRef,
        currentUser,
        isNew,
        editor,
        getDefaultCode,
        getCurrentLanguage: () => document.getElementById('language-selector')?.value || 'javascript',
        focusEditor: () => {
          if (activeFileMeta) {
            applyEditorAccessForFile(activeFileMeta, true);
          } else {
            editor.focus();
          }
        },
        beforeActiveFileChange: saveActiveSnapshotNow,
        onActiveFileChange: openWorkspaceFile,
        onWorkspaceChange: () => {},
        loadHiddenFiles: loadHiddenProblemFiles
      }).catch(function(error) {
        console.error('Workspace initialization failed:', error);
        showOutput('Workspace failed to initialize. Refresh the page and try again.', 'error');
      });
      
      // Setup presence after the workspace is initialized.
      setTimeout(() => setupPresenceOnce(), 100);
      
      // Setup session info
      setupSessionInfo();
      
      // Setup settings sync
      setupSettingsSync();

      // Share the latest run result with every participant.
      setupLastRunSync();

      // Keep the problem prompt visible for both interviewers and candidates.
      setupProblemSidebarSync();
      
    } catch (error) {
      console.error('❌ Failed to create workspace editor:', error);
    }
  }

  async function loadHiddenProblemFiles(source) {
    if (!currentUser?.isAdmin) return [];

    const problemId = source?.problemId;
    const versionId = source?.problemVersionId || source?.versionId;
    if (!problemId || !versionId) return [];

    const response = await fetch(`/api/problems/get?problemId=${encodeURIComponent(problemId)}`, {
      headers: {
        ...Auth.getAuthHeaders()
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success || !data.problem) {
      throw new Error(data.error || 'Could not load hidden problem files');
    }

    const version = data.problem.versions?.[versionId];
    if (!version) return [];

    return (version.files || []).filter(file => file.visibility === 'hidden');
  }

  function setupProblemSidebarSync() {
    const sourceRef = sessionRef.child('workspace/source');
    const problemRef = sessionRef.child('problem');

    sourceRef.on('value', function(snapshot) {
      problemSource = snapshot.val() || {};
      renderProblemSidebar();
    });
    problemRef.on('value', function(snapshot) {
      problemMeta = snapshot.val() || {};
      renderProblemSidebar();
    });
  }

  function getProblemSidebarData() {
    const title = String(problemMeta.title || problemSource.problemTitle || '').trim();
    const prompt = String(problemMeta.prompt || problemSource.problemPrompt || '').trim();
    const problemId = problemMeta.problemId || problemSource.problemId || null;
    const versionId = problemMeta.versionId || problemSource.problemVersionId || problemSource.versionId || null;

    return {
      title,
      prompt,
      problemId,
      versionId,
      hasProblem: !!(problemId || title || prompt)
    };
  }

  function renderProblemSidebar() {
    const panel = document.getElementById('problem-panel');
    const button = document.getElementById('problem-toggle-btn');
    const title = document.getElementById('problem-panel-title');
    const prompt = document.getElementById('problem-prompt-text');
    if (!panel || !button || !title || !prompt) return;

    const data = getProblemSidebarData();
    if (!data.hasProblem) {
      panel.style.display = 'none';
      button.style.display = 'none';
      button.classList.remove('active');
      button.setAttribute('aria-expanded', 'false');
      return;
    }

    if (problemPanelOpen === null) {
      problemPanelOpen = true;
    }

    maybeHydrateMissingProblemPrompt(data);

    title.textContent = data.title || 'Problem';
    prompt.textContent = data.prompt || 'No problem instructions were saved for this session.';
    button.style.display = 'inline-flex';
    panel.style.display = problemPanelOpen ? 'flex' : 'none';
    button.classList.toggle('active', problemPanelOpen);
    button.setAttribute('aria-expanded', String(problemPanelOpen));
  }

  async function maybeHydrateMissingProblemPrompt(data) {
    if (data.prompt || !currentUser?.isAdmin || !data.problemId || !data.versionId) return;

    const key = `${data.problemId}:${data.versionId}`;
    if (problemPromptHydrateKey === key) return;
    problemPromptHydrateKey = key;

    try {
      const response = await fetch(`/api/problems/get?problemId=${encodeURIComponent(data.problemId)}`, {
        headers: {
          ...Auth.getAuthHeaders()
        }
      });
      const body = await response.json().catch(() => ({}));
      const version = body.problem?.versions?.[data.versionId];
      const prompt = String(version?.prompt || '').trim();
      if (!response.ok || !body.success || !prompt) return;

      await sessionRef.update({
        'problem/title': data.title || body.problem?.title || version.title || 'Problem',
        'problem/prompt': prompt,
        'workspace/source/problemPrompt': prompt
      });
    } catch (error) {
      console.warn('Could not hydrate problem prompt for this session:', error);
    }
  }

  function isWritableWorkspaceFile(file) {
    return !!file && file.readonly !== true && file.role !== 'runtime';
  }

  function applyEditorAccessForFile(file, shouldFocus = false) {
    if (!editor || !file) return;

    const writable = isWritableWorkspaceFile(file);
    editor.setReadOnly(!writable);

    const textInput = editor.textInput?.getElement?.();
    if (textInput) {
      textInput.disabled = false;
      textInput.readOnly = !writable;
      textInput.tabIndex = 0;
    }

    if (writable && shouldFocus) {
      editor.focus();
      const textInput = editor.textInput?.getElement?.();
      if (textInput && document.activeElement !== textInput) {
        textInput.focus({ preventScroll: true });
      }
    }
  }

  async function openWorkspaceFile(file, snapshot) {
    if (!file || !editor) return;
    if (activeFileId === file.id && (file.readonly || file.role === 'runtime')) return;

    activeFileId = file.id;
    activeFileMeta = file;

    const languageSelector = document.getElementById('language-selector');
    if (languageSelector && languageSelector.value !== file.language) {
      languageSelector.value = file.language;
    }
    changeLanguage(file.language);

    const defaultText = typeof snapshot?.content === 'string'
      ? snapshot.content
      : getDefaultCode(file.language);
    suppressSnapshotSave = true;
    editor.setValue(defaultText, -1);
    applyEditorAccessForFile(file);
    suppressSnapshotSave = false;

    applyEditorAccessForFile(file, true);
    updateCursorPosition();
    console.log('Opened workspace file:', file.path);

    if (!isNewSession && !joinedNotificationShown) {
      joinedNotificationShown = true;
      showUserNotification(`You joined session ${currentSessionCode}`, 'join');
    }
  }

  function scheduleActiveSnapshotSave() {
    if (suppressSnapshotSave || !editor || !activeFileId || !window.CollabWorkspace?.isEnabled?.()) return;
    if (activeFileMeta?.readonly || activeFileMeta?.role === 'runtime') return;

    clearTimeout(snapshotSaveTimer);
    snapshotSaveTimer = setTimeout(() => {
      saveActiveSnapshotNow();
    }, 900);
  }

  async function saveActiveSnapshotNow() {
    clearTimeout(snapshotSaveTimer);
    if (suppressSnapshotSave || !editor || !activeFileId || !window.CollabWorkspace?.isEnabled?.()) return;
    if (activeFileMeta?.readonly || activeFileMeta?.role === 'runtime') return;

    try {
      await window.CollabWorkspace.saveActiveSnapshot(editor.getValue());
    } catch (error) {
      console.warn('Could not save active file snapshot:', error);
    }
  }

  // Setup presence (ONCE)
  let presenceSetup = false;
  function setupPresenceOnce() {
    if (presenceSetup) {
      console.log('Presence already setup');
      return;
    }
    presenceSetup = true;
    
    const userRef = usersRef.child(currentUser.id);
    
    // Set user data
    userRef.set({
      name: currentUser.name,
      displayName: currentUser.displayName,
      role: currentUser.role,
      isAdmin: currentUser.isAdmin === true,
      color: currentUser.color,
      timestamp: firebase.database.ServerValue.TIMESTAMP
    });

    // Remove on disconnect
    userRef.onDisconnect().remove();
    
    // Monitor for session termination (non-admin users only)
    monitorSessionTermination();
    
    // Initialize interview notes system (for admins only)
    if (window.initializeInterviewNotes) {
      window.initializeInterviewNotes(currentSessionCode, currentUser);
    }

    // Listen for users ONCE
    usersRef.on('value', function(snapshot) {
      const users = snapshot.val() || {};
      updateUsersList(users);
      detectUserChanges(users);
      updateUserCount(users);
    });

    // Monitor connection
    firebase.database().ref('.info/connected').on('value', function(snapshot) {
      updateConnectionStatus(snapshot.val());
    });
  }

  // Detect user joins/leaves
  let isFirstUserUpdate = true;
  function detectUserChanges(currentUsers) {
    // Skip the first update to avoid false notifications
    if (isFirstUserUpdate) {
      isFirstUserUpdate = false;
      previousUsers = {...currentUsers};
      return;
    }
    
    const currentIds = Object.keys(currentUsers);
    const previousIds = Object.keys(previousUsers);
    
    // Check for new users (only if we had previous users to compare)
    if (previousIds.length > 0) {
      currentIds.forEach(userId => {
        if (!previousIds.includes(userId) && userId !== currentUser.id) {
          const user = currentUsers[userId];
          showUserNotification(`${user.name} joined the session`, 'join');
          playNotificationSound('join');
        }
      });
    }
    
    // Check for users who left
    previousIds.forEach(userId => {
      if (!currentIds.includes(userId) && userId !== currentUser.id) {
        const user = previousUsers[userId];
        if (user) {
          showUserNotification(`${user.name} left the session`, 'leave');
          playNotificationSound('leave');
        }
      }
    });
    
    previousUsers = {...currentUsers};
  }

  // Show user notification
  let notificationQueue = [];
  let isShowingNotification = false;
  
  function showUserNotification(message, type) {
    // Add to queue
    notificationQueue.push({ message, type });
    
    // Process queue if not already processing
    if (!isShowingNotification) {
      processNotificationQueue();
    }
  }
  
  function processNotificationQueue() {
    if (notificationQueue.length === 0) {
      isShowingNotification = false;
      return;
    }
    
    isShowingNotification = true;
    const { message, type } = notificationQueue.shift();
    
    // Remove any existing notifications
    const existing = document.querySelector('.user-notification');
    if (existing) {
      existing.remove();
    }
    
    const notification = document.createElement('div');
    notification.className = `user-notification ${type}`;

    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.textContent = message;

    notification.append(icon, text);
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.classList.add('is-exiting');
      setTimeout(() => {
        notification.remove();
        // Process next notification
        setTimeout(() => processNotificationQueue(), 100);
      }, 300);
    }, 2000);
  }

  // Play notification sound (optional)
  function playNotificationSound(type) {
    // You can add sound effects here if desired
  }

  // Update users list display
  function formatPresenceDisplayName(name, email, isAdminUser) {
    const rawName = String(name || '').trim();
    const emailLocal = String(email || '').split('@')[0].trim();
    const withoutEmailSuffix = rawName.replace(/\s*\([^)]*@[^)]*\)\s*$/, '').trim();

    if (isAdminUser) {
      if (!withoutEmailSuffix || /^admin$/i.test(withoutEmailSuffix) || withoutEmailSuffix.includes('@')) {
        return emailLocal || 'Interviewer';
      }
      return withoutEmailSuffix;
    }

    return withoutEmailSuffix || 'Candidate';
  }

  function getUserListLabel(user) {
    const label = formatPresenceDisplayName(user.displayName || user.name, null, user.isAdmin === true || user.role === 'interviewer');
    if (!currentUser?.isAdmin && /^admin$/i.test(label)) return 'Interviewer';
    return label;
  }

  function getUserInitials(label) {
    const parts = String(label || '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }

    return (parts[0] || '?').slice(0, 2).toUpperCase();
  }

  function updateUsersList(users) {
    const usersList = document.getElementById('users-list');
    if (!usersList) return;
    
    usersList.replaceChildren();
    const entries = Object.keys(users).map(userId => ({ userId, user: users[userId] }));
    const visibleEntries = entries.slice(0, 5);

    visibleEntries.forEach(({ userId, user }) => {
      const badge = document.createElement('div');
      badge.className = 'user-badge';
      if (userId === currentUser.id) {
        badge.className += ' current-user';
      }
      const label = getUserListLabel(user);
      const roleLabel = user.isAdmin === true || user.role === 'interviewer' ? 'Interviewer' : 'Candidate';
      const tooltip = `${label} · ${roleLabel}`;
      badge.dataset.tooltip = tooltip;
      badge.setAttribute('aria-label', tooltip);
      badge.style.setProperty('--avatar-ring', user.color || '#4cb782');

      const name = document.createElement('span');
      name.className = 'user-badge-name';
      name.textContent = getUserInitials(label);
      badge.appendChild(name);

      if (currentUser?.isAdmin && (user.isAdmin === true || user.role === 'interviewer')) {
        const role = document.createElement('span');
        role.className = 'user-badge-role';
        role.textContent = 'Interviewer';
        badge.appendChild(role);
      }

      usersList.appendChild(badge);
    });

    if (entries.length > visibleEntries.length) {
      const overflow = document.createElement('div');
      overflow.className = 'user-badge user-badge-overflow';
      const hiddenEntries = entries.slice(visibleEntries.length);
      const hiddenLabels = hiddenEntries.map(({ user }) => getUserListLabel(user)).join(', ');
      const hiddenCount = hiddenEntries.length;
      overflow.textContent = `+${hiddenCount}`;
      overflow.dataset.tooltip = hiddenLabels || `${hiddenCount} more participant${hiddenCount === 1 ? '' : 's'}`;
      overflow.setAttribute('aria-label', overflow.dataset.tooltip);
      usersList.appendChild(overflow);
    }
  }

  // Update user count
  function updateUserCount(users) {
    const count = Object.keys(users).length;
    const userCountEl = document.getElementById('user-count');
    if (userCountEl) {
      userCountEl.textContent = `${count} ${count === 1 ? 'user' : 'users'} online`;
    }
  }

  // Update connection status
  function updateConnectionStatus(connected) {
    const status = document.getElementById('connection-status');
    if (status) {
      status.textContent = connected ? 'Connected' : 'Disconnected';
      status.className = connected ? 'connected' : 'disconnected';
    }
  }

  // Setup session info
  function setupSessionInfo() {
    const sessionInfo = document.getElementById('session-info');
    if (!sessionInfo || sessionInfo.dataset.sessionCode === currentSessionCode) return;

    sessionInfo.replaceChildren();
    sessionInfo.dataset.sessionCode = currentSessionCode;

    const label = document.createElement('span');
    label.className = 'session-label';
    label.textContent = 'Session';

    const code = document.createElement('strong');
    code.textContent = currentSessionCode;

    sessionInfo.append(label, code);

    if (currentUser?.isAdmin) {
      const adminBadge = document.createElement('span');
      adminBadge.className = 'session-role-pill';
      adminBadge.textContent = 'Admin';
      sessionInfo.appendChild(adminBadge);
    }
  }

  function setupLastRunSync() {
    if (!lastRunRef) return;

    lastRunRef.off();
    lastRunRef.on('value', function(snapshot) {
      const run = snapshot.val();
      if (!run) return;
      renderSharedRun(run);
    });
  }

  function formatRunTime(timestamp) {
    if (!timestamp) return '';
    try {
      return new Date(timestamp).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch (error) {
      return '';
    }
  }

  function renderSharedRun(run) {
    const outputPanel = document.getElementById('output-panel');
    const outputText = document.getElementById('output-text');
    const lastRunSummary = document.getElementById('last-run-summary');
    if (!outputPanel || !outputText) return;

    const status = run.status === 'success' ? 'success' : run.status === 'running' ? 'info' : 'error';
    const runner = run.runByName || 'Someone';
    const entry = run.entryPath ? ` ${run.entryPath}` : '';
    const language = run.language ? ` ${run.language}` : '';
    const when = formatRunTime(run.updatedAt);
    const runtimeFiles = run.runtimeFileCount
      ? ` | generated ${run.runtimeFileCount} file${run.runtimeFileCount === 1 ? '' : 's'}`
      : '';
    const summary = `${run.status || 'run'} by ${runner}${language}${entry}${when ? ` at ${when}` : ''}${runtimeFiles}`;

    outputPanel.style.display = 'flex';
    window.CollabPanelLayout?.selectRightTab?.('output');
    if (lastRunSummary) {
      lastRunSummary.textContent = summary;
      lastRunSummary.className = status;
    }
    outputText.textContent = run.output || run.error || '(No output)';
    outputText.className = status;
  }

  function publishRunResult(status, details = {}) {
    if (!lastRunRef) return Promise.resolve();

    return lastRunRef.set({
      status,
      language: details.language || null,
      entryPath: details.entryPath || null,
      output: details.output || '',
      error: details.error || '',
      runtimeFileCount: details.runtimeFileCount || 0,
      executionTime: details.executionTime || null,
      runById: currentUser?.id || null,
      runByName: currentUser?.name || null,
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    });
  }

  // Settings sync (simplified)
  function setupSettingsSync() {
    const settingsRef = sessionRef.child('settings');
    
    // Language selector
    const languageSelector = document.getElementById('language-selector');
    if (languageSelector) {
      // Remove old listeners
      const newLanguageSelector = languageSelector.cloneNode(true);
      languageSelector.parentNode.replaceChild(newLanguageSelector, languageSelector);
      
      newLanguageSelector.addEventListener('change', function() {
        const language = this.value;
        if (window.CollabWorkspace?.isEnabled?.()) {
          window.CollabWorkspace.updateActiveFileLanguage(language).catch(function(error) {
            console.warn('Could not update file language:', error);
          });
        } else {
          settingsRef.child('language').set(language);
        }
        changeLanguage(language);
        
        // Only load template if editor is empty or has default content
        const currentContent = editor.getValue().trim();
        if (!currentContent || currentContent === '// Welcome to Collaborative Code Editor!\n// Start coding here...') {
          const template = getDefaultCode(language);
          if (template && editor) {
            editor.setValue(template, -1);
          }
        }
      });
    }

    // Theme selector
    const themeSelector = document.getElementById('theme-selector');
    if (themeSelector) {
      // Remove old listeners
      const newThemeSelector = themeSelector.cloneNode(true);
      themeSelector.parentNode.replaceChild(newThemeSelector, themeSelector);
      
      newThemeSelector.addEventListener('change', function() {
        const theme = this.value;
        settingsRef.child('theme').set(theme);
        editor.setTheme(`ace/theme/${theme}`);
      });
    }

    // Listen for settings changes
    settingsRef.on('value', function(snapshot) {
      const settings = snapshot.val();
      if (settings) {
        if (settings.language && !window.CollabWorkspace?.isEnabled?.()) {
          const selector = document.getElementById('language-selector');
          if (selector && selector.value !== settings.language) {
            selector.value = settings.language;
            changeLanguage(settings.language);
          }
        }
        if (settings.theme) {
          const selector = document.getElementById('theme-selector');
          if (selector && selector.value !== settings.theme) {
            selector.value = settings.theme;
            editor.setTheme(`ace/theme/${settings.theme}`);
          }
        }
      }
    });
  }

  // Change language
  function changeLanguage(language) {
    const config = languageConfig[language];
    if (config) {
      session.setMode(config.mode);
    }
  }

  // Setup event listeners ONCE
  let listenersSetup = false;
  function setupEventListenersOnce() {
    if (listenersSetup) {
      console.log('Event listeners already setup');
      return;
    }
    listenersSetup = true;
    
    // Share button
    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) {
      shareBtn.addEventListener('click', shareSession);
    }

    const problemToggleBtn = document.getElementById('problem-toggle-btn');
    if (problemToggleBtn) {
      problemToggleBtn.addEventListener('click', function() {
        if (window.CollabPanelLayout?.isRightTabAvailable?.('problem') &&
            !window.CollabPanelLayout?.isRightTabActive?.('problem')) {
          window.CollabPanelLayout.selectRightTab('problem');
          return;
        }
        problemPanelOpen = !problemPanelOpen;
        renderProblemSidebar();
        if (problemPanelOpen) {
          window.CollabPanelLayout?.selectRightTab?.('problem');
        }
      });
    }

    const closeProblemBtn = document.getElementById('close-problem');
    if (closeProblemBtn) {
      closeProblemBtn.addEventListener('click', function() {
        problemPanelOpen = false;
        renderProblemSidebar();
      });
    }

    // Run button
    const runBtn = document.getElementById('run-btn');
    if (runBtn) {
      runBtn.addEventListener('click', runCode);
    }

    // Clear output
    const clearBtn = document.getElementById('clear-output');
    if (clearBtn) {
      clearBtn.addEventListener('click', clearOutput);
    }

    // Close output
    const closeBtn = document.getElementById('close-output');
    if (closeBtn) {
      closeBtn.addEventListener('click', hideOutput);
    }
    
    // End session button (admin only)
    const endSessionBtn = document.getElementById('end-session-btn');
    if (endSessionBtn) {
      console.log('Setting up End Interview button handler');
      endSessionBtn.addEventListener('click', function(e) {
        e.preventDefault();
        console.log('End Interview button clicked');
        if (confirm('Are you sure you want to end this interview? All participants will be disconnected.')) {
          console.log('User confirmed ending interview');
          endSession();
        } else {
          console.log('User cancelled ending interview');
        }
      });
      
      // Ensure button is visible and clickable
      endSessionBtn.style.pointerEvents = 'auto';
      console.log('End Interview button setup complete');
    } else {
      console.error('End Interview button not found in DOM');
    }

    const resetSessionBtn = document.getElementById('reset-session-btn');
    if (resetSessionBtn) {
      resetSessionBtn.addEventListener('click', function(e) {
        e.preventDefault();
        resetSessionWorkspace();
      });
    }

    // Cursor position
    if (editor) {
      editor.on('changeSelection', updateCursorPosition);
    }

    // Font size selector
    const fontSizeSelector = document.getElementById('fontSize-selector');
    if (fontSizeSelector) {
      fontSizeSelector.addEventListener('change', function() {
        editor.setFontSize(this.value + 'px');
      });
    }
  }

  // Share session
  function shareSession() {
    const shareMessage = `Join my coding session!\n\nSession Code: ${currentSessionCode}\n\nGo to: ${window.location.origin}\nEnter code: ${currentSessionCode}`;
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(currentSessionCode).then(function() {
        showNotification(`✓ Session code ${currentSessionCode} copied! Share it with others to collaborate.`);
      });
    } else {
      prompt('Share this session code with others:', currentSessionCode);
    }
  }
  
  // End session (admin only)
  async function endSession() {
    if (!currentUser || !currentUser.isAdmin) {
      console.error('Only admins can end sessions');
      return;
    }
    
    console.log('Admin ending session:', currentSessionCode);
    isEndingSession = true;
    
    await saveActiveSnapshotNow();

    // Save the final code and workspace snapshot before ending the session.
    const projectSnapshot = window.CollabWorkspace?.isEnabled?.()
      ? window.CollabWorkspace.getCurrentProjectSnapshot(editor ? editor.getValue() : '')
      : null;
    const entryFile = projectSnapshot?.files?.find(file => file.id === projectSnapshot.entryFileId)
      || projectSnapshot?.files?.[0]
      || null;
    const finalCode = entryFile?.content || (editor ? editor.getValue() : '');
    const language = entryFile?.language || document.getElementById('language-selector')?.value || 'javascript';
    
    if (!sessionRef) {
      console.error('No session reference available');
      isEndingSession = false;
      alert('Unable to end session - no active session found');
      return;
    }

    try {
      const response = await fetch('/api/sessions/end', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...Auth.getAuthHeaders()
        },
        body: JSON.stringify({
          sessionId: currentSessionCode,
          finalCode,
          language,
          finalFiles: projectSnapshot?.files || null,
          entryFileId: projectSnapshot?.entryFileId || null,
          entryPath: projectSnapshot?.entryPath || null,
          workspaceSource: projectSnapshot?.source || null
        })
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to end session');
      }

      console.log('Session terminated successfully with code and participants saved');
      alert('Interview ended. Code has been saved. All participants have been disconnected.');
      setTimeout(() => {
        window.location.replace(window.location.pathname + window.location.search);
      }, 800);
    } catch (error) {
      isEndingSession = false;
      console.error('Error terminating session:', error);
      alert('Failed to end the interview: ' + error.message);
    }
  }

  async function resetSessionWorkspace() {
    if (!currentUser || !currentUser.isAdmin) {
      console.error('Only admins can reset sessions');
      return;
    }

    if (!confirm('Reset this session back to the problem snapshot? Candidate edits and generated runtime files will be cleared.')) return;

    const resetBtn = document.getElementById('reset-session-btn');
    const originalText = resetBtn ? resetBtn.textContent : '';
    if (resetBtn) {
      resetBtn.disabled = true;
      resetBtn.textContent = 'Resetting...';
    }

    try {
      await saveActiveSnapshotNow();
      const response = await fetch('/api/sessions/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...Auth.getAuthHeaders()
        },
        body: JSON.stringify({
          sessionId: currentSessionCode
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to reset session');
      }

      alert('Workspace reset to the problem snapshot. The page will reload.');
      window.location.reload();
    } catch (error) {
      console.error('Error resetting session:', error);
      alert('Failed to reset the session: ' + error.message);
    } finally {
      if (resetBtn) {
        resetBtn.disabled = false;
        resetBtn.textContent = originalText || 'Reset Workspace';
      }
    }
  }
  
  // Monitor for session termination
  function monitorSessionTermination() {
    if (!sessionRef) return;
    
    // Both admin and non-admin should monitor, but respond differently
    sessionRef.child('terminated').on('value', function(snapshot) {
      const data = snapshot.val();
      if (data && data.terminated) {
        console.log('Session has been terminated');
        
        if (!currentUser.isAdmin || !isEndingSession) {
          // Candidates and other interviewers should leave the ended session.
          if (window.saveActivitySummary) {
            window.saveActivitySummary();
          }
          showSessionTerminatedModal();
        }
        // The interviewer who clicked End will navigate via endSession().
      }
    });
  }
  
  // Show session terminated modal
  function showSessionTerminatedModal() {
    const modal = ensureSessionTerminatedModal();
    if (modal) {
      modal.style.display = 'flex';
      
      // Disable the editor
      if (editor) {
        editor.setReadOnly(true);
      }
      
    }
  }

  function ensureSessionTerminatedModal() {
    const existing = document.getElementById('session-terminated-modal');
    if (existing) return existing;

    const modal = document.createElement('div');
    modal.id = 'session-terminated-modal';
    modal.className = 'modal session-ended-modal';

    const card = document.createElement('div');
    card.className = 'modal-content session-ended-card';

    const icon = document.createElement('div');
    icon.className = 'session-ended-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.appendChild(createIcon('i-x', 'ic-18'));

    const title = document.createElement('h2');
    title.textContent = 'Interview Ended';

    const message = document.createElement('p');
    message.textContent = 'This interview has been ended by the interviewer.';

    const returnHomeButton = document.createElement('button');
    returnHomeButton.id = 'return-home-after-ended';
    returnHomeButton.className = 'session-ended-action';
    returnHomeButton.type = 'button';
    returnHomeButton.textContent = 'Return to Home';
    returnHomeButton.addEventListener('click', function() {
      window.location.replace(window.location.pathname + window.location.search);
    });

    card.append(icon, title, message, returnHomeButton);
    modal.appendChild(card);
    document.body.appendChild(modal);
    return modal;
  }

  // Run code execution
  async function runCode() {
    const runBtn = document.getElementById('run-btn');
    const selectedLanguage = document.getElementById('language-selector').value;
    const code = editor.getValue();
    const input = document.getElementById('stdin-input').value;
    const projectSnapshot = window.CollabWorkspace?.isEnabled?.()
      ? window.CollabWorkspace.getCurrentProjectSnapshot(code)
      : null;
    const language = projectSnapshot?.entryLanguage || selectedLanguage;
    const entryPath = projectSnapshot?.entryPath || activeFileMeta?.path || 'current file';

    // Check if language supports execution
    if (!CodeExecutor.isSupported(language)) {
      const message = `Language '${language}' does not support execution yet.`;
      showOutput(message, 'error');
      await publishRunResult('error', { language, entryPath, error: message, output: message });
      return;
    }

    // Show output panel
    showOutput('Running in Blaxel...', 'info');
    await publishRunResult('running', { language, entryPath, output: 'Running in Blaxel...' });
    runBtn.disabled = true;
    runBtn.textContent = 'Running...';

    try {
      await saveActiveSnapshotNow();

      const executionContext = {
        sessionId: currentSessionCode,
        runById: currentUser?.id || null,
        runByName: currentUser?.name || null
      };
      const result = projectSnapshot && CodeExecutor.executeProject
        ? await CodeExecutor.executeProject(language, projectSnapshot.files, projectSnapshot.entryPath, input, executionContext)
        : await CodeExecutor.execute(language, code, input, { ...executionContext, entryPath });
      
      if (result.success) {
        let output = result.output || '(No output)';
        let runtimeFileCount = 0;
        if (Array.isArray(result.runtimeFiles) && result.runtimeFiles.length && window.CollabWorkspace?.saveRuntimeFiles) {
          await window.CollabWorkspace.saveRuntimeFiles(result.runtimeFiles);
          runtimeFileCount = result.runtimeFiles.length;
          output += `\n\nGenerated ${result.runtimeFiles.length} session file${result.runtimeFiles.length === 1 ? '' : 's'}.`;
        }
        if (result.executionTime) {
          output += `\n\nExecution time: ${result.executionTime}ms`;
        }
        showOutput(output, 'success');
        await publishRunResult('success', {
          language,
          entryPath,
          output,
          runtimeFileCount,
          executionTime: result.executionTime || null
        });
      } else {
        const message = result.error || 'Execution failed';
        showOutput(message, 'error');
        await publishRunResult('error', { language, entryPath, error: message, output: message });
      }
    } catch (error) {
      const message = `Error: ${error.message}`;
      showOutput(message, 'error');
      await publishRunResult('error', { language, entryPath, error: message, output: message });
    } finally {
      runBtn.disabled = false;
      setRunButtonIdle(runBtn);
    }
  }

  // Show output panel
  function showOutput(text, type = 'normal') {
    const outputPanel = document.getElementById('output-panel');
    const outputText = document.getElementById('output-text');
    
    outputPanel.style.display = 'flex';
    window.CollabPanelLayout?.selectRightTab?.('output');
    outputText.textContent = text;
    outputText.className = type;

    // Show input section for languages that might need it
    const language = document.getElementById('language-selector').value;
    const inputSection = document.getElementById('input-section');
    if (['python', 'java', 'c_cpp', 'javascript', 'typescript'].includes(language)) {
      inputSection.style.display = 'block';
    }
  }

  // Clear output
  function clearOutput() {
    const outputText = document.getElementById('output-text');
    outputText.textContent = '';
    outputText.className = '';
  }

  // Hide output panel
  function hideOutput() {
    const outputPanel = document.getElementById('output-panel');
    outputPanel.style.display = 'none';
  }

  // Show notification
  function showNotification(message) {
    // Remove any existing notifications
    const existing = document.querySelector('.notification');
    if (existing) existing.remove();
    
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.classList.add('is-exiting');
      setTimeout(() => notification.remove(), 300);
    }, 4000);
  }

  // Update cursor position display
  function updateCursorPosition() {
    const position = editor.getCursorPosition();
    const display = document.getElementById('cursor-position');
    if (display) {
      display.textContent = `Line ${position.row + 1}, Column ${position.column + 1}`;
    }
  }

  // Generate user color
  function generateUserColor() {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
      '#DDA0DD', '#98D8C8', '#FFD700', '#FF69B4', '#00CED1'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

})();
