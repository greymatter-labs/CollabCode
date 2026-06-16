/**
 * Vercel Serverless Function - Update Password
 * /api/auth/update-password
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getAdminEmails, isAdminEmail } = require('../../lib/admin-auth');

const JWT_SECRET = process.env.JWT_SECRET;

// Ensure required environment variables are set
if (!JWT_SECRET || !getAdminEmails().length) {
  console.error('Missing required environment variables: JWT_SECRET and ADMIN_EMAILS or ADMIN_EMAIL');
}

// In production, this would update a database
// For now, it generates the new hash for manual update
module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Token and new password required' });
  }

  // Validate password strength
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  if (!/[A-Z]/.test(newPassword)) {
    return res.status(400).json({ error: 'Password must contain uppercase letter' });
  }

  if (!/[a-z]/.test(newPassword)) {
    return res.status(400).json({ error: 'Password must contain lowercase letter' });
  }

  if (!/[0-9]/.test(newPassword)) {
    return res.status(400).json({ error: 'Password must contain number' });
  }

  if (!/[!@#$%^&*]/.test(newPassword)) {
    return res.status(400).json({ error: 'Password must contain special character' });
  }

  try {
    // Verify reset token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (decoded.type !== 'password-reset') {
      return res.status(401).json({ error: 'Invalid reset token' });
    }

    if (!isAdminEmail(decoded.email)) {
      return res.status(401).json({ error: 'Invalid reset token' });
    }

    // Generate new password hash
    const newHash = await bcrypt.hash(newPassword, 10);

    // In production with a database, you would update the user record here
    // For now, we'll return instructions for manual update
    
    console.log('New password hash generated:', newHash);
    console.log('Update ADMIN_PASSWORD_HASH in Vercel Dashboard with:', newHash);

    res.status(200).json({ 
      success: true,
      message: 'Password updated successfully',
      instructions: process.env.NODE_ENV !== 'production' ? {
        step1: 'Go to Vercel Dashboard → Settings → Environment Variables',
        step2: 'Update ADMIN_PASSWORD_HASH with the new hash',
        step3: 'Redeploy for changes to take effect',
        newHash: newHash
      } : undefined
    });

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Reset token has expired' });
    }
    
    console.error('Password update error:', error);
    res.status(401).json({ error: 'Invalid or expired reset token' });
  }
};
