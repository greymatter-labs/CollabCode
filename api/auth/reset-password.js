/**
 * Vercel Serverless Function - Password Reset
 * /api/auth/reset-password
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getAdminEmails, isAdminEmail, normalizeEmail } = require('../../lib/admin-auth');

const JWT_SECRET = process.env.JWT_SECRET;

// Ensure required environment variables are set
if (!getAdminEmails().length || !JWT_SECRET) {
  console.error('Missing required environment variables: ADMIN_EMAILS or ADMIN_EMAIL, or JWT_SECRET');
}
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;

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

  const { email } = req.body;
  const normalizedEmail = normalizeEmail(email);

  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  // Check if email matches admin
  if (!isAdminEmail(normalizedEmail)) {
    // Don't reveal if email exists or not (security)
    return res.status(200).json({ 
      success: true, 
      message: 'If the email exists, a reset link has been sent' 
    });
  }

  try {
    // Generate reset token (expires in 1 hour)
    const resetToken = jwt.sign(
      { 
        email: normalizedEmail,
        type: 'password-reset',
        nonce: crypto.randomBytes(16).toString('hex')
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Create reset URL (use your app domain)
    const appDomain = process.env.APP_DOMAIN || 'http://localhost:3000';
    const resetUrl = `${appDomain}/reset-password?token=${resetToken}`;

    if (SENDGRID_API_KEY) {
      // Send email via SendGrid
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(SENDGRID_API_KEY);

      const msg = {
        to: normalizedEmail,
        from: 'noreply@yourcompany.com', // Must be verified in SendGrid
        subject: 'Password Reset Request',
        text: `Click this link to reset your password: ${resetUrl}\n\nThis link expires in 1 hour.`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Password Reset Request</h2>
            <p>You requested a password reset for your Sneakers account.</p>
            <p>Click the button below to reset your password:</p>
            <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #4CAF50; color: white; text-decoration: none; border-radius: 4px;">Reset Password</a>
            <p style="color: #666; font-size: 14px; margin-top: 20px;">This link expires in 1 hour. If you didn't request this, please ignore this email.</p>
          </div>
        `
      };

      await sgMail.send(msg);
    } else {
      // No email service configured - return token for manual process
      console.log('Reset token generated:', resetToken);
      console.log('Reset URL:', resetUrl);
      
      return res.status(200).json({ 
        success: true,
        message: 'Reset token generated (email service not configured)',
        // Only include in development
        ...(process.env.NODE_ENV !== 'production' && { resetUrl })
      });
    }

    res.status(200).json({ 
      success: true, 
      message: 'Password reset email sent' 
    });

  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Failed to process password reset' });
  }
};
