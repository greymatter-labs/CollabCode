(function() {
  // Variables
  let editor = null;
  let currentUser = null;
  let usersRef = null;
  let sessionRef = null;
  let lastRunRef = null;
  let runHistoryRef = null;
  let outputInteractionRef = null;
  let outputSelectionsRef = null;
  let outputScrollRef = null;
  let problemSource = {};
  let problemMeta = {};
  let problemPanelOpen = null;
  let problemPoppedOut = false;
  let problemPopout = null;
  let problemPopoutRect = null;
  let problemPromptHydrateKey = '';
  let currentSessionCode = null;
  let previousUsers = {};
  let isInitialized = false;
  let isEndingSession = false;
  let isNewSession = false;
  let isReviewMode = false;
  let activeFileId = null;
  let activeFileMeta = null;
  let joinedNotificationShown = false;
  let lastRunFallback = null;
  let outputRuns = [];
  let outputScrollWriteTimer = null;
  let outputSelectionWriteTimer = null;
  let applyingRemoteOutputScroll = false;
  let remoteOutputSelections = {};
  let outputHighlightNames = new Set();

  const MAX_RUN_HISTORY = 80;
  const OUTPUT_SCROLL_SYNC_MS = 120;
  const OUTPUT_SELECTION_SYNC_MS = 80;

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
    
    const { userName, userEmail, sessionCode, isNew, isAdmin, isReview } = options;
    
    console.log('=== INITIALIZING SESSION (ONCE) ===');
    console.log('User:', userName, 'Code:', sessionCode, 'New:', isNew, 'Admin:', isAdmin);
    
    currentSessionCode = sessionCode;
    isNewSession = !!isNew;
    isReviewMode = isReview === true;
    currentUser = {
      name: userName,
      displayName: formatPresenceDisplayName(userName, userEmail, isAdmin),
      id: 'user_' + Math.random().toString(36).substr(2, 9),
      color: generateUserColor(),
      isAdmin: isAdmin,
      role: isReviewMode ? 'reviewer' : (isAdmin ? 'interviewer' : 'candidate')
    };
    
    // Initialize components
    initializeEditor();
    initializeFirebase(isNew);
    setupEventListenersOnce();
    
    // Update UI based on role
    const endSessionBtn = document.getElementById('end-session-btn');
    const resetSessionBtn = document.getElementById('reset-session-btn');
    const reviewHomeBtn = document.getElementById('review-home-btn');
    
    if (isReviewMode) {
      console.log('Review mode detected - disabling live interview controls');
      setupSessionInfo();
      if (reviewHomeBtn) {
        reviewHomeBtn.style.display = 'inline-flex';
      }
      [endSessionBtn, resetSessionBtn, document.getElementById('run-btn'), document.getElementById('share-btn')].forEach(button => {
        if (button) {
          button.style.display = 'none';
        }
      });
      const languageSelector = document.getElementById('language-selector');
      if (languageSelector) {
        languageSelector.disabled = true;
      }
    } else if (isAdmin) {
      console.log('Admin user detected - showing End Interview button');
      setupSessionInfo();
      if (reviewHomeBtn) {
        reviewHomeBtn.style.display = 'none';
      }
      
      // Admin keeps the button visible (it's visible by default now)
      if (endSessionBtn) {
        console.log('End Interview button is visible for admin');
      }
      if (resetSessionBtn) {
        resetSessionBtn.style.display = 'inline-block';
      }
    } else {
      console.log('Non-admin user - hiding End Interview button');
      if (reviewHomeBtn) {
        reviewHomeBtn.style.display = 'none';
      }
      // Hide button for non-admin users
      if (endSessionBtn) {
        endSessionBtn.style.display = 'none';
      }
      if (resetSessionBtn) {
        resetSessionBtn.style.display = 'none';
      }
    }
  }

  // Initialize Monaco editor
  function initializeEditor() {
    // Prevent duplicate editor creation
    if (editor) {
      console.warn('Editor already exists');
      return;
    }
    
    console.log('Creating Monaco editor...');
    const container = document.getElementById('firepad-container');
    if (!container || !window.CollabEditor?.create) {
      throw new Error('Collaborative editor module did not load');
    }

    editor = window.CollabEditor.create({
      container,
      readOnly: isReviewMode,
      theme: document.getElementById('theme-selector')?.value || 'monokai',
      fontSize: document.getElementById('fontSize-selector')?.value || '14',
      currentUser,
      onSelectionChange: updateCursorPosition
    });

    // Access is finalized once the active workspace file loads.
    editor.setReadOnly(isReviewMode);
    editor.focus();
    
    console.log('Editor initialized - ReadOnly:', editor.getReadOnly?.());
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
    if (runHistoryRef) {
      runHistoryRef.off();
      runHistoryRef = null;
    }
    teardownOutputInteractionSync();
    lastRunFallback = null;
    outputRuns = [];
    remoteOutputSelections = {};
    clearOutputHighlights();
    
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
    runHistoryRef = ref.child('runHistory');
    outputInteractionRef = ref.child('outputInteraction');
    
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
      // Access is finalized once the active workspace file loads.
      editor.setReadOnly(isReviewMode);

      if (!window.CollabWorkspace || !window.CollabWorkspace.init) {
        throw new Error('Workspace editor module did not load');
      }

      window.CollabWorkspace.init({
        sessionRef,
        currentUser,
        isNew,
        readOnly: isReviewMode,
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
      if (!isReviewMode) {
        setTimeout(() => setupPresenceOnce(), 100);
      }
      
      // Setup session info
      setupSessionInfo();
      
      // Setup settings sync
      setupSettingsSync();

      // Share the latest run result with every participant.
      setupLastRunSync();
      setupRunHistorySync();
      setupOutputInteractionSync();

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
      hideProblemPopout();
      return;
    }

    if (problemPanelOpen === null) {
      problemPanelOpen = true;
    }

    maybeHydrateMissingProblemPrompt(data);

    title.textContent = data.title || 'Problem';
    prompt.textContent = data.prompt || 'No problem instructions were saved for this session.';
    syncProblemPopoutContent(data);
    button.style.display = 'inline-flex';

    if (problemPoppedOut) {
      panel.style.display = 'none';
      button.classList.add('active');
      button.setAttribute('aria-expanded', 'true');
      window.CollabPanelLayout?.refresh?.();
      return;
    }

    panel.style.display = problemPanelOpen ? 'flex' : 'none';
    button.classList.toggle('active', problemPanelOpen);
    button.setAttribute('aria-expanded', String(problemPanelOpen));
  }

  function setupProblemPopoutControls() {
    const tab = document.getElementById('right-dock-tab-problem');
    if (tab && tab.dataset.problemPopoutReady !== 'true') {
      tab.dataset.problemPopoutReady = 'true';
      tab.title = 'Double-click to pop out problem';
      tab.addEventListener('dblclick', function(event) {
        event.preventDefault();
        event.stopPropagation();
        popOutProblemPanel();
      });
    }

    window.addEventListener('resize', constrainProblemPopout);
  }

  function ensureProblemPopout() {
    if (problemPopout && document.body.contains(problemPopout)) return problemPopout;

    problemPopout = document.createElement('section');
    problemPopout.id = 'problem-popout';
    problemPopout.className = 'problem-popout';
    problemPopout.setAttribute('role', 'dialog');
    problemPopout.setAttribute('aria-label', 'Problem prompt');
    problemPopout.style.display = 'none';

    const header = document.createElement('div');
    header.className = 'problem-popout__header';

    const titleLabel = document.createElement('span');
    titleLabel.className = 'problem-popout__label';
    titleLabel.append(createIcon('i-book'), document.createTextNode('Problem'));

    const actions = document.createElement('div');
    actions.className = 'problem-popout__actions';

    const dockButton = document.createElement('button');
    dockButton.className = 'problem-popout__button';
    dockButton.type = 'button';
    dockButton.title = 'Dock problem';
    dockButton.setAttribute('aria-label', 'Dock problem');
    dockButton.appendChild(createIcon('i-arrow-right'));
    dockButton.addEventListener('click', dockProblemPopout);

    const closeButton = document.createElement('button');
    closeButton.className = 'problem-popout__button';
    closeButton.type = 'button';
    closeButton.title = 'Close problem popout';
    closeButton.setAttribute('aria-label', 'Close problem popout');
    closeButton.appendChild(createIcon('i-x'));
    closeButton.addEventListener('click', dockProblemPopout);

    actions.append(dockButton, closeButton);
    header.append(titleLabel, actions);

    const body = document.createElement('div');
    body.className = 'problem-popout__body';

    const title = document.createElement('h2');
    title.id = 'problem-popout-title';

    const prompt = document.createElement('pre');
    prompt.id = 'problem-popout-prompt';

    body.append(title, prompt);

    const resizeHandle = document.createElement('span');
    resizeHandle.className = 'problem-popout__resize';
    resizeHandle.setAttribute('aria-hidden', 'true');

    problemPopout.append(header, body, resizeHandle);
    document.body.appendChild(problemPopout);

    header.addEventListener('pointerdown', beginProblemPopoutDrag);
    resizeHandle.addEventListener('pointerdown', beginProblemPopoutResize);
    problemPopout.addEventListener('pointerdown', bringProblemPopoutForward);

    return problemPopout;
  }

  function defaultProblemPopoutRect() {
    const width = Math.min(560, Math.max(360, Math.round(window.innerWidth * 0.36)));
    const height = Math.min(640, Math.max(340, Math.round(window.innerHeight * 0.62)));
    return {
      width,
      height,
      left: Math.max(16, window.innerWidth - width - 64),
      top: Math.max(76, Math.min(150, Math.round((window.innerHeight - height) / 2)))
    };
  }

  function clampProblemPopoutRect(rect) {
    const minWidth = 320;
    const minHeight = 260;
    const margin = 12;
    const width = Math.min(Math.max(rect.width, minWidth), Math.max(minWidth, window.innerWidth - margin * 2));
    const height = Math.min(Math.max(rect.height, minHeight), Math.max(minHeight, window.innerHeight - margin * 2));
    return {
      width,
      height,
      left: Math.min(Math.max(rect.left, margin), Math.max(margin, window.innerWidth - width - margin)),
      top: Math.min(Math.max(rect.top, margin), Math.max(margin, window.innerHeight - height - margin))
    };
  }

  function applyProblemPopoutRect(rect) {
    if (!problemPopout) return;
    problemPopoutRect = clampProblemPopoutRect(rect || problemPopoutRect || defaultProblemPopoutRect());
    problemPopout.style.left = `${problemPopoutRect.left}px`;
    problemPopout.style.top = `${problemPopoutRect.top}px`;
    problemPopout.style.width = `${problemPopoutRect.width}px`;
    problemPopout.style.height = `${problemPopoutRect.height}px`;
  }

  function bringProblemPopoutForward() {
    if (!problemPopout) return;
    problemPopout.style.zIndex = String(90 + Date.now() % 1000);
  }

  function constrainProblemPopout() {
    if (!problemPopout || problemPopout.style.display === 'none') return;
    applyProblemPopoutRect(problemPopoutRect);
  }

  function beginProblemPopoutDrag(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest('button')) return;
    event.preventDefault();
    bringProblemPopoutForward();
    const rect = problemPopoutRect || defaultProblemPopoutRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = rect.left;
    const startTop = rect.top;

    const onPointerMove = moveEvent => {
      applyProblemPopoutRect({
        ...rect,
        left: startLeft + moveEvent.clientX - startX,
        top: startTop + moveEvent.clientY - startY
      });
    };

    const finish = () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      document.body.classList.remove('is-dragging-popout');
    };

    document.body.classList.add('is-dragging-popout');
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
  }

  function beginProblemPopoutResize(event) {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    bringProblemPopoutForward();
    const rect = problemPopoutRect || defaultProblemPopoutRect();
    const startX = event.clientX;
    const startY = event.clientY;

    const onPointerMove = moveEvent => {
      applyProblemPopoutRect({
        ...rect,
        width: rect.width + moveEvent.clientX - startX,
        height: rect.height + moveEvent.clientY - startY
      });
    };

    const finish = () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      document.body.classList.remove('is-resizing-popout');
    };

    document.body.classList.add('is-resizing-popout');
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
  }

  function syncProblemPopoutContent(data = getProblemSidebarData()) {
    if (!problemPopout) return;
    const title = problemPopout.querySelector('#problem-popout-title');
    const prompt = problemPopout.querySelector('#problem-popout-prompt');
    if (title) title.textContent = data.title || 'Problem';
    if (prompt) prompt.textContent = data.prompt || 'No problem instructions were saved for this session.';
  }

  function hideProblemPopout() {
    problemPoppedOut = false;
    if (problemPopout) {
      problemPopout.style.display = 'none';
    }
  }

  function popOutProblemPanel() {
    const data = getProblemSidebarData();
    if (!data.hasProblem) return;

    const popout = ensureProblemPopout();
    syncProblemPopoutContent(data);
    problemPoppedOut = true;
    problemPanelOpen = false;
    popout.style.display = 'flex';
    applyProblemPopoutRect(problemPopoutRect || defaultProblemPopoutRect());
    bringProblemPopoutForward();

    const panel = document.getElementById('problem-panel');
    if (panel) panel.style.display = 'none';
    const outputPanel = document.getElementById('output-panel');
    if (outputPanel) outputPanel.style.display = 'flex';
    renderProblemSidebar();
    renderOutputTimeline(getVisibleOutputRuns(), { preserveScroll: true, showWhenEmpty: true });
    window.CollabPanelLayout?.selectRightTab?.('output');
  }

  function dockProblemPopout() {
    problemPoppedOut = false;
    if (problemPopout) {
      problemPopout.style.display = 'none';
    }
    problemPanelOpen = true;
    renderProblemSidebar();
    window.CollabPanelLayout?.selectRightTab?.('problem');
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
    return !isReviewMode && !!file && file.readonly !== true && file.role !== 'runtime';
  }

  function applyEditorAccessForFile(file, shouldFocus = false) {
    if (!editor || !file) return;

    const writable = isWritableWorkspaceFile(file);
    editor.setReadOnly(!writable);

    if (writable && shouldFocus) {
      editor.focus();
    }
  }

  async function openWorkspaceFile(file, snapshot, collabContext) {
    if (!file || !editor) return;
    if (activeFileId === file.id && (file.readonly || file.role === 'runtime')) return;

    activeFileId = file.id;
    activeFileMeta = file;

    const languageSelector = document.getElementById('language-selector');
    if (languageSelector && languageSelector.value !== file.language) {
      languageSelector.value = file.language;
    }
    changeLanguage(file.language);

    editor.openFile(file, snapshot, collabContext || {});
    applyEditorAccessForFile(file);

    applyEditorAccessForFile(file, true);
    updateCursorPosition();
    console.log('Opened workspace file:', file.path);

    if (!isReviewMode && !isNewSession && !joinedNotificationShown) {
      joinedNotificationShown = true;
      showUserNotification(`You joined session ${currentSessionCode}`, 'join');
    }
  }

  async function saveActiveSnapshotNow() {
    if (isReviewMode) return;
    if (!editor || !activeFileId || !window.CollabWorkspace?.isEnabled?.()) return;

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

    if (isReviewMode || currentUser?.isAdmin) {
      const roleBadge = document.createElement('span');
      roleBadge.className = 'session-role-pill';
      if (isReviewMode) {
        roleBadge.classList.add('session-role-pill--review');
      }
      roleBadge.textContent = isReviewMode ? 'Review' : 'Admin';
      sessionInfo.appendChild(roleBadge);
    }

    if (isReviewMode) {
      const userCountEl = document.getElementById('user-count');
      const usersList = document.getElementById('users-list');
      if (userCountEl) userCountEl.textContent = 'Read-only ended session';
      if (usersList) usersList.replaceChildren();
    }
  }

  function setupLastRunSync() {
    if (!lastRunRef) return;

    lastRunRef.off();
    lastRunRef.on('value', function(snapshot) {
      const run = snapshot.val();
      lastRunFallback = run ? normalizeRunRecord(run, 'last-run') : null;
      if (!outputRuns.length) {
        renderOutputTimeline(getVisibleOutputRuns(), { preserveScroll: true });
      }
    });
  }

  function setupRunHistorySync() {
    if (!runHistoryRef) return;

    runHistoryRef.off();
    runHistoryRef.limitToLast(MAX_RUN_HISTORY).on('value', function(snapshot) {
      const runs = [];
      snapshot.forEach(function(child) {
        runs.push(normalizeRunRecord(child.val(), child.key));
      });
      outputRuns = runs
        .filter(Boolean)
        .sort((a, b) => (a.sortTime || 0) - (b.sortTime || 0));
      renderOutputTimeline(getVisibleOutputRuns(), { preserveScroll: true });
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

  function createRunId() {
    if (runHistoryRef?.push) return runHistoryRef.push().key;
    return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function toRunTimestamp(value, fallback) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) ? timestamp : fallback;
  }

  function normalizeRunRecord(run, fallbackId) {
    if (!run) return null;
    const status = run.status || 'info';
    const now = Date.now();
    const createdAt = toRunTimestamp(run.createdAt, now);
    const updatedAt = toRunTimestamp(run.updatedAt, createdAt);
    return {
      id: run.id || fallbackId || createRunId(),
      status,
      language: run.language || null,
      entryPath: run.entryPath || null,
      output: typeof run.output === 'string' ? run.output : '',
      error: typeof run.error === 'string' ? run.error : '',
      runtimeFileCount: Number(run.runtimeFileCount || 0),
      executionTime: run.executionTime || null,
      runById: run.runById || null,
      runByName: run.runByName || 'Someone',
      createdAt,
      updatedAt,
      sortTime: createdAt
    };
  }

  function getVisibleOutputRuns() {
    if (outputRuns.length) return outputRuns;
    return lastRunFallback ? [lastRunFallback] : [];
  }

  function getRunStatusClass(status) {
    if (status === 'success') return 'success';
    if (status === 'running') return 'info';
    if (status === 'error') return 'error';
    return 'normal';
  }

  function getRunOutputText(run) {
    if (!run) return '';
    return run.output || run.error || '(No output)';
  }

  function getRunSummary(run) {
    if (!run) return '';
    const runner = run.runByName || 'Someone';
    const entry = run.entryPath ? ` ${run.entryPath}` : '';
    const language = run.language ? ` ${run.language}` : '';
    const when = formatRunTime(run.updatedAt);
    const runtimeFiles = run.runtimeFileCount
      ? ` | generated ${run.runtimeFileCount} file${run.runtimeFileCount === 1 ? '' : 's'}`
      : '';
    return `${run.status || 'run'} by ${runner}${language}${entry}${when ? ` at ${when}` : ''}${runtimeFiles}`;
  }

  function showOutputPanel() {
    const outputPanel = document.getElementById('output-panel');
    if (outputPanel) outputPanel.style.display = 'flex';
    window.CollabPanelLayout?.selectRightTab?.('output');
  }

  function renderOutputTimeline(runs, options = {}) {
    const outputText = document.getElementById('output-text');
    const outputContent = document.getElementById('output-content');
    const lastRunSummary = document.getElementById('last-run-summary');
    if (!outputText || !outputContent) return;

    const normalizedRuns = (runs || []).filter(Boolean);
    const wasNearBottom = outputContent.scrollHeight - outputContent.scrollTop - outputContent.clientHeight < 48;
    const shouldPinToLatest = options.pinToLatest === true || (!options.preserveScroll && wasNearBottom);
    const previousTop = outputContent.scrollTop;

    const outputPanel = document.getElementById('output-panel');
    const shouldShowPanel = normalizedRuns.length > 0 || options.showWhenEmpty === true || outputPanel?.style.display !== 'none';
    if (shouldShowPanel) {
      showOutputPanel();
    }

    outputText.replaceChildren();

    if (!normalizedRuns.length) {
      const empty = document.createElement('div');
      empty.className = 'output-empty';
      empty.textContent = 'No runs yet.';
      outputText.appendChild(empty);
      if (lastRunSummary) {
        lastRunSummary.textContent = 'Execution history';
        lastRunSummary.className = 'normal';
      }
      clearOutputHighlights();
      return;
    }

    normalizedRuns.forEach((run, index) => {
      const status = getRunStatusClass(run.status);
      const item = document.createElement('article');
      item.className = `output-run output-run--${status}`;
      item.dataset.runId = run.id;

      const marker = document.createElement('div');
      marker.className = 'output-run-marker';
      marker.textContent = String(index + 1);

      const content = document.createElement('div');
      content.className = 'output-run-content';

      const header = document.createElement('div');
      header.className = 'output-run-header';

      const title = document.createElement('div');
      title.className = 'output-run-title';
      title.textContent = run.status === 'running' ? 'Running' : run.status === 'success' ? 'Completed' : run.status === 'error' ? 'Failed' : 'Run';

      const meta = document.createElement('div');
      meta.className = 'output-run-meta';
      meta.textContent = getRunSummary(run);

      header.append(title, meta);

      const body = document.createElement('pre');
      body.className = `output-run-body ${status}`;
      body.textContent = getRunOutputText(run);

      content.append(header, body);
      item.append(marker, content);
      outputText.appendChild(item);
    });

    const latestRun = normalizedRuns[normalizedRuns.length - 1];
    if (lastRunSummary) {
      lastRunSummary.textContent = getRunSummary(latestRun);
      lastRunSummary.className = getRunStatusClass(latestRun.status);
    }

    window.requestAnimationFrame(() => {
      if (shouldPinToLatest) {
        outputContent.scrollTop = outputContent.scrollHeight;
      } else if (options.preserveScroll) {
        outputContent.scrollTop = Math.min(previousTop, Math.max(0, outputContent.scrollHeight - outputContent.clientHeight));
      }
      renderOutputRemoteHighlights();
    });
  }

  function publishRunResult(status, details = {}) {
    if (isReviewMode) return Promise.resolve();
    if (!sessionRef) return Promise.resolve();

    const runId = details.runId || createRunId();
    const runRecord = {
      id: runId,
      status,
      language: details.language || null,
      entryPath: details.entryPath || null,
      output: details.output || '',
      error: details.error || '',
      runtimeFileCount: details.runtimeFileCount || 0,
      executionTime: details.executionTime || null,
      runById: currentUser?.id || null,
      runByName: currentUser?.name || null,
      createdAt: details.createdAt || firebase.database.ServerValue.TIMESTAMP,
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    };
    const updates = {
      lastRun: runRecord,
      [`runHistory/${runId}`]: runRecord
    };

    return sessionRef.update(updates);
  }

  function setupOutputInteractionSync() {
    if (!outputInteractionRef || !currentUser || isReviewMode) return;

    outputInteractionRef.off();
    outputSelectionsRef = outputInteractionRef.child('selections');
    outputScrollRef = outputInteractionRef.child('scroll');
    const localSelectionRef = outputSelectionsRef.child(currentUser.id);

    localSelectionRef.onDisconnect().remove();

    outputSelectionsRef.on('value', function(snapshot) {
      remoteOutputSelections = snapshot.val() || {};
      renderOutputRemoteHighlights();
    });

    outputScrollRef.on('value', function(snapshot) {
      const data = snapshot.val();
      applyRemoteOutputScroll(data);
    });

    attachOutputInteractionDomListeners();
  }

  function teardownOutputInteractionSync() {
    if (outputInteractionRef) {
      outputInteractionRef.off();
    }
    if (outputSelectionsRef) {
      outputSelectionsRef.off();
      outputSelectionsRef = null;
    }
    if (outputScrollRef) {
      outputScrollRef.off();
      outputScrollRef = null;
    }
    outputInteractionRef = null;
    if (outputScrollWriteTimer) {
      clearTimeout(outputScrollWriteTimer);
      outputScrollWriteTimer = null;
    }
    if (outputSelectionWriteTimer) {
      clearTimeout(outputSelectionWriteTimer);
      outputSelectionWriteTimer = null;
    }
    applyingRemoteOutputScroll = false;
  }

  function attachOutputInteractionDomListeners() {
    const outputContent = document.getElementById('output-content');
    if (outputContent && outputContent.dataset.outputCollabReady !== 'true') {
      outputContent.dataset.outputCollabReady = 'true';
      outputContent.addEventListener('scroll', queueOutputScrollSync, { passive: true });
    }

    if (document.body.dataset.outputSelectionCollabReady !== 'true') {
      document.body.dataset.outputSelectionCollabReady = 'true';
      document.addEventListener('selectionchange', queueOutputSelectionSync);
    }
  }

  function queueOutputScrollSync() {
    if (!outputInteractionRef || !currentUser || isReviewMode || applyingRemoteOutputScroll) return;
    if (outputScrollWriteTimer) return;

    outputScrollWriteTimer = setTimeout(function() {
      outputScrollWriteTimer = null;
      const outputContent = document.getElementById('output-content');
      if (!outputContent || document.getElementById('output-panel')?.style.display === 'none') return;

      const maxScrollTop = Math.max(0, outputContent.scrollHeight - outputContent.clientHeight);
      outputInteractionRef.child('scroll').set({
        top: outputContent.scrollTop,
        ratio: maxScrollTop ? outputContent.scrollTop / maxScrollTop : 0,
        scrollHeight: outputContent.scrollHeight,
        clientHeight: outputContent.clientHeight,
        updatedBy: currentUser.id,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      });
    }, OUTPUT_SCROLL_SYNC_MS);
  }

  function applyRemoteOutputScroll(data) {
    if (!data || !currentUser || data.updatedBy === currentUser.id) return;
    const outputContent = document.getElementById('output-content');
    if (!outputContent) return;

    const maxScrollTop = Math.max(0, outputContent.scrollHeight - outputContent.clientHeight);
    const ratio = Number(data.ratio);
    const top = Number.isFinite(ratio) ? ratio * maxScrollTop : Number(data.top || 0);
    applyingRemoteOutputScroll = true;
    outputContent.scrollTop = Math.min(Math.max(0, top), maxScrollTop);
    setTimeout(function() {
      applyingRemoteOutputScroll = false;
    }, OUTPUT_SCROLL_SYNC_MS + 30);
  }

  function getOutputRoot() {
    return document.getElementById('output-text');
  }

  function getAbsoluteTextOffset(root, container, offset) {
    if (!root || !container || (!root.contains(container) && root !== container)) return null;
    const range = document.createRange();
    range.selectNodeContents(root);
    try {
      range.setEnd(container, offset);
      return range.toString().length;
    } catch (error) {
      return null;
    } finally {
      range.detach?.();
    }
  }

  function getOutputSelectionOffsets() {
    const root = getOutputRoot();
    const selection = window.getSelection?.();
    if (!root || !selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    if (range.collapsed) return null;
    if ((!root.contains(range.startContainer) && root !== range.startContainer) ||
        (!root.contains(range.endContainer) && root !== range.endContainer)) {
      return null;
    }

    const start = getAbsoluteTextOffset(root, range.startContainer, range.startOffset);
    const end = getAbsoluteTextOffset(root, range.endContainer, range.endOffset);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return null;

    return {
      start: Math.min(start, end),
      end: Math.max(start, end),
      textLength: root.textContent.length
    };
  }

  function queueOutputSelectionSync() {
    if (!outputInteractionRef || !currentUser || isReviewMode) return;
    if (outputSelectionWriteTimer) {
      clearTimeout(outputSelectionWriteTimer);
    }

    outputSelectionWriteTimer = setTimeout(function() {
      outputSelectionWriteTimer = null;
      const localSelectionRef = outputInteractionRef.child('selections').child(currentUser.id);
      const range = getOutputSelectionOffsets();
      if (!range) {
        localSelectionRef.remove();
        return;
      }

      localSelectionRef.set({
        ...range,
        userId: currentUser.id,
        name: currentUser.name || 'Collaborator',
        color: currentUser.color || '#7c87e8',
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      });
    }, OUTPUT_SELECTION_SYNC_MS);
  }

  function getTextBoundaryAtOffset(root, offset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let remaining = Math.max(0, offset);
    let lastNode = null;

    while (node) {
      const length = node.nodeValue.length;
      if (remaining <= length) {
        return { node, offset: remaining };
      }
      remaining -= length;
      lastNode = node;
      node = walker.nextNode();
    }

    if (lastNode) {
      return { node: lastNode, offset: lastNode.nodeValue.length };
    }
    return null;
  }

  function sanitizeHighlightName(value) {
    return `opencall-output-${String(value || 'user').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  }

  function colorWithAlpha(color, alpha) {
    const fallback = 'rgba(124, 135, 232, .28)';
    const value = String(color || '').trim();
    if (!/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value)) return fallback;
    const hex = value.length === 4
      ? value.slice(1).split('').map(char => `${char}${char}`).join('')
      : value.slice(1);
    const numeric = Number.parseInt(hex, 16);
    if (!Number.isFinite(numeric)) return fallback;
    const red = (numeric >> 16) & 255;
    const green = (numeric >> 8) & 255;
    const blue = numeric & 255;
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  function getOutputHighlightStyleElement() {
    let style = document.getElementById('output-collab-highlight-styles');
    if (!style) {
      style = document.createElement('style');
      style.id = 'output-collab-highlight-styles';
      document.head.appendChild(style);
    }
    return style;
  }

  function clearOutputHighlights() {
    if (window.CSS?.highlights) {
      outputHighlightNames.forEach(name => CSS.highlights.delete(name));
    }
    outputHighlightNames = new Set();
    const style = document.getElementById('output-collab-highlight-styles');
    if (style) style.textContent = '';
  }

  function renderOutputRemoteHighlights() {
    if (!window.CSS?.highlights || typeof window.Highlight !== 'function') return;

    const root = getOutputRoot();
    if (!root) return;

    clearOutputHighlights();
    const rules = [];
    const textLength = root.textContent.length;

    Object.entries(remoteOutputSelections || {}).forEach(([userId, selection]) => {
      if (!selection || userId === currentUser?.id) return;
      const start = Math.max(0, Math.min(Number(selection.start || 0), textLength));
      const end = Math.max(0, Math.min(Number(selection.end || 0), textLength));
      if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return;

      const startBoundary = getTextBoundaryAtOffset(root, Math.min(start, end));
      const endBoundary = getTextBoundaryAtOffset(root, Math.max(start, end));
      if (!startBoundary || !endBoundary) return;

      try {
        const range = document.createRange();
        range.setStart(startBoundary.node, startBoundary.offset);
        range.setEnd(endBoundary.node, endBoundary.offset);
        const name = sanitizeHighlightName(userId);
        CSS.highlights.set(name, new Highlight(range));
        outputHighlightNames.add(name);
        rules.push(`::highlight(${name}) { background-color: ${colorWithAlpha(selection.color, 0.32)}; color: inherit; }`);
      } catch (error) {
        console.warn('Could not render shared output highlight:', error);
      }
    });

    getOutputHighlightStyleElement().textContent = rules.join('\n');
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
        if (isReviewMode) {
          changeLanguage(language);
        } else if (window.CollabWorkspace?.isEnabled?.()) {
          window.CollabWorkspace.updateActiveFileLanguage(language).catch(function(error) {
            console.warn('Could not update file language:', error);
          });
        } else {
          settingsRef.child('language').set(language);
        }
        changeLanguage(language);
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
        if (!isReviewMode) {
          settingsRef.child('theme').set(theme);
        }
        editor.setTheme(theme);
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
            editor.setTheme(settings.theme);
          }
        }
      }
    });
  }

  // Change language
  function changeLanguage(language) {
    editor?.setLanguage?.(language);
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
        if (problemPoppedOut) {
          ensureProblemPopout().style.display = 'flex';
          bringProblemPopoutForward();
          return;
        }
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

    setupProblemPopoutControls();

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

    const reviewHomeBtn = document.getElementById('review-home-btn');
    if (reviewHomeBtn) {
      reviewHomeBtn.addEventListener('click', function(e) {
        e.preventDefault();
        returnToHomeFromReview();
      });
    }

    // Font size selector
    const fontSizeSelector = document.getElementById('fontSize-selector');
    if (fontSizeSelector) {
      fontSizeSelector.addEventListener('change', function() {
        editor.setFontSize(this.value);
      });
    }
  }

  // Share session
  function shareSession() {
    if (isReviewMode) return;
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
    if (isReviewMode) return;
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

  function returnToHomeFromReview() {
    const target = window.location.pathname + window.location.search;
    window.location.assign(target || '/app.html');
  }

  async function resetSessionWorkspace() {
    if (isReviewMode) return;
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
    if (isReviewMode) return;
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
    if (isReviewMode) {
      showOutput('Review mode is read-only. Runs are disabled for ended sessions.', 'info');
      return;
    }
    const runBtn = document.getElementById('run-btn');
    const selectedLanguage = document.getElementById('language-selector').value;
    const code = editor.getValue();
    const input = document.getElementById('stdin-input').value;
    const projectSnapshot = window.CollabWorkspace?.isEnabled?.()
      ? window.CollabWorkspace.getCurrentProjectSnapshot(code)
      : null;
    const language = projectSnapshot?.entryLanguage || selectedLanguage;
    const entryPath = projectSnapshot?.entryPath || activeFileMeta?.path || 'current file';
    const runId = createRunId();
    const runCreatedAt = Date.now();

    // Check if language supports execution
    if (!CodeExecutor.isSupported(language)) {
      const message = `Language '${language}' does not support execution yet.`;
      showOutput(message, 'error');
      await publishRunResult('error', { runId, createdAt: runCreatedAt, language, entryPath, error: message, output: message });
      return;
    }

    // Show output panel
    showOutput('Running in Blaxel...', 'info');
    await publishRunResult('running', { runId, createdAt: runCreatedAt, language, entryPath, output: 'Running in Blaxel...' });
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
          runId,
          createdAt: runCreatedAt,
          language,
          entryPath,
          output,
          runtimeFileCount,
          executionTime: result.executionTime || null
        });
      } else {
        const message = result.error || 'Execution failed';
        showOutput(message, 'error');
        await publishRunResult('error', { runId, createdAt: runCreatedAt, language, entryPath, error: message, output: message });
      }
    } catch (error) {
      const message = `Error: ${error.message}`;
      showOutput(message, 'error');
      await publishRunResult('error', { runId, createdAt: runCreatedAt, language, entryPath, error: message, output: message });
    } finally {
      runBtn.disabled = false;
      setRunButtonIdle(runBtn);
    }
  }

  // Show output panel
  function showOutput(text, type = 'normal') {
    const status = type === 'success' ? 'success' : type === 'error' ? 'error' : type === 'info' ? 'running' : 'info';
    const previewRun = normalizeRunRecord({
      id: 'local-preview',
      status,
      language: document.getElementById('language-selector')?.value || null,
      entryPath: activeFileMeta?.path || null,
      output: String(text || ''),
      runById: currentUser?.id || null,
      runByName: currentUser?.name || 'You',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }, 'local-preview');

    const runs = getVisibleOutputRuns().filter(run => run.id !== 'local-preview').concat(previewRun);
    renderOutputTimeline(runs, { pinToLatest: true });

    // Show input section for languages that might need it
    const language = document.getElementById('language-selector')?.value;
    const inputSection = document.getElementById('input-section');
    if (inputSection && ['python', 'java', 'c_cpp', 'javascript', 'typescript'].includes(language)) {
      inputSection.style.display = 'block';
    }
  }

  // Clear output
  function clearOutput() {
    outputRuns = [];
    lastRunFallback = null;
    remoteOutputSelections = {};
    clearOutputHighlights();
    renderOutputTimeline([], { preserveScroll: false, showWhenEmpty: true });

    if (!isReviewMode && sessionRef) {
      const updates = {
        lastRun: null,
        runHistory: null,
        'outputInteraction/selections': null
      };
      sessionRef.update(updates).catch(function(error) {
        console.warn('Could not clear shared output history:', error);
      });
    }
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
