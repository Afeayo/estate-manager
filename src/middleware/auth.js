// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const db = require('../config/database');

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    db.get('SELECT id, name, email, role, is_active FROM users WHERE id = ?', [decoded.id], (err, user) => {
      if (err || !user) return res.status(401).json({ error: 'Invalid token' });
      if (!user.is_active) return res.status(403).json({ error: 'Account deactivated' });
      req.user = user;
      next();
    });
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

module.exports = { authenticate, authorize };
