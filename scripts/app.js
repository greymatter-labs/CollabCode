// Main Application Controller
(function() {
  let appInitialized = false;
  let adminDashboardInitialized = false;

  const SESSION_CODE_LENGTH = 8;
  const SESSION_CODE_PATTERN = /^[A-Z0-9]{8}$/;

  function normalizeSessionCode(value) {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, SESSION_CODE_LENGTH);
  }

  function isValidSessionCode(value) {
    return SESSION_CODE_PATTERN.test(normalizeSessionCode(value));
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function iconMarkup(id, size = 14) {
    return `<svg class="ic ic-${size}" aria-hidden="true"><use href="#${id}"></use></svg>`;
  }

  async function createSessionViaApi(payload = {}) {
    const response = await fetch('/api/sessions/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...Auth.getAuthHeaders()
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success || !data.sessionId) {
      throw new Error(data.error || 'Failed to create session');
    }

    return data;
  }

  async function endSessionViaApi(sessionCode, payload = {}) {
    const response = await fetch('/api/sessions/end', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...Auth.getAuthHeaders()
      },
      body: JSON.stringify({
        sessionId: normalizeSessionCode(sessionCode),
        ...payload
      })
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to end session');
    }

    return data;
  }

  function getAdminDisplayName() {
    const currentUser = Auth.getCurrentUser();
    const interviewerName = document.getElementById('interviewerName')?.value.trim();
    const email = currentUser.email || '';
    if (interviewerName && email) return `${interviewerName} (${email})`;
    return interviewerName || email || 'Interviewer';
  }

  function updateInterviewerPreview() {
    const preview = document.getElementById('interviewerDisplayPreview');
    if (!preview) return;
    preview.textContent = getAdminDisplayName();
  }

  function clearSessionHash() {
    if (!window.location.hash) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function hideEditorSession() {
    const mainContainer = document.getElementById('main-container');
    if (mainContainer) {
      mainContainer.style.display = 'none';
    }

    const activeSession = document.getElementById('activeSession');
    if (activeSession) {
      activeSession.style.display = 'none';
    }
  }

  function showInitialScreen() {
    init();

    document.querySelectorAll('.modal').forEach(modal => {
      modal.style.display = 'none';
    });
    hideEditorSession();

    if (Auth.isAdmin()) {
      document.getElementById('adminDashboardModal').style.display = 'flex';
      setupAdminDashboard();
    } else {
      document.getElementById('landingModal').style.display = 'flex';
    }
  }

  function handleInvalidSession(message) {
    clearSessionHash();
    hideEditorSession();
    alert(message);
    showInitialScreen();
  }

  // Initialize the application
  function init() {
    if (appInitialized) {
      console.log('App already initialized, skipping duplicate setup');
      return;
    }
    appInitialized = true;

    setupLandingPage();
    setupCandidateFlow();
    setupAdminFlow();
    setupSessionDetailsModalHandlers();
  }

  function closeSessionDetailsModal() {
    const modal = document.getElementById('sessionDetailsModal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  function setupSessionDetailsModalHandlers() {
    document.addEventListener('click', function(event) {
      const closeButton = event.target.closest('#closeSessionDetailsBtn');
      if (closeButton) {
        closeSessionDetailsModal();
        return;
      }

      const modal = document.getElementById('sessionDetailsModal');
      if (modal && event.target === modal) {
        closeSessionDetailsModal();
      }
    });

    document.addEventListener('keydown', function(event) {
      const modal = document.getElementById('sessionDetailsModal');
      if (event.key === 'Escape' && modal && modal.style.display === 'flex') {
        closeSessionDetailsModal();
      }
    });
  }

  // Setup landing page
  function setupLandingPage() {
    // Candidate button - support both old and new classes
    const candidateBtn = document.querySelector('#candidateCard .role-btn');
    if (candidateBtn) {
      candidateBtn.addEventListener('click', function() {
        document.getElementById('landingModal').style.display = 'none';
        document.getElementById('candidateModal').style.display = 'flex';
      });
    }

    // Admin button - support both old and new classes
    const adminBtn = document.querySelector('#adminCard .role-btn');
    if (adminBtn) {
      adminBtn.addEventListener('click', function() {
        document.getElementById('landingModal').style.display = 'none';
        document.getElementById('adminLoginModal').style.display = 'flex';
      });
    }
  }

  // Setup candidate flow
  function setupCandidateFlow() {
    const candidateName = document.getElementById('candidateName');
    const candidateSessionCode = document.getElementById('candidateSessionCode');
    const candidateJoinBtn = document.getElementById('candidateJoinBtn');
    const candidateBack = document.getElementById('candidateBack');

    // Back button
    candidateBack.addEventListener('click', function() {
      document.getElementById('candidateModal').style.display = 'none';
      document.getElementById('landingModal').style.display = 'flex';
    });

    // Enable/disable join button
    function updateJoinButton() {
      const privacyConsent = document.getElementById('candidatePrivacyConsent');
      candidateJoinBtn.disabled =
        !candidateName.value.trim() ||
        !isValidSessionCode(candidateSessionCode.value) ||
        !privacyConsent.checked;
    }

    candidateName.addEventListener('input', updateJoinButton);
    candidateSessionCode.addEventListener('input', function() {
      this.value = normalizeSessionCode(this.value);
      updateJoinButton();
    });

    // Privacy consent checkbox
    const privacyConsent = document.getElementById('candidatePrivacyConsent');
    if (privacyConsent) {
      privacyConsent.addEventListener('change', updateJoinButton);
    }

    // Join session
    candidateJoinBtn.addEventListener('click', async function() {
      const name = candidateName.value.trim();
      const sessionCode = normalizeSessionCode(candidateSessionCode.value);

      if (name && isValidSessionCode(sessionCode)) {
        // Show loading state
        candidateJoinBtn.disabled = true;
        candidateJoinBtn.textContent = 'Validating...';

        // Validate session exists before joining (pass true for isCandidate)
        const validation = await validateSession(sessionCode, true);

        if (!validation.valid) {
          candidateJoinBtn.disabled = false;
          candidateJoinBtn.textContent = 'Join Session';
          alert(validation.error || 'Invalid session code. Please check with your interviewer.');
          return;
        }

        // Initialize session tracking for candidates (make it async/non-blocking)
        if (window.SessionTracking) {
          // Don't await - let tracking happen in background
          window.SessionTracking.initialize(sessionCode, 'candidate', name);
          // Remove the security check message - just proceed
        }

        // Initialize activity monitoring for candidates (with consent)
        if (window.initActivityMonitor) {
          console.log('Starting activity monitoring for candidate:', name);
          window.initActivityMonitor(sessionCode, name, 'candidate');

          // Log consent status
          if (window.firebase) {
            firebase.database()
              .ref(`sessions/${sessionCode}/privacy_consent/${name}`)
              .set({
                consented: true,
                timestamp: Date.now(),
                consentedTo: 'Activity monitoring during interview session'
              });
          }
        }

        Auth.joinAsCandidate(name);
        window.location.hash = sessionCode;

        startSession(name, sessionCode, false);
      }
    });

    // Enter key support
    candidateSessionCode.addEventListener('keypress', function(e) {
      if (e.key === 'Enter' && !candidateJoinBtn.disabled) {
        candidateJoinBtn.click();
      }
    });
  }

  // Setup admin flow
  function setupAdminFlow() {
    const adminEmail = document.getElementById('adminEmail');
    const adminPassword = document.getElementById('adminPassword');
    const adminLoginBtn = document.getElementById('adminLoginBtn');
    const adminLoginBack = document.getElementById('adminLoginBack');
    const loginError = document.getElementById('loginError');

    // Back button
    adminLoginBack.addEventListener('click', function() {
      document.getElementById('adminLoginModal').style.display = 'none';
      document.getElementById('landingModal').style.display = 'flex';
      loginError.style.display = 'none';
    });

    // Login
    adminLoginBtn.addEventListener('click', async function() {
      const email = adminEmail.value.trim();
      const password = adminPassword.value;

      // Show loading state
      adminLoginBtn.disabled = true;
      adminLoginBtn.textContent = 'Logging in...';
      loginError.style.display = 'none';

      try {
        const result = await Auth.loginAdmin(email, password);

        if (result.success) {
          document.getElementById('adminLoginModal').style.display = 'none';
          document.getElementById('adminDashboardModal').style.display = 'flex';
          setupAdminDashboard();
        } else {
          loginError.textContent = result.error;
          loginError.style.display = 'block';
        }
      } catch (error) {
        loginError.textContent = 'Login failed. Please try again.';
        loginError.style.display = 'block';
      } finally {
        // Reset button state
        adminLoginBtn.disabled = false;
        adminLoginBtn.textContent = 'Login';
      }
    });

    // Enter key support
    adminPassword.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        adminLoginBtn.click();
      }
    });
  }

  // Setup admin dashboard
  function setupAdminDashboard() {
    if (adminDashboardInitialized) {
      console.log('Admin dashboard already initialized, skipping duplicate setup');
      return;
    }
    adminDashboardInitialized = true;

    const createSessionBtn = document.getElementById('createSessionBtn');
    const adminSessionCode = document.getElementById('adminSessionCode');
    const adminJoinBtn = document.getElementById('adminJoinBtn');
    const adminLogoutBtn = document.getElementById('adminLogoutBtn');
    const copyCodeBtn = document.getElementById('copyCodeBtn');
    const viewAllSessionsBtn = document.getElementById('viewAllSessionsBtn');
    const closeSessionsModalBtn = document.getElementById('closeSessionsModalBtn');
    const interviewerNameInput = document.getElementById('interviewerName');

    if (window.ProblemLibrary?.init) {
      window.ProblemLibrary.init();
    }

    // Load saved interviewer name from localStorage
    if (interviewerNameInput) {
      const savedName = localStorage.getItem('interviewerName');
      if (savedName) {
        interviewerNameInput.value = savedName;
      }
      updateInterviewerPreview();

      // Save name when it changes
      interviewerNameInput.addEventListener('input', function() {
        localStorage.setItem('interviewerName', this.value.trim());
        updateInterviewerPreview();
      });
    }

    // View all sessions button
    if (viewAllSessionsBtn) {
      viewAllSessionsBtn.addEventListener('click', function() {
        const modal = document.getElementById('sessionsModal');
        modal.style.display = 'flex';

        // Reset selections
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        const selectAllBtn = document.getElementById('selectAllBtn');
        if (selectAllCheckbox) selectAllCheckbox.checked = false;
        if (selectAllBtn) selectAllBtn.textContent = 'Select All';
        updateBulkActionButtons();

        loadActiveSessions();

        // Close on escape key
        const escHandler = function(e) {
          if (e.key === 'Escape') {
            modal.style.display = 'none';
            document.removeEventListener('keydown', escHandler);
            // Clean up the listener
            if (sessionsListener) {
              window.firebase.database().ref('sessions').off('value', sessionsListener);
              sessionsListener = null;
            }
          }
        };
        document.addEventListener('keydown', escHandler);

        // Close on click outside
        modal.addEventListener('click', function(e) {
          if (e.target === modal) {
            modal.style.display = 'none';
            // Clean up the listener
            if (sessionsListener) {
              window.firebase.database().ref('sessions').off('value', sessionsListener);
              sessionsListener = null;
            }
          }
        });
      });
    }

    // Close sessions modal
    if (closeSessionsModalBtn) {
      closeSessionsModalBtn.addEventListener('click', function() {
        document.getElementById('sessionsModal').style.display = 'none';
        // Clean up the listener when modal is closed
        if (sessionsListener) {
          window.firebase.database().ref('sessions').off('value', sessionsListener);
          sessionsListener = null;
        }
      });
    }

    // Create new session
    if (createSessionBtn) {
      createSessionBtn.addEventListener('click', async function() {
        // Check if already starting
        if (sessionStarting) {
          console.warn('CREATE SESSION: Already starting a session, ignoring click');
          return;
        }

        const createSessionLabel = createSessionBtn.querySelector('span');
        const originalText = createSessionLabel ? createSessionLabel.textContent : createSessionBtn.textContent;
        createSessionBtn.disabled = true;
        if (createSessionLabel) {
          createSessionLabel.textContent = 'Creating...';
        } else {
          createSessionBtn.textContent = 'Creating...';
        }

        try {
          const sessionPayload = window.ProblemLibrary?.getSessionPayload
            ? window.ProblemLibrary.getSessionPayload()
            : {};
          const session = await createSessionViaApi(sessionPayload);
          const sessionCode = normalizeSessionCode(session.sessionId);
          console.log('CREATE SESSION: Created code:', sessionCode);

          // Show active session
          document.getElementById('activeSessionCode').textContent = sessionCode;
          document.getElementById('activeSession').style.display = 'block';

          // Hide the dashboard modal immediately
          document.getElementById('adminDashboardModal').style.display = 'none';

          // Now set the hash (this might trigger hashchange/load events)
          window.location.hash = sessionCode;
          console.log('CREATE SESSION: Current URL hash:', window.location.hash);

          // Track interviewer creating and joining session
          const adminName = getAdminDisplayName();

          // Initialize activity monitor in observer mode for interviewer
          if (window.initActivityMonitor) {
            console.log('Starting activity monitor in observer mode for interviewer');
            window.initActivityMonitor(sessionCode, adminName, 'interviewer');
          }

          // Start session - DON'T set sessionStarting here, let startSession handle it
          startSession(adminName, sessionCode, true);
        } catch (error) {
          console.error('CREATE SESSION: Failed:', error);
          alert(error.message || 'Failed to create session. Please try again.');
        } finally {
          createSessionBtn.disabled = false;
          if (createSessionLabel) {
            createSessionLabel.textContent = originalText;
          } else {
            createSessionBtn.textContent = originalText;
          }
        }
      });
    }

    // Join existing session
    adminJoinBtn.addEventListener('click', async function() {
      const sessionCode = normalizeSessionCode(adminSessionCode.value);

      if (isValidSessionCode(sessionCode)) {
        const validation = await validateSession(sessionCode);
        if (!validation.valid) {
          alert(validation.error || 'Invalid session code. Please check with your candidate.');
          return;
        }

        // Track interviewer joining session
        const adminName = getAdminDisplayName();

        // Initialize activity monitor in observer mode for interviewer
        if (window.initActivityMonitor) {
          console.log('Starting activity monitor in observer mode for interviewer');
          window.initActivityMonitor(sessionCode, adminName, 'interviewer');
        }

        window.location.hash = sessionCode;
        startSession(adminName, sessionCode, false);
      } else {
        alert('Please enter a valid 8-character session code.');
      }
    });

    // Format session code input
    adminSessionCode.addEventListener('input', function() {
      this.value = normalizeSessionCode(this.value);
    });

    // Copy session code
    if (copyCodeBtn) {
      copyCodeBtn.addEventListener('click', function() {
        const code = document.getElementById('activeSessionCode').textContent;
        navigator.clipboard.writeText(code).then(function() {
          copyCodeBtn.textContent = '✓ Copied!';
          setTimeout(() => {
            copyCodeBtn.textContent = 'Copy Code';
          }, 2000);
        });
      });
    }

    // Logout
    adminLogoutBtn.addEventListener('click', function() {
      Auth.logout();
      document.getElementById('adminDashboardModal').style.display = 'none';
      document.getElementById('landingModal').style.display = 'flex';
      document.getElementById('activeSession').style.display = 'none';
    });
  }

  // Validate session before joining
  async function validateSession(sessionCode, isCandidate = false) {
    sessionCode = normalizeSessionCode(sessionCode);
    if (!isValidSessionCode(sessionCode)) {
      return { valid: false, error: 'Please enter a valid 8-character session code.' };
    }

    // Wait for Firebase if not ready
    if (!window.firebase || !window.firebase.database) {
      console.log('Waiting for Firebase to validate session...');
      // Wait a bit for Firebase to load
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Try again
      if (!window.firebase || !window.firebase.database) {
        return { valid: false, error: 'Database connection failed. Please refresh and try again.' };
      }
    }

    try {
      const snapshot = await window.firebase.database().ref('sessions/' + sessionCode).once('value');
      const sessionData = snapshot.val();

      console.log('Validating session:', sessionCode, 'Data:', sessionData);

      if (!sessionData) {
        return { valid: false, error: 'Session code not found. Please verify the code with your interviewer.' };
      }

      if (!sessionData.created || !sessionData.createdBy) {
        return { valid: false, error: 'Invalid session. This session was not created by an interviewer.' };
      }

      // For candidates, session MUST exist with proper structure
      if (isCandidate) {
        // Check if session has been archived (older than 2 hours)
        const sessionAge = Date.now() - (sessionData.created || 0);
        const twoHours = 2 * 60 * 60 * 1000;
        if (sessionAge > twoHours) {
          return { valid: false, error: 'This session has expired. Please request a new session code from your interviewer.' };
        }
      }

      // Check if session is terminated
      if (sessionData && sessionData.terminated && sessionData.terminated.terminated) {
        return { valid: false, error: 'This interview session has already ended.' };
      }

      return { valid: true };
    } catch (error) {
      console.error('Session validation error:', error);
      return { valid: false, error: 'Failed to validate session. Please check your internet connection.' };
    }
  }

  // Setup bulk action handlers
  function setupBulkActions() {
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const selectAllBtn = document.getElementById('selectAllBtn');
    const endSelectedBtn = document.getElementById('endSelectedBtn');
    const endAllSessionsBtn = document.getElementById('endAllSessionsBtn');

    // Select All checkbox in header
    if (selectAllCheckbox) {
      selectAllCheckbox.addEventListener('change', function() {
        const checkboxes = document.querySelectorAll('.session-checkbox');
        checkboxes.forEach(cb => cb.checked = this.checked);
        updateBulkActionButtons();
      });
    }

    // Select All button
    if (selectAllBtn) {
      selectAllBtn.addEventListener('click', function() {
        const isSelectAll = this.textContent === 'Select All';
        const checkboxes = document.querySelectorAll('.session-checkbox');
        const headerCheckbox = document.getElementById('selectAllCheckbox');

        checkboxes.forEach(cb => cb.checked = isSelectAll);
        if (headerCheckbox) headerCheckbox.checked = isSelectAll;

        this.textContent = isSelectAll ? 'Select None' : 'Select All';
        updateBulkActionButtons();
      });
    }

    // End/Delete Selected button (behavior depends on active tab)
    if (endSelectedBtn) {
      endSelectedBtn.addEventListener('click', function() {
        const selected = document.querySelectorAll('.session-checkbox:checked');
        const archivedTabBtn = document.getElementById('archivedTabBtn');
        const isArchivedTab = archivedTabBtn && archivedTabBtn.classList.contains('active');

        console.log('End/Delete Selected clicked, found checkboxes:', selected.length);
        console.log('Is archived tab:', isArchivedTab);

        const sessionCodes = Array.from(selected).map(cb => cb.getAttribute('data-code'));
        console.log('Session codes to process:', sessionCodes);

        if (sessionCodes.length === 0) {
          console.log('No sessions selected');
          return;
        }

        if (isArchivedTab) {
          // In Ended Sessions tab - DELETE permanently
          const message = sessionCodes.length === 1
            ? `⚠️ PERMANENTLY DELETE session ${sessionCodes[0]}?`
            : `⚠️ PERMANENTLY DELETE ${sessionCodes.length} selected sessions?`;

          if (confirm(message + '\n\nThis will remove all data forever and CANNOT be undone!')) {
            if (confirm('FINAL CONFIRMATION: Delete these sessions forever?')) {
              console.log('User confirmed, DELETING sessions...', sessionCodes);

              // Delete sessions with staggered timing to ensure Firebase handles them properly
              sessionCodes.forEach((code, index) => {
                setTimeout(() => {
                  console.log(`Deleting session ${index + 1}/${sessionCodes.length}: ${code}`);
                  deleteSession(code);
                }, index * 200); // Stagger by 200ms
              });

              showNotification(`Deleting ${sessionCodes.length} session(s)...`);
            }
          }
        } else {
          // In Active tab - just end/terminate sessions
          const message = sessionCodes.length === 1
            ? `End session ${sessionCodes[0]}?`
            : `End ${sessionCodes.length} selected sessions?`;

          if (confirm(message + ' All participants will be disconnected.')) {
            console.log('User confirmed, ending sessions...');
            sessionCodes.forEach(code => {
              console.log('Ending:', code);
              terminateSessionFromDashboard(code);
            });
          }
        }
      });
    }

    // End All / Delete All button (behavior depends on active tab)
    if (endAllSessionsBtn) {
      endAllSessionsBtn.addEventListener('click', function() {
        const checkboxes = document.querySelectorAll('.session-checkbox');
        const archivedTabBtn = document.getElementById('archivedTabBtn');
        const isArchivedTab = archivedTabBtn && archivedTabBtn.classList.contains('active');

        if (checkboxes.length === 0) {
          alert(isArchivedTab ? 'No ended sessions to delete' : 'No active sessions to end');
          return;
        }

        if (isArchivedTab) {
          // In Ended Sessions tab - DELETE ALL permanently
          if (confirm(`⚠️ PERMANENTLY DELETE ALL ${checkboxes.length} ended sessions?\n\nThis will remove all data forever!`)) {
            if (confirm('FINAL CONFIRMATION: Delete ALL ended sessions forever? This CANNOT be undone!')) {
              const sessionCodes = Array.from(checkboxes).map(cb => cb.getAttribute('data-code'));
              console.log('Mass deleting sessions:', sessionCodes);

              // Delete all sessions sequentially to ensure they complete
              sessionCodes.forEach((code, index) => {
                setTimeout(() => {
                  console.log(`Deleting session ${index + 1}/${sessionCodes.length}: ${code}`);
                  deleteSession(code);
                }, index * 200); // Stagger deletions by 200ms to avoid overwhelming Firebase
              });

              showNotification(`Deleting ${sessionCodes.length} sessions...`);
            }
          }
        } else {
          // In Active tab - end all sessions
          if (confirm(`End ALL ${checkboxes.length} active sessions? This will disconnect all participants.`)) {
            const sessionCodes = Array.from(checkboxes).map(cb => cb.getAttribute('data-code'));
            sessionCodes.forEach(code => terminateSessionFromDashboard(code));
          }
        }
      });
    }
  }

  // Update bulk action buttons state
  function updateBulkActionButtons() {
    const selected = document.querySelectorAll('.session-checkbox:checked');
    const endSelectedBtn = document.getElementById('endSelectedBtn');

    if (endSelectedBtn) {
      endSelectedBtn.disabled = selected.length === 0;
      if (selected.length > 0) {
        endSelectedBtn.textContent = `End Selected (${selected.length})`;
      } else {
        endSelectedBtn.textContent = 'End Selected';
      }
    }
  }

  // Store the sessions listener reference globally to prevent duplicates
  let sessionsListener = null;

  // Load all active sessions for admin
  function loadActiveSessions(isArchived = false) {
    const sessionsTableBody = document.getElementById('sessionsTableBody');
    const noSessionsMessage = document.getElementById('noSessionsMessage');
    const sessionsTable = document.getElementById('sessionsTable');

    if (!sessionsTableBody) return;

    // Setup bulk actions once
    if (!sessionsTableBody.hasAttribute('data-bulk-setup')) {
      setupBulkActions();
      sessionsTableBody.setAttribute('data-bulk-setup', 'true');
    }

    // Setup tab handlers
    const activeTabBtn = document.getElementById('activeTabBtn');
    const archivedTabBtn = document.getElementById('archivedTabBtn');
    const bulkActionsBar = document.getElementById('bulkActionsBar');

    // Update time column header based on tab
    function updateTimeColumnHeader(isArchived) {
      const timeHeader = document.querySelector('#sessionsTable th:nth-child(6)');
      if (timeHeader) {
        timeHeader.textContent = isArchived ? 'Ended' : 'Created';
      }
    }

    function setBulkActionsMode(isArchived) {
      if (!bulkActionsBar) return;
      bulkActionsBar.classList.toggle('bulk-actions--archive', Boolean(isArchived));
      bulkActionsBar.classList.toggle('bulk-actions--active', !isArchived);
    }

    function renderSessionsMessage(message, tone = '') {
      sessionsTableBody.replaceChildren();
      const row = document.createElement('tr');
      row.className = ['sessions-message-row', tone].filter(Boolean).join(' ');
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.textContent = message;
      row.appendChild(cell);
      sessionsTableBody.appendChild(row);
    }

    if (activeTabBtn && !activeTabBtn.hasAttribute('data-handler')) {
      activeTabBtn.setAttribute('data-handler', 'true');
      activeTabBtn.addEventListener('click', function() {
          this.classList.add('active');
          archivedTabBtn.classList.remove('active');
          bulkActionsBar.style.display = 'flex';
          setBulkActionsMode(false);
          updateTimeColumnHeader(false); // Update header to "Created"
          // Update bulk action buttons for active/in-progress sessions
          const endSelectedBtn = document.getElementById('endSelectedBtn');
          const deleteAllBtn = document.getElementById('endAllSessionsBtn');
          if (endSelectedBtn) {
            endSelectedBtn.textContent = 'End Selected';
          }
          if (deleteAllBtn) {
            deleteAllBtn.textContent = 'End All';
          }
          loadActiveSessions();
        });
    }

    if (archivedTabBtn && !archivedTabBtn.hasAttribute('data-handler')) {
      archivedTabBtn.setAttribute('data-handler', 'true');
      archivedTabBtn.addEventListener('click', function() {
          this.classList.add('active');
          activeTabBtn.classList.remove('active');
          bulkActionsBar.style.display = 'flex'; // Show bulk actions for ended sessions too
          setBulkActionsMode(true);
          updateTimeColumnHeader(true); // Update header to "Ended"
          // Update bulk action buttons for ended sessions (delete only)
          const endSelectedBtn = document.getElementById('endSelectedBtn');
          const deleteAllBtn = document.getElementById('endAllSessionsBtn');
          if (endSelectedBtn) {
            endSelectedBtn.textContent = 'Delete Selected';
          }
          if (deleteAllBtn) {
            deleteAllBtn.textContent = 'Delete All Ended';
          }
          loadActiveSessions(true); // Load ended sessions
        });
    }

      // Check current tab
      const isShowingArchived = archivedTabBtn && archivedTabBtn.classList.contains('active');
      setBulkActionsMode(isShowingArchived);

      // Check if Firebase is loaded
      if (!window.firebase || !window.firebase.database) {
        console.log('Waiting for Firebase to load...');
        renderSessionsMessage('Connecting to database...');
        setTimeout(() => loadActiveSessions(isArchived), 1500);
        return;
      }

    // Double check Firebase database ref is accessible
      try {
        const testRef = window.firebase.database().ref();
      } catch (error) {
        console.error('Firebase database error:', error);
        renderSessionsMessage('Database connection error. Please refresh the page.', 'is-error');
        return;
      }

    // Remove existing listener if it exists to prevent duplicates
    if (sessionsListener) {
      window.firebase.database().ref('sessions').off('value', sessionsListener);
      sessionsListener = null;
    }

      // Create the listener function
      sessionsListener = function(snapshot) {
        const sessions = snapshot.val() || {};
        sessionsTableBody.replaceChildren();

      const activeSessions = [];
      const archivedSessions = [];
      let totalUsers = 0;
      const twoHours = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
      const now = Date.now();

      // Filter sessions into active/in-progress and ended
      Object.keys(sessions).forEach(code => {
        const session = sessions[code];

        if (!session || !session.created || !session.createdBy) {
          console.warn('Ignoring malformed session record:', code);
          return;
        }

        const sessionAge = now - (session.created || now);
        const userCount = Object.keys(session.users || {}).length;

        // For ended sessions, use preserved participants if available
        const participants = (session.terminated && session.terminated.terminated && session.preservedParticipants)
          ? session.preservedParticipants
          : session.users || {};

        const sessionInfo = {
          code: code,
          users: participants,
          userCount: Object.keys(participants).length,
          created: session.created || now,
          createdBy: session.createdBy || 'Unknown',
          isExpired: sessionAge > twoHours,
          isTerminated: session.terminated && session.terminated.terminated
        };

        // Ended sessions go to the ended list
        if (session.terminated && session.terminated.terminated) {
          sessionInfo.terminatedAt = session.terminated.terminatedAt || session.created; // Add terminated timestamp
          archivedSessions.push(sessionInfo); // Using archivedSessions array for ended sessions
        } else {
          // Active or In Progress sessions
          activeSessions.push(sessionInfo);
          totalUsers += userCount;
        }
      });

      // Sort ended sessions by terminated time (most recent first)
      console.log('Sorting ended sessions. Count:', archivedSessions.length);
      archivedSessions.sort((a, b) => {
        const timeA = a.terminatedAt || a.created || 0;
        const timeB = b.terminatedAt || b.created || 0;
        // Debug log for first few sessions
        if (archivedSessions.indexOf(a) < 3) {
          console.log(`Session ${a.code}: terminatedAt=${a.terminatedAt}, created=${a.created}, timeA=${timeA}`);
        }
        return timeB - timeA; // Descending order (newest first)
      });

      // Sort active sessions by created time (most recent first)
      activeSessions.sort((a, b) => {
        return (b.created || 0) - (a.created || 0); // Descending order
      });

      // Update stats
      const activeSessionsCount = document.getElementById('activeSessionsCount');
      const totalUsersCount = document.getElementById('totalUsersCount');
      if (activeSessionsCount) activeSessionsCount.textContent = activeSessions.length;
      if (totalUsersCount) totalUsersCount.textContent = totalUsers;

      // Choose which sessions to display based on active tab
      const isShowingArchived = archivedTabBtn && archivedTabBtn.classList.contains('active');
      const sessionsToDisplay = isShowingArchived ? archivedSessions : activeSessions;

        if (sessionsToDisplay.length === 0) {
          sessionsTable.style.display = 'none';
          noSessionsMessage.style.display = 'block';
          const message = document.createElement('p');
          message.textContent = isShowingArchived
            ? 'No ended sessions'
            : 'No active or in-progress sessions';
          noSessionsMessage.replaceChildren(message);
          return;
        }

      sessionsTable.style.display = 'table';
      noSessionsMessage.style.display = 'none';

      // Display each session
      sessionsToDisplay.forEach(session => {
        const row = document.createElement('tr');

        // Get the full session data to access notes
        const fullSession = sessions[session.code];

        // Make isShowingArchived available in this scope
        const isArchivedView = isShowingArchived;

        // Separate candidates and interviewers
        const users = Object.values(session.users);
        const candidates = users.filter(user => {
          if (!user.name) return false;
          const nameLower = user.name.toLowerCase();
          // Exclude if it contains interviewer patterns, email domains, or admin keywords
          return !nameLower.includes('interviewer') &&
                 !nameLower.includes('@') &&
                 !nameLower.includes('admin') &&
                 !nameLower.includes('.com') &&
                 !nameLower.includes('.io') &&
                 !nameLower.includes('.net');
        });
        const interviewers = users.filter(user => {
          if (!user.name) return false;
          const nameLower = user.name.toLowerCase();
          // Include if it contains interviewer patterns or email domains
          return nameLower.includes('interviewer') ||
                 nameLower.includes('@') ||
                 nameLower.includes('admin') ||
                 nameLower.includes('.com') ||
                 nameLower.includes('.io') ||
                 nameLower.includes('.net');
        });

        // Get hire signal from notes if available
          let hireSignal = '';
          if (fullSession && fullSession.interviewerNotes && fullSession.interviewerNotes.recommendation) {
            const rec = fullSession.interviewerNotes.recommendation;
            const recLabels = {
              'STRONG_HIRE': 'Strong Hire',
              'HIRE': 'Hire',
              'PROCEED_TO_NEXT_ROUND': 'Next Round',
              'MAYBE': 'Maybe',
              'NO_HIRE': 'No Hire'
            };
            const recClass = rec.toLowerCase().replace(/_/g, '-');
            hireSignal = `<span class="hire-signal hire-signal--${recClass}">${escapeHtml(recLabels[rec] || rec)}</span>`;
          }

          // Format candidate names with hire signal (only show candidates)
          const candidateNames = candidates.map(user =>
            `<div class="participant-name participant-name--candidate"><span>${escapeHtml(user.name)}</span>${hireSignal}</div>`
          ).join('') || `<div class="participant-empty">No candidate yet${hireSignal}</div>`;

          // Format interviewer names
          const interviewerNames = interviewers.length > 0 ?
            `<div class="participant-meta">Interviewed by: ${escapeHtml(interviewers.map(i => i.name).join(', '))}</div>` : '';

          // Format all participants with clear separation
          const allParticipants = `
            ${candidates.length > 0 ? `<div class="participant-group"><span class="participant-group-label">Candidates</span><span class="participant-values">${escapeHtml(candidates.map(c => c.name).join(', '))}</span></div>` : ''}
            ${interviewers.length > 0 ? `<div class="participant-group"><span class="participant-group-label">Interviewers</span><span class="participant-values participant-values--admin">${escapeHtml(interviewers.map(i => i.name).join(', '))}</span></div>` : ''}
            ${users.length === 0 ? '<div class="participant-empty">No participants</div>' : ''}
          `;

        // Check for fraud indicators from security warnings
        let fraudBadge = '';
        if (fullSession && fullSession.security_warnings) {
          const warnings = Object.values(fullSession.security_warnings || {});
          const candidateWarnings = warnings.filter(w => w.userType === 'candidate');

          if (candidateWarnings.length > 0) {
            const hasVPN = candidateWarnings.some(w => w.type === 'vpn_detected');
            const hasMultipleLogin = candidateWarnings.some(w => w.type === 'multiple_login');

              if (hasMultipleLogin) {
                fraudBadge = '<span class="fraud-badge fraud-badge--danger">Fraud</span>';
              } else if (hasVPN) {
                fraudBadge = '<span class="fraud-badge fraud-badge--warning">VPN</span>';
              }
            }
          }

        // Determine session status - Simple progression: Active -> In Progress -> Ended
        let status = 'active';
        let statusBadge = '';

          if (session.isTerminated) {
            // Session has ended
            status = 'ended';
            statusBadge = '<span class="status-badge status-ended">Ended</span>' + fraudBadge;
          } else if (candidates.length > 0 && interviewers.length > 0) {
            // Both candidate and interviewer present - interview in progress
            status = 'in-progress';
            statusBadge = '<span class="status-badge status-in-progress">In Progress</span>' + fraudBadge;
          } else {
            // Session created but interview not started yet
            status = 'active';
            statusBadge = '<span class="status-badge status-active">Active</span>' + fraudBadge;
          }
          statusBadge = `<div class="session-status-stack">${statusBadge}</div>`;

        // Format time - show terminated time for ended sessions, created time for active
        let displayTime;
        if (isArchivedView && session.terminatedAt) {
          const terminatedDate = new Date(session.terminatedAt);
          displayTime = terminatedDate.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });
        } else {
          displayTime = new Date(session.created).toLocaleTimeString();
        }

          row.innerHTML = `
            <td>
              <input type="checkbox" class="session-checkbox" data-code="${escapeHtml(session.code)}">
            </td>
            <td><span class="session-code-chip">${escapeHtml(session.code)}</span></td>
            <td>${statusBadge}</td>
            <td>
              <div class="participants-list">
              ${candidateNames}
              ${interviewerNames}
            </div>
          </td>
          <td>
            <div class="participants-list">
                ${allParticipants}
              </div>
            </td>
            <td class="session-time" title="${isArchivedView ? 'Ended' : 'Created'}: ${escapeHtml(displayTime)}">${escapeHtml(displayTime)}</td>
            <td>
              <div class="action-buttons-modern">
                <button class="action-btn view-btn" data-code="${escapeHtml(session.code)}" title="View details" aria-label="View session details">
                  ${iconMarkup('i-info')}
                  <span>View</span>
                </button>


                ${isArchivedView ?
                  `<button class="action-btn delete-forever-btn" data-code="${escapeHtml(session.code)}" title="Permanently delete" aria-label="Permanently delete session">
                    ${iconMarkup('i-trash')}
                    <span>Delete</span>
                  </button>` :
                  `<button class="action-btn join-btn" data-code="${escapeHtml(session.code)}" ${session.isExpired || session.isTerminated ? 'disabled' : ''} title="Join session" aria-label="Join session">
                    ${iconMarkup('i-arrow-right')}
                    <span>Join</span>
                  </button>
                   <button class="action-btn end-btn" data-code="${escapeHtml(session.code)}" ${session.isTerminated ? 'disabled' : ''} title="End session" aria-label="End session">
                    ${iconMarkup('i-x')}
                    <span>End</span>
                  </button>`
                }
            </div>
          </td>
        `;

        // Add checkbox change handler (only for active sessions)
        const checkbox = row.querySelector('.session-checkbox');
        if (checkbox) {
          checkbox.addEventListener('change', updateBulkActionButtons);
        }

        sessionsTableBody.appendChild(row);

        // Add join button handler
        const joinBtn = row.querySelector('.join-btn');
        if (joinBtn) {
          joinBtn.addEventListener('click', function() {
            const code = this.getAttribute('data-code');
            document.getElementById('sessionsModal').style.display = 'none';
            const adminName = getAdminDisplayName();
            window.location.hash = code;
            startSession(adminName, code, false);
          });
        }

        // Add view button handler
        const viewBtn = row.querySelector('.view-btn');
        if (viewBtn) {
          viewBtn.addEventListener('click', function() {
            const code = this.getAttribute('data-code');
            // Pass the full session data, not just from the filtered sessionInfo
            const fullSessionData = sessions[code];
            console.log('View details clicked for session:', code, fullSessionData);
            viewSessionDetails(code, fullSessionData);
          });
        }

        // Add delete forever button handler
        const deleteForeverBtn = row.querySelector('.delete-forever-btn');
        if (deleteForeverBtn) {
          deleteForeverBtn.addEventListener('click', function() {
            const code = this.getAttribute('data-code');
            const message = `⚠️ PERMANENTLY DELETE session ${code}?\n\nThis will:\n• Remove ALL session data\n• Delete ALL interview notes\n• Remove from Firebase completely\n• This CANNOT be undone!\n\nAre you absolutely sure?`;
            if (confirm(message)) {
              // Double confirmation for safety
              if (confirm(`FINAL CONFIRMATION: Delete session ${code} forever?`)) {
                deleteSession(code);
              }
            }
          });
        }

        // Add end button handler
        const endBtn = row.querySelector('.end-btn');
        if (endBtn) {
          endBtn.addEventListener('click', function() {
            const code = this.getAttribute('data-code');
            if (confirm(`End session ${code}? This will mark the interview as completed and move it to Ended Sessions.`)) {
              terminateSessionFromDashboard(code);
            }
          });
        }
      });
    };

    // Attach the listener for real-time updates
      window.firebase.database().ref('sessions').on('value', sessionsListener, function(error) {
        console.error('Firebase listener error:', error);
        renderSessionsMessage(`Error loading sessions: ${error.message}`, 'is-error');
      });
  }

  // End session - mark as ended (not deleted)
  async function terminateSessionFromDashboard(sessionCode) {
    sessionCode = normalizeSessionCode(sessionCode);
    console.log('Ending session:', sessionCode);

    if (!isValidSessionCode(sessionCode)) {
      alert('Invalid session code');
      return;
    }

    // Track session end with PostHog
    if (window.trackSessionEnd) {
      window.trackSessionEnd('admin_ended');
    }

    try {
      await endSessionViaApi(sessionCode);
      console.log('Session ' + sessionCode + ' ended successfully');
      showNotification('Session ' + sessionCode + ' has been ended');
    } catch (error) {
      console.error('Error ending session:', error);
      alert('Failed to end session: ' + error.message);
    }
  }

  // Show notification helper
  function showNotification(message, isError = false) {
    // Simple notification (you can enhance this)
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `position: fixed; top: 20px; right: 20px; background: ${isError ? '#f44336' : '#4caf50'}; color: white; padding: 10px 20px; border-radius: 4px; z-index: 10000;`;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  }

  // Delete ALL sessions from Firebase - NUCLEAR OPTION
  function deleteAllSessions() {
    console.log('DELETING ALL SESSIONS FROM DATABASE');

    if (!window.firebase || !window.firebase.database) {
      alert('Database connection not ready');
      return;
    }

    // Delete the entire sessions node
    window.firebase.database().ref('sessions').remove()
      .then(function() {
        console.log('ALL SESSIONS DELETED SUCCESSFULLY');
        showNotification('ALL SESSIONS HAVE BEEN DELETED FROM DATABASE');

        // Force refresh the sessions list
        setTimeout(() => {
          if (typeof loadActiveSessions === 'function') {
            const archivedTabBtn = document.getElementById('archivedTabBtn');
            const isArchived = archivedTabBtn && archivedTabBtn.classList.contains('active');
            loadActiveSessions(isArchived);
          }
        }, 500);
      })
      .catch(function(error) {
        console.error('Error deleting all sessions:', error);
        alert('Failed to delete all sessions: ' + error.message);
      });
  }

  // Make it globally accessible for console use
  window.deleteAllSessions = deleteAllSessions;

  // Delete session completely from Firebase - HARD DELETE
  function deleteSession(sessionCode) {
    console.log('HARD DELETING session:', sessionCode);

    if (!window.firebase || !window.firebase.database) {
      alert('Database connection not ready');
      return;
    }

    // First, try to read the session to confirm it exists
    window.firebase.database().ref('sessions/' + sessionCode).once('value')
      .then(function(snapshot) {
        if (!snapshot.exists()) {
          console.log('Session does not exist:', sessionCode);
          showNotification('Session ' + sessionCode + ' does not exist', true);
          return;
        }

        console.log('Session exists, proceeding with HARD DELETE');

        // Now perform the actual deletion
        return window.firebase.database().ref('sessions/' + sessionCode).remove();
      })
      .then(function(result) {
        if (result !== undefined) { // Only show success if we actually deleted
          console.log('Session ' + sessionCode + ' HARD DELETED successfully');
          showNotification('Session ' + sessionCode + ' has been PERMANENTLY DELETED from database');

          // Force refresh the sessions list after a short delay
          setTimeout(() => {
            if (typeof loadActiveSessions === 'function') {
              const archivedTabBtn = document.getElementById('archivedTabBtn');
              const isArchived = archivedTabBtn && archivedTabBtn.classList.contains('active');
              loadActiveSessions(isArchived);
            }
          }, 500);
        }
      })
      .catch(function(error) {
        console.error('Error HARD DELETING session:', error);
        console.error('Error details:', error.code, error.message);

        if (error.code === 'PERMISSION_DENIED') {
          showNotification('Permission denied. Update Firebase rules to allow deletion.', true);
          alert('Cannot delete: Permission denied.\n\nPlease update Firebase rules:\nAdd ".write": true at the sessions root level');
        } else {
          showNotification('Failed to delete session: ' + error.message, true);
        }
      });
  }

  // Display activity tab data
  function displayActivityTab(sessionCode) {
    console.log('displayActivityTab called for session:', sessionCode);
    const container = document.getElementById('activity-tracking-data');
    if (!container) {
      console.error('Activity container not found');
      return;
    }

    // Start loading
    container.innerHTML = '<p class="loading-message">Loading activity data...</p>';

    // Get activity data from Firebase
    if (window.firebase && window.firebase.database) {
      console.log('Fetching activity data from Firebase...');
      console.log('Firebase available:', !!window.firebase);
      console.log('Firebase database available:', !!window.firebase.database);

      // Also check for any activity logs
      firebase.database()
        .ref(`sessions/${sessionCode}/activity_log`)
        .limitToLast(5)
        .once('value')
        .then(snapshot => {
          const logs = snapshot.val();
          console.log('Activity logs found:', logs);
        });

      // Try to get final summary first, then regular summary
      firebase.database()
        .ref(`sessions/${sessionCode}/activity_final_summary`)
        .once('value')
        .then(snapshot => {
          let activityData = snapshot.val();
          console.log('Final summary data:', activityData);

          // If no final summary, try regular summary
          if (!activityData) {
            console.log('No final summary, checking regular summary...');
            return firebase.database()
              .ref(`sessions/${sessionCode}/activity_summary`)
              .once('value');
          }
          return snapshot;
        })
        .then(snapshot => {
          const activityData = snapshot.val();
          console.log('Activity data retrieved:', activityData);

          if (!activityData) {
            container.innerHTML = `
              <div style="padding: 20px; text-align: center; color: #666;">
                <p>No activity data available for this session.</p>
                <p style="font-size: 12px; margin-top: 10px;">Activity tracking may not have been enabled for this session.</p>
              </div>
            `;
            return;
          }

          // Display activity data
          const scoreColor = activityData.activityScore > 80 ? '#4caf50' :
                           activityData.activityScore > 60 ? '#ff9800' : '#ff4444';

          // Calculate engagement level
          let engagementLevel = 'High';
          let engagementColor = '#4caf50';
          if (activityData.activityScore < 60) {
            engagementLevel = 'Low';
            engagementColor = '#ff4444';
          } else if (activityData.activityScore < 80) {
            engagementLevel = 'Medium';
            engagementColor = '#ff9800';
          }

          container.innerHTML = `
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; border-radius: 8px; color: white; margin-bottom: 20px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                  <h3 style="margin: 0; font-size: 20px; opacity: 0.9;">Engagement Level</h3>
                  <div style="font-size: 36px; font-weight: bold; color: ${engagementColor}; text-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                    ${engagementLevel}
                  </div>
                  <div style="font-size: 14px; opacity: 0.7; margin-top: 5px;">
                    Based on activity patterns
                  </div>
                </div>
                <div style="text-align: right;">
                  <div style="font-size: 14px; opacity: 0.9;">Session Duration</div>
                  <div style="font-size: 20px; font-weight: bold;">${activityData.sessionDurationMinutes || 0} min</div>
                  <div style="font-size: 12px; opacity: 0.7; margin-top: 5px;">
                    Score: ${activityData.activityScore || 0}/100
                  </div>
                </div>
              </div>
            </div>

            <h4 style="margin-bottom: 15px; color: #666;">📊 Behavior Metrics</h4>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px;">
              <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 4px solid ${activityData.tabSwitches > 10 ? '#ff9800' : '#42a5f5'};">
                <div style="color: #666; font-size: 12px; margin-bottom: 5px;">🔄 TAB SWITCHES</div>
                <div style="font-size: 24px; font-weight: bold; color: ${activityData.tabSwitches > 10 ? '#ff9800' : '#333'};">
                  ${activityData.tabSwitches || 0}
                </div>
                <div style="font-size: 11px; color: #999; margin-top: 5px;">
                  ${activityData.tabSwitches > 10 ? 'High (may indicate looking up answers)' :
                    activityData.tabSwitches > 5 ? 'Moderate' : 'Normal'}
                </div>
              </div>

              <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 4px solid ${activityData.idlePeriods > 5 ? '#ff9800' : '#66bb6a'};">
                <div style="color: #666; font-size: 12px; margin-bottom: 5px;">⏸️ IDLE PERIODS</div>
                <div style="font-size: 24px; font-weight: bold; color: #333;">
                  ${activityData.idlePeriods || 0}
                </div>
                <div style="font-size: 11px; color: #999; margin-top: 5px;">
                  Times inactive for >1 minute
                </div>
              </div>

              <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 4px solid #ffa726;">
                <div style="color: #666; font-size: 12px; margin-bottom: 5px;">⏱️ TOTAL IDLE TIME</div>
                <div style="font-size: 24px; font-weight: bold; color: #333;">
                  ${Math.round((activityData.totalIdleSeconds || 0) / 60)} min
                </div>
                <div style="font-size: 11px; color: #999; margin-top: 5px;">
                  ${Math.round(((activityData.totalIdleSeconds || 0) / ((activityData.sessionDurationMinutes || 1) * 60)) * 100)}% of session
                </div>
              </div>
            </div>

            ${activityData.suspiciousPatterns && activityData.suspiciousPatterns.length > 0 ? `
              <div style="background: rgba(255,152,0,0.1); border: 1px solid rgba(255,152,0,0.3); border-radius: 8px; padding: 15px; margin-top: 20px;">
                <h4 style="color: #ff9800; margin-top: 0;">⚠️ Notable Behaviors</h4>
                <ul style="margin: 10px 0;">
                  ${activityData.suspiciousPatterns.map(p => {
                    let description = '';
                    if (p.type === 'quick_tab_switch') {
                      description = '• Quick tab switch (returned in < 5 seconds)';
                    } else if (p.type === 'switch_and_paste') {
                      description = `• Pasted content after switching tabs ${p.size ? `(${p.size} characters)` : ''}`;
                    } else {
                      description = `• ${p.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`;
                    }
                    return `<li style="color: #666; margin: 5px 0; list-style: none;">${description}</li>`;
                  }).join('')}
                </ul>
              </div>
            ` : ''}

            <div style="background: #e3f2fd; border-radius: 8px; padding: 15px; margin-top: 20px;">
              <h5 style="margin-top: 0; color: #1976d2;">ℹ️ Understanding the Metrics</h5>
              <ul style="font-size: 12px; color: #666; margin: 10px 0; padding-left: 20px;">
                <li><strong>Engagement Level:</strong> Overall assessment based on activity patterns (High/Medium/Low)</li>
                <li><strong>Tab Switches:</strong> Number of times candidate switched away from the interview tab</li>
                <li><strong>Idle Periods:</strong> Number of times candidate was inactive for more than 1 minute</li>
                <li><strong>Score:</strong> 0-100 score calculated from behavior patterns (100 = perfect engagement)</li>
              </ul>
              <small style="color: #999;">Note: These metrics are indicators only and should be considered alongside interview performance.</small>
            </div>
          `;
        })
        .catch(error => {
          console.error('Error loading activity data:', error);
          container.innerHTML = `
            <div style="padding: 20px; text-align: center; color: #f44336;">
              <p>Error loading activity data.</p>
              <p style="font-size: 12px; margin-top: 10px;">${error.message}</p>
            </div>
          `;
        });
    } else {
      container.innerHTML = '<p>Firebase not initialized</p>';
    }
  }

  // View session details with notes
  function viewSessionDetails(sessionCode, sessionData) {
    console.log('viewSessionDetails called with:', sessionCode, sessionData);

    const modal = document.getElementById('sessionDetailsModal');
    if (!modal) {
      console.error('Session details modal not found in DOM');
      // Try to find it with a delay in case DOM isn't ready
      setTimeout(() => {
        const retryModal = document.getElementById('sessionDetailsModal');
        if (retryModal) {
          viewSessionDetails(sessionCode, sessionData);
        } else {
          alert('Session details view is not available. Please refresh the page.');
        }
      }, 100);
      return;
    }

    console.log('Modal found, showing it now');

    // Make sure modal is visible with high z-index
    modal.style.display = 'flex';
    modal.style.zIndex = '10000';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';

    // Set session code
    const codeElement = document.getElementById('detail-session-code');
    if (codeElement) codeElement.textContent = sessionCode;

    // Load notes
    if (window.firebase) {
      window.firebase.database()
        .ref(`sessions/${sessionCode}/interviewerNotes`)
        .once('value')
        .then(snapshot => {
          const notes = snapshot.val();
          if (notes) {
            // Display recommendation
            if (notes.recommendation) {
              const recDiv = document.getElementById('detail-recommendation');
              if (recDiv) {
                recDiv.textContent = window.formatRecommendation ? window.formatRecommendation(notes.recommendation) : notes.recommendation;
                recDiv.className = 'detail-recommendation ' + (window.getRecommendationClass ? window.getRecommendationClass(notes.recommendation) : '');
              }
            }

            // Display rating
            const ratingEl = document.getElementById('display-rating');
            if (ratingEl) {
              if (notes.rating && notes.rating.overall) {
                const stars = '★'.repeat(notes.rating.overall) + '☆'.repeat(5 - notes.rating.overall);
                ratingEl.innerHTML = stars + ` (${notes.rating.overall}/5)`;
              } else {
                ratingEl.textContent = 'Not rated';
              }
            }

            // Display tags
            const tagsEl = document.getElementById('display-tags');
            if (tagsEl) {
              if (notes.tags && notes.tags.length > 0) {
                tagsEl.innerHTML = notes.tags.map(tag =>
                  `<span class="tag">${tag.replace(/-/g, ' ')}</span>`
                ).join(' ');
              } else {
                tagsEl.textContent = 'No tags';
              }
            }

            // Display notes content
            const notesContentEl = document.getElementById('display-notes-content');
            if (notesContentEl) {
              notesContentEl.textContent = notes.content || 'No notes added';
            }

            // Display metadata
            const updatedEl = document.getElementById('display-updated');
            if (updatedEl && notes.updatedAt) {
              updatedEl.textContent = new Date(notes.updatedAt).toLocaleString();
            }
            const authorEl = document.getElementById('display-author');
            if (authorEl) {
              authorEl.textContent = notes.createdBy || 'Unknown';
            }
          } else {
            // No notes yet
            const recDiv = document.getElementById('detail-recommendation');
            if (recDiv) {
              recDiv.textContent = 'No recommendation';
              recDiv.className = 'detail-recommendation';
            }
            const ratingEl = document.getElementById('display-rating');
            if (ratingEl) ratingEl.textContent = 'Not rated';
            const tagsEl = document.getElementById('display-tags');
            if (tagsEl) tagsEl.textContent = 'No tags';
            const notesContentEl = document.getElementById('display-notes-content');
            if (notesContentEl) notesContentEl.textContent = 'No notes added yet';
          }
        }).catch(error => {
          console.error('Error loading notes:', error);
        });

      // Load code content
      const codeTab = document.getElementById('code-tab');
      if (codeTab) {
        if (sessionData.finalFiles && Array.isArray(sessionData.finalFiles.files)) {
          const files = sessionData.finalFiles.files;
          codeTab.innerHTML = `
            <div style="padding: 20px;">
              <p>${files.length} file${files.length === 1 ? '' : 's'} saved. Entry: <strong>${sessionData.finalFiles.entryPath || files[0]?.path || 'Unknown'}</strong></p>
              <pre style="margin-top: 12px; max-height: 320px; overflow: auto; background: #111; color: #ddd; padding: 12px; border-radius: 6px;">${escapeHtml(files.map(file => `// ${file.path}\n${file.content}`).join('\n\n'))}</pre>
            </div>
          `;
        } else {
          const workspaceFiles = Object.values(sessionData.workspace?.files || {});
          const snapshots = sessionData.fileSnapshots || {};
          if (workspaceFiles.length) {
            const files = workspaceFiles
              .sort((left, right) => String(left.path || '').localeCompare(String(right.path || '')))
              .map(file => ({
                path: file.path || file.id || 'Untitled',
                content: typeof snapshots[file.id]?.content === 'string' ? snapshots[file.id].content : ''
              }));

            codeTab.innerHTML = `
              <div style="padding: 20px;">
                <p>${files.length} file${files.length === 1 ? '' : 's'} saved. Entry: <strong>${sessionData.workspace?.entryFileId || files[0]?.path || 'Unknown'}</strong></p>
                <pre style="margin-top: 12px; max-height: 320px; overflow: auto; background: #111; color: #ddd; padding: 12px; border-radius: 6px;">${escapeHtml(files.map(file => `// ${file.path}\n${file.content}`).join('\n\n'))}</pre>
              </div>
            `;
          } else {
            codeTab.innerHTML = '<p style="padding: 20px;">No code written in this session.</p>';
          }
        }
      }
    }

    // Load session info
    if (sessionData) {
      const createdEl = document.getElementById('display-created');
      if (createdEl) {
        const created = new Date(sessionData.created || Date.now());
        createdEl.textContent = created.toLocaleString();
      }

      // Calculate duration
      const durationEl = document.getElementById('display-duration');
      if (durationEl) {
        const now = Date.now();
        const created = new Date(sessionData.created || Date.now());
        const duration = Math.floor((now - created.getTime()) / 1000 / 60); // minutes
        durationEl.textContent = `${duration} minutes`;
      }

      // Participants - use preserved participants for ended sessions
      const participantsEl = document.getElementById('display-participants');
      if (participantsEl) {
        let users;
        if (sessionData.terminated && sessionData.terminated.terminated && sessionData.preservedParticipants) {
          // For ended sessions, use preserved participants
          users = Object.values(sessionData.preservedParticipants || {});
        } else {
          // For active sessions, use current users
          users = Object.values(sessionData.users || {});
        }
        participantsEl.textContent = users.map(u => u.name).join(', ') || 'None';
      }

      // Status
      const statusEl = document.getElementById('display-status');
      if (statusEl) {
        let status = 'Active';
        if (sessionData.terminated && sessionData.terminated.terminated) {
          status = 'Terminated';
        } else if (sessionData.archived) {
          status = 'Archived';
        } else {
          const activeUsers = Object.values(sessionData.users || {});
          const hasCandidate = activeUsers.some(user => {
            const name = (user.name || '').toLowerCase();
            return name &&
              !name.includes('interviewer') &&
              !name.includes('@') &&
              !name.includes('admin') &&
              !name.includes('.com') &&
              !name.includes('.io') &&
              !name.includes('.net');
          });
          const hasInterviewer = activeUsers.some(user => {
            const name = (user.name || '').toLowerCase();
            return name.includes('interviewer') ||
              name.includes('@') ||
              name.includes('admin') ||
              name.includes('.com') ||
              name.includes('.io') ||
              name.includes('.net');
          });
          if (hasCandidate && hasInterviewer) {
            status = 'In Progress';
          }
        }
        statusEl.textContent = status;
      }
    } else {
      console.error('No session data provided to viewSessionDetails');
    }

    // Setup tab switching (remove old listeners first)
    const tabs = document.querySelectorAll('.detail-tab');
    const tabContents = document.querySelectorAll('.tab-content');

    // Remove any existing listeners by cloning
    tabs.forEach(tab => {
      const newTab = tab.cloneNode(true);
      tab.parentNode.replaceChild(newTab, tab);
    });

    // Re-query after cloning
    const newTabs = document.querySelectorAll('.detail-tab');
    newTabs.forEach(tab => {
      tab.addEventListener('click', function() {
        // Remove active class from all tabs
        newTabs.forEach(t => t.classList.remove('active'));
        tabContents.forEach(c => c.style.display = 'none');

        // Add active to clicked tab
        this.classList.add('active');
        const tabName = this.getAttribute('data-tab');
        const tabContent = document.getElementById(`${tabName}-tab`);
        if (tabContent) {
          tabContent.style.display = 'block';

          // If security tab, load tracking data
          if (tabName === 'security' && window.SessionTracking) {
            const sessionCode = document.getElementById('detail-session-code').textContent;
            window.SessionTracking.displaySecurityTab(sessionCode);
          }

          // If activity tab, load activity data
          if (tabName === 'activity') {
            const sessionCode = document.getElementById('detail-session-code').textContent;
            displayActivityTab(sessionCode);
          }
        }
      });
    });

    // Close button - remove old listener first
    const closeBtn = document.getElementById('closeSessionDetailsBtn');
    if (closeBtn) {
      const newCloseBtn = closeBtn.cloneNode(true);
      closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
      newCloseBtn.addEventListener('click', function() {
        modal.style.display = 'none';
      });
    }

    // Close on ESC - use a named function to avoid duplicate listeners
    const escHandler = function(e) {
      if (e.key === 'Escape' && modal.style.display === 'flex') {
        modal.style.display = 'none';
      }
    };
    // Remove old listener and add new one
    document.removeEventListener('keydown', escHandler);
    document.addEventListener('keydown', escHandler);
  }

  // Track if session is starting to prevent duplicates
  let sessionStarting = false;

  // Start coding session
  async function startSession(userName, sessionCode, isNew) {
    sessionCode = normalizeSessionCode(sessionCode);

    // Prevent duplicate session starts
    if (sessionStarting) {
      console.warn('Session already starting, preventing duplicate');
      return;
    }
    sessionStarting = true;

    if (!isValidSessionCode(sessionCode)) {
      sessionStarting = false;
      alert('Please enter a valid 8-character session code.');
      return;
    }

    console.log('START SESSION:', userName, sessionCode, 'isNew:', isNew);
    // Validate session first (for existing sessions)
    if (!isNew) {
      const validation = await validateSession(sessionCode);
      if (!validation.valid) {
        sessionStarting = false;
        handleInvalidSession(validation.error || 'Invalid session');
        return;
      }
    }

    // Hide all modals
    document.querySelectorAll('.modal').forEach(modal => {
      modal.style.display = 'none';
    });

    // Show main container - force it visible
    const mainContainer = document.getElementById('main-container');
    if (mainContainer) {
      mainContainer.style.display = 'flex';
      mainContainer.style.visibility = 'visible';
      mainContainer.style.opacity = '1';
      console.log('Main container shown, display:', mainContainer.style.display);
    } else {
      console.error('CRITICAL: main-container element not found in DOM!');
      sessionStarting = false;
      alert('Error: Unable to load editor interface. Please refresh the page.');
      return;
    }

    // Initialize the editor session
    if (typeof initializeSession === 'function') {
      const authUser = Auth.getCurrentUser();
      initializeSession({
        userName: userName,
        userEmail: authUser.email || null,
        sessionCode: sessionCode,
        isNew: isNew,
        isAdmin: Auth.isAdmin()
      });
    }

    // Reset flag after a delay to allow future navigation
    setTimeout(() => {
      sessionStarting = false;
    }, 2000);
  }

  // Track if this is initial page load
  let isInitialLoad = true;

  // Check for existing session on load - ONLY for page refreshes
  window.addEventListener('load', function() {
    console.log('PAGE LOAD EVENT FIRED - isInitialLoad:', isInitialLoad);

    // If this is NOT the initial page load, skip (means we navigated after page was already loaded)
    if (!isInitialLoad) {
      console.log('PAGE LOAD: Not initial load, skipping');
      return;
    }
    isInitialLoad = false;

    // Don't run if we're already starting a session
    if (sessionStarting) {
      console.log('PAGE LOAD: Session already starting, skipping load handler');
      return;
    }

    // Check if we're already in a session (main container visible means session is active)
    const mainContainer = document.getElementById('main-container');
    if (mainContainer && mainContainer.style.display !== 'none') {
      console.log('PAGE LOAD: Already in a session, skipping');
      return;
    }

    const session = Auth.getCurrentSession();
    const urlCode = window.location.hash.replace('#', '');

    console.log('PAGE LOAD: Session logged in?', session.isLoggedIn, 'URL code:', urlCode);

    // Only auto-join if we have a URL code AND we're logged in (for page refresh scenarios)
    if (session.isLoggedIn && isValidSessionCode(urlCode)) {
      console.log('PAGE LOAD: This should only run on page refresh! Resuming session with code from URL:', urlCode);
      console.trace('PAGE LOAD: Stack trace');
      // Resume existing session - this is ONLY for when someone refreshes the page
      startSession(session.userName, urlCode, false);
    } else {
      console.log('PAGE LOAD: Showing landing page');
      // Show landing page
      if (urlCode) clearSessionHash();
      showInitialScreen();
    }
  });

  // Initialize on DOM ready (but only if not already handling via load event)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      console.log('DOM READY: Checking if should init...');
      const urlCode = window.location.hash.replace('#', '');
      const session = Auth.getCurrentSession();

      // Only init if we're not going to handle this in the load event
      if (!session.isLoggedIn || !isValidSessionCode(urlCode)) {
        console.log('DOM READY: Calling init()');
        if (urlCode) clearSessionHash();
        showInitialScreen();
      } else {
        console.log('DOM READY: Skipping init, will handle in load event');
      }
    });
  } else {
    // Document already loaded, check same conditions
    const urlCode = window.location.hash.replace('#', '');
    const session = Auth.getCurrentSession();
    if (!session.isLoggedIn || !isValidSessionCode(urlCode)) {
      console.log('IMMEDIATE: Calling init()');
      if (urlCode) clearSessionHash();
      showInitialScreen();
    }
  }
})();
