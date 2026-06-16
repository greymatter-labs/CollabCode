const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

function setCorsHeaders(res, methods = 'GET, POST, OPTIONS') {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function requireAdmin(req) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    const error = new Error('No token provided');
    error.statusCode = 401;
    throw error;
  }

  const decoded = jwt.verify(token, JWT_SECRET);
  if (!decoded.isAdmin) {
    const error = new Error('Admin access required');
    error.statusCode = 403;
    throw error;
  }

  return decoded;
}

function sendApiError(res, error, fallback = 'Request failed') {
  const status = error.statusCode || error.status || 500;
  const message = status >= 500 ? fallback : error.message || fallback;
  if (status >= 500) {
    console.error(fallback, error);
  }
  res.status(status).json({ error: message });
}

module.exports = {
  requireAdmin,
  sendApiError,
  setCorsHeaders
};
