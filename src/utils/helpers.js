// src/utils/helpers.js
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

/**
 * Log an activity to the audit trail
 */
const logActivity = (userId, action, entityType, entityId, details, ipAddress, status = 'success') => {
  db.run(
    'INSERT INTO activity_logs (id, user_id, action, entity_type, entity_id, details, ip_address, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [uuidv4(), userId || null, action, entityType || null, entityId || null, details || null, ipAddress || null, status],
    (err) => { if (err) console.error('Activity log error:', err.message); }
  );
};

/**
 * Create a notification for a user
 */
const createNotification = (userId, title, message, type = 'info', link = null) => {
  db.run(
    'INSERT INTO notifications (id, user_id, title, message, type, link) VALUES (?, ?, ?, ?, ?, ?)',
    [uuidv4(), userId, title, message, type, link],
    (err) => { if (err) console.error('Notification error:', err.message); }
  );
};

/**
 * Pagination helper
 */
const paginate = (page = 1, limit = 20) => {
  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, Math.max(1, parseInt(limit)));
  return { offset: (p - 1) * l, limit: l, page: p };
};

/**
 * Format currency
 */
const formatCurrency = (amount, currency = '₦') => `${currency}${Number(amount || 0).toLocaleString()}`;

/**
 * Check if a date is overdue and update bills
 */
const updateOverdueBills = () => {
  db.run(
    "UPDATE bills SET status='overdue', updated_at=datetime('now') WHERE status='pending' AND due_date < date('now')",
    [],
    (err) => { if (err) console.error('Overdue update error:', err.message); }
  );
};

/**
 * Check expiring leases and notify
 */
const checkExpiringLeases = () => {
  db.all(
    "SELECT l.*, u.id as uid, u.name, p.unit_number FROM leases l JOIN users u ON u.id=l.tenant_id JOIN properties p ON p.id=l.property_id WHERE l.status='active' AND l.end_date BETWEEN date('now') AND date('now','+30 days')",
    [],
    (err, leases) => {
      leases?.forEach(l => {
        createNotification(l.uid, 'Lease Expiring', `Your lease for Unit ${l.unit_number} expires on ${l.end_date}. Please contact the office.`, 'warning');
      });
    }
  );
};

module.exports = { logActivity, createNotification, paginate, formatCurrency, updateOverdueBills, checkExpiringLeases };
