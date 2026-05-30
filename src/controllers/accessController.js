// src/controllers/accessController.js
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const { logActivity, createNotification } = require('../utils/helpers');

// ─── ACCESS CARDS ───────────────────────────────────────────

// GET /api/access/cards — tenant gets own; admin gets all
const getAccessCards = (req, res) => {
  let where = 'WHERE 1=1';
  const params = [];
  if (req.user.role === 'tenant') { where += ' AND ac.tenant_id = ?'; params.push(req.user.id); }

  db.all(
    `SELECT ac.*, u.name as tenant_name, u.email as tenant_email, p.unit_number
     FROM access_cards ac
     JOIN users u ON u.id = ac.tenant_id
     LEFT JOIN leases l ON l.tenant_id = u.id AND l.status='active'
     LEFT JOIN properties p ON p.id = l.property_id
     ${where}
     ORDER BY ac.created_at DESC`,
    params,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
};

// POST /api/access/cards — tenant requests; admin assigns
const createAccessCard = (req, res) => {
  const { card_number, type = 'physical', tenant_id } = req.body;
  const owner = req.user.role === 'admin' ? tenant_id : req.user.id;

  if (!owner) return res.status(400).json({ error: 'Tenant ID required' });
  if (!card_number) return res.status(400).json({ error: 'Card number required' });

  const id = uuidv4();
  db.run(
    'INSERT INTO access_cards (id, tenant_id, card_number, type) VALUES (?, ?, ?, ?)',
    [id, owner, card_number, type],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Card number already exists' });
        return res.status(500).json({ error: err.message });
      }
      logActivity(req.user.id, 'create_card', 'access_card', id, `Card ${card_number} issued`, req.ip, 'new_entry');
      createNotification(owner, 'Access Card', `Your ${type} access card ${card_number} has been activated.`, 'success');
      res.status(201).json({ id, card_number, message: 'Access card created' });
    }
  );
};

// PUT /api/access/cards/:id — update status
const updateAccessCard = (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'Status required' });

  db.run(
    'UPDATE access_cards SET status = ? WHERE id = ?',
    [status, req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Card not found' });
      logActivity(req.user.id, 'update_card', 'access_card', req.params.id, `Card status: ${status}`, req.ip);
      res.json({ message: `Card ${status}` });
    }
  );
};

// DELETE /api/access/cards/:id
const deleteAccessCard = (req, res) => {
  db.run('DELETE FROM access_cards WHERE id = ?', [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Card not found' });
    res.json({ message: 'Card deleted' });
  });
};

// ─── VISITOR CODES ───────────────────────────────────────────

// GET /api/access/visitor-codes
const getVisitorCodes = (req, res) => {
  let where = 'WHERE 1=1';
  const params = [];
  if (req.user.role === 'tenant') { where += ' AND vc.tenant_id = ?'; params.push(req.user.id); }

  db.all(
    `SELECT vc.*, u.name as tenant_name, p.unit_number
     FROM visitor_codes vc
     JOIN users u ON u.id = vc.tenant_id
     LEFT JOIN leases l ON l.tenant_id = u.id AND l.status='active'
     LEFT JOIN properties p ON p.id = l.property_id
     ${where}
     ORDER BY vc.created_at DESC`,
    params,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      // Auto-expire codes
      db.run("UPDATE visitor_codes SET status='expired' WHERE valid_until < datetime('now') AND status='active'");
      res.json(rows);
    }
  );
};

// POST /api/access/visitor-codes — tenant generates a code
const createVisitorCode = (req, res) => {
  const { visitor_name, visitor_phone, valid_from, valid_until, max_uses = 1 } = req.body;
  if (!valid_until) return res.status(400).json({ error: 'valid_until required' });

  const id = uuidv4();
  // 6-digit alphanumeric code
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();

  db.run(
    'INSERT INTO visitor_codes (id, tenant_id, code, visitor_name, visitor_phone, valid_from, valid_until, max_uses) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, req.user.id, code, visitor_name, visitor_phone, valid_from || new Date().toISOString(), valid_until, max_uses],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      logActivity(req.user.id, 'create_visitor_code', 'visitor_code', id, `Code ${code} for ${visitor_name || 'visitor'}`, req.ip, 'new_entry');
      res.status(201).json({ id, code, message: 'Visitor code generated' });
    }
  );
};

