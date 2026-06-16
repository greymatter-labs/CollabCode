function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getAdminEmails() {
  const configuredEmails = process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '';
  return configuredEmails
    .split(',')
    .map(normalizeEmail)
    .filter(Boolean);
}

function isAdminEmail(email) {
  return getAdminEmails().includes(normalizeEmail(email));
}

module.exports = {
  getAdminEmails,
  isAdminEmail,
  normalizeEmail
};
