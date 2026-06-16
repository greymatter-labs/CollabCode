const admin = require('firebase-admin');

function getFirebaseAdmin() {
  if (!admin.apps.length) {
    const databaseURL = process.env.FIREBASE_DATABASE_URL || `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`;

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
      }),
      databaseURL
    });
  }

  return admin;
}

module.exports = getFirebaseAdmin;