// DELETE /api/access/visitor-codes/:id — revoke
const revokeVisitorCode = (req, res) => {
  const ownerId = req.user.role === 'tenant' ? req.user.id : null;
  const where = ownerId ? 'id = ? AND tenant_id = ?' : 'id = ?';
  const params = ownerId ? [req.params.id, ownerId] : [req.params.id];

  db.run(`UPDATE visitor_codes SET status='revoked' WHERE ${where}`, params, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Code not found' });
    res.json({ message: 'Visitor code revoked' });
  });
};

// POST /api/access/verify — gate system verifies card/code
const verifyAccess = (req, res) => {
  const { identifier, direction = 'entry' } = req.body;
  if (!identifier) return res.status(400).json({ error: 'identifier required' });

  const logId = uuidv4();

  // Check physical/NFC card
  db.get(
    `SELECT ac.*, u.name as tenant_name, p.unit_number
     FROM access_cards ac
     JOIN users u ON u.id = ac.tenant_id
     LEFT JOIN leases l ON l.tenant_id = u.id AND l.status='active'
     LEFT JOIN properties p ON p.id = l.property_id
     WHERE ac.card_number = ? AND ac.status = 'active'`,
    [identifier],
    (err, card) => {
      if (card) {
        db.run('INSERT INTO access_logs (id, person_id, card_id, access_type, direction, status) VALUES (?, ?, ?, "card", ?, "granted")',
          [logId, card.tenant_id, card.id, direction]);
        return res.json({ granted: true, type: 'card', tenant: card.tenant_name, unit: card.unit_number });
      }

      // Check visitor code
      db.get(
        `SELECT vc.*, u.name as tenant_name, p.unit_number
         FROM visitor_codes vc
         JOIN users u ON u.id = vc.tenant_id
         LEFT JOIN leases l ON l.tenant_id = u.id AND l.status='active'
         LEFT JOIN properties p ON p.id = l.property_id
         WHERE vc.code = ? AND vc.status='active' AND vc.valid_until >= datetime('now')
           AND vc.used_count < vc.max_uses`,
        [identifier],
        (err2, code) => {
          if (code) {
            db.run('UPDATE visitor_codes SET used_count = used_count + 1 WHERE id = ?', [code.id]);
            db.run('INSERT INTO access_logs (id, visitor_code_id, access_type, direction, status) VALUES (?, ?, "visitor_code", ?, "granted")',
              [logId, code.id, direction]);
            return res.json({ granted: true, type: 'visitor_code', visitor: code.visitor_name, host: code.tenant_name });
          }

          // Denied
          db.run('INSERT INTO access_logs (id, access_type, direction, status, notes) VALUES (?, "manual", ?, "denied", ?)',
            [logId, direction, `Unknown: ${identifier}`]);
          res.status(401).json({ granted: false, message: 'Access denied' });
        }
      );
    }
  );
};

// GET /api/access/logs — access history
const getAccessLogs = (req, res) => {
  const { limit = 50, page = 1 } = req.query;
  const offset = (page - 1) * limit;
  let where = 'WHERE 1=1';
  const params = [];

  if (req.user.role === 'tenant') {
    where += ' AND (ac.tenant_id = ? OR vc.tenant_id = ?)';
    params.push(req.user.id, req.user.id);
  }

  db.all(
    `SELECT al.*,
      u.name as tenant_name,
      ac.card_number,
      vc.code as visitor_code, vc.visitor_name
     FROM access_logs al
     LEFT JOIN access_cards ac ON ac.id = al.card_id
     LEFT JOIN visitor_codes vc ON vc.id = al.visitor_code_id
     LEFT JOIN users u ON u.id = COALESCE(al.person_id, ac.tenant_id, vc.tenant_id)
     ${where}
     ORDER BY al.timestamp DESC
     LIMIT ? OFFSET ?`,
    [...params, parseInt(limit), offset],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
};

module.exports = {
  getAccessCards, createAccessCard, updateAccessCard, deleteAccessCard,
  getVisitorCodes, createVisitorCode, revokeVisitorCode,
  verifyAccess, getAccessLogs
};
