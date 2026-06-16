(function() {
  // Variables
  let firepad = null;
  let editor = null;
  let session = null;
  let currentUser = null;
  let usersRef = null;
  let sessionRef = null;
  let firepadRef = null;
  let languageModes = {};
  let currentSessionCode = null;
  let previousUsers = {};
  let isInitialized = false;
  let firepadReady = false;
  
  // Session termination modal HTML
  const terminationModalHTML = `
    <div id="session-terminated-modal" class="modal" style="display: none; z-index: 10000;">
      <div class="modal-content" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border: 2px solid #fff; box-shadow: 0 20px 60px rgba(102, 126, 234, 0.5);">
        <h2 style="color: #ffffff; font-size: 28px; margin-bottom: 20px; text-shadow: 0 2px 4px rgba(0,0,0,0.2);">Interview Ended</h2>
        <div style="background: rgba(255,255,255,0.95); padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <p style="color: #333; font-size: 16px; margin-bottom: 10px;">This interview has been terminated by the interviewer.</p>
          <p style="color: #555; font-size: 15px;">Thank you for your participation!</p>
        </div>
        <button onclick="location.reload()" class="primary-btn" style="background: #fff; color: #667eea; font-weight: bold; font-size: 16px; padding: 12px 30px; border: 2px solid #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.2);">Return to Home</button>
      </div>
    </div>
  `;
  
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

  // Initialize the application (called from app.js)
  window.initializeSession = function(options) {
    // CRITICAL: Prevent multiple initializations
    if (isInitialized) {
      console.warn('⚠️ Session already initialized, blocking re-initialization');
      return;
    }
    isInitialized = true;
    
    const { userName, sessionCode, isNew, isAdmin } = options;
    
    console.log('=== INITIALIZING SESSION (ONCE) ===');
    console.log('User:', userName, 'Code:', sessionCode, 'New:', isNew, 'Admin:', isAdmin);
    
    currentSessionCode = sessionCode;
    currentUser = {
      name: userName,
      id: 'user_' + Math.random().toString(36).substr(2, 9),
      color: generateUserColor(),
      isAdmin: isAdmin
    };
    
    // Initialize components
    initializeEditor();
    initializeFirebase(isNew);
    setupEventListenersOnce();
    
    // Update UI based on role
    const endSessionBtn = document.getElementById('end-session-btn');
    
    if (isAdmin) {
      console.log('Admin user detected - showing End Interview button');
      const sessionInfo = document.getElementById('session-info');
      if (sessionInfo && !sessionInfo.innerHTML.includes('Admin')) {
        sessionInfo.innerHTML += ' <span style="color: #4caf50">(Admin)</span>';
      }
      
      // Admin keeps the button visible (it's visible by default now)
      if (endSessionBtn) {
        console.log('End Interview button is visible for admin');
      }
    } else {
      console.log('Non-admin user - hiding End Interview button');
      // Hide button for non-admin users
      if (endSessionBtn) {
        endSessionBtn.style.display = 'none';
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
    
    console.log('Editor initialized - ReadOnly:', editor.getReadOnly());
  }

  // Initialize Firebase and Firepad
  function initializeFirebase(isNew) {
    // Clean up any existing Firepad
    if (firepad) {
      console.log('Cleaning up existing Firepad...');
      try {
        firepad.dispose();
      } catch(e) {
        console.error('Error disposing Firepad:', e);
      }
      firepad = null;
      firepadReady = false;
    }
    
    // Clear any existing Firebase listeners
    if (sessionRef) {
      sessionRef.off();
    }
    if (usersRef) {
      usersRef.off();
    }
    
    // For non-admins joining, verify session exists first
    if (!isNew && !currentUser.isAdmin) {
      const sessionCheck = firebase.database().ref('sessions').child(currentSessionCode);
      sessionCheck.once('value').then(function(snapshot) {
        const data = snapshot.val();
        if (!data || !data.created || !data.createdBy) {
          console.error('Invalid session - not created by admin');
          alert('Invalid session code. This session does not exist.');
          location.reload();
          return;
        }
      });
    }
    
    // Create new Firebase references
    const ref = firebase.database().ref('sessions').child(currentSessionCode);
    firepadRef = ref.child('firepad');
    sessionRef = ref;
    usersRef = ref.child('users');
    
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

    console.log('Creating Firepad instance...');
    console.log('User info:', { 
      id: currentUser.id, 
      name: currentUser.name, 
      isAdmin: currentUser.isAdmin 
    });
    
    try {
      // Ensure editor is editable for all users
      editor.setReadOnly(false);
      
      // Create Firepad with minimal options
      const currentLanguage = document.getElementById('language-selector')?.value || 'javascript';
      firepad = Firepad.fromACE(firepadRef, editor, {
        defaultText: isNew ? getDefaultCode(currentLanguage) : '',
        userId: currentUser.id
      });
      
      console.log('✅ Firepad instance created');
      console.log('Editor read-only status:', editor.getReadOnly());
      
      // Setup ready handler ONCE
      firepad.on('ready', function() {
        if (firepadReady) {
          console.warn('Firepad ready already triggered, ignoring duplicate');
          return;
        }
        firepadReady = true;
        
        console.log('🟢 Firepad READY! Session', currentSessionCode, 'is active');
        
        // Ensure editor stays editable after Firepad initialization
        if (editor.getReadOnly()) {
          console.warn('Editor was read-only after Firepad init, fixing...');
          editor.setReadOnly(false);
        }
        
        // Check if there's existing content
        const content = editor.getValue();
        console.log('Session content length:', content.length);
        console.log('Final editor state - ReadOnly:', editor.getReadOnly());
        
        if (!isNew) {
          // Announce joining for existing session
          showUserNotification(`You joined session ${currentSessionCode}`, 'join');
        }
      });
      
      // Setup presence AFTER Firepad is ready
      setTimeout(() => setupPresenceOnce(), 100);
      
      // Setup session info
      setupSessionInfo();
      
      // Setup settings sync
      setupSettingsSync();
      
    } catch (error) {
      console.error('❌ Failed to create Firepad:', error);
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
    notification.innerHTML = `
      <span class="icon">${type === 'join' ? '👋' : '👋'}</span>
      <span>${message}</span>
    `;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'fadeOut 0.3s ease';
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
  function updateUsersList(users) {
    const usersList = document.getElementById('users-list');
    if (!usersList) return;
    
    usersList.innerHTML = '';
    Object.keys(users).forEach(userId => {
      const user = users[userId];
      const badge = document.createElement('div');
      badge.className = 'user-badge';
      if (userId === currentUser.id) {
        badge.className += ' current-user';
      }
      badge.textContent = user.name;
      badge.style.borderLeft = `3px solid ${user.color}`;
      usersList.appendChild(badge);
    });
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
    if (sessionInfo && !sessionInfo.innerHTML.includes(currentSessionCode)) {
      sessionInfo.innerHTML = `Session Code: <strong>${currentSessionCode}</strong>`;
    }
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
        settingsRef.child('language').set(language);
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
        if (settings.language) {
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
    
    // Save the final code before ending the session
    const finalCode = editor ? editor.getValue() : '';
    const language = document.getElementById('language-selector')?.value || 'javascript';
    
    if (!sessionRef) {
      console.error('No session reference available');
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
          language
        })
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to end session');
      }

      console.log('Session terminated successfully with code and participants saved');
      alert('Interview ended. Code has been saved. All participants have been disconnected.');
      setTimeout(() => location.reload(), 800);
    } catch (error) {
      console.error('Error terminating session:', error);
      alert('Failed to end the interview: ' + error.message);
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
        
        if (!currentUser.isAdmin) {
          // Non-admin: show termination modal
          showSessionTerminatedModal();
        }
        // Admin will reload via the endSession function
      }
    });
  }
  
  // Show session terminated modal
  function showSessionTerminatedModal() {
    // Add modal to page if not already present
    if (!document.getElementById('session-terminated-modal')) {
      document.body.insertAdjacentHTML('beforeend', terminationModalHTML);
    }
    
    // Show the modal
    const modal = document.getElementById('session-terminated-modal');
    if (modal) {
      modal.style.display = 'flex';
      
      // Disable the editor
      if (editor) {
        editor.setReadOnly(true);
      }
      
      // Disconnect from Firebase
      if (firepad) {
        try {
          firepad.dispose();
        } catch(e) {
          console.error('Error disposing Firepad:', e);
        }
      }
    }
  }

  // Run code execution
  async function runCode() {
    const runBtn = document.getElementById('run-btn');
    const language = document.getElementById('language-selector').value;
    const code = editor.getValue();
    const input = document.getElementById('stdin-input').value;

    // Check if language supports execution
    if (!CodeExecutor.isSupported(language)) {
      showOutput(`Language '${language}' does not support execution yet.`, 'error');
      return;
    }

    // Show output panel
    showOutput('Running...', 'info');
    runBtn.disabled = true;
    runBtn.textContent = 'Running...';

    try {
      const result = await CodeExecutor.execute(language, code, input);
      
      if (result.success) {
        let output = result.output || '(No output)';
        if (result.executionTime) {
          output += `\n\nExecution time: ${result.executionTime}ms`;
        }
        showOutput(output, 'success');
      } else {
        showOutput(result.error || 'Execution failed', 'error');
      }
    } catch (error) {
      showOutput(`Error: ${error.message}`, 'error');
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = '▶ Run';
    }
  }

  // Show output panel
  function showOutput(text, type = 'normal') {
    const outputPanel = document.getElementById('output-panel');
    const outputText = document.getElementById('output-text');
    
    outputPanel.style.display = 'flex';
    outputText.textContent = text;
    outputText.className = type;

    // Show input section for languages that might need it
    const language = document.getElementById('language-selector').value;
    const inputSection = document.getElementById('input-section');
    if (['python', 'java', 'c_cpp', 'javascript'].includes(language)) {
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
    notification.style.cssText = `
      position: fixed;
      top: 70px;
      right: 20px;
      background: #4caf50;
      color: white;
      padding: 14px 20px;
      border-radius: 6px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 10001;
      font-size: 14px;
      max-width: 400px;
      animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s ease';
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
