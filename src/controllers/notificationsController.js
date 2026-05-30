// src/controllers/notificationsController.js
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

// GET /api/notifications
const getNotifications = (req, res) => {
  db.all(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    [req.user.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
};

// PUT /api/notifications/read-all
const markAllRead = (req, res) => {
  db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'All notifications marked as read' });
  });
};

// PUT /api/notifications/:id/read
const markRead = (req, res) => {
  db.run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Notification marked as read' });
  });
};

// POST /api/notifications/broadcast — admin sends to all/role
const broadcastNotification = (req, res) => {
  const { title, message, type = 'info', role = 'tenant' } = req.body;
  if (!title || !message) return res.status(400).json({ error: 'Title and message required' });

  const query = role === 'all' ? 'SELECT id FROM users WHERE is_active=1' : 'SELECT id FROM users WHERE role=? AND is_active=1';
  const params = role === 'all' ? [] : [role];

  db.all(query, params, (err, users) => {
    if (err || !users.length) return res.status(500).json({ error: 'No recipients' });

    const stmt = db.prepare('INSERT INTO notifications (id, user_id, title, message, type) VALUES (?, ?, ?, ?, ?)');
    users.forEach(u => stmt.run([uuidv4(), u.id, title, message, type]));
    stmt.finalize();
    res.json({ message: `Notification sent to ${users.length} users` });
  });
};

module.exports = { getNotifications, markAllRead, markRead, broadcastNotification };
