/**
 * Production Authentication Module for Vercel
 * All authentication goes through secure Vercel API endpoints
 * NO credentials are stored client-side
 */
const Auth = (function() {
  'use strict';
  
  // API configuration
  const API_CONFIG = {
    baseUrl: '', // Uses relative paths for same-origin requests
    timeout: 10000,
    retryAttempts: 3
  };
  
  // Session state (token only, no credentials)
  let session = {
    isAuthenticated: false,
    isAdmin: false,
    userName: null,
    email: null,
    token: null,
    expiresAt: null
  };
  
  // Initialize from storage
  function init() {
    const stored = localStorage.getItem('auth_session');
    if (stored) {
      try {
        const data = JSON.parse(stored);
        // Validate token hasn't expired
        if (data.expiresAt && new Date(data.expiresAt) > new Date()) {
          session = data;
        } else {
          localStorage.removeItem('auth_session');
        }
      } catch (e) {
        console.error('Session restore failed:', e);
        localStorage.removeItem('auth_session');
      }
    }
  }
  
  // Secure API request wrapper
  async function apiRequest(endpoint, options = {}) {
    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    };
    
    // Add auth token if available
    if (session.token) {
      config.headers['Authorization'] = `Bearer ${session.token}`;
    }
    
    try {
      const response = await fetch(`${API_CONFIG.baseUrl}${endpoint}`, config);
      let data = {};
      try {
        data = await response.json();
      } catch (parseError) {
        data = {};
      }
      
      if (!response.ok) {
        const apiError = new Error(data.error || `Request failed (${response.status})`);
        apiError.status = response.status;
        throw apiError;
      }
      
      return data;
    } catch (error) {
      console.error(`API request failed: ${endpoint}`, error);
      throw error;
    }
  }
  
  // Admin login - server-side validation only
  async function loginAdmin(email, password) {
    try {
      const data = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      
      if (data.success && data.token) {
        // Calculate expiration (24 hours)
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);
        
        session = {
          isAuthenticated: true,
          isAdmin: true,
          userName: 'Admin',
          email: data.user?.email || email,
          token: data.token,
          expiresAt: expiresAt.toISOString()
        };
        
        // Store securely
        localStorage.setItem('auth_session', JSON.stringify(session));
        
        return { success: true };
      }
      
      return { success: false, error: data.error || 'Authentication failed' };
    } catch (error) {
      console.error('API login error:', error);
      const message = error?.message || '';
      const networkFailure = error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(message);
      return { 
        success: false, 
        error: networkFailure ? 'Server connection failed. Please check if the API is running.' : message
      };
    }
  }
  
  // Candidate join - no authentication needed
  function joinAsCandidate(name) {
    if (!name || name.trim().length === 0) {
      return { success: false, error: 'Please enter your name' };
    }
    
    if (name.trim().length < 2) {
      return { success: false, error: 'Name must be at least 2 characters' };
    }
    
    if (name.trim().length > 50) {
      return { success: false, error: 'Name must be less than 50 characters' };
    }
    
    // Sanitize name
    const sanitized = name.trim().replace(/[<>]/g, '');
    
    session = {
      isAuthenticated: true,
      isAdmin: false,
      userName: sanitized,
      email: null,
      token: null,
      expiresAt: null
    };
    
    // Store in sessionStorage (temporary)
    sessionStorage.setItem('candidate_session', JSON.stringify(session));
    
    return { success: true };
  }
  
  // Verify current session with server
  async function verifySession() {
    if (!session.token) {
      return { valid: false };
    }
    
    try {
      const data = await apiRequest('/api/auth/verify', {
        method: 'GET'
      });
      
      return { valid: data.valid === true };
    } catch (error) {
      // Token invalid or expired
      logout();
      return { valid: false };
    }
  }
  
  // Logout and clear session
  function logout() {
    session = {
      isAuthenticated: false,
      isAdmin: false,
      userName: null,
      email: null,
      token: null,
      expiresAt: null
    };
    
    localStorage.removeItem('auth_session');
    sessionStorage.removeItem('candidate_session');
    
    // Call logout endpoint if token exists
    if (session.token) {
      apiRequest('/api/auth/logout', { method: 'POST' }).catch(() => {});
    }
  }
  
  // Check if user is admin
  function isAdmin() {
    return session.isAuthenticated && session.isAdmin === true;
  }
  
  // Check if user is authenticated
  function isAuthenticated() {
    return session.isAuthenticated === true;
  }
  
  // Get current user info (safe subset)
  function getCurrentUser() {
    return {
      userName: session.userName,
      email: session.email,
      isAdmin: session.isAdmin,
      isAuthenticated: session.isAuthenticated
    };
  }
  
  // Get auth headers for API calls
  function getAuthHeaders() {
    if (session.token) {
      return {
        'Authorization': `Bearer ${session.token}`
      };
    }
    return {};
  }
  
  // Initialize on load
  init();
  
  // Auto-verify session every 5 minutes
  if (session.token) {
    setInterval(() => {
      verifySession();
    }, 5 * 60 * 1000);
  }
  
  // Get current session (compatibility with app.js)
  function getCurrentSession() {
    return {
      isLoggedIn: session.isAuthenticated,
      isAuthenticated: session.isAuthenticated,
      isAdmin: session.isAdmin,
      userName: session.userName,
      email: session.email,
      token: session.token
    };
  }
  
  // Public API
  return {
    loginAdmin,
    joinAsCandidate,
    logout,
    isAdmin,
    isAuthenticated,
    getCurrentUser,
    getCurrentSession,  // Added for compatibility
    getAuthHeaders,
    verifySession
  };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Auth;
}

// Make available globally
window.Auth = Auth;
