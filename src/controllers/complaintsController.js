// src/controllers/complaintsController.js
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { logActivity, createNotification } = require('../utils/helpers');

// GET /api/complaints
const getComplaints = (req, res) => {
  const { status, priority, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  let where = 'WHERE 1=1';
  const params = [];

  if (req.user.role === 'tenant') { where += ' AND c.tenant_id = ?'; params.push(req.user.id); }
  if (status) { where += ' AND c.status = ?'; params.push(status); }
  if (priority) { where += ' AND c.priority = ?'; params.push(priority); }

  db.all(
    `SELECT c.*, u.name as tenant_name, u.email as tenant_email, p.unit_number,
      a.name as assigned_to_name
     FROM complaints c
     JOIN users u ON u.id = c.tenant_id
     LEFT JOIN properties p ON p.id = c.property_id
     LEFT JOIN users a ON a.id = c.assigned_to
     ${where}
     ORDER BY
       CASE c.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
       c.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, parseInt(limit), offset],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      db.get(`SELECT COUNT(*) as total FROM complaints c ${where}`, params, (e, c) => {
        res.json({ complaints: rows, total: c?.total || 0, page: parseInt(page) });
      });
    }
  );
};

// GET /api/complaints/:id
const getComplaint = (req, res) => {
  let where = 'c.id = ?';
  const params = [req.params.id];
  if (req.user.role === 'tenant') { where += ' AND c.tenant_id = ?'; params.push(req.user.id); }

  db.get(
    `SELECT c.*, u.name as tenant_name, u.email as tenant_email, p.unit_number,
      a.name as assigned_to_name
     FROM complaints c
     JOIN users u ON u.id = c.tenant_id
     LEFT JOIN properties p ON p.id = c.property_id
     LEFT JOIN users a ON a.id = c.assigned_to
     WHERE ${where}`,
    params,
    (err, complaint) => {
      if (err || !complaint) return res.status(404).json({ error: 'Complaint not found' });

      db.all(
        `SELECT m.*, u.name as sender_name, u.role as sender_role
         FROM messages m JOIN users u ON u.id = m.sender_id
         WHERE m.complaint_id = ? ORDER BY m.created_at ASC`,
        [complaint.id],
        (e, messages) => {
          res.json({ ...complaint, messages });
        }
      );
    }
  );
};

// POST /api/complaints
const createComplaint = (req, res) => {
  const { title, description, category = 'general', priority = 'medium' } = req.body;
  if (!title || !description) return res.status(400).json({ error: 'Title and description required' });

  const id = uuidv4();
  const images = req.files ? req.files.map(f => `/uploads/${f.filename}`).join(',') : null;

  // Get tenant's property
  db.get("SELECT property_id FROM leases WHERE tenant_id = ? AND status='active'", [req.user.id], (err, lease) => {
    db.run(
      'INSERT INTO complaints (id, tenant_id, property_id, title, description, category, priority, images) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, req.user.id, lease?.property_id || null, title, description, category, priority, images],
      function (err2) {
        if (err2) return res.status(500).json({ error: err2.message });
        logActivity(req.user.id, 'create_complaint', 'complaint', id, `Complaint: ${title}`, req.ip, 'new_entry');
        // Notify admins
        db.all("SELECT id FROM users WHERE role IN ('admin','support')", [], (e, admins) => {
          admins?.forEach(a => createNotification(a.id, 'New Complaint', `${title} — ${priority} priority`, priority === 'urgent' ? 'error' : 'warning'));
        });
        res.status(201).json({ id, message: 'Complaint submitted' });
      }
    );
  });
};

// PUT /api/complaints/:id — admin updates status/assignment
const updateComplaint = (req, res) => {
  const { status, assigned_to, resolution_notes, priority } = req.body;
  const updates = ['updated_at = datetime("now")'];
  const values = [];

  if (status) {
    updates.push('status = ?'); values.push(status);
    if (status === 'resolved') { updates.push('resolved_at = datetime("now")'); }
  }
  if (assigned_to !== undefined) { updates.push('assigned_to = ?'); values.push(assigned_to); }
  if (resolution_notes !== undefined) { updates.push('resolution_notes = ?'); values.push(resolution_notes); }
  if (priority) { updates.push('priority = ?'); values.push(priority); }
  values.push(req.params.id);

  db.run(`UPDATE complaints SET ${updates.join(', ')} WHERE id = ?`, values, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Complaint not found' });

    if (status) {
      db.get('SELECT tenant_id, title FROM complaints WHERE id = ?', [req.params.id], (e, c) => {
        if (c) createNotification(c.tenant_id, 'Complaint Update', `Your complaint "${c.title}" is now ${status}`, status === 'resolved' ? 'success' : 'info');
      });
    }

    logActivity(req.user.id, 'update_complaint', 'complaint', req.params.id, `Status: ${status}`, req.ip, 'success');
    res.json({ message: 'Complaint updated' });
  });
};

// POST /api/complaints/:id/messages — send chat message
const sendMessage = (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Message content required' });

  // Verify access
  db.get('SELECT tenant_id FROM complaints WHERE id = ?', [req.params.id], (err, complaint) => {
    if (!complaint) return res.status(404).json({ error: 'Complaint not found' });
    if (req.user.role === 'tenant' && complaint.tenant_id !== req.user.id)
      return res.status(403).json({ error: 'Not your complaint' });

    const id = uuidv4();
    db.run(
      'INSERT INTO messages (id, sender_id, complaint_id, content) VALUES (?, ?, ?, ?)',
      [id, req.user.id, req.params.id, content],
      function (err2) {
        if (err2) return res.status(500).json({ error: err2.message });

        const msg = { id, sender_id: req.user.id, sender_name: req.user.name, complaint_id: req.params.id, content, created_at: new Date().toISOString() };

        // Emit via socket.io if available
        if (req.app.get('io')) {
          req.app.get('io').to(`complaint_${req.params.id}`).emit('new_message', msg);
        }

        res.status(201).json(msg);
      }
    );
  });
};

// GET /api/complaints/stats — for dashboard
const getComplaintStats = (req, res) => {
  db.all(
    `SELECT status, COUNT(*) as count FROM complaints GROUP BY status`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
};

module.exports = { getComplaints, getComplaint, createComplaint, updateComplaint, sendMessage, getComplaintStats };
