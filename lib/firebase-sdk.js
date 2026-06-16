/**
 * Firebase SDK Configuration
 * 
 * SECURITY NOTE:
 * - Firebase API keys are designed to be public and included in client-side code
 * - Security is enforced through Firebase Security Rules (database.rules.secure.json)
 * - These keys only identify your project, they don't grant access
 * - Access control is managed by:
 *   1. Database Security Rules (configured in Firebase Console)
 *   2. Authentication (handled by our backend API)
 *   3. CORS settings and domain restrictions
 * 
 * For additional security:
 * - Database rules restrict access to authenticated users only
 * - Admin functions require JWT tokens from our backend
 * - Consider enabling App Check for additional client verification
 */

// Initialize Firebase with public configuration
// These are CLIENT-SIDE keys that are safe to expose
// IMPORTANT: Replace these with your own Firebase project configuration
var config = {
  apiKey: "AIzaSyC5bqDBfNIP8IpW70w_1HSbrNNm8yLh2u8",
  authDomain: "collabcode-74b1c.firebaseapp.com",
  databaseURL: "https://collabcode-74b1c-default-rtdb.firebaseio.com",
  storageBucket: "collabcode-74b1c.firebasestorage.app",
  messagingSenderId: "5853768322",
  projectId: "collabcode-74b1c",
  appId: "1:5853768322:web:be92f68e060b5fbbf4629b"
};

// Initialize Firebase
try {
  firebase.initializeApp(config);
  console.log('✅ Firebase initialized');
  
  // Monitor connection status
  firebase.database().ref('.info/connected').on('value', function(snapshot) {
    if (snapshot.val() === true) {
      console.log('✅ Firebase connected');
    } else {
      console.warn('⚠️ Firebase disconnected - check your internet connection');
    }
  });
} catch (error) {
  console.error('❌ Firebase initialization error:', error);
}

// Security reminder for developers
if (window.location.hostname === 'localhost') {
  console.info(
    '%c⚠️ Security Reminder',
    'background: yellow; color: black; padding: 5px;',
    '\nFirebase config is public by design. Security is enforced through:\n' +
    '1. Database Security Rules (database.rules.secure.json)\n' +
    '2. Backend authentication (Vercel API)\n' +
    '3. Never store sensitive data in client-side code\n' +
    '4. Use environment variables for server-side secrets only'
  );
}
