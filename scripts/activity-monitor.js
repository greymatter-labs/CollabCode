// Activity Monitoring Module - Simple and Reliable
// Uses built-in browser APIs that actually work

(function() {
  let monitoring = false;
  let sessionCode = null;
  let userId = null;
  let userType = null;
  let metricsIntervalId = null;
  
  // Idle detection state (moved to module scope)
  let isIdle = false;
  let idleStartTime = null;
  
  // Metrics
  let metrics = {
    tabSwitches: 0,
    idlePeriods: 0,
    focusLost: 0,
    totalIdleTime: 0,
    lastActiveTime: Date.now(),
    sessionStart: Date.now(),
    suspiciousPatterns: []
  };
  
  // Initialize monitoring
  window.initActivityMonitor = function(session, user, type) {
    sessionCode = session;
    userId = user;
    userType = type;
    
    // For candidates, track their activity
    if (type === 'candidate') {
      monitoring = true;
      metrics.sessionStart = Date.now();
      console.log('Activity monitoring started for candidate:', user);
      
      // Start monitoring
      setupVisibilityTracking();
      setupIdleDetection();
      setupActivityTracking();
      reportMetricsPeriodically();
    } 
    // For interviewers, just listen to activity updates from Firebase
    else if (type === 'interviewer') {
      console.log('Activity monitoring in observer mode for interviewer');
      listenToActivityUpdates();
    }
  };
  
  // Listen to activity updates from Firebase (for interviewers)
  function listenToActivityUpdates() {
    if (!window.firebase || !sessionCode) return;
    
    // Listen to activity summary updates
    firebase.database()
      .ref(`sessions/${sessionCode}/activity_summary`)
      .on('value', function(snapshot) {
        const summary = snapshot.val();
        if (summary) {
          // Cache for later use
          window.lastActivitySummary = summary;
          if (window.updateActivityDashboard) {
            window.updateActivityDashboard(summary);
          }
        }
      });
    
    // Also listen for final summary
    firebase.database()
      .ref(`sessions/${sessionCode}/activity_final_summary`)
      .on('value', function(snapshot) {
        const finalSummary = snapshot.val();
        if (finalSummary) {
          window.lastActivitySummary = finalSummary;
          console.log('Final activity summary received:', finalSummary);
        }
      });
    
    // Listen to alerts
    firebase.database()
      .ref(`sessions/${sessionCode}/activity_log`)
      .orderByChild('timestamp')
      .limitToLast(10)
      .on('child_added', function(snapshot) {
        const event = snapshot.val();
        if (event && event.type === 'alert_triggered') {
          console.log('Activity alert:', event.message);
          // Could show a toast notification here
        }
      });
  }

  function stopMonitoring() {
    monitoring = false;
    if (metricsIntervalId) {
      clearInterval(metricsIntervalId);
      metricsIntervalId = null;
    }
  }

  async function canWriteActivityData(options = {}) {
    if (!monitoring || !window.firebase || !window.firebase.database || !sessionCode) {
      return false;
    }

    const snapshot = await firebase.database().ref(`sessions/${sessionCode}`).once('value');
    const session = snapshot.val();
    const hasSessionMetadata = !!(session && session.created && session.createdBy);
    const isTerminated = !!(session && session.terminated && session.terminated.terminated);
    const canWrite = hasSessionMetadata && (options.allowTerminated || !isTerminated);

    if (!canWrite) {
      console.log('Stopping activity monitoring for inactive session:', sessionCode);
      stopMonitoring();
    }

    return canWrite;
  }
  
  // 1. VISIBILITY API - This actually works!
  function setupVisibilityTracking() {
    let hiddenTime = null;
    
    document.addEventListener('visibilitychange', function() {
      if (!monitoring) return;
      
      if (document.hidden) {
        // Tab became hidden
        hiddenTime = Date.now();
        metrics.tabSwitches++;
        
        console.log('Tab hidden - Total switches:', metrics.tabSwitches);
        
        // Log to Firebase
        logEvent('tab_hidden', {
          count: metrics.tabSwitches,
          timestamp: hiddenTime
        });
        
        // Alert if excessive
        if (metrics.tabSwitches > 5 && metrics.tabSwitches % 5 === 0) {
          showAlert('frequent_tab_switching', {
            count: metrics.tabSwitches
          });
        }
      } else {
        // Tab became visible
        if (hiddenTime) {
          const awayDuration = Date.now() - hiddenTime;
          console.log('Returned to tab after:', Math.round(awayDuration / 1000), 'seconds');
          
          // Log suspicious pattern
          if (awayDuration < 5000) { // Less than 5 seconds
            metrics.suspiciousPatterns.push({
              type: 'quick_tab_switch',
              duration: awayDuration,
              timestamp: Date.now()
            });
            
            // Check if paste happens soon after
            watchForPostSwitchActivity();
          }
        }
      }
    });
  }
  
  // 2. IDLE DETECTION - Using mouse/keyboard activity
  function setupIdleDetection() {
    let idleTimer = null;
    const IDLE_THRESHOLD = 60000; // 1 minute
    
    function resetIdleTimer() {
      if (!monitoring) return;
      
      clearTimeout(idleTimer);
      
      if (isIdle) {
        // User was idle and is now active again
        isIdle = false;
        if (idleStartTime) {
          const idleDuration = Date.now() - idleStartTime;
          metrics.totalIdleTime += idleDuration;
          console.log('Activity resumed after idle:', Math.round(idleDuration / 1000), 'seconds');
          console.log('Total idle time so far:', Math.round(metrics.totalIdleTime / 1000), 'seconds');
        }
        idleStartTime = null;
      }
      
      metrics.lastActiveTime = Date.now();
      
      idleTimer = setTimeout(function() {
        // User has become idle
        isIdle = true;
        idleStartTime = Date.now();
        metrics.idlePeriods++;
        console.log('User idle detected at:', new Date(idleStartTime).toLocaleTimeString());
        
        logEvent('idle_detected', {
          idlePeriods: metrics.idlePeriods,
          timestamp: Date.now()
        });
      }, IDLE_THRESHOLD);
    }
    
    // Track activity
    ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'].forEach(event => {
      document.addEventListener(event, resetIdleTimer, true);
    });
    
    // Start timer
    resetIdleTimer();
  }
  
  // 3. ACTIVITY PATTERNS - Track suspicious behaviors
  function setupActivityTracking() {
    let recentActivity = [];
    const PATTERN_WINDOW = 10000; // 10 seconds
    
    // Track copy events (we can detect ctrl+c/cmd+c)
    document.addEventListener('copy', function(e) {
      if (!monitoring) return;
      
      console.log('Copy event detected');
      recentActivity.push({
        type: 'copy',
        timestamp: Date.now()
      });
      
      logEvent('copy_detected', {
        timestamp: Date.now()
      });
    });
    
    // Track paste events (this works in the document context)
    document.addEventListener('paste', function(e) {
      if (!monitoring) return;
      
      const pasteSize = e.clipboardData ? 
        e.clipboardData.getData('text').length : 0;
      
      console.log('Paste event detected, size:', pasteSize);
      
      recentActivity.push({
        type: 'paste',
        size: pasteSize,
        timestamp: Date.now()
      });
      
      // Check for suspicious patterns
      const recentTabSwitch = metrics.suspiciousPatterns.find(p => 
        p.type === 'quick_tab_switch' && 
        Date.now() - p.timestamp < 3000
      );
      
      if (recentTabSwitch && pasteSize > 50) {
        console.warn('SUSPICIOUS: Large paste after tab switch');
        metrics.suspiciousPatterns.push({
          type: 'switch_and_paste',
          pasteSize: pasteSize,
          timestamp: Date.now()
        });
        
        showAlert('suspicious_paste_pattern', {
          size: pasteSize,
          afterTabSwitch: true
        });
      }
      
      logEvent('paste_detected', {
        size: pasteSize,
        afterTabSwitch: !!recentTabSwitch,
        timestamp: Date.now()
      });
    });
    
    // Track focus/blur
    window.addEventListener('focus', function() {
      if (!monitoring) return;
      console.log('Window focused');
      recentActivity.push({
        type: 'focus',
        timestamp: Date.now()
      });
    });
    
    window.addEventListener('blur', function() {
      if (!monitoring) return;
      metrics.focusLost++;
      console.log('Window blurred');
      recentActivity.push({
        type: 'blur',
        timestamp: Date.now()
      });
    });
    
    // Clean old activity periodically
    setInterval(function() {
      const cutoff = Date.now() - PATTERN_WINDOW;
      recentActivity = recentActivity.filter(a => a.timestamp > cutoff);
    }, 5000);
  }
  
  // 4. Watch for activity after tab switch
  function watchForPostSwitchActivity() {
    const watchDuration = 3000; // 3 seconds
    const startTime = Date.now();
    
    const checkInterval = setInterval(function() {
      if (Date.now() - startTime > watchDuration) {
        clearInterval(checkInterval);
        return;
      }
      
      // This will be caught by the paste event listener
    }, 100);
  }
  
  // 5. Log events to Firebase
  async function logEvent(eventType, data) {
    if (!monitoring) return;
    
    if (!window.firebase || !window.firebase.database) {
      console.warn('Firebase not available for logging event:', eventType);
      return;
    }
    
    try {
      const eventData = {
        type: eventType,
        userId: userId,
        userType: userType,
        ...data,
        timestamp: Date.now()
      };
      
      if (!await canWriteActivityData()) return;

      console.log('Logging event to Firebase:', eventType, sessionCode);
      firebase.database()
        .ref(`sessions/${sessionCode}/activity_log`)
        .push(eventData)
        .then(() => {
          console.log('✅ Event logged successfully:', eventType);
        })
        .catch(err => {
          console.error('❌ Firebase push failed:', err);
        });
    } catch (error) {
      console.error('Failed to log event:', error);
    }
  }
  
  // 6. Show alerts to interviewer
  function showAlert(alertType, data) {
    if (!monitoring) return;
    
    const messages = {
      'frequent_tab_switching': `⚠️ Candidate has switched tabs ${data.count} times`,
      'suspicious_paste_pattern': `🚨 Large paste detected after tab switch (${data.size} chars)`,
      'extended_idle': `💤 Candidate has been idle for extended period`
    };
    
    const message = messages[alertType] || 'Suspicious activity detected';
    
    // Log alert
    logEvent('alert_triggered', {
      alertType: alertType,
      message: message,
      data: data
    });
    
    // Update UI if we have access to it
    if (window.updateBehaviorAlert) {
      window.updateBehaviorAlert(message, data);
    }
    
    console.warn('ALERT:', message);
  }
  
  // 7. Report metrics periodically
  function reportMetricsPeriodically() {
    if (metricsIntervalId) return;

    metricsIntervalId = setInterval(async function() {
      if (!monitoring) return;
      
      // Calculate total idle time including current idle period
      let currentIdleTime = metrics.totalIdleTime;
      if (isIdle && idleStartTime) {
        const ongoingIdleDuration = Date.now() - idleStartTime;
        currentIdleTime += ongoingIdleDuration;
      }
      
      const sessionDuration = Date.now() - metrics.sessionStart;
      const summary = {
        sessionDuration: Math.round(sessionDuration / 1000), // seconds
        tabSwitches: metrics.tabSwitches,
        idlePeriods: metrics.idlePeriods,
        totalIdleTime: Math.round(currentIdleTime / 1000), // seconds
        focusLostCount: metrics.focusLost,
        suspiciousPatterns: metrics.suspiciousPatterns.length,
        activityScore: calculateActivityScore()
      };
      
      console.log('Activity Summary:', summary);
      
      // Store summary
      if (window.firebase && window.firebase.database) {
        if (!await canWriteActivityData()) return;

        console.log('📝 Saving activity summary to Firebase for session:', sessionCode);
        firebase.database()
          .ref(`sessions/${sessionCode}/activity_summary`)
          .set(summary)
          .then(() => {
            console.log('✅ Activity summary saved successfully');
          })
          .catch(err => {
            console.error('❌ Failed to save activity summary:', err);
          });
      } else {
        console.warn('Firebase not available for saving summary');
      }
      
      // Update interviewer dashboard
      if (window.updateActivityDashboard) {
        window.updateActivityDashboard(summary);
      }
    }, 30000); // Every 30 seconds
  }
  
  // 8. Calculate activity score
  function calculateActivityScore() {
    let score = 100; // Start with perfect score
    
    // Deduct for tab switches
    score -= Math.min(metrics.tabSwitches * 5, 30); // Max -30
    
    // Deduct for idle time
    const idlePercent = (metrics.totalIdleTime / (Date.now() - metrics.sessionStart)) * 100;
    score -= Math.min(idlePercent * 0.5, 20); // Max -20
    
    // Deduct for suspicious patterns
    score -= metrics.suspiciousPatterns.length * 10; // -10 per pattern
    
    return Math.max(0, Math.round(score));
  }
  
  // 9. Get summary for export
  window.getActivitySummary = function() {
    // For candidates, return their metrics
    if (monitoring) {
      // Calculate total idle time including current idle period
      let currentIdleTime = metrics.totalIdleTime;
      if (isIdle && idleStartTime) {
        const ongoingIdleDuration = Date.now() - idleStartTime;
        currentIdleTime += ongoingIdleDuration;
      }
      
      return {
        tabSwitches: metrics.tabSwitches,
        idlePeriods: metrics.idlePeriods,
        totalIdleSeconds: Math.round(currentIdleTime / 1000),
        suspiciousPatterns: metrics.suspiciousPatterns,
        activityScore: calculateActivityScore(),
        sessionDurationMinutes: Math.round((Date.now() - metrics.sessionStart) / 60000)
      };
    }
    // For interviewers, get the last saved summary from Firebase
    else if (window.lastActivitySummary) {
      return window.lastActivitySummary;
    }
    
    return null;
  };
  
  // Save final activity summary when session ends
  window.saveActivitySummary = function() {
    if (!monitoring) return;
    
    // Check if currently idle and add that time
    let finalIdleTime = metrics.totalIdleTime;
    if (isIdle && idleStartTime) {
      const currentIdleDuration = Date.now() - idleStartTime;
      finalIdleTime += currentIdleDuration;
      console.log('Adding current idle period to final summary:', Math.round(currentIdleDuration / 1000), 'seconds');
    }
    
    const finalSummary = {
      tabSwitches: metrics.tabSwitches,
      idlePeriods: metrics.idlePeriods,
      totalIdleSeconds: Math.round(finalIdleTime / 1000),
      suspiciousPatterns: metrics.suspiciousPatterns,
      activityScore: calculateActivityScore(),
      sessionDurationMinutes: Math.round((Date.now() - metrics.sessionStart) / 60000),
      finalReport: true,
      timestamp: Date.now()
    };
    
    // Save to Firebase
    if (window.firebase && window.firebase.database && sessionCode) {
      canWriteActivityData({ allowTerminated: true })
        .then((canWrite) => {
          if (!canWrite) return false;
          console.log('💾 Saving final activity summary for session:', sessionCode);
          return firebase.database()
            .ref(`sessions/${sessionCode}/activity_final_summary`)
            .set(finalSummary)
            .then(() => true);
        })
        .then((saved) => {
          if (!saved) return;
          console.log('✅ Final activity summary saved successfully:', finalSummary);
          stopMonitoring();
        })
        .catch(err => {
          console.error('❌ Failed to save final activity summary:', err);
        });
    } else {
      console.warn('Cannot save final summary - Firebase or sessionCode missing');
    }
    
    return finalSummary;
  };
  
  // 10. Update interviewer UI
  window.updateActivityDashboard = function(summary) {
    // Update the dashboard in notes panel
    const dashboard = document.getElementById('activity-dashboard');
    if (dashboard) {
      dashboard.style.display = 'block';
      dashboard.innerHTML = `
      <div class="activity-summary">
        <h4>Candidate Activity Monitor</h4>
        <div class="activity-metrics">
          <div class="metric">
            <span class="label">Tab Switches</span>
            <span class="value ${summary.tabSwitches > 10 ? 'warning' : ''}">${summary.tabSwitches}</span>
          </div>
          <div class="metric">
            <span class="label">Idle Periods</span>
            <span class="value">${summary.idlePeriods}</span>
          </div>
          <div class="metric">
            <span class="label">Activity Score</span>
            <span class="value ${summary.activityScore < 70 ? 'warning' : ''}">${summary.activityScore}%</span>
          </div>
          <div class="metric">
            <span class="label">Session Time</span>
            <span class="value">${summary.sessionDurationMinutes} min</span>
          </div>
        </div>
        ${summary.suspiciousPatterns > 0 ? `
          <div class="warning-message">
            ⚠️ ${summary.suspiciousPatterns} suspicious patterns detected
          </div>
        ` : ''}
      </div>
    `;
    }
    
    // Also create/update a floating indicator for interviewers
    createFloatingIndicator(summary);
  };
  
  // Create a floating activity indicator that's always visible
  function createFloatingIndicator(summary) {
    // Only show for interviewers
    const user = window.Auth && window.Auth.getCurrentUser();
    if (!user || !user.isAdmin) return;
    
    let indicator = document.getElementById('floating-activity-indicator');
    if (!indicator) {
      // Create the floating indicator
      indicator = document.createElement('div');
      indicator.id = 'floating-activity-indicator';
      indicator.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 20px;
        background: rgba(30, 30, 30, 0.95);
        border: 1px solid rgba(66, 165, 245, 0.3);
        border-radius: 8px;
        padding: 12px;
        min-width: 200px;
        z-index: 1000;
        font-family: monospace;
        font-size: 12px;
        color: #fff;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      `;
      document.body.appendChild(indicator);
    }
    
    // Color based on activity score
    const scoreColor = summary.activityScore > 80 ? '#4caf50' : 
                      summary.activityScore > 60 ? '#ff9800' : '#ff4444';
    
    indicator.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 8px; color: #42a5f5;">
        📊 Candidate Activity
      </div>
      <div style="display: grid; grid-template-columns: auto auto; gap: 4px 12px; font-size: 11px;">
        <span style="color: #999;">Score:</span>
        <span style="color: ${scoreColor}; font-weight: bold;">${summary.activityScore}%</span>
        
        <span style="color: #999;">Tab Switches:</span>
        <span style="color: ${summary.tabSwitches > 10 ? '#ff9800' : '#fff'};">${summary.tabSwitches}</span>
        
        <span style="color: #999;">Idle:</span>
        <span>${summary.idlePeriods} periods</span>
        
        ${summary.suspiciousPatterns > 0 ? `
          <span style="color: #ff9800;">⚠️ Suspicious:</span>
          <span style="color: #ff9800;">${summary.suspiciousPatterns}</span>
        ` : ''}
      </div>
      <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 10px; color: #666;">
        Session: ${summary.sessionDurationMinutes} min
      </div>
    `;
  }
  
  console.log('Activity Monitor module loaded - using reliable browser APIs');
  
  // Debug function to test Firebase connectivity and manually save test data
  window.testActivitySave = function(testSessionCode) {
    const code = testSessionCode || sessionCode || 'test123';
    console.log('🧪 Testing activity save for session:', code);
    
    if (!window.firebase || !window.firebase.database) {
      console.error('❌ Firebase not available');
      return;
    }
    
    const testData = {
      tabSwitches: 5,
      idlePeriods: 2,
      totalIdleSeconds: 120,
      activityScore: 75,
      sessionDurationMinutes: 10,
      test: true,
      timestamp: Date.now()
    };
    
    console.log('📝 Attempting to save test data:', testData);
    
    firebase.database()
      .ref(`sessions/${code}/activity_test`)
      .set(testData)
      .then(() => {
        console.log('✅ Test data saved successfully!');
        console.log('Now trying to read it back...');
        return firebase.database()
          .ref(`sessions/${code}/activity_test`)
          .once('value');
      })
      .then(snapshot => {
        const retrieved = snapshot.val();
        console.log('✅ Successfully retrieved test data:', retrieved);
        console.log('Firebase is working correctly!');
      })
      .catch(err => {
        console.error('❌ Firebase error:', err);
        console.error('Error details:', err.message, err.code);
      });
  };
})();
